// ESP32 keypress LED test for the ESP32 -> DB25 wiring.
// Same idea as the Nano's keypress_test, and it answers one extra question: are the
// ESP32's 3.3V signals enough to switch the board's 5V optocoupler inputs cleanly?
//
// Type a DB25 hole number (2-7) in Serial Monitor and press Enter: that hole goes LOW
// and stays LOW, and every other hole goes back HIGH (3.3V). Watch which board LED changes.
// Type the same number again, or 0, to put everything back HIGH.
//
//   DB25 2  X step       <- GPIO 32
//   DB25 3  X direction  <- GPIO 33
//   DB25 4  Y step       <- GPIO 25
//   DB25 5  Y direction  <- GPIO 26
//   DB25 6  Z step       <- GPIO 27
//   DB25 7  Z direction  <- GPIO 13
//   DB25 18 ground       <- GND
//
// What to look for: each LED should be fully on in one state and fully OFF in the
// other. An LED that glows dimly while its pin is HIGH means 3.3V isn't enough;
// report that before going any further.
//
// Run it with the motor cables unplugged (unplug them with the box off).
// The ESP32 is powered from USB only. Never connect its VIN, 5V or 3V3 to the box.
// Serial Monitor: 115200 baud.

struct Signal {
  uint8_t gpio;
  uint8_t db25Pin;
  const char *name;
};

const Signal signals[] = {
  {32, 2, "X step (X-PU)"},
  {33, 3, "X direction (X-DR)"},
  {25, 4, "Y step (Y-PU)"},
  {26, 5, "Y direction (Y-DR)"},
  {27, 6, "Z step (Z-PU)"},
  {13, 7, "Z direction (Z-DR)"},
};
const uint8_t SIGNAL_COUNT = sizeof(signals) / sizeof(signals[0]);

int8_t activeIndex = -1;  // which signal is LOW, -1 = none

void printHelp() {
  Serial.println("--- ESP32 keypress LED test ---");
  Serial.println("Type a DB25 hole number and press Enter:");
  for (uint8_t i = 0; i < SIGNAL_COUNT; i++) {
    Serial.printf("  %u = GPIO %u  %s\n", signals[i].db25Pin, signals[i].gpio, signals[i].name);
  }
  Serial.println("  0 = all HIGH (nothing active)   ? = this help");
}

void allHigh() {
  for (uint8_t i = 0; i < SIGNAL_COUNT; i++) {
    digitalWrite(signals[i].gpio, HIGH);
  }
  activeIndex = -1;
}

void selectHole(uint8_t hole) {
  for (uint8_t i = 0; i < SIGNAL_COUNT; i++) {
    if (signals[i].db25Pin != hole) continue;

    if (activeIndex == i) {
      allHigh();
      Serial.println("All HIGH (nothing active).");
      return;
    }
    allHigh();
    digitalWrite(signals[i].gpio, LOW);
    activeIndex = i;
    Serial.printf("DB25 %u (GPIO %u) is LOW: expect %s to change. Which LED changed?\n",
                  hole, signals[i].gpio, signals[i].name);
    return;
  }

  Serial.printf("DB25 %u isn't wired in this test. Use 2-7, or 0 for all HIGH.\n", hole);
}

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < SIGNAL_COUNT; i++) {
    // Write HIGH before switching to output so no pin glitches LOW at startup.
    digitalWrite(signals[i].gpio, HIGH);
    pinMode(signals[i].gpio, OUTPUT);
    digitalWrite(signals[i].gpio, HIGH);
  }
  delay(500);  // give Serial Monitor a moment to attach after reset
  printHelp();
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c >= '1' && c <= '9') {
      selectHole(c - '0');
    } else if (c == '0') {
      allHigh();
      Serial.println("All HIGH (nothing active).");
    } else if (c == '?') {
      printHelp();
    }
  }
}
