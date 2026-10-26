"""Printable 4-pin screw-clamp plug for the JP-3163B spindle header (C / NO / 0-10V / GND).

The board has a vertical 5.08 mm pluggable header (pins stand straight up out of the board,
inside a green housing). The original green screw plug is missing. This plug pushes onto
the same pins and clamps each stripped wire directly against its pin:

        top view of one pin cell (Y points to the board interior, away from the heatsink)

        back (heatsink side)                                     front (board interior)
        | anvil |pin| wire |  jaw  |~~~~~~~~ front block (nut + M3 screw) ~~~~~~~~|
                          <- the screw tip pushes the jaw this way

  - "anvil": the fixed back half of the plug. It sits between the housing's back wall and
    the pins, so each pin has a solid wall behind it.
  - "jaw": one small loose finger per pin. An M3 hex bolt goes in from the front face,
    through a trapped M3 nyloc nut, and its tip pushes the jaw toward the pin. The jaw
    squeezes the bare strands against the pin, and higher up it squeezes the insulation
    against the anvil (strain relief).
  - All the force stays inside the plug (screw -> nut -> body -> anvil -> pin -> wire -> jaw
    -> screw), so tightening doesn't push the plug off the header. A screw pressing down on
    the pin tip would, which is why the screws are horizontal.
  - Pins are only 5.08 mm apart but an M3 nut is 5.8 mm across, so the nuts sit in two
    rows: C and 0-10V low (slid in from underneath), NO and GND high (dropped in from the
    top).

Frame (mm): z = 0 is the housing floor (where the pins come out), +Z up. Pins lie on
the X axis, C at -X, GND at +X. Pin centres are at y = 0. +Y is the housing wall that
faces the board interior (the side with R11 / SW3 / the big capacitor in the photo).

Header sizes come from the standard 2EDG-family 5.08 mm vertical header (Degson drawing
2EDGVC-5.08-XXP-1Y-100Z: pin 1.0 mm square, pitch 5.08, housing 5.08*N+2 long, 8.6 deep,
12 high). The inside of the socket isn't dimensioned on that drawing, so those values are
chosen on the small side. A loose fit is fine here because the clamp doesn't rely on it.
Only the pitch needs checking with calipers. Print fit_test.stl before the full plug.
Run:  uv run --python 3.12 --with cadquery python header_plug.py
"""
import os
import cadquery as cq

# ---------------------------------------------------------------- header (standard 2EDG 5.08)
PITCH = 5.08          # pin centre-to-centre: CONFIRM with calipers (C to GND = 3 x pitch = 15.24)
PIN_T = 1.0           # pin thickness (square pin, drawing: 1 +-0.05)
PIN_H = 6.5           # pin tip height above the housing floor (not on the drawing)
SOCK_H = 8.0          # housing rim height above the housing floor; if it's shallower, the plug just sits a little high
SOCK_L = 5.08 * 4 + 2 - 2 * 1.0   # socket opening length: housing 5.08*N+2 minus ~1 mm end walls
SOCK_W = 6.2          # socket opening width (housing is 8.6 deep; kept narrow so it always goes in)
SOCK_WALL = 0.8       # housing wall thickness (only sets where the jaw foot sits)
PIN_Y = 0.0           # pin row offset from the socket's centre line, + toward the front
WELL_R = 2.0          # the housing has a round well around each pin; the anvil teeth stay inside this radius
N = 4
LABELS = ["C", "NO", "0-10V", "GND"]     # board order; C is next to the 24V/GND plug

# ---------------------------------------------------------------- wire and hardware
WIRE_BARE = 0.7       # twisted strands of 22-24 AWG (tinning them with solder helps a lot)
WIRE_INS = 1.7        # insulation outer diameter
M3_CLEAR, M3_NUT_AF, M3_NUT_T = 3.4, 5.8, 4.3   # PETG prints holes ~0.1-0.2 small
SCREW_L = 12          # M3 hex bolt length under the head

# ---------------------------------------------------------------- plug design
FIT = 0.15            # clearance per side, plug nose vs housing (snug push fit)
JAW_FIT = 0.2         # clearance per side, jaw in its pocket (must slide freely)
PIN_FIT = 0.1         # pin vs anvil face
SLACK = 0.35          # extra opening when the jaw is backed off, for feeding the wire in
NOSE_T = 1.3          # jaw thickness below the rim (it fits between the pin and the housing wall)
NOSE_GAP = 0.6        # plug nose stops this far above the housing floor
END_MARGIN = PITCH / 2 - 0.1   # body end past the outer pins; the 24V plug sits right next to C
POCKET_W = 3.2        # jaw pocket width in X (= wire channel width)
WALL = 1.6            # wall between the jaw pocket and the nuts
LEDGE = 1.0           # ledge under the jaw's front foot, keeps the jaw from dropping out
JAW_FOOT = 1.0        # how far the jaw's upper part reaches past the housing's outer wall
ROW1 = SOCK_H + 4.0   # screw height for C and 0-10V
ROW2 = ROW1 + 5.4     # screw height for NO and GND
TOP = ROW2 + 3.4      # top of the plug
END_SCREW_SHIFT = 0.6 # end screws move inward so the end nut slots stay inside the body
TEXT_D = 0.5

# derived Y stations (pin centre at y = 0)
y_sock_back = -SOCK_W / 2 - PIN_Y                  # housing back wall, inner face
y_sock_front = SOCK_W / 2 - PIN_Y                  # housing front wall, inner face
y_back = y_sock_back - SOCK_WALL                   # plug back face, flush with the housing
y_anvil = -PIN_T / 2 - PIN_FIT                     # anvil face (behind the pin)
y_lane_open = PIN_T / 2 + WIRE_BARE + SLACK        # jaw back face, backed off
y_nose_front = y_lane_open + NOSE_T                # jaw nose front face, backed off
y_outer_front = y_sock_front + SOCK_WALL           # outside of the housing front wall
y_jaw_front = y_outer_front + JAW_FOOT             # jaw upper part front face, backed off
TRAVEL = SLACK + WIRE_BARE + 0.3                   # room in front of the jaw to back it off
y_pocket_front = y_jaw_front + TRAVEL
y_nut = y_pocket_front + WALL                      # nut slot, back face
y_front = y_nut + M3_NUT_T + 1.8                   # plug front face (screw heads here)
X_END = (N - 1) / 2 * PITCH + END_MARGIN

assert y_nose_front <= y_sock_front - FIT + 1e-6, "jaw nose doesn't fit beside the pin: check SOCK_W / PIN_Y"


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
    """Workplane on the XZ plane at y1 (its normal is -Y, so a positive extrude runs toward y0)."""
    return cq.Workplane("XZ", origin=(x, y1, z)), y1 - y0


def anvil_teeth(z0, z1):
    """One D-shaped tooth behind each pin, small enough to sit inside the housing's round pin well."""
    r = WELL_R - FIT
    t = None
    for i in range(N):
        disc = cq.Workplane("XY", origin=(pin_x(i), 0, z0)).circle(r).extrude(z1 - z0)
        tooth = disc.intersect(box(pin_x(i) - r, pin_x(i) + r, max(y_sock_back + FIT, -r), y_anvil, z0, z1))
        t = tooth if t is None else t.union(tooth)
    return t


def nut_cut(i):
    sx, sz = screw_x(i), screw_z(i)
    wp, d = along_y(sx, sz, y_nut, y_nut + M3_NUT_T)
    nut = wp.transformed(rotate=(0, 0, 30)).polygon(6, M3_NUT_AF / 0.8660254).extrude(d)
    if sz == ROW1:   # slides in from underneath
        slot = box(sx - M3_NUT_AF / 2, sx + M3_NUT_AF / 2, y_nut, y_nut + M3_NUT_T, SOCK_H - 1, sz)
    else:            # drops in from the top
        slot = box(sx - M3_NUT_AF / 2, sx + M3_NUT_AF / 2, y_nut, y_nut + M3_NUT_T, sz, TOP + 1)
    return nut.union(slot)


def screw_cut(i):
    wp, d = along_y(screw_x(i), screw_z(i), y_pocket_front - 0.5, y_front + 0.5)
    return wp.circle(M3_CLEAR / 2).extrude(d)


def body():
    """One-piece plug body: anvil teeth, the block above the rim with a jaw pocket per pin,
    and the front block holding the nuts."""
    b = box(-X_END, X_END, y_back, y_front, SOCK_H, TOP).union(anvil_teeth(NOSE_GAP, SOCK_H + 0.01))
    for i in range(N):
        px = pin_x(i)
        # jaw pocket, open at the top; the wire goes down it between the anvil face and the jaw
        b = b.cut(box(px - POCKET_W / 2, px + POCKET_W / 2, y_anvil, y_pocket_front, SOCK_H + LEDGE, TOP + 1))
        # under the ledge, open down to the housing so the jaw nose can pass
        b = b.cut(box(px - POCKET_W / 2, px + POCKET_W / 2, y_anvil, y_outer_front, SOCK_H - 1, SOCK_H + LEDGE + 0.01))
        b = b.cut(screw_cut(i)).cut(nut_cut(i))
    # labels: on the top face behind each wire channel, and on the front face beside each screw
    for i, t in enumerate(LABELS):
        size = 2.4 if len(t) == 1 else (1.6 if len(t) == 2 else 1.25)
        top = (cq.Workplane("XY", origin=(pin_x(i), (y_back + y_anvil) / 2, TOP))
               .transformed(rotate=(0, 0, 90))
               .text(t, size, -TEXT_D, kind="bold", halign="center", valign="center"))
        dz = 3.0 if screw_z(i) == ROW1 else -3.0
        front = (cq.Workplane("XZ", origin=(screw_x(i), y_front, screw_z(i) + dz))
                 .text(t, 1.8 if len(t) < 3 else 1.3, TEXT_D, kind="bold", halign="center", valign="center"))
        b = b.cut(top).cut(front)
    return b


def jaw(i=0):
    """One loose jaw, in place and backed off, for pin i."""
    px = pin_x(i)
    w = POCKET_W - 2 * JAW_FIT
    x0, x1 = px - w / 2, px + w / 2
    z_up = SOCK_H + LEDGE + JAW_FIT             # the upper part rests on the ledge
    j = box(x0, x1, y_lane_open, y_jaw_front, z_up, TOP - 0.3)
    j = j.union(box(x0, x1, y_lane_open, y_nose_front, NOSE_GAP + 0.3, z_up + 0.01))
    # step back above the pin tip if the insulation is fatter than pin + strands
    step = WIRE_INS - (PIN_T + PIN_FIT + WIRE_BARE)
    if step > 0:
        j = j.cut(box(x0 - 1, x1 + 1, y_lane_open - 1, y_lane_open + step, PIN_H + 1.0, TOP))
    # shallow V groove down the nose keeps the strands centred on the pin
    g = (cq.Workplane("XY", origin=(px, y_lane_open, 0))
         .polyline([(-0.8, 0), (0, 0.35), (0.8, 0)]).close().extrude(PIN_H + 1.0))
    return j.cut(g)


def fit_test():
    """Only the part that goes into the housing: anvil teeth plus dummy jaw noses under a
    1.6 mm plate, with a window over each pin. Quick to print; checks the fit before the plug."""
    plate_front = y_outer_front + 1.5
    b = box(-X_END, X_END, y_back, plate_front, SOCK_H, SOCK_H + 1.6).union(anvil_teeth(NOSE_GAP, SOCK_H + 0.01))
    w = POCKET_W - 2 * JAW_FIT
    for i in range(N):
        b = b.union(box(pin_x(i) - w / 2, pin_x(i) + w / 2, y_lane_open, y_nose_front, NOSE_GAP + 0.3, SOCK_H + 0.01))
        b = b.cut(box(pin_x(i) - 1.2, pin_x(i) + 1.2, y_anvil, y_lane_open, SOCK_H - 1, SOCK_H + 3))
    mark = (cq.Workplane("XY", origin=(pin_x(0), (y_back + y_anvil) / 2, SOCK_H + 1.6))
            .text("C", 2.2, -0.4, kind="bold", halign="center", valign="center"))
    return b.cut(mark)


def on_bed(shape, flip=False, rot_y=0):
    """Turn a part to its print orientation and drop it onto z = 0."""
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
    # body upside down: the flat top on the bed, anvil teeth pointing up, no supports
    export(on_bed(body(), flip=True), os.path.join(out, "plug_body.stl"))
    # jaws on their sides (the L-shaped profile flat on the bed), 4 in a row
    j = on_bed(jaw(0), rot_y=90)
    jaws = j
    for k in range(1, N):
        jaws = jaws.union(j.translate((0, k * 6.0, 0)))
    export(jaws, os.path.join(out, "jaws_x4.stl"))
    export(on_bed(fit_test(), flip=True), os.path.join(out, "fit_test.stl"))
    print(f"plug outside: X {2 * X_END:.1f} x Y {y_front - y_back:.1f} (y {y_back:.1f} .. {y_front:.1f}) x "
          f"Z {TOP:.1f} above the housing floor ({TOP - SOCK_H:.1f} above the rim)")
    print(f"wire lane backed off: {y_lane_open - y_anvil:.2f} mm (pin {PIN_T} + strands {WIRE_BARE} + slack)")
    print(f"screw path front face -> jaw: {y_front - y_jaw_front:.1f} mm, jaw travel room {TRAVEL:.2f} mm; "
          f"M3 x {SCREW_L} reaches {SCREW_L - (y_front - y_jaw_front):.1f} mm past the backed-off jaw face")


if __name__ == "__main__":
    main()
