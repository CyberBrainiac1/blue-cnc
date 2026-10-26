// Real-time keyboard jog for the JP-3163B box, driven straight from the Nano (no GRBL).
// Pair with jog.py on the PC: hold arrow keys / A-D and the axes move until you let go.
//
// Wiring (straight across, as tested with keypress_test):
//   DB25 2/3 = X step/dir <- D2/D3
//   DB25 4/5 = Y step/dir <- D4/D5
//   DB25 6/7 = Z step/dir <- D6/D7
//   DB25 18  = ground     <- GND
//
// Dead-man: the PC must keep sending jog commands (every 50 ms). If none arrive for
// 300 ms (window lost focus, app crashed, USB pulled), every axis ramps to a stop.
// The real E-stop is still the power-cut switch at the outlet.
//
// Serial protocol, 115200 baud, one command per line:
//   Jxyz   jog direction per axis, each '+', '-' or '0'  (e.g. J+0- = X+, Z-)
//   F3000  max speed in steps/s (20-8000)
//   S      stop immediately, no ramp
//   Z      zero the step counters
//   ?      print status
// Replies: "READY realtime_jog", "P x y z" (positions in steps), "F n", "ERR ...".

struct Axis {
  char name;
  uint8_t stepPin;
  uint8_t dirPin;
  long position;
  int8_t target;           // -1, 0, +1 from the PC
  float speed;             // signed steps/s
  unsigned long periodUs;  // time between steps at the current speed, 0 = stopped
  int8_t dir;              // direction currently on the dir pin, 0 = not set yet
  unsigned long lastStepUs;  // step schedule, kept even rather than tied to the loop
  bool pulseActive;          // true while a step pulse is in progress
  unsigned long pulseStartUs;
};

Axis axes[] = {
  {'X', 2, 3, 0, 0, 0, 0, 0, 0, false, 0},
  {'Y', 4, 5, 0, 0, 0, 0, 0, 0, false, 0},
  {'Z', 6, 7, 0, 0, 0, 0, 0, 0, false, 0},
};
const uint8_t AXIS_COUNT = sizeof(axes) / sizeof(axes[0]);

const uint8_t STEP_IDLE = HIGH;     // pins idle HIGH and pulse LOW, as in the LED test
const unsigned int PULSE_US = 20;   // long enough for the slow 4N26 optocouplers
const unsigned int MIN_SPEED = 20;
const unsigned int MAX_SPEED = 8000;
const float START_SPEED = 50;       // motors start and stop instantly below this
const float MIN_ACCEL = 1500;       // steps/s^2
const float RAMP_TIME = 0.4;        // seconds from standstill to full speed
const unsigned long DEADMAN_MS = 300;
const unsigned long REPORT_MS = 100;

float maxSpeed = 200;
float accel = MIN_ACCEL;
unsigned long lastJogMs = 0;
unsigned long lastUpdateUs = 0;
unsigned long lastReportMs = 0;
bool wasMoving = false;

char line[16];
uint8_t lineLen = 0;

void reportPositions() {
  Serial.print(F("P "));
  for (uint8_t i = 0; i < AXIS_COUNT; i++) {
    Serial.print(axes[i].position);
    Serial.print(i + 1 < AXIS_COUNT ? ' ' : '\n');
  }
}

void stopAll() {
  for (uint8_t i = 0; i < AXIS_COUNT; i++) {
    axes[i].target = 0;
    axes[i].speed = 0;
    axes[i].periodUs = 0;
  }
}

void setMaxSpeed(float s) {
  maxSpeed = s;
  // Faster speeds get a stronger ramp, so reaching full speed always takes about RAMP_TIME.
  accel = max(MIN_ACCEL, maxSpeed / RAMP_TIME);
}

int8_t parseDir(char c) {
  if (c == '+') return 1;
  if (c == '-') return -1;
  return 0;
}

void runCommand() {
  line[lineLen] = '\0';
  lineLen = 0;

  switch (line[0]) {
    case 'J':
      if (strlen(line) != 1 + AXIS_COUNT) { Serial.println(F("ERR bad jog")); return; }
      for (uint8_t i = 0; i < AXIS_COUNT; i++) axes[i].target = parseDir(line[1 + i]);
      lastJogMs = millis();
      break;
    case 'F': {
      long s = atol(line + 1);
      if (s < MIN_SPEED || s > MAX_SPEED) { Serial.println(F("ERR speed 20-8000")); return; }
      setMaxSpeed(s);
      Serial.print(F("F "));
      Serial.println(s);
      break;
    }
    case 'S':
      stopAll();
      reportPositions();
      break;
    case 'Z':
      for (uint8_t i = 0; i < AXIS_COUNT; i++) axes[i].position = 0;
      reportPositions();
      break;
    case '?':
      Serial.print(F("F "));
      Serial.println((long)maxSpeed);
      reportPositions();
      break;
    case '\0':
      break;
    default:
      Serial.println(F("ERR unknown"));
  }
}

void updateSpeed(Axis &a, float dt) {
  float goal = a.target * maxSpeed;
  bool reversingOrStopping = goal == 0 || (a.speed > 0 && goal < 0) || (a.speed < 0 && goal > 0);

  if (reversingOrStopping) {
    // Slow toward zero first; below the start speed the motor can stop at once.
    if (a.speed > 0) a.speed = max(0.0f, a.speed - accel * dt);
    else if (a.speed < 0) a.speed = min(0.0f, a.speed + accel * dt);
    if (fabs(a.speed) < START_SPEED) a.speed = 0;
  } else {
    if (a.speed == 0) a.speed = goal > 0 ? START_SPEED : -START_SPEED;
    if (a.speed < goal) a.speed = min(goal, a.speed + accel * dt);
    else if (a.speed > goal) a.speed = max(goal, a.speed - accel * dt);
  }

  // Work out the step period here, once per millisecond, instead of on every loop.
  a.periodUs = a.speed == 0 ? 0 : (unsigned long)(1000000.0f / fabs(a.speed));
}

void stepIfDue(Axis &a, unsigned long now) {
  // End a running pulse without blocking, so the other axes keep stepping meanwhile.
  if (a.pulseActive) {
    if (now - a.pulseStartUs < PULSE_US) return;
    digitalWrite(a.stepPin, STEP_IDLE);
    a.pulseActive = false;
  }
  if (a.periodUs == 0) return;

  int8_t d = a.speed > 0 ? 1 : -1;
  if (d != a.dir) {
    // New direction: set the pin and wait one full step period before stepping,
    // which gives the optocoupler plenty of setup time.
    digitalWrite(a.dirPin, d > 0 ? HIGH : LOW);
    a.dir = d;
    a.lastStepUs = now;
    return;
  }

  if (now - a.lastStepUs < a.periodUs) return;

  digitalWrite(a.stepPin, !STEP_IDLE);
  a.pulseActive = true;
  a.pulseStartUs = now;
  // Keep an even step rate; only resync if the loop fell far behind.
  if (now - a.lastStepUs > 2 * a.periodUs) a.lastStepUs = now;
  else a.lastStepUs += a.periodUs;
  a.position += d;
}

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < AXIS_COUNT; i++) {
    // Write HIGH before switching to output so no pin glitches LOW at startup.
    digitalWrite(axes[i].stepPin, STEP_IDLE);
    pinMode(axes[i].stepPin, OUTPUT);
    digitalWrite(axes[i].dirPin, HIGH);
    pinMode(axes[i].dirPin, OUTPUT);
  }
  setMaxSpeed(maxSpeed);
  lastUpdateUs = micros();
  Serial.println(F("READY realtime_jog"));
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') runCommand();
    else if (lineLen < sizeof(line) - 1) line[lineLen++] = ch;
  }

  if (millis() - lastJogMs > DEADMAN_MS) {
    for (uint8_t i = 0; i < AXIS_COUNT; i++) axes[i].target = 0;
  }

  unsigned long now = micros();
  if (now - lastUpdateUs >= 1000) {
    float dt = (now - lastUpdateUs) / 1000000.0f;
    lastUpdateUs = now;
    for (uint8_t i = 0; i < AXIS_COUNT; i++) updateSpeed(axes[i], dt);
  }

  bool moving = false;
  for (uint8_t i = 0; i < AXIS_COUNT; i++) {
    stepIfDue(axes[i], micros());
    if (axes[i].periodUs != 0) moving = true;
  }

  // Positions while moving, plus one final report when everything stops.
  if ((moving && millis() - lastReportMs >= REPORT_MS) || (wasMoving && !moving)) {
    lastReportMs = millis();
    reportPositions();
  }
  wasMoving = moving;
}
