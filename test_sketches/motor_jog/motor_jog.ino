// Manual motor jog for the JP-3163B box, driven straight from the Nano (no GRBL).
//
// Wiring (straight across, as tested with keypress_test):
//   DB25 2/3 = X step/dir <- D2/D3
//   DB25 4/5 = Y step/dir <- D4/D5
//   DB25 6/7 = Z step/dir <- D6/D7
//   DB25 18  = ground     <- GND
//
// Stopping: the real E-stop is the power-cut switch at the outlet. Typing anything
// in Serial Monitor also stops a move. Optional: a normally-open button from A0 to GND
// stops moves too. Left unwired, A0's pull-up keeps it inactive.
//
// Moves are in motor steps, not mm. Steps per mm isn't known yet.
//
// Serial Monitor: 115200 baud, line ending "Newline". Commands:
//   x 50     move X by +50 steps     (x -50 goes the other way; same for y and z)
//   f 300    set speed in steps per second (20-1000, starts at 200)
//   p        show step counts since power-up
//   ?        help

struct Axis {
  char name;
  uint8_t stepPin;
  uint8_t dirPin;
  long position;
};

Axis axes[] = {
  {'X', 2, 3, 0},
  {'Y', 4, 5, 0},
  {'Z', 6, 7, 0},
};
const uint8_t AXIS_COUNT = sizeof(axes) / sizeof(axes[0]);

const uint8_t ESTOP_PIN = A0;      // optional normally-open button to GND, LOW = pressed
const uint8_t STEP_IDLE = HIGH;    // pins idle HIGH and pulse LOW, as in the LED test
const unsigned int PULSE_US = 50;  // long pulse for the slow 4N26 optocouplers
const unsigned int DIR_SETUP_MS = 2;

const long MAX_STEPS = 1000;       // per command, so a typo can't run an axis far
const unsigned int MIN_SPEED = 20;
const unsigned int MAX_SPEED = 1000;
const unsigned int START_SPEED = 100;  // ramp from here up to the set speed
const unsigned int RAMP_STEPS = 50;

unsigned int speed = 200;

char line[24];
uint8_t lineLen = 0;
unsigned long lastCharMs = 0;

bool estopPressed() {
  return digitalRead(ESTOP_PIN) == LOW;
}

void printHelp() {
  Serial.println(F("--- Motor jog (steps, not mm) ---"));
  Serial.println(F("x 50 / x -50   move X (same for y, z), max 1000 steps"));
  Serial.println(F("f 300          speed in steps/s (20-1000)"));
  Serial.println(F("p              step counts since power-up"));
  Serial.println(F("Typing anything stops a move. Outlet E-stop cuts all power."));
}

void printPositions() {
  for (uint8_t i = 0; i < AXIS_COUNT; i++) {
    Serial.print(axes[i].name);
    Serial.print(F("="));
    Serial.print(axes[i].position);
    Serial.print(F("  "));
  }
  Serial.println(F("(steps)"));
}

unsigned long periodForStep(long i, long total) {
  // Linear speed ramp at both ends of the move so the motors don't stall.
  unsigned int target = speed;
  if (target <= START_SPEED) return 1000000UL / target;
  long fromEdge = min(i, total - 1 - i);
  if (fromEdge >= RAMP_STEPS) return 1000000UL / target;
  unsigned int s = START_SPEED + (unsigned long)(target - START_SPEED) * fromEdge / RAMP_STEPS;
  return 1000000UL / s;
}

void moveAxis(Axis &a, long steps) {
  long total = labs(steps);
  int8_t sign = steps > 0 ? 1 : -1;

  digitalWrite(a.dirPin, steps > 0 ? HIGH : LOW);
  delay(DIR_SETUP_MS);

  Serial.print(F("Moving "));
  Serial.print(a.name);
  Serial.print(F(" "));
  Serial.print(steps);
  Serial.println(F(" steps..."));

  long done = 0;
  const __FlashStringHelper *stopReason = NULL;
  while (done < total) {
    if (estopPressed()) { stopReason = F("A0 stop button pressed"); break; }
    if (Serial.available()) { stopReason = F("stopped by keypress"); break; }

    unsigned long start = micros();
    digitalWrite(a.stepPin, !STEP_IDLE);
    delayMicroseconds(PULSE_US);
    digitalWrite(a.stepPin, STEP_IDLE);
    done++;
    a.position += sign;

    unsigned long period = periodForStep(done - 1, total);
    while (micros() - start < period) {}
  }

  if (stopReason) {
    while (Serial.available()) Serial.read();
    lineLen = 0;
    Serial.print(F("STOPPED ("));
    Serial.print(stopReason);
    Serial.print(F(") after "));
    Serial.print(done);
    Serial.println(F(" steps."));
  } else {
    Serial.println(F("Done."));
  }
  printPositions();
}

void runCommand() {
  line[lineLen] = '\0';
  lineLen = 0;
  if (line[0] == '\0') return;

  char c = tolower(line[0]);
  if (c == '?') { printHelp(); return; }
  if (c == 'p') { printPositions(); return; }

  if (c == 'f') {
    long s = atol(line + 1);
    if (s < MIN_SPEED || s > MAX_SPEED) {
      Serial.println(F("Speed must be 20-1000 steps/s."));
      return;
    }
    speed = s;
    Serial.print(F("Speed = "));
    Serial.print(speed);
    Serial.println(F(" steps/s"));
    return;
  }

  for (uint8_t i = 0; i < AXIS_COUNT; i++) {
    if (toupper(c) != axes[i].name) continue;

    long steps = atol(line + 1);
    if (steps == 0) {
      Serial.println(F("Give a step count, e.g. x 50 or x -50."));
      return;
    }
    if (labs(steps) > MAX_STEPS) {
      Serial.println(F("Max 1000 steps per command."));
      return;
    }
    if (estopPressed()) {
      Serial.println(F("A0 stop button is pressed. Release it first."));
      return;
    }
    moveAxis(axes[i], steps);
    return;
  }

  Serial.print(F("Unknown command: "));
  Serial.println(line);
}

void setup() {
  Serial.begin(115200);
  pinMode(ESTOP_PIN, INPUT_PULLUP);
  for (uint8_t i = 0; i < AXIS_COUNT; i++) {
    // Write HIGH before switching to output so no pin glitches LOW at startup.
    digitalWrite(axes[i].stepPin, STEP_IDLE);
    pinMode(axes[i].stepPin, OUTPUT);
    digitalWrite(axes[i].dirPin, HIGH);
    pinMode(axes[i].dirPin, OUTPUT);
  }
  printHelp();
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    lastCharMs = millis();
    if (ch == '\n' || ch == '\r') {
      runCommand();
    } else if (lineLen < sizeof(line) - 1) {
      line[lineLen++] = ch;
    }
  }
  // Also run a command if Serial Monitor is set to "No line ending".
  if (lineLen > 0 && millis() - lastCharMs > 300) runCommand();
}
