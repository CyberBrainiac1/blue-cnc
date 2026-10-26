# Spindle + VFD: let GRBL / gSender run the spindle

**VFD:** A131NBC-9015 (single-phase 95–130 V in, 3-phase 110 V out, 0–400 Hz). It uses the "A2 inverter" control board, with terminals 12V OUT, 5V OUT, 5V IN, 10V IN, 20mA IN, 5V Fout, GND, FWD, REV, RST, D0+, D1−, D2 JOG, Lk, Lb, Lz.
Parameter codes below are from the A2 inverter manual, which matches these terminals exactly.

## How the VFD is controlled (from the manual's wiring diagram)
- **Run forward:** close a switch between **FWD** and **GND**. Open it to stop.
- **Speed:** **0–10 V** between **10V IN** and **GND**. 10 V = maximum frequency (Pn 10).

## Wiring (power off, VFD unplugged, wait 10 minutes)
| Controller box terminal | → VFD terminal | Purpose |
|---|---|---|
The box end is the 4-pin header on the main JP-3163B board, labelled **C, NO, 0-10V, GND**. It sits just below the 2-pin 24V/GND power plug. Its screw-terminal plug is missing, so only the bare pins are there.

| Box pin | Wire | → VFD terminal | Purpose |
|---|---|---|---|
| **NO** | orange | **FWD** | relay closes = spindle runs |
| **C** | brown | **GND** | other side of the run switch |
| **0-10V** | red | **10V IN** | spindle speed |
| **GND** | 4th wire | **GND** (same screw as brown) | speed reference |

Leave REV, RST, D0–D2, 5V IN, 20mA IN and the relay outputs (Lk/Lb/Lz) unconnected.

## Test the box's outputs BEFORE connecting them (VFD unplugged)
1. **Relay:** box off, multimeter on continuity. Find which terminal **NO** connects to.
   - Then box on and send `M3 S10000`: NO should now beep to its common (or GND), and `M5` should open it again.
   - **If NO shows 24 V to GND instead of switching**, it's a powered output, not a plain switch. **Don't** connect it to FWD; ask first.
2. **Speed:** multimeter on DC volts, **0-10V to GND**.
   - `M3 S24000` should give about **10 V**, `M3 S12000` about **5 V**, and `M5` about **0 V**. Set `$30` first, see below.

## GRBL settings (gSender console)
| Setting | Value | Why |
|---|---|---|
| `$30` | spindle max RPM from its label (usually **24000**) | so `S24000` = 10 V = full speed |
| `$31` | `0` | minimum PWM |

GRBL on the Nano is already rebuilt so **D13 (DB25 hole 1)** is spindle on/off and **D11 (hole 17)** is speed. `S0` also turns the relay off.

## VFD parameters (set with the VFD stopped)
Editing: press **SET**, choose the Pn with **▲/▼**, press **SET**, change the digit with **◄/►** and **▲/▼**, then press **SET** to save (**STOP** cancels).

| Parameter | Set to | Meaning |
|---|---|---|
| Pn 32 | `1` | allow parameter changes |
| Pn 04 | `2` | run command from terminals (FWD/REV), not the keypad |
| Pn 03 | `4` | speed from external 0–10 V |
| Pn 05 | `1` | clockwise (forward) only |
| Pn 10 | from the spindle label, usually `400` Hz | maximum frequency (= full speed at 10 V) |
| Pn 12 | from the spindle label, usually `400` Hz | motor rated frequency (V/F curve) |
| Pn 11 | about `100` Hz (6000 RPM), check the spindle label's minimum | below this the VFD stops instead of running a water-cooled spindle too slowly |
| Pn 08 | `10` s | acceleration time |
| Pn 09 | `10` s | deceleration time (long enough to avoid over-voltage, since there's no braking resistor) |
| Pn 01 | `24000` (optional) | display shows RPM instead of Hz |

To go back to knob control: **Pn 04 = 1**, **Pn 03 = 1**.

## Safety
- **Water must be flowing through the spindle before every spin.**
- **Nano reset flicker:** the Nano's bootloader blinks D13 when gSender connects, which can briefly close the relay. Connect gSender **before** switching the VFD on, or keep the VFD on knob control (Pn 04 = 1) until you're ready.
- Mains wiring (R/T/ground and U/V/W) must be checked by a mentor.
- **First run:** `M3 S6000` with water flowing. Watch, listen, and check the spindle stays cool before going faster.
