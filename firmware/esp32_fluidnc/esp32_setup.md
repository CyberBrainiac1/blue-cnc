# ESP32 + FluidNC controller

This replaces the Nano with an ESP32 running **FluidNC**: a free, open-source GRBL-style firmware with a WiFi web interface, room for 6 axes, and much faster stepping. The Nano files elsewhere in this folder are untouched, and the Nano (with GRBL) still works as a fallback.

| File | What it's for |
|---|---|
| `esp32_keypress_test/esp32_keypress_test.ino` | Step 2: checks that the board accepts 3.3V signals |
| `fluidnc/config.yaml` | Step 4: tells FluidNC which pins do what |

## Pinout (30-pin ESP32 DevKit, left header)

The pins are all next to each other on the left header (antenna at the top, USB at the bottom). GPIO 14 and 12 are skipped: they're boot pins, and they can twitch or stop the board booting.

| ESP32 pin | DB25 hole | Signal | Board LED |
|---|---|---|---|
| GPIO 32 | 2 | X step | X-PU |
| GPIO 33 | 3 | X direction | X-DR |
| GPIO 25 | 4 | Y step | Y-PU |
| GPIO 26 | 5 | Y direction | Y-DR |
| GPIO 27 | 6 | Z step | Z-PU |
| GPIO 13 | 7 | Z direction | Z-DR |
| GND | 18 | Ground | none |

On a different ESP32 board layout (for example a 38-pin one), go by the GPIO numbers printed on the board, not by position.

**Later, not wired yet (not used in the config):**

| ESP32 pin | Goes to | For |
|---|---|---|
| GPIO 4 | DB25 1 (unverified) | Spindle relay on/off |
| GPIO 21 | DB25 17 (unverified) | Spindle speed (0-10V circuit) |
| GPIO 17 / 18 / 19 | Endstop switch → GND | X / Y / Z homing, if you add 3D-printer endstops |
| GPIO 22 / 23 | A axis step / dir (DB25 holes unverified) | 4th axis |

## Safety
- The ESP32 gets power **from USB only**. Never connect its VIN, 5V or 3V3 pins to the box.
- Only plug or unplug wires and motor cables with the box **off**.
- The outlet E-stop is the real stop. It should cut power to both the box and the VFD.

## Step 1: Wire it (box off)
Move the 7 jumper wires from the Nano to the ESP32 pins in the table. The DB25 ends stay exactly where they are.

## Step 2: 3.3V LED test (motor cables unplugged)
1. In the Arduino IDE, open **Boards Manager**, install **"esp32 by Espressif Systems"**, and pick the board **ESP32 Dev Module**.
2. Upload `esp32_keypress_test.ino`. If the upload hangs on "Connecting...", hold the **BOOT** button until it starts.
3. Open Serial Monitor at **115200**, then switch the box on.
4. Type `2` to `7` one at a time. Each LED must be **fully on in one state and fully off in the other**.
5. **If any LED glows dimly** while its pin is HIGH, 3.3V isn't enough for this board. Stop there and report it. The fallback is the Nano, which is 5V.

## Step 3: Flash FluidNC
Easiest: open **https://installer.fluidnc.com** in Chrome or Edge, connect the ESP32 over USB, and install the **ESP32 / WiFi** version.
(The other way: download `fluidnc-vX.Y.Z-win64.zip` from github.com/bdring/FluidNC/releases and run `install-wifi.bat`. v4.1.1 was the latest when this was written.)

## Step 4: Load the config
Pick one:
- **WiFi:** connect your PC to the ESP32's WiFi network (**FluidNC**). Open **http://192.168.0.1** and upload `config.yaml` on the files (flash) tab.
- **USB:** run `fluidterm` from the FluidNC zip, press **Ctrl+U**, and pick `config.yaml`.

Then reset the ESP32. Check the boot messages for lines starting with `[MSG:ERR` or `[MSG:WARN`. It should report `Stepping:RMT Pulse:20us`.

## Step 5: Connect a sender
- **gSender:** works, but FluidNC isn't officially supported. Choose **Grbl** (not grblHAL) as the firmware type. Homing and soft limits are where people report problems, and this machine uses neither.
- **Universal G-code Sender (UGS):** works well with FluidNC.
- **No install:** use FluidNC's own web page at the WiFi address above to jog and run files.

## After that
Do the same calibration as planned for the Nano. Then update `steps_per_mm`, `max_rate_mm_per_min`, `acceleration_mm_per_sec2` and `max_travel_mm` in `config.yaml`, and upload it again. If an axis moves the wrong way, add `:low` to its `direction_pin` (for example `gpio.33:low`).
