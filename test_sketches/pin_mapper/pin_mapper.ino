// DB25 pin mapper for the JP-3163B controller box.
//
// One jumper wire goes from the Nano's D2 to one socket of the box's DB25 port,
// and a second wire goes from the Nano's GND to DB25 pin 25 (a ground pin).
// The sketch drives or reads D2 so you can see which board LED or signal each DB25
// pin is. Move the D2 wire from pin to pin and record what happens.
//
// Safety: motor cables unplugged (with the box off), VFD unplugged from the wall,
// pump socket empty. The Nano is powered from USB only. Never connect it to the box's
// 24V or VCC terminals.
//
// Serial Monitor: 115200 baud. Commands (type the letter and press Enter):
//   b  blink  - D2 alternates HIGH/LOW every second (use this for output pins)
//   h  high   - hold D2 HIGH (5V)
//   l  low    - hold D2 LOW (0V)
//   r  read   - D2 becomes an input with a pull-up, prints changes (use for E-stop / limit pins)
//   s  safe   - D2 stops driving anything (the default at power-up)
//   ?  help

const uint8_t PROBE_PIN = 2;
const unsigned long BLINK_MS = 1000;
const unsigned long DEBOUNCE_MS = 20;

enum Mode { SAFE, BLINK, HOLD_HIGH, HOLD_LOW, READ };
Mode mode = SAFE;

bool blinkState = false;
unsigned long lastToggle = 0;

int lastReading = -1;
int stableReading = -1;
unsigned long lastChange = 0;

void printHelp() {
  Serial.println(F("--- DB25 pin mapper (probe = D2) ---"));
  Serial.println(F("b = blink   h = hold HIGH   l = hold LOW"));
  Serial.println(F("r = read input (E-stop/limits)   s = safe (stop driving)   ? = help"));
  Serial.println(F("The Nano's onboard LED mirrors D2 while driving."));
}

void setMode(Mode m) {
  mode = m;
  switch (m) {
    case SAFE:
      pinMode(PROBE_PIN, INPUT);
      digitalWrite(LED_BUILTIN, LOW);
      Serial.println(F("SAFE: D2 is not driving anything. OK to move the wire."));
      break;
    case BLINK:
      pinMode(PROBE_PIN, OUTPUT);
      blinkState = false;
      lastToggle = millis() - BLINK_MS;  // toggle right away
      Serial.println(F("BLINK: D2 alternates every second. Watch the board LEDs."));
      break;
    case HOLD_HIGH:
      pinMode(PROBE_PIN, OUTPUT);
      digitalWrite(PROBE_PIN, HIGH);
      digitalWrite(LED_BUILTIN, HIGH);
      Serial.println(F("HIGH: D2 held at 5V."));
      break;
    case HOLD_LOW:
      pinMode(PROBE_PIN, OUTPUT);
      digitalWrite(PROBE_PIN, LOW);
      digitalWrite(LED_BUILTIN, LOW);
      Serial.println(F("LOW: D2 held at 0V."));
      break;
    case READ:
      pinMode(PROBE_PIN, INPUT_PULLUP);
      digitalWrite(LED_BUILTIN, LOW);
      lastReading = -1;
      stableReading = -1;
      Serial.println(F("READ: reporting D2 changes. Press/release the E-stop."));
      break;
  }
}

void handleCommand(char c) {
  switch (c) {
    case 'b': case 'B': setMode(BLINK); break;
    case 'h': case 'H': setMode(HOLD_HIGH); break;
    case 'l': case 'L': setMode(HOLD_LOW); break;
    case 'r': case 'R': setMode(READ); break;
    case 's': case 'S': setMode(SAFE); break;
    case '?': printHelp(); break;
    case '\r': case '\n': case ' ': break;
    default:
      Serial.print(F("Unknown command: "));
      Serial.println(c);
      printHelp();
  }
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
  setMode(SAFE);
  printHelp();
}

void loop() {
  while (Serial.available()) {
    handleCommand(Serial.read());
  }

  unsigned long now = millis();

  if (mode == BLINK && now - lastToggle >= BLINK_MS) {
    lastToggle = now;
    blinkState = !blinkState;
    digitalWrite(PROBE_PIN, blinkState ? HIGH : LOW);
    digitalWrite(LED_BUILTIN, blinkState ? HIGH : LOW);
    Serial.println(blinkState ? F("D2 HIGH (5V)") : F("D2 LOW (0V)"));
  }

  if (mode == READ) {
    int reading = digitalRead(PROBE_PIN);
    if (reading != lastReading) {
      lastReading = reading;
      lastChange = now;
    }
    if (reading != stableReading && now - lastChange >= DEBOUNCE_MS) {
      stableReading = reading;
      Serial.println(reading == HIGH ? F("D2 reads HIGH") : F("D2 reads LOW"));
    }
  }
}
