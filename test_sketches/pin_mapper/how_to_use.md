# DB25 pin mapper

Finds out which DB25 pin on the controller box does what (step, direction, enable, spindle relay, E-stop) by driving one pin at a time from the Nano and watching the board's LEDs. Use it to check the pinout from the research. If the research finds no pinout, this test is how you get one.

**Nano status:** tested on COM8 (CH340 chip). Upload with **Board: Arduino Nano, Processor: ATmega328P**. This Nano uses the new bootloader, so do **not** pick "Old Bootloader". The sketch is already on it.

## Before you start (box OFF and unplugged from the wall)

- Motor cables **unplugged** from the box. Only plug or unplug them with the box off.
- VFD unplugged from the wall. Pump socket empty.
- Box lid off so you can see the LEDs. Hands and phone out of the box while it's on: the power supply's left screw terminals carry wall voltage.
- The Nano gets power from USB only. Never connect it to the box's 24V or VCC terminals.

## Step 1: Multimeter check (nothing connected to the DB25)

1. Box ON. Multimeter on DC volts.
2. Black probe in DB25 **pin 25** (a ground pin). Red probe in each of pins **1–17**, one at a time. Write each reading in the table below.
3. **Any reading above 5.5V, or negative: stop.** Don't connect the Nano. Report it first.
4. Box OFF. Switch to continuity (beep) mode. Check pin 25 against pins 18–24. They should all beep, since they're all ground.

## Finding pin numbers on the box's socket

The box has a **female** socket. Looking straight at it, the wide row has 13 holes (pins 1–13) and the narrow row has 12 (pins 14–25). **Pin 1 is at the right end of the wide row.** Tiny numbers are often molded next to the holes, so check for those too.

## Step 2: Wiring (box OFF)

| Nano | DB25 |
|---|---|
| GND | pin 25 (stays there the whole time) |
| D2 | the pin being tested (you'll move this one) |

Use female-to-male jumper wires: the female end goes on the Nano's header pin, and the male end pushes into the DB25 socket. Don't let the bare end touch the metal case.

## Step 3: Map the output pins (1–9, 14, 16, 17)

1. Plug the Nano into the PC, then turn the box ON.
2. In the Arduino IDE, open Serial Monitor at **115200 baud**, then type `b` and press Enter. D2 now alternates every second, and the Nano's onboard LED blinks along with it.
3. Put the D2 wire in a pin. Watch for 3–4 blinks:
   - **Which board LED blinks?** (X-PU, X-DR, Y-PU, Y-DR, Z-PU, Z-DR, enable 使能, spindle 主轴…)
   - **Polarity:** does the board LED light when the monitor says `D2 HIGH` or `D2 LOW`? Lit on LOW means **active-low**, which is common for these boards.
   - Does a relay click? That's harmless, because the VFD and pump are unplugged.
4. Move the wire to the next pin. Moving it while blinking is fine, or type `s` first if you'd rather.
5. `h` and `l` hold D2 steady HIGH or LOW, which helps with an LED that's hard to judge.

## Step 4: Find the E-stop pin (input pins 10, 11, 12, 13, 15)

1. Type `r` and press Enter. D2 becomes an input and prints a line each time it changes.
2. Put the D2 wire in each input pin, then press and release the E-stop.
3. The pin that prints a change is the E-stop. Note whether **pressed** reads HIGH or LOW.

When you're done: type `s`, turn the box OFF, then pull the wires.

## Worksheet

Pins marked "out" or "in" follow the standard parallel-port layout. Those are only expectations for now, so trust what you see.

| DB25 pin | Std. use | Volts (box on, nothing connected) | Board LED that blinks / what happens | Lit on HIGH or LOW |
|---|---|---|---|---|
| 1 | out | | | |
| 2 | out | | | |
| 3 | out | | | |
| 4 | out | | | |
| 5 | out | | | |
| 6 | out | | | |
| 7 | out | | | |
| 8 | out | | | |
| 9 | out | | | |
| 14 | out | | | |
| 16 | out | | | |
| 17 | out | | | |
| 10 | in | | E-stop? pressed reads: | |
| 11 | in | | E-stop? pressed reads: | |
| 12 | in | | E-stop? pressed reads: | |
| 13 | in | | E-stop? pressed reads: | |
| 15 | in | | E-stop? pressed reads: | |
| 18–24 | GND | beeps to 25? | | |

Also note any board LEDs that were already lit before anything was connected.

Bring the filled table back here. The step/dir/enable pins and their polarity become the GRBL wiring and the `$3` (direction invert) and `$4` (enable invert) settings. Step-pulse invert is set in `$2`, which goes in the same settings.

## Notes

- Close Serial Monitor before uploading anything else. It locks COM8.
- Later, GRBL resets the Nano every time a sender connects. That's one reason motion tests wait until the E-stop is wired.
