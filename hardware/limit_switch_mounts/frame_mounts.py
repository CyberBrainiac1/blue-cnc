"""Frame-mounted limit-switch brackets for the 6040 (GrabCAD "6040 CNC 1.5kW 2020" model),
KW11 / 10T85 / SS-5GL micro switches with the wire lever cut to ~16.5 mm.

Nothing sits on the rails or rods and nothing needs drilling. Hardware is only what's on
hand: M3 hex-head bolts, M4 socket-head screws and nyloc nuts for both.
  - Each bracket clips onto a plate edge or groove and is locked by one M4 socket screw
    running through a trapped M4 nyloc nut; its tip presses the aluminium.
  - Each switch sits in a pocket between two end walls and is clamped by
    one M3 hex bolt running through a trapped M3 nyloc nut; its tip presses the switch body.
    The switch's own 2.35 mm holes are not used.

  X (home +X, right): saddle over the top edge of the right gantry side plate. The X
     carriage top plate (Z motor plate) hits the lever.
     Its inner jaw sits over the end of the upper 20 mm X rod, so it locates itself.
  Y (home +Y, back/motor end): C-clip whose tongue slides into the front groove of the
     back end plate from its open right end. The gantry right side plate hits the lever.
  Z (home +Z, up): clip on the right edge of the Z top plate, arm forward so the switch
     hangs over the spindle holder's right clamp ear, which hits the lever.
     A fork on top slides onto the Z rod's top screw head and stops there.

All coordinates are the Onshape "6040CNC" Part Studio frame (mm, Z up, after Transform 1),
with the machine in the pose the STEP was drawn in. limit_switch_mounts.fs is the same
geometry as an Onshape feature. Print: PETG, 0.4 mm nozzle, 0.2 mm layers, 5 walls,
40 % infill, no supports, orientations as exported in stl/.
"""
import math
import os
import cadquery as cq
import ss5gl

GAP = 0.2        # sliding fit against aluminium faces, per side (0.1 once the real plates are measured)
SNUG = 0.1       # switch pocket clearance per end (pins do the tight locating; set SW body length from calipers)
SNUG_HALF = ss5gl.L / 2 + SNUG
# hole / nut-trap sizes for PETG (holes print slightly small, traps get +0.3)
M3_CLEAR, M3_NUT_AF, M3_NUT_H = 3.4, 5.8, 4.3      # M3 nyloc: 5.5 AF x 4.0
M4_CLEAR, M4_NUT_AF, M4_NUT_H = 4.5, 7.3, 5.3      # M4 nyloc: 7.0 AF x 5.0
# printed pins through the switch's two 2.35 mm holes
PIN_D = 2.30        # printed pin (vertical): snug in the switch hole; test set also has 2.20 / 2.25
PIN_HOLE = 2.45     # blind hole in the bracket: horizontal printed holes come out ~0.15 small -> press fit
PIN_ACCESS = 2.6    # clearance hole the pin is pushed in through (keeps 0.55 mm wall to the M3 nut trap)
PIN_LEN = 18.6      # same length for all six pins (flush with the access face when fully in)
# locating features on round parts of the machine (tight: 0.1 per side)
X_ROD = (None, 281.19, 327.61)   # upper 20 mm X rod, its end against the right side plate (y, z)
X_ROD_R = 10.0 + 0.1
ROD_X0 = 2.0                     # cradle's inner face; X carriage bearings stop at x -1.8 when the switch trips
Z_HEAD = (-324.28, 228.19)       # M5 socket head on the Z top plate (holds the top of the Z rod)
Z_HEAD_R = 4.25 + 0.1

# (axis, role): (bolt, length mm, nut)
HARDWARE = {
    ("X", "bracket lock"): ("M4 socket head", 12, "M4 nyloc"),
    ("X", "switch clamp"): ("M3 hex head", 10, "M3 nyloc"),
    ("Y", "bracket lock"): ("M4 socket head", 12, "M4 nyloc"),
    ("Y", "switch clamp"): ("M3 hex head", 10, "M3 nyloc"),
    ("Z", "bracket lock"): ("M4 socket head", 12, "M4 nyloc"),
    ("Z", "switch clamp"): ("M3 hex head", 12, "M3 nyloc"),
}


def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(
        ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def add(p, *terms):
    out = list(p)
    for k, v in terms:
        out = [o + k * c for o, c in zip(out, v)]
    return tuple(out)


class SwitchPlacement:
    """face = centre of the plunger (lever) face, n = direction the lever faces (toward the
    carriage), a = switch length axis. Thickness axis is a x n."""

    def __init__(self, face, n, a):
        self.face, self.n, self.a = face, n, a
        self.t = cross(a, n)
        self.origin = add(face, (-ss5gl.H, n))      # terminal edge, body centre

    def solid(self, pressed=False):
        plane = cq.Plane(origin=self.origin, xDir=self.a, normal=self.t)
        return ss5gl.switch(pressed).val().moved(cq.Location(plane))

    def holes(self):
        """Centres of the switch's two mounting holes (mid-thickness)."""
        return [add(self.origin, (s * ss5gl.HOLE_SP / 2, self.a), (ss5gl.HOLE_Y, self.n)) for s in (-1, 1)]


def round_cut(centre, axis, start, length, dia):
    plane = cq.Plane(origin=add(centre, (start, axis)), normal=axis)
    return cq.Workplane(plane).circle(dia / 2).extrude(length)


def nut_trap(centre, axis, slot_dir, af, h, slot_len):
    """Hex pocket (flats parallel to slot_dir) centred on `centre`, h long along `axis`,
    plus a slot of width af running slot_len along slot_dir so the nut can be pushed in."""
    plane = cq.Plane(origin=add(centre, (-h / 2, axis)), xDir=slot_dir, normal=axis)
    hexp = cq.Workplane(plane).polygon(6, af / math.cos(math.radians(30))).extrude(h)
    slot = cq.Workplane(plane).center(slot_len / 2, 0).rect(slot_len, af).extrude(h)
    return hexp.union(slot)


# ---------------------------------------------------------------- X axis
def x_mount():
    y0, y1 = 260.5, 291.9                     # in front of the back-beam tab (y 292.3)
    ym = (y0 + y1) / 2
    inner, outer, top = 11.19, 23.29, 347.61  # right gantry side plate
    b = box(9.0, 26.6, y0, y1, top, 350.6)                        # saddle
    b = b.union(box(9.0, inner - GAP, y0, y1, 343.6, top))        # inner lip
    b = b.union(box(outer + GAP, 26.6, y0, y1, 330.0, top))       # outer jaw
    b = b.union(box(26.6, 32.0, y0, y1, 330.0, 345.0))            # M4 lock boss
    b = b.union(box(9.5, 20.0, y0, y1, 350.6, 360.2))             # switch riser
    # switch pocket: end walls (front edge flush with the switch's lever face, use it to line
    # the switch up), bridge carrying the clamp. Terminal side left open for soldered wires.
    b = b.union(box(9.5, 21.5, y0, ym - SNUG_HALF, 360.2, 374.8))
    b = b.union(box(9.5, 21.5, ym + SNUG_HALF, y1, 360.2, 374.8))
    b = b.union(box(10.0, 21.5, y0, y1, 366.8, 374.8))
    # rod cradle: the inner jaw comes down the inside of the plate and sits over the end of the
    # upper 20 mm X rod, so the bracket drops into place (rod sets y and height, back beam behind).
    # Wraps the top and the front side; the back side is cut at 45 deg so it prints without support.
    b = b.union(box(ROD_X0, inner - GAP, y0, y1, X_ROD[2], top))
    b = b.union(box(ROD_X0, inner - GAP, y0, X_ROD[1] - X_ROD_R, X_ROD[2] - 6.0, X_ROD[2]))
    b = b.cut(round_cut((ROD_X0 - 0.5, X_ROD[1], X_ROD[2]), (1, 0, 0), 0, 12.0, 2 * X_ROD_R))
    b = b.cut(box(ROD_X0 - 0.5, inner, X_ROD[1], y1 + 0.5, X_ROD[2] - 7.0, X_ROD[2] + 7.2))
    # M4 lock: through the outer jaw, nut slides in from below
    b = b.cut(round_cut((outer + GAP, ym, 337.5), (1, 0, 0), 0, 9.0, M4_CLEAR))
    b = b.cut(nut_trap((27.15, ym, 337.5), (1, 0, 0), (0, 0, -1), M4_NUT_AF, M4_NUT_H, 8.0))
    # M3 switch clamp: down through the bridge, nut slides in from the lever side (keeps it
    # clear of the pin holes, which sit toward the terminal side)
    b = b.cut(round_cut((13.0, ym, 366.8), (0, 0, 1), 0, 8.5, M3_CLEAR))
    b = b.cut(nut_trap((13.0, ym, 370.0), (0, 0, 1), (-1, 0, 0), M3_NUT_AF, M3_NUT_H, 6.0))
    sw = SwitchPlacement(face=(9.5, ym, 360.2 + ss5gl.T / 2), n=(-1, 0, 0), a=(0, 1, 0))
    for h in sw.holes():   # pins: pushed down through the bridge and the switch into the riser
        b = b.cut(round_cut((h[0], h[1], 366.6), (0, 0, 1), 0, 8.5, PIN_ACCESS))
        b = b.cut(round_cut((h[0], h[1], 360.2), (0, 0, -1), 0, 4.0, PIN_HOLE))
    print_rot = ((1, 0, 0), 90)               # y becomes print Z, y0 end on the bed
    return b, sw, print_rot


# ---------------------------------------------------------------- Y axis
def y_mount():
    front, floor, back = 319.09, 325.09, 339.09     # back end plate faces / groove floor
    g0, g1 = 54.87, 76.87                            # front groove (z)
    end = -1.82                                      # open right end of the end plate
    zb = g0 + 0.4                                    # common bed plane
    b = box(-21.8, end, front, floor - 0.4, g0 + 0.4, g1 - 0.4)   # tongue in groove
    b = b.union(box(end, 2.2, front, back + 9.2, zb, 81.4))       # spine around the end
    b = b.union(box(-16.8, end, back + GAP, back + 9.2, zb, 81.4))  # back jaw (below table)
    b = b.union(box(2.2, 14.0, front + 0.4, 333.0, zb, 92.0))     # arm / switch backing
    # switch pocket: outer wall carrying the clamp, end walls (front edge flush with the
    # switch's lever face). Terminal side left open for soldered wires.
    b = b.union(box(20.6, 28.6, 317.0, 333.0, zb, 92.0))
    b = b.union(box(14.0, 20.6, 317.0, 333.0, zb, 79.0 - SNUG_HALF))
    b = b.union(box(14.0, 20.6, 317.0, 333.0, 79.0 + SNUG_HALF, 92.0))
    # M4 lock: from behind into the end plate's flat band (z 61.7-68.0), nut from below
    b = b.cut(round_cut((-9.3, back + GAP, 64.9), (0, 1, 0), 0, 9.5, M4_CLEAR))
    b = b.cut(nut_trap((-9.3, 343.45, 64.9), (0, 1, 0), (0, 0, -1), M4_NUT_AF, M4_NUT_H, 11.0))
    # M3 switch clamp: through the outer wall, nut from the lever side (clear of the pin holes)
    b = b.cut(round_cut((20.6, 320.3, 79.0), (1, 0, 0), 0, 8.5, M3_CLEAR))
    b = b.cut(nut_trap((23.9, 320.3, 79.0), (1, 0, 0), (0, -1, 0), M3_NUT_AF, M3_NUT_H, 6.0))
    sw = SwitchPlacement(face=(14.0 + ss5gl.T / 2, 317.0, 79.0), n=(0, -1, 0), a=(0, 0, 1))
    for h in sw.holes():   # pins: pushed in from outside through the outer wall and the switch into the arm
        b = b.cut(round_cut((20.4, h[1], h[2]), (1, 0, 0), 0, 8.5, PIN_ACCESS))
        b = b.cut(round_cut((14.0, h[1], h[2]), (-1, 0, 0), 0, 4.0, PIN_HOLE))
    print_rot = None                           # prints as modelled, z=zb face on the bed
    return b, sw, print_rot


# ---------------------------------------------------------------- Z axis
def z_mount():
    right, shelf, bottom = -305.28, 369.74, 360.73  # Z top plate
    c0, c1 = 248.6, 259.0          # clamp section: behind the spindle holder (y <= 248.2)
    y_front = 140.6                # switch sits over the holder's right clamp ear (y 140-166)
    top = 380.0
    b = box(-316.4, right + GAP, y_front, c1, shelf + GAP, top)            # top beam
    b = b.union(box(right + GAP, -301.0, y_front, c1, 357.5, top))         # outer spine
    b = b.union(box(-310.5, right + GAP, c0, c1, 357.5, bottom - 0.6))     # hook under plate (droop room)
    b = b.union(box(-316.4, -312.2, y_front, 167.0, 359.5, top))           # inner wall
    b = b.union(box(-316.4, -301.0, y_front, 153.0 - SNUG_HALF, 359.5, top))           # front end cap
    b = b.union(box(-312.2, right + GAP, 153.0 + SNUG_HALF, 155.0 + SNUG_HALF, 359.5, top))        # rear end wall
    b = b.union(box(-301.0, -295.8, 145.0, 161.0, 359.5, top))             # M3 clamp boss
    b = b.cut(box(-311.0, -306.6, 153.0 - SNUG_HALF, 153.0 + SNUG_HALF, 369.0, top + 0.5))         # terminal / wire slot
    # locating fork: an arm over the plate with a slot that slides onto the socket head of the
    # Z rod's top screw. Open toward -x, so sliding the clip on stops on the head (sets x and y).
    hx, hy = Z_HEAD
    b = b.union(box(-328.0, -316.4, hy - Z_HEAD_R - 2.6, hy + Z_HEAD_R + 2.6, shelf + GAP, top))
    b = b.cut(round_cut((hx, hy, shelf), (0, 0, 1), 0, 5.2, 2 * Z_HEAD_R))
    b = b.cut(box(-329.0, hx, hy - Z_HEAD_R, hy + Z_HEAD_R, shelf, shelf + 5.2))
    # M4 lock: down through the beam onto the plate shelf, nut from the inner side
    b = b.cut(round_cut((-310.8, 253.8, shelf + GAP), (0, 0, 1), 0, 11.0, M4_CLEAR))
    b = b.cut(nut_trap((-310.8, 253.8, 374.0), (0, 0, 1), (-1, 0, 0), M4_NUT_AF, M4_NUT_H, 7.0))
    # M3 switch clamp: through the spine boss from outside, nut from below (clear of the pin holes)
    b = b.cut(round_cut((right + GAP, 153.0, 362.0), (1, 0, 0), 0, 10.0, M3_CLEAR))
    b = b.cut(nut_trap((-300.85, 153.0, 362.0), (1, 0, 0), (0, 0, -1), M3_NUT_AF, M3_NUT_H, 6.0))
    sw = SwitchPlacement(face=(-308.8, 153.0, 359.5), n=(0, 0, -1), a=(0, 1, 0))
    for h in sw.holes():   # pins: pushed in from outside through the spine boss and the switch into the inner wall
        b = b.cut(round_cut((-305.6, h[1], h[2]), (1, 0, 0), 0, 10.0, PIN_ACCESS))
        b = b.cut(round_cut((-312.2, h[1], h[2]), (-1, 0, 0), 0, 2.2, PIN_HOLE))
    print_rot = ((1, 0, 0), 180)              # upside down: top face on the bed
    return b, sw, print_rot


MOUNTS = {"X": x_mount, "Y": y_mount, "Z": z_mount}


def pin(d=PIN_D, length=PIN_LEN, chamfer=0.3):
    """Printed locating pin, standing on the bed. Lead-in chamfer on the top end only, so the
    full diameter sits on the bed. Push it in chamfered end first."""
    return cq.Workplane("XY").circle(d / 2).extrude(length).faces(">Z").edges().chamfer(chamfer)


def pin_set():
    """Test set printed together: 4 pins each of 2.20, 2.25 and 2.30 mm (2.30 is the default)."""
    out = None
    for row, d in enumerate((2.20, 2.25, 2.30)):
        for col in range(4):
            p = pin(d).translate((col * 7.0, row * 9.0, 0))
            out = p if out is None else out.union(p)
    # a little tab under each row so you can tell the sizes apart (1, 2, 3 notches)
    for row in range(3):
        tab = cq.Workplane("XY").box(24.0, 3.0, 0.6).translate((10.5, row * 9.0 + 4.0, 0.3))
        for k in range(row + 1):
            tab = tab.cut(cq.Workplane("XY").box(1.2, 3.2, 1.0).translate((1.0 + k * 2.4, row * 9.0 + 4.0, 0.3)))
        out = out.union(tab)
    return out


def test_piece():
    """Small coupon to check fits before printing the brackets: switch pocket with its pin holes,
    M3 and M4 nyloc traps with clearance holes, and three pin-hole sizes. Prints flat."""
    t = box(0, 46, 0, 26, 0, 9)
    # switch pocket 20 x 10.4, 3.5 deep, with the two pin holes 4 mm deeper
    x0, y0 = 3.0, 3.0
    t = t.cut(box(x0, x0 + ss5gl.L + 2 * SNUG, y0, y0 + ss5gl.H + 0.2, 9 - 3.5, 9.1))
    for s in (-1, 1):
        cx = x0 + SNUG + ss5gl.L / 2 + s * ss5gl.HOLE_SP / 2
        cy = y0 + 0.1 + ss5gl.H - ss5gl.HOLE_Y
        t = t.cut(round_cut((cx, cy, 9 - 3.5), (0, 0, -1), 0, 4.0, PIN_HOLE))
    # nut traps from the top, clearance holes through
    for (cx, cy, af, h, clear) in ((30.0, 8.0, M3_NUT_AF, M3_NUT_H, M3_CLEAR), (39.0, 8.0, M4_NUT_AF, M4_NUT_H, M4_CLEAR)):
        plane = cq.Plane(origin=(cx, cy, 9 - h), normal=(0, 0, 1))
        t = t.cut(cq.Workplane(plane).polygon(6, af / math.cos(math.radians(30))).extrude(h + 0.1))
        t = t.cut(round_cut((cx, cy, -0.1), (0, 0, 1), 0, 9.2, clear))
    # pin-hole size row, left to right 2.35 / 2.45 (used in the brackets) / 2.55, 6 mm deep
    for i, d in enumerate((2.35, 2.45, 2.55)):
        t = t.cut(round_cut((28.0 + i * 6.0, 19.0, 9.1), (0, 0, -1), 0, 6.1, d))
    return t


def to_print(shape, rot):
    s = shape
    if rot:
        s = s.rotate((0, 0, 0), rot[0], rot[1])
    bb = s.val().BoundingBox()
    return s.translate((-bb.xmin, -bb.ymin, -bb.zmin))


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(os.path.join(here, "stl"), exist_ok=True)
    os.makedirs(os.path.join(here, "step"), exist_ok=True)
    asm = cq.Assembly()
    for axis, fn in MOUNTS.items():
        bracket, sw, rot = fn()
        assert bracket.val().isValid(), axis
        asm.add(bracket, name=f"mount_{axis}", color=cq.Color(1.0, 0.45, 0.0))
        asm.add(sw.solid(), name=f"switch_{axis}", color=cq.Color(0.1, 0.1, 0.1))
        cq.exporters.export(bracket, os.path.join(here, "step", f"mount_{axis}_machine.step"))
        p = to_print(bracket, rot)
        cq.exporters.export(p, os.path.join(here, "stl", f"mount_{axis}.stl"), tolerance=0.01, angularTolerance=0.1)
        cq.exporters.export(p, os.path.join(here, "step", f"mount_{axis}_print.step"))
        bb = p.val().BoundingBox()
        print(axis, "print bbox %.1f x %.1f x %.1f mm" % (bb.xlen, bb.ylen, bb.zlen),
              "vol %.1f mm3" % bracket.val().Volume())
    for name, part in (("pins_test_set", pin_set()), ("fit_test_piece", test_piece())):
        cq.exporters.export(part, os.path.join(here, "stl", f"{name}.stl"), tolerance=0.01, angularTolerance=0.1)
        bb = part.val().BoundingBox()
        print(name, "bbox %.1f x %.1f x %.1f mm" % (bb.xlen, bb.ylen, bb.zlen))
    asm.save(os.path.join(here, "step", "limit_switch_mounts_in_machine.step"))
    print("ok")
