// Keypress LED test for the Nano -> DB25 wiring, as wired straight across
// (Nano D2-D7 to DB25 holes 2-7). Note: standard GRBL expects X/Y/Z step on D2/D3/D4
// and X/Y/Z direction on D5/D6/D7, so this wiring needs changing before GRBL runs.
//
// Type a DB25 hole number (2-7) in Serial Monitor and press Enter: that hole goes LOW
// and stays LOW, and every other hole goes back HIGH. Watch which board LED changes.
// Type the same number again, or 0, to put everything back HIGH.
//
//   DB25 2  X step       <- D2
//   DB25 3  X direction  <- D3
//   DB25 4  Y step       <- D4
//   DB25 5  Y direction  <- D5
//   DB25 6  Z step       <- D6
//   DB25 7  Z direction  <- D7
//   DB25 18 ground       <- GND
//
// Run it with the motor cables unplugged (unplug them with the box off).
// Serial Monitor: 115200 baud.

struct Signal {
  uint8_t nanoPin;
  uint8_t db25Pin;
  const char *name;
};

const Signal signals[] = {
  {2, 2, "X step (X-PU)"},
  {3, 3, "X direction (X-DR)"},
  {4, 4, "Y step (Y-PU)"},
  {5, 5, "Y direction (Y-DR)"},
  {6, 6, "Z step (Z-PU)"},
  {7, 7, "Z direction (Z-DR)"},
};
const uint8_t SIGNAL_COUNT = sizeof(signals) / sizeof(signals[0]);

int8_t activeIndex = -1;  // which signal is LOW, -1 = none

void printHelp() {
  Serial.println(F("--- Keypress LED test ---"));
  Serial.println(F("Type a DB25 hole number and press Enter:"));
  for (uint8_t i = 0; i < SIGNAL_COUNT; i++) {
    Serial.print(F("  "));
    Serial.print(signals[i].db25Pin);
    Serial.print(F(" = D"));
    Serial.print(signals[i].nanoPin);
    Serial.print(F("  "));
    Serial.println(signals[i].name);
  }
  Serial.println(F("  0 = all HIGH (nothing active)   ? = this help"));
}

void allHigh() {
  for (uint8_t i = 0; i < SIGNAL_COUNT; i++) {
    digitalWrite(signals[i].nanoPin, HIGH);
  }
  activeIndex = -1;
}

void selectHole(uint8_t hole) {
  for (uint8_t i = 0; i < SIGNAL_COUNT; i++) {
    if (signals[i].db25Pin != hole) continue;

    if (activeIndex == i) {
      allHigh();
      Serial.println(F("All HIGH (nothing active)."));
      return;
    }
    allHigh();
    digitalWrite(signals[i].nanoPin, LOW);
    activeIndex = i;
    Serial.print(F("DB25 "));
    Serial.print(hole);
    Serial.print(F(" (D"));
    Serial.print(signals[i].nanoPin);
    Serial.print(F(") is LOW: expect "));
    Serial.print(signals[i].name);
    Serial.println(F(" to change. Which LED changed?"));
    return;
  }

  Serial.print(F("DB25 "));
  Serial.print(hole);
  Serial.println(F(" isn't wired in this test. Use 2-7, or 0 for all HIGH."));
}

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < SIGNAL_COUNT; i++) {
    // Write HIGH before switching to output so the pin never glitches LOW at startup.
    digitalWrite(signals[i].nanoPin, HIGH);
    pinMode(signals[i].nanoPin, OUTPUT);
  }
  printHelp();
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c >= '1' && c <= '9') {
      selectHole(c - '0');
    } else if (c == '0') {
      allHigh();
      Serial.println(F("All HIGH (nothing active)."));
    } else if (c == '?') {
      printHelp();
    }
  }
}
