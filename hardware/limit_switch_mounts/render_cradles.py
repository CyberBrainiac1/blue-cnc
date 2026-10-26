"""Renders of the X rod cradle and the Z locating fork, with the machine parts they sit on."""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import cadquery as cq
import frame_mounts as fm
from render_mounts import tris, shade

ORANGE, DARK = np.array([1.0, 0.5, 0.1]), np.array([0.25, 0.25, 0.28])


def rod(start, axis, length, r):
    return cq.Workplane(cq.Plane(origin=start, normal=axis)).circle(r).extrude(length).val()


def scene_x():
    b, sw, _ = fm.x_mount()
    _, y, z = fm.X_ROD
    return [(rod((-12.0, y, z), (1, 0, 0), 23.29, 10.0), DARK), (b.val(), ORANGE)], (8, -165), \
        "X: inner jaw drops over the end of the upper X rod\n(side plate hidden, seen along the rod)"


def scene_z():
    b, sw, _ = fm.z_mount()
    hx, hy = fm.Z_HEAD
    head = rod((hx, hy, 369.74), (0, 0, 1), 5.0, 4.25)
    return [(head, DARK), (b.val(), ORANGE)], (-55, 200), \
        "Z: fork slides onto the Z rod's top screw head\n(plate hidden, seen from below)"


def section_x(ax):
    """Cut through the X bracket at x = 6 (in the cradle), looking along the rod from the carriage."""
    b, _, _ = fm.x_mount()
    face = b.intersect(fm.box(6.0, 6.01, 200.0, 400.0, 300.0, 400.0)).faces("<X").val()
    for wi, w in enumerate([face.outerWire()] + face.innerWires()):
        pts = []
        for e in w.Edges():   # edges of a wire are not all in order, so walk them by matching ends
            pts.append([e.positionAt(u) for u in np.linspace(0, 1, 24)])
        chain = pts.pop(0)
        while pts:
            end = chain[-1]
            k = min(range(len(pts)), key=lambda j: min((pts[j][0] - end).Length, (pts[j][-1] - end).Length))
            seg = pts.pop(k)
            chain += seg if (seg[0] - end).Length <= (seg[-1] - end).Length else seg[::-1]
        e = np.array([(p.y, p.z) for p in chain])
        ax.fill(e[:, 0], e[:, 1], color=ORANGE if wi == 0 else "white", lw=0)
        ax.plot(e[:, 0], e[:, 1], color="k", lw=0.6)
    _, y, z = fm.X_ROD
    ax.add_patch(plt.Circle((y, z), 10.0, color=DARK))
    ax.plot([314.19, 194.19], [347.61, 347.61], color="grey", lw=1, ls="--")
    ax.text(262, 348.6, "top of side plate (behind)", fontsize=8, color="grey")
    ax.axvspan(292.19, 300, color="grey", alpha=0.35)
    ax.text(292.6, 322, "back\nbeam", fontsize=8, color="grey")
    ax.set_xlim(255, 300); ax.set_ylim(318, 378); ax.set_aspect("equal")
    ax.set_xlabel("y (mm)"); ax.set_ylabel("z (mm)")
    ax.set_title("X: section through the cradle (x = 6), rod 20 mm\n0.1 mm gap over the top and the front side", fontsize=10)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    fig = plt.figure(figsize=(12, 6.2), dpi=130)
    section_x(fig.add_subplot(1, 2, 1))
    for i, fn in enumerate((scene_z,)):
        parts, (el, az), title = fn()
        ax = fig.add_subplot(1, 2, i + 2, projection="3d")
        allv = []
        for shape, col in parts:
            t = tris(shape)
            allv.append(t.reshape(-1, 3))
            ax.add_collection3d(Poly3DCollection(t, facecolors=shade(t, col), edgecolors="none"))
        v = np.vstack(allv)
        lo, hi = v.min(0), v.max(0)
        c, r = (lo + hi) / 2, (hi - lo).max() / 2
        ax.set_xlim(c[0] - r, c[0] + r); ax.set_ylim(c[1] - r, c[1] + r); ax.set_zlim(c[2] - r, c[2] + r)
        ax.set_box_aspect((1, 1, 1))
        ax.view_init(el, az)
        ax.set_axis_off()
        ax.set_title(title, fontsize=10)
    plt.tight_layout()
    out = os.path.join(here, "renders", "cradles.png")
    plt.savefig(out, facecolor="white")
    print(out)


if __name__ == "__main__":
    main()
