"""Clash checks against a simple model of the header, plus preview renders (renders/*.png).
The header model is a plain rectangular socket 0.1 mm bigger than the plug's in-socket part
(fit test piece 1 fit the real header snugly), with 4 square pins."""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import cadquery as cq
import header_plug as hp


def header(v=None):
    """Housing walls + floor + 4 square pins, socket 0.1 mm bigger than size v."""
    W, L = (d + 0.1 for d in hp.VARIANTS[v or hp.SIZE])
    wl = hp.SOCK_WALL
    h = hp.box(-L / 2 - wl, L / 2 + wl, -W / 2 - wl, W / 2 + wl, -1.5, hp.SOCK_H)
    h = h.cut(hp.box(-L / 2, L / 2, -W / 2, W / 2, 0, hp.SOCK_H + 1))
    for i in range(hp.N):
        t = hp.PIN_T / 2
        h = h.union(hp.box(hp.pin_x(i) - t, hp.pin_x(i) + t, -t, t, -1, hp.PIN_H))
    return h


def vol(a, b):
    try:
        return a.intersect(b).val().Volume()
    except Exception:
        return 0.0


def jaw_clamped(i, shift):
    return hp.jaw(i).translate((0, -shift, 0))


def tris(shape, tol=0.05):
    verts, faces = shape.tessellate(tol, 0.2)
    v = np.array([(p.x, p.y, p.z) for p in verts])
    return v[np.array(faces)]


def shade(t, base):
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    light = np.array([0.4, -0.5, 0.75])
    light /= np.linalg.norm(light)
    k = 0.45 + 0.55 * np.abs(n @ light)
    return np.clip(np.outer(k, base), 0, 1)


def draw(ax, parts, elev, azim, title):
    allv = []
    for shape, col, alpha in parts:
        t = tris(shape.val())
        allv.append(t.reshape(-1, 3))
        pc = Poly3DCollection(t, facecolors=shade(t, np.array(col)), edgecolors="none", alpha=alpha)
        ax.add_collection3d(pc)
    v = np.vstack(allv)
    c, r = (v.max(0) + v.min(0)) / 2, (v.max(0) - v.min(0)).max() / 2
    ax.set_xlim(c[0] - r, c[0] + r); ax.set_ylim(c[1] - r, c[1] + r); ax.set_zlim(c[2] - r, c[2] + r)
    ax.set_box_aspect((1, 1, 1)); ax.view_init(elev, azim); ax.set_axis_off()
    ax.set_title(title, fontsize=9)


def cut_polys(shape, origin, normal, axes):
    """Faces where a plane cuts a solid, as lists of 2D points (axes picks the two coords)."""
    face = cq.Face.makePlane(200, 200, basePnt=cq.Vector(*origin), dir=cq.Vector(*normal))
    polys = []
    for f in shape.val().intersect(face).Faces():
        for k, w in enumerate([f.outerWire()] + f.innerWires()):
            pts = [w.positionAt(t).toTuple() for t in np.linspace(0, 1, 400)]
            polys.append(([(p[axes[0]], p[axes[1]]) for p in pts], k > 0))
    return polys


def draw_section(ax, items, origin, normal, axes, title, xlabel, ylabel):
    from matplotlib.patches import Polygon
    for shape, col, label in items:
        first = True
        for pts, hole in cut_polys(shape, origin, normal, axes):
            ax.add_patch(Polygon(pts, closed=True, facecolor="white" if hole else col,
                                 edgecolor="k", lw=0.5, label=label if first and not hole else None))
            first = False if not hole else first
    ax.set_aspect("equal"); ax.autoscale_view(); ax.margins(0.05)
    ax.set_title(title, fontsize=9); ax.set_xlabel(xlabel, fontsize=8); ax.set_ylabel(ylabel, fontsize=8)
    ax.tick_params(labelsize=7); ax.grid(alpha=0.3)


def sections(here, body, hdr, jaws):
    green, orange, blue, grey = (0.45, 0.75, 0.5), (0.98, 0.65, 0.3), (0.45, 0.65, 1.0), (0.7, 0.7, 0.75)
    screws = None
    for i in range(hp.N):   # M3 bolts, tips touching the backed-off jaws
        wp, _ = hp.along_y(hp.screw_x(i), hp.screw_z(i), 0, hp.y_jaw_front + hp.SCREW_L)
        s = wp.circle(1.5).extrude(hp.SCREW_L)
        head = hp.along_y(hp.screw_x(i), hp.screw_z(i), 0, hp.y_jaw_front + hp.SCREW_L + 2)[0] \
            .transformed(rotate=(0, 0, 30)).polygon(6, 5.5 / 0.866).extrude(2)
        s = s.union(head)
        screws = s if screws is None else screws.union(s)
    jw = jaws[0]
    for j in jaws[1:]:
        jw = jw.union(j)
    items = [(hdr, green, "header model (socket fits size 1)"), (body, orange, "plug body"),
             (jw, blue, "jaws"), (screws, grey, "M3 bolts")]
    fig, axs = plt.subplots(1, 3, figsize=(17, 6.2), dpi=120)
    draw_section(axs[0], items, (hp.pin_x(1), 0, 0), (1, 0, 0), (1, 2),
                 "side cut through the NO pin (upper screw row)", "Y  (back / heatsink  <->  front / board interior)", "Z above housing floor")
    draw_section(axs[1], items, (0, 0, 3.5), (0, 0, 1), (0, 1),
                 "plan cut 3.5 mm above the housing floor (inside the socket)", "X  (C ... GND)", "Y")
    draw_section(axs[2], items, (0, 0, hp.ROW1), (0, 0, 1), (0, 1),
                 "plan cut at the lower screw row (C and 0-10V nuts)", "X  (C ... GND)", "Y")
    axs[0].legend(fontsize=7, loc="upper left")
    plt.tight_layout()
    fig.savefig(os.path.join(here, "renders", "plug_sections.png"))
    print("saved renders/plug_sections.png")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    v = hp.SIZE
    w, length = hp.VARIANTS[v]
    body, hdr = hp.body(v), header(v)
    jaws = [hp.jaw(i) for i in range(hp.N)]
    full = hp.y_lane_open - hp.PIN_T / 2    # jaw pushed until its face would touch the pin (no wire)
    print(f"size {v}: clash body/header %.3f, jaws/header %.3f, jaws/body %.3f, pushed jaws/body %.3f mm3; body valid {body.val().isValid()}"
          % (vol(body, hdr), sum(vol(j, hdr) for j in jaws), sum(vol(j, body) for j in jaws),
             sum(vol(jaw_clamped(i, full), body) for i in range(hp.N))))
    clash = 0.0
    for i in range(hp.N):
        for k in range(hp.N):
            if i != k:
                clash += vol(hp.nut_cut(i), hp.nut_cut(k)) + vol(hp.nut_cut(i), hp.screw_cut(k))
    print("clash between neighbouring nut slots / screw holes %.3f mm3" % clash)
    # each cell must be sealed from its neighbours inside the socket
    air = hp.box(-length / 2 + 0.05, length / 2 - 0.05, -w / 2 + 0.05, w / 2 - 0.05,
                 hp.NOSE_GAP + 0.01, hp.SOCK_H - 0.01).cut(body)
    pins_in = [sum(s.isInside(cq.Vector(hp.pin_x(i), 0, z)) for i in range(hp.N) for z in (1.0, 4.0, 7.5)) // 3
               for s in air.val().Solids()]
    print(f"air pockets in the socket {len(air.val().Solids())}, pins per pocket {pins_in} (no pocket may hold 2)")
    os.makedirs(os.path.join(here, "renders"), exist_ok=True)
    sections(here, body, hdr, jaws)


if __name__ == "__main__":
    main()
