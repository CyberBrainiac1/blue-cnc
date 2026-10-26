%
(1001)
(Hand-written in the style of the Fusion 360 grbl post, not a real export)
(T1  D=6 CR=0 - ZMIN=-3 - flat end mill)
G90 G94
G17
G21
(2D Contour1)
T1
S16000 M3
G54
G0 X-3 Y0
Z15
Z5
G1 Z-3 F300
G1 X50 F900
G2 X60 Y10 I0 J10
G1 Y40
G3 X50 Y50 R10
G1 X0
G0 Z15
G28 G91 Z0
G90
M5
M30
%
