// Wiring test for the Nano -> DB25 connection, using GRBL 1.1's own Nano pin map
// (checked against gnea/grbl cpu_map.h), so the same wires work once GRBL is flashed.
//
//   DB25 2  X step       <- D2
//   DB25 3  X direction  <- D5
//   DB25 4  Y step       <- D3
//   DB25 5  Y direction  <- D6
//   DB25 6  Z step       <- D4
//   DB25 7  Z direction  <- D7
//   DB25 18 ground       <- GND
//
// All six pins idle HIGH. One at a time, in DB25 order, a pin goes LOW for 3 s.
// Watch the board's X-PU, X-DR, Y-PU, Y-DR, Z-PU, Z-DR LEDs. Each line should change
// only its own LED. Run it with the motor cables unplugged (unplug them with the box off).
//
// Serial Monitor: 115200 baud.

struct Signal {
  uint8_t nanoPin;
  uint8_t db25Pin;
  const char *name;
};

const Signal signals[] = {
  {2, 2, "X step (X-PU)"},
  {5, 3, "X direction (X-DR)"},
  {3, 4, "Y step (Y-PU)"},
  {6, 5, "Y direction (Y-DR)"},
  {4, 6, "Z step (Z-PU)"},
  {7, 7, "Z direction (Z-DR)"},
};
const uint8_t SIGNAL_COUNT = sizeof(signals) / sizeof(signals[0]);

const unsigned long LOW_MS = 3000;
const unsigned long GAP_MS = 2000;

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < SIGNAL_COUNT; i++) {
    // Write HIGH before switching to output so the pin never glitches LOW at startup.
    digitalWrite(signals[i].nanoPin, HIGH);
    pinMode(signals[i].nanoPin, OUTPUT);
  }
  Serial.println(F("--- Wiring test: all pins HIGH, one goes LOW at a time ---"));
}

void loop() {
  for (uint8_t i = 0; i < SIGNAL_COUNT; i++) {
    const Signal &s = signals[i];
    Serial.print(F("D"));
    Serial.print(s.nanoPin);
    Serial.print(F(" -> DB25 "));
    Serial.print(s.db25Pin);
    Serial.print(F("  "));
    Serial.print(s.name);
    Serial.println(F("  LOW for 3 s"));

    digitalWrite(s.nanoPin, LOW);
    delay(LOW_MS);
    digitalWrite(s.nanoPin, HIGH);
    delay(GAP_MS);
  }
  Serial.println(F("--- cycle done, repeating ---"));
}
