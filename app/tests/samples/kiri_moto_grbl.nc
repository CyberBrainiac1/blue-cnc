; Hand-written in the style of Kiri:Moto's Any.Generic.Grbl device, not a real export
G21 ; set units to MM (required)
G90 ; absolute position mode (required)
M6 T1 ; change tool to 'end 1/8 flat'
M3 S10000
G0 Z5
G0 X10 Y10
G1 Z-1 F250
G1 X40 Y10 F800
G4 P1000 ; dwell for 1000ms
G1 X40 Y40
G1 X10 Y40
G1 X10 Y10
G0 Z5
M6 T2 ; change tool to 'drill 3mm'
G0 X25 Y25
G1 Z-3 F100
G0 Z5
M30 ; program end
