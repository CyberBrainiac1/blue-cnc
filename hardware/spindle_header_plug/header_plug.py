"""Printable 4-pin screw-clamp plug for the JP-3163B spindle header (C / NO / 0-10V / GND).

The board has a vertical 5.08 mm pluggable header (pins stand straight up out of the board,
inside a green housing). The original green screw plug is missing. This plug pushes onto
the same pins and clamps each stripped wire directly against its pin.

Every pin sits in its own closed cell, from just above the housing floor to the top of the
plug, so a stray strand can't reach the next pin:

        top view of one cell (Y points to the board interior, away from the heatsink)

        back (heatsink side)                                     front (board interior)
        | anvil |pin| wire |  jaw  |~~~~~~~~ front block (nut + M3 screw) ~~~~~~~~|
                          <- the screw tip pushes the jaw this way
        side walls of the cell run the whole way from the anvil to the housing's front wall

  - "anvil": the back wall of the cell, behind the pin.
  - "jaw": one small loose finger per cell. An M3 hex bolt goes in from the front face,
    through a trapped M3 nyloc nut, and its tip pushes the jaw toward the pin. The jaw
    squeezes the bare strands against the pin, and higher up it squeezes the insulation
    against the anvil (strain relief). The jaw is the cell's 4th wall at the clamp; in
    front of it is the housing's own front wall.
  - All the force stays inside the plug (screw -> nut -> body -> anvil -> pin -> wire -> jaw
    -> screw), so tightening doesn't push the plug off the header.
  - Pins are only 5.08 mm apart but an M3 nut is 5.8 mm across, so the nuts sit in two
    rows: C and 0-10V low (slid in from underneath), NO and GND high (dropped in from the
    top).

Frame (mm): z = 0 is the housing floor (where the pins come out), +Z up. Pins lie on
the X axis, C at -X, GND at +X. Pin centres are at y = 0. +Y is the housing wall that
faces the board interior (the side with R11 / SW3 / the big capacitor in the photo).

Size: the part that goes into the socket is a row of 4 rectangular cells, VARIANTS[SIZE]
wide x long. Fit test v2 (pieces 1/2/3 = 6.1 x 20.0, 6.3 x 20.15, 6.5 x 20.3) on the real
header: piece 1 fit really well, so SIZE = 1. (old/header_plug_v3_recess.py was a later
guess at round recesses inside the housing; the fit test proved it unnecessary.)
Run:  uv run --python 3.12 --with cadquery python header_plug.py     -> stl/plug_body.stl, stl/jaws_x4.stl
"""
import os
import cadquery as cq

# ---------------------------------------------------------------- header (5.08 pluggable, vertical)
PITCH = 5.08
PIN_T = 1.0
PIN_H = 6.5
SOCK_H = 8.0
SOCK_W = 6.4          # nominal; only sets the plug's back face and jaw foot above the rim
SOCK_WALL = 0.8
N = 4
LABELS = ["C", "NO", "0-10V", "GND"]
VARIANTS = {1: (6.1, 20.00), 2: (6.3, 20.15), 3: (6.5, 20.30)}   # fit test v2 sizes, width x length
SIZE = 1              # piece 1 fit the real header really well

# ---------------------------------------------------------------- wire and hardware
WIRE_BARE = 0.7
WIRE_INS = 1.7
M3_CLEAR, M3_NUT_AF, M3_NUT_T = 3.4, 5.8, 4.3
SCREW_L = 12

# ---------------------------------------------------------------- plug design
CELL_IN = 2.7
CELL_GAP = 1.0
JAW_FIT = 0.15
PIN_FIT = 0.2
SLACK = 0.35
NOSE_T = 1.3
NOSE_GAP = 0.6
BACK_CHAMFER = 0.5
LEAD = 0.4
END_MARGIN = PITCH / 2 - 0.1
WALL = 1.6
LEDGE = 1.0
JAW_FOOT = 1.0
ROW1 = SOCK_H + 4.0
ROW2 = ROW1 + 5.4
TOP = ROW2 + 3.4
END_SCREW_SHIFT = 0.6
TEXT_D = 0.5

y_back = -SOCK_W / 2 - SOCK_WALL
y_anvil = -PIN_T / 2 - PIN_FIT
y_lane_open = PIN_T / 2 + WIRE_BARE + SLACK
y_nose_front = y_lane_open + NOSE_T
y_outer_front = SOCK_W / 2 + SOCK_WALL
y_jaw_front = y_outer_front + JAW_FOOT
TRAVEL = SLACK + WIRE_BARE + 0.3
y_pocket_front = y_jaw_front + TRAVEL
y_nut = y_pocket_front + WALL
y_front = y_nut + M3_NUT_T + 1.8
X_END = (N - 1) / 2 * PITCH + END_MARGIN
JAW_W = CELL_IN - 2 * JAW_FIT

assert y_nose_front <= min(w for w, _ in VARIANTS.values()) / 2 - 0.1, "jaw nose doesn't fit in front of the pin"


def pin_x(i):
    return (i - (N - 1) / 2) * PITCH


def screw_x(i):
    if i == 0:
        return pin_x(i) + END_SCREW_SHIFT
    if i == N - 1:
        return pin_x(i) - END_SCREW_SHIFT
    return pin_x(i)


def screw_z(i):
    return ROW1 if i % 2 == 0 else ROW2


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def along_y(x, z, y0, y1):
    return cq.Workplane("XZ", origin=(x, y1, z)), y1 - y0


def cell_interior(i, z0, z1):
    px = pin_x(i)
    return box(px - CELL_IN / 2, px + CELL_IN / 2, y_anvil, 10, z0, z1)


def nose(v):
    w, length = VARIANTS[v]
    z0, z1 = NOSE_GAP, SOCK_H + 0.01
    n = None
    for i in range(N):
        px = pin_x(i)
        x0 = -length / 2 if i == 0 else px - (PITCH - CELL_GAP) / 2
        x1 = length / 2 if i == N - 1 else px + (PITCH - CELL_GAP) / 2
        c = (box(x0, x1, -w / 2, w / 2, z0, z1)
             .edges("|Z and <Y").chamfer(BACK_CHAMFER)
             .faces("<Z").edges("not(>Y)").chamfer(LEAD * 0.75))
        c = c.cut(cell_interior(i, z0 - 1, z1 + 1))
        lead = (cq.Workplane("YZ", origin=(px - CELL_IN / 2, 0, 0))
                .polyline([(y_anvil + 0.01, z0 - 0.01), (y_anvil - LEAD, z0 - 0.01), (y_anvil + 0.01, z0 + LEAD + 0.01)])
                .close().extrude(CELL_IN))
        c = c.cut(lead)
        n = c if n is None else n.union(c)
    return n


def nut_cut(i):
    sx, sz = screw_x(i), screw_z(i)
    wp, d = along_y(sx, sz, y_nut, y_nut + M3_NUT_T)
    nut = wp.transformed(rotate=(0, 0, 30)).polygon(6, M3_NUT_AF / 0.8660254).extrude(d)
    if sz == ROW1:
        slot = box(sx - M3_NUT_AF / 2, sx + M3_NUT_AF / 2, y_nut, y_nut + M3_NUT_T, SOCK_H - 1, sz)
    else:
        slot = box(sx - M3_NUT_AF / 2, sx + M3_NUT_AF / 2, y_nut, y_nut + M3_NUT_T, sz, TOP + 1)
    return nut.union(slot)


def screw_cut(i):
    wp, d = along_y(screw_x(i), screw_z(i), y_outer_front, y_front + 0.5)
    return wp.circle(M3_CLEAR / 2).extrude(d)


def body(v=SIZE):
    b = box(-X_END, X_END, y_back, y_front, SOCK_H, TOP).union(nose(v))
    for i in range(N):
        px = pin_x(i)
        b = b.cut(box(px - CELL_IN / 2, px + CELL_IN / 2, y_anvil, y_pocket_front, SOCK_H + LEDGE, TOP + 1))
        b = b.cut(box(px - CELL_IN / 2, px + CELL_IN / 2, y_anvil, y_outer_front, SOCK_H - 1, SOCK_H + LEDGE + 0.01))
        b = b.cut(screw_cut(i)).cut(nut_cut(i))
    for i, t in enumerate(LABELS):
        size = 2.4 if len(t) == 1 else (1.6 if len(t) == 2 else 1.25)
        top = (cq.Workplane("XY", origin=(pin_x(i), (y_back + y_anvil) / 2, TOP))
               .transformed(rotate=(0, 0, 90))
               .text(t, size, -TEXT_D, kind="bold", halign="center", valign="center"))
        dz = 3.0 if screw_z(i) == ROW1 else -3.0
        front = (cq.Workplane("XZ", origin=(screw_x(i), y_front, screw_z(i) + dz)).transformed(rotate=(0, 180, 0))
                 .text(t, 1.8 if len(t) < 3 else 1.3, -TEXT_D, kind="bold", halign="center", valign="center"))
        b = b.cut(top).cut(front)
    num = (cq.Workplane("XZ", origin=(0, y_back, (SOCK_H + TOP) / 2))
           .text(str(v), 3.0, -TEXT_D, kind="bold", halign="center", valign="center"))
    return b.cut(num)


def jaw(i=0):
    px = pin_x(i)
    x0, x1 = px - JAW_W / 2, px + JAW_W / 2
    z_up = SOCK_H + LEDGE + JAW_FIT
    j = box(x0, x1, y_lane_open, y_jaw_front, z_up, TOP - 0.3)
    j = j.union(box(x0, x1, y_lane_open, y_nose_front, NOSE_GAP + 0.3, z_up + 0.01))
    step = WIRE_INS - (PIN_T + PIN_FIT + WIRE_BARE)
    if step > 0:
        j = j.cut(box(x0 - 1, x1 + 1, y_lane_open - 1, y_lane_open + step, PIN_H + 1.0, TOP))
    g = (cq.Workplane("XY", origin=(px, y_lane_open, 0))
         .polyline([(-0.7, 0), (0, 0.3), (0.7, 0)]).close().extrude(PIN_H + 1.0))
    return j.cut(g)


def fit_test(v):
    plate_front = y_outer_front + 2.6
    b = box(-X_END, X_END, y_back, plate_front, SOCK_H, SOCK_H + 1.2).union(nose(v))
    for i in range(N):
        b = b.cut(cell_interior(i, SOCK_H - 1, SOCK_H + 3).intersect(box(-20, 20, y_anvil, SOCK_W / 2, -5, 30)))
    for k in range(v):
        x = (k - (v - 1) / 2) * 2.0
        b = b.cut(box(x - 0.5, x + 0.5, y_back - 1, y_back + 1.0, SOCK_H - 1, SOCK_H + 3))
    num = (cq.Workplane("XY", origin=(0, (SOCK_W / 2 + plate_front) / 2, SOCK_H + 1.2))
           .text(str(v), 2.4, -0.5, kind="bold", halign="center", valign="center"))
    c_mark = (cq.Workplane("XY", origin=(pin_x(0) - 1.4, (SOCK_W / 2 + plate_front) / 2, SOCK_H + 1.2))
              .text("C", 2.0, -0.5, kind="bold", halign="center", valign="center"))
    return b.cut(num).cut(c_mark)


def on_bed(shape, flip=False, rot_y=0):
    if flip:
        shape = shape.rotate((0, 0, 0), (1, 0, 0), 180)
    if rot_y:
        shape = shape.rotate((0, 0, 0), (0, 1, 0), rot_y)
    bb = shape.val().BoundingBox()
    return shape.translate((-(bb.xmin + bb.xmax) / 2, -(bb.ymin + bb.ymax) / 2, -bb.zmin))


def export(shape, path):
    cq.exporters.export(shape, path, tolerance=0.01, angularTolerance=0.1)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "stl")
    os.makedirs(out, exist_ok=True)
    export(on_bed(body(SIZE), flip=True), os.path.join(out, "plug_body.stl"))
    j = on_bed(jaw(0), rot_y=90)
    jaws = j
    for k in range(1, N):
        jaws = jaws.union(j.translate((0, k * 6.0, 0)))
    export(jaws, os.path.join(out, "jaws_x4.stl"))
    w, length = VARIANTS[SIZE]
    print(f"stl/plug_body.stl: size {SIZE} ({w} x {length} in the socket), outside "
          f"{2 * X_END:.1f} x {y_front - y_back:.1f} x {TOP - NOSE_GAP:.1f} mm")
    print(f"stl/jaws_x4.stl: 4 jaws, {JAW_W:.2f} wide, nose {NOSE_T} thick")


if __name__ == "__main__":
    main()
