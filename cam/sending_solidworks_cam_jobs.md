# Sending SOLIDWORKS CAM jobs to the router

SOLIDWORKS CAM doesn't come with a GRBL post processor, so you post with the Mach3 one (it's the closest) and then run the file through `solidworks_to_grbl.py`, which cleans out the stuff GRBL can't handle.

## One time setup in SOLIDWORKS CAM

1. On the SOLIDWORKS CAM tab, click **Define Machine**.
2. On the **Machine** tab pick **Mill - Metric**.
3. On the **Post Processor** tab click **Browse** and pick `mach_iii.ctl` from `C:\ProgramData\SOLIDWORKS\SOLIDWORKS CAM 2026\Posts\Mill`. Click **Select**, then **OK**.
4. Right click **Mill Part Setup** > **Edit Definition** > **Origin** tab, and set the origin to the spot you'll zero the router on (the top front left corner of the stock is easiest). Whatever point you pick here is where you put X0 Y0 Z0 in gSender.

## Every job

1. Set up your features and operations like normal, then **Generate Toolpath**.
2. Leave cutter compensation off (the default, "computer" compensation, is fine). Feeds have to be per minute, not per rev.
3. Click **Post Process**, save the file somewhere you can find it, and click the play button in the post window.
4. Drag that file onto `drag_file_here_to_convert.bat` in this folder. You'll get a new file next to it ending in `_grbl.nc`.
   If you'd rather use a terminal: `python solidworks_to_grbl.py yourfile.txt`
5. Open the `_grbl.nc` file in gSender, zero X, Y and Z on the same point as the CAM origin, and run it.

## What the converter changes

- Takes out the `%` and `O` program lines, line numbers, tool length offsets (G43/G49) and Mach3-only codes.
- Turns drilling cycles (G81, G82, G83, G73) into normal moves, since GRBL doesn't have them.
- Replaces G28 home moves with a lift to Z10 and a move back to X0 Y0 (there are no homing switches).
- If the job uses more than one tool, it stops the spindle, lifts Z and pauses at each tool change. Swap the bit, re-zero Z, then press resume in gSender.

If it says it can't convert a file, it tells you why. It's almost always cutter compensation (G41/G42) or feed per rev (G95) being turned on in the operation settings.

Change the lift height with `--safe-z`, for example `python solidworks_to_grbl.py part.txt --safe-z 20`.
