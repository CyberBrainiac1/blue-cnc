(Air-cut test for the blue desktop CNC: a square, a circle and a diagonal.)
(NO BIT. SPINDLE OFF. There is no M3 in this file, so the spindle is never started.)
(Set zero before running:)
(  X0 Y0 = front-left corner of a 50 x 50 mm area, with room to the right and to the back.)
(  Z0    = about 25 mm above the table, so the "cut" depth Z-1 stays in the air.)
(Feeds: 600 mm/min along the path, 200 mm/min for the Z plunges.)

G21 (millimetres)
G90 (absolute coordinates)
G17 (XY plane, for the circle)

G0 Z5 (lift to safe height)
G0 X0 Y0

(1. 50 mm square, counter-clockwise from the front-left corner)
G1 Z-1 F200
G1 X50 Y0 F600
G1 X50 Y50
G1 X0 Y50
G1 X0 Y0
G0 Z5

(2. 30 mm circle centred at X25 Y25, clockwise)
G0 X10 Y25
G1 Z-1 F200
G2 X10 Y25 I15 J0 F600
G0 Z5

(3. Diagonal from front-left to back-right)
G0 X0 Y0
G1 Z-1 F200
G1 X50 Y50 F600
G0 Z5

(Back to the start corner and stop)
G0 X0 Y0
M2
