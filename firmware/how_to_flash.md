# Flashing GRBL onto the Nano

The `grbl` folder is GRBL 1.1h with two lines turned on in `config.h`:

- `USE_SPINDLE_DIR_AS_ENABLE_PIN`, so D13 switches the spindle relay on and off
- `SPINDLE_ENABLE_OFF_WITH_ZERO_SPEED`, so S0 also turns the spindle off

Don't flash plain GRBL from the internet, or the spindle relay won't work.

## Steps

1. Install the Arduino IDE or arduino-cli.
2. Plug in the Nano. It's a CH340 clone with the new bootloader (COM8 or COM5 usually).
3. With arduino-cli, from this folder:

   ```
   arduino-cli compile --fqbn arduino:avr:nano:cpu=atmega328 --library grbl -u -p COM8 grbl/examples/grblUpload
   ```

   In the Arduino IDE instead: copy the `grbl` folder into your Arduino `libraries` folder, open File > Examples > grbl > grblUpload, pick **Arduino Nano** with processor **ATmega328P** (not "Old Bootloader") and upload.
4. If it says "programmer is not responding", just upload again. That happens with this Nano.
5. Open gSender, connect, and type `$I`. It should show `[OPT:VD0,15,128]`.
6. Paste everything from `grbl_settings.txt` into gSender's console to load the machine settings.
