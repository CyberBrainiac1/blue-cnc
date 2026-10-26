# Frame-mounted limit switch brackets (6040)

Nothing goes on the rods or rails, nothing needs drilling, and each bracket slides on without
taking anything apart. Homing goes to **+X (right), +Y (back / motor end), +Z (up)**, which is
GRBL's default direction.

| Axis | Where it mounts | What hits the lever |
|---|---|---|
| X | Saddle over the top edge of the **right gantry side plate**. Its inner jaw reaches down and sits over the end of the **upper 20 mm X rod**, so it drops into place | Right end of the X carriage's top plate (the Z motor plate) |
| Y | C-clip whose tongue slides into the **front groove of the back end plate** from its open right end, until it stops on the end of the plate | Back edge of the right gantry side plate |
| Z | Clip on the **right edge of the Z top plate**, with an arm reaching forward over the spindle holder. A fork on top slides onto the **head of the Z rod's top screw** and stops there | The spindle holder's right clamp ear |

**No measuring:** every bracket finds its own position. X sits on the rod and the plate,
Y stops on the end of the end plate, Z stops on the screw head. Then the M4 locks it.

Switch: KW11 / 10T85 / SS-5GL size (19.8 x 10.2 x 6.4 mm, two 2.35 mm holes 9.5 mm apart,
2.9 mm from the terminal edge), with the **wire lever cut to about 16.5 mm from the hinge pin**.

## What to print

| File | Qty | Notes |
|---|---|---|
| `fit_test_piece.stl` | 1 | **Print this first** (about 15 min). Checks the switch pocket, pin holes, M3/M4 nut traps and bolt holes |
| `pins_test_set.stl` | 1 | 12 pins: 4 each of 2.20 / 2.25 / 2.30 mm (1 / 2 / 3 notches on the strip beside each row). You need 6 |
| `mount_X.stl` | 1 | |
| `mount_Y.stl` | 1 | |
| `mount_Z.stl` | 1 | 118 mm long, prints upside down |

PETG, 0.4 mm nozzle: 0.2 mm layers, 5 walls, 5 top/bottom layers, 40 % infill, **no supports**.
Load each STL as it is; the flat face is already on the bed. Turn on elephant-foot compensation
(about 0.15 mm). For the pins: 0.1 mm layers, brim on, and slow down for the small layers
(minimum layer time about 8 s).

## Hardware (all from what you have)

| Qty | Part | Where |
|---|---|---|
| 3 | **M4 x 12 socket-head screw** (12 to 16 mm works) | One per bracket: locks the bracket to the machine |
| 3 | **M4 nyloc nut** | Trapped in each bracket |
| 2 | **M3 x 10 hex-head bolt** (10 to 16 mm works) | Clamps the X and Y switches |
| 1 | **M3 x 12 hex-head bolt** (12 to 16 mm works) | Clamps the Z switch |
| 3 | **M3 nyloc nut** | Trapped in each bracket |
| 6 | Printed pins | Two per switch, through the switch's own holes |

Tools: 3 mm hex key, 5.5 mm spanner or nut driver, something thin to push the pins (a 2 mm
drill bit or nail). M3 x 8 is too short everywhere.

How it holds: the two pins go through the switch's holes into the bracket, so the switch
can't move. The M3 bolt (through a trapped nyloc) presses the switch into its pocket. The M4
screw (through a trapped nyloc) presses on the aluminium and pulls the bracket's other jaw tight
against the plate, so the bracket can't slide or rattle.

## Tolerances (PETG, 0.4 mm nozzle)

Printed holes come out about 0.1 to 0.2 mm small (horizontal ones a bit more); pegs come out
about right. The sizes below allow for that.

| Fit | Designed | Expected after printing | Intent |
|---|---|---|---|
| Pin in switch hole (2.35) | Pin 2.30 (test set also 2.20, 2.25) | 2.28 to 2.33 | Snug slide. Pick the size that pushes in firmly by hand |
| Pin in bracket hole | Hole 2.45, 4 mm deep (Z: 2.2) | About 2.25 to 2.35 | Press fit. Too tight: run a 2.4 mm drill in by hand. Too loose: a drop of superglue |
| Pin push-in hole | 2.6 | About 2.45 | Pin slides through |
| Switch pocket (along the switch) | 20.0 for a 19.8 body | 19.85 to 20.0 | Snug. The pins do the exact locating |
| Switch to clamp side | 0.2 gap | | The M3 bolt closes it |
| M3 / M4 nyloc traps | 5.8 / 7.3 across flats, 4.3 / 5.3 deep | 5.65 / 7.15 | Firm push-in for 5.5 / 7.0 nuts |
| M3 / M4 bolt holes | 3.4 / 4.5 | 3.25 / 4.35 | Free fit |
| Against the aluminium | 0.2 per side | 0.1 to 0.2 | Slides on, M4 locks it. Use 0.1 once your plates are measured |
| X cradle on the 20 mm rod | 20.2 (0.1 per side) | About 20.0 to 20.1 | Snug drop-on. If it sits on the rod instead of the plate, sand the arch lightly |
| Z fork on the M5 screw head (8.5) | 8.7 slot (0.1 per side) | About 8.5 to 8.6 | Snug slide-on. Sand or file the slot if it won't go |
| Y tongue in the 22 x 6 groove | 21.2 x 5.6 | | Slides in from the end |
| Thinnest wall in any bracket | 0.8 mm (Z), 1.0 mm (X), 1.15 mm (Y) | | At least 2 extrusion lines |

All of these are variables at the top of `frame_mounts.py` (`PIN_D`, `PIN_HOLE`, `SNUG`, `GAP`,
nut sizes). If the test piece shows a fit is off, change the number and run
`python frame_mounts.py` to remake the STLs.

## Before printing the brackets: check the real machine and switch

These are the GrabCAD model's dimensions. Measure yours with calipers:

1. **Switch:** body length 19.8 mm, mounting holes 9.5 mm apart, 2.9 mm from the terminal edge.
2. **X:** right gantry side plate thickness = **12.1 mm** (the saddle opens to 12.5).
   Gap from the top of that plate up to the underside of the Z top plate = about **13 mm**.
   Upper X rod: 20 mm, its top **10.0 mm** below the top of the side plate, its front edge
   **21 mm** in front of the back beam.
3. **Y:** back end plate front groove = **22 mm wide x 6 mm deep**, its top edge **5 mm** below
   the top of the end plate. End plate thickness = **20 mm**.
4. **Z:** Z top plate thickness at its right edge = **9 mm**. The spindle holder needs a solid
   right "ear" at the front (where its clamp screw is) for the lever to hit. The Z rod's top
   screw is an **M5 socket head (8.5 mm)**, centre **19 mm** in from the plate's right edge and
   **75 mm** behind the switch. If yours is a different head, open the slot (`Z_HEAD_R`).

## Installing

1. Cut each lever to about 16.5 mm from the hinge, and solder the wires. The terminal side of
   each pocket is open, so heat-shrink fits.
2. Push the nyloc nuts into their slots: M4 for the lock screw, M3 for the switch clamp.
3. Put the switch in its pocket, lever toward the moving part. Push the two pins in through
   the push-in holes, chamfered end first, through the switch and into the bracket until flush.
   Then thread the M3 bolt in until it just nips the switch. Don't crush the switch case.
4. **X:** move the carriage left and back the M4 out. Lower the saddle straight down over the top
   edge of the right gantry side plate, just inside the back beam: the inner jaw drops over the
   end of the upper X rod and the bracket settles onto the plate. Tighten the M4 from the right side.
5. **Y:** move the gantry forward. Slide the tongue into the front groove of the back end plate
   from its right end until the clip sits flat against the end of the plate. Tighten the M4 from
   behind the machine.
6. **Z:** move the carriage left and the spindle down. Slide the clip onto the right edge of the
   Z top plate from the right, with the hook under the plate, behind the spindle holder, until the
   fork stops on the Z rod's screw head. Tighten the vertical M4 from the top.
7. By hand, push each axis slowly toward its switch. You should hear the click **before**
   anything touches the switch body (about 1.3 to 1.5 mm to spare in CAD).

## Wiring and GRBL (Nano, GRBL 1.1)

- X to D9, Y to D10, Z to D12. Switch common (C) to GND. Use the **NC** contact so a broken wire
  reads as "triggered".
- `$5=1` (NC switches), `$21=1` (hard limits), `$22=1` (homing), `$23=0` (home to +X +Y +Z)
- `$27=2` (pull-off 2 mm), `$24=50`, `$25=500`
- Max travel from the CAD model. Re-measure on the real machine, then set:
  `$130=376` (X), `$131=572` (Y), `$132=65` (Z)
- Test `$H` slowly with a hand on the power switch. If an axis heads away from its switch,
  flip that bit in `$23`.

## Checked in CAD (Onshape, with every bolt, nut and pin modelled)

- **Fit:** no overlap between any of the 24 pieces (3 brackets, 3 switches, 6 bolts, 6 nuts,
  6 pins) and the machine, or between pieces.
- **Installing:** each fully assembled bracket was moved along its install path (X lowered 40 mm
  onto the plate and rod, Y slid 40 mm into the groove, Z slid 25 mm onto the plate and the screw
  head) with no collisions. Only the X M4 tip grazes the plate corner if it's already screwed in,
  so back it out first.
- **Cradle vs. carriage:** at the X trip point the X carriage's bearing housing stops 3.8 mm short
  of the X cradle (2.3 mm at first contact). Full X, Y and Z travel is clear.
- **Tool access:** a 3 mm hex key or 5.5 mm nut driver reaches every head straight on, and every
  pin can be pushed straight in, each with 40 mm clear.
- **Motion:** every axis was swept through full travel. Nothing clashes except the lever touching
  what it's meant to:

| Axis | Lever first touched | Switch trips (estimated) | First contact with switch/bracket |
|---|---|---|---|
| Y | -2.5 mm | +1.4 mm | +3.0 mm |
| X | 309.5 mm | 313.5 mm | 315 mm |
| Z | 41.5 mm | 45.7 mm | 47 mm |

The trip point uses the switch's estimated lever travel (4.2 mm). Real KW11 clones vary, so do
installing step 7.

## Files

- `stl/`: the print files
- `step/mount_*_print.step`: the brackets as STEP, in print orientation
- `step/mount_*_machine.step`, `limit_switch_mounts_in_machine.step`: placed in the machine model
- `frame_mounts.py`: CadQuery source for everything printed. `limit_switch_mounts.fs` is the same
  geometry as an Onshape FeatureScript (the "Limit switch mounts" Part Studio in the 6040CNC
  document), with bolts, nuts and pins modelled.
- `renders/`: pictures (`cradles.png` shows the X rod cradle in section and the Z fork)
