(Pen test for the blue desktop CNC: draws shapes you can measure with a ruler.)
(NO BIT. SPINDLE OFF. There is no M3 in this file, so the spindle is never started.)
(Setup:)
(  Tape paper flat to the bed. Letter or A4 is fine.)
(  Tape a pen to the spindle body, pointing straight down, loosely enough that it can slide up a little.)
(  X0 Y0 = front-left of the drawing: needs 100 mm of paper to the right, 100 mm towards the back,)
(          and 10 mm in front for the tick marks.)
(  Z0    = pen tip just touching the paper. The pen presses 0.5 mm down while drawing.)
(What to measure:)
(  Square sides 100.0 mm. Diagonals 141.4 mm. Circle 60.0 mm across, both ways.)
(  The 10 mm tick marks along the front edge should be evenly spaced.)

G21 (millimetres)
G90 (absolute coordinates)
G17 (XY plane, for the circle)

G0 Z3 (lift the pen)
G0 X0 Y0

(1. 100 mm square, counter-clockwise from the front-left corner)
G1 Z-0.5 F200
G1 X100 Y0 F500
G1 X100 Y100
G1 X0 Y100
G1 X0 Y0
G0 Z3

(2. Both diagonals)
G1 Z-0.5 F200
G1 X100 Y100 F500
G0 Z3
G0 X100 Y0
G1 Z-0.5 F200
G1 X0 Y100 F500
G0 Z3

(3. 60 mm circle centred at X50 Y50, clockwise)
G0 X20 Y50
G1 Z-0.5 F200
G2 X20 Y50 I30 J0 F500
G0 Z3

(4. Tick marks every 10 mm, just in front of the square's front edge)
G0 X10 Y-2
G1 Z-0.5 F200
G1 Y-6 F500
G0 Z3
G0 X20 Y-2
G1 Z-0.5 F200
G1 Y-6 F500
G0 Z3
G0 X30 Y-2
G1 Z-0.5 F200
G1 Y-6 F500
G0 Z3
G0 X40 Y-2
G1 Z-0.5 F200
G1 Y-6 F500
G0 Z3
G0 X50 Y-2
G1 Z-0.5 F200
G1 Y-6 F500
G0 Z3
G0 X60 Y-2
G1 Z-0.5 F200
G1 Y-6 F500
G0 Z3
G0 X70 Y-2
G1 Z-0.5 F200
G1 Y-6 F500
G0 Z3
G0 X80 Y-2
G1 Z-0.5 F200
G1 Y-6 F500
G0 Z3
G0 X90 Y-2
G1 Z-0.5 F200
G1 Y-6 F500
G0 Z3

(Lift and return to the start corner)
G0 Z10
G0 X0 Y0
M2
