"""Omron SS-5GL (and KW11-style clones) hinge-lever micro switch, approx. model.
Frame: body centred on x, bottom (terminal edge) at y=0, top at y=10.2, thickness along z centred.
Datasheet values used: body 19.8 x 10.2 x 6.4, 2x dia 2.35 mounting holes 9.5 apart.
Hole height (2.9 from terminal edge) and lever geometry are estimated from photos -> holders use slots."""
import cadquery as cq, math
L, H, T = 19.8, 10.2, 6.4
HOLE_D, HOLE_SP, HOLE_Y = 2.35, 9.5, 2.9
OP_ABOVE_HOLES = 8.8      # operating position of lever above hole centreline (approx)
FP_ABOVE_HOLES = 13.0     # free position (approx)
LEVER_LEN = 16.5

def body():
    b = cq.Workplane("XY").box(L, H, T).translate((0, H / 2, 0)).edges("|Z").fillet(0.6)
    b = b.cut(cq.Workplane("XY").pushPoints([(-HOLE_SP / 2, HOLE_Y), (HOLE_SP / 2, HOLE_Y)])
              .circle(HOLE_D / 2).extrude(T, both=True))
    for x in (-7.9, 0.8, 7.8):   # C, NO, NC terminals
        b = b.union(cq.Workplane("XY").box(0.5, 3.6, 3.2).translate((x, -1.8, 0)))
    return b

def lever(pressed=False):
    tip_y = HOLE_Y + (OP_ABOVE_HOLES if pressed else FP_ABOVE_HOLES)
    px, py = -L / 2 + 1.2, H + 0.4
    ang = math.degrees(math.atan2(tip_y - py, LEVER_LEN))
    lv = cq.Workplane("XY").box(LEVER_LEN, 0.35, 4.0).translate((LEVER_LEN / 2, 0, 0))
    return lv.rotate((0, 0, 0), (0, 0, 1), ang).translate((px, py, 0))

def switch(pressed=False):
    return body().union(lever(pressed))

if __name__ == "__main__":
    cq.exporters.export(switch(), "ss5gl_switch.step")
    print("ok")
