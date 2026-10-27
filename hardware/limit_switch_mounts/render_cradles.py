"""Section views of the locating features: the X rod cradle, the Y rail clamp, and the Z fork."""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import cadquery as cq
import frame_mounts as fm
from render_mounts import tris, shade

ORANGE, LIGHT, DARK = np.array([1.0, 0.5, 0.1]), np.array([0.95, 0.68, 0.25]), np.array([0.25, 0.25, 0.28])


def rod(start, axis, length, r):
    return cq.Workplane(cq.Plane(origin=start, normal=axis)).circle(r).extrude(length).val()


def plot_section(ax, part, plane_box, axes, colour):
    """Fill the faces where `part` is cut by the thin box `plane_box` (x0, x1, y0, y1, z0, z1);
    `axes` picks the two coordinates to plot, `plane_box`'s thin direction is the view direction."""
    cut = part.intersect(fm.box(*plane_box))
    sel = {"yz": "<X", "xz": "<Y"}[axes]
    for face in cut.faces(sel).vals():
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
            e = np.array([(p.y, p.z) if axes == "yz" else (p.x, p.z) for p in chain])
            ax.fill(e[:, 0], e[:, 1], color=colour if wi == 0 else "white", lw=0)
            ax.plot(e[:, 0], e[:, 1], color="k", lw=0.6)


def section_x(ax):
    """Cut through the X bracket 6 mm in from the end of the upper X rod (in the cradle)."""
    b, _, _ = fm.x_mount()
    xc = fm.x_left((6.0, 0, 0))[0] if fm.X_SIDE == "left" else 6.0
    dz = fm.X_LEFT_DZ if fm.X_SIDE == "left" else 0.0
    plot_section(ax, b, (xc, xc + 0.01, 200.0, 400.0, 300.0, 400.0), "yz", ORANGE)
    _, y, z = fm.X_ROD
    ax.add_patch(plt.Circle((y, z + dz), 10.0, color=DARK))
    ax.plot([314.19, 194.19], [347.61 + dz, 347.61 + dz], color="grey", lw=1, ls="--")
    ax.text(262, 348.6, "top of side plate (behind)", fontsize=8, color="grey")
    ax.axvspan(292.19, 300, color="grey", alpha=0.35)
    ax.text(292.6, 322, "back\nbeam", fontsize=8, color="grey")
    ax.set_xlim(255, 300); ax.set_ylim(318, 378); ax.set_aspect("equal")
    ax.set_xlabel("y (mm)"); ax.set_ylabel("z (mm)")
    ax.set_title("X: cradle on the left end of the upper X rod\n0.1 mm gap over the top and the front side", fontsize=10)


def section_y(ax):
    """Cut across the Y bracket on the lock screw, looking from the back: tongue in the table's T-slot."""
    yl, zl = fm.Y_LOCK
    b, _, _ = fm.y_mount()
    pb = (-40.0, 40.0, yl, yl + 0.01, 40.0, 120.0)
    table = (cq.Workplane("XZ").polyline([(-40, 81.87), (-2.72, 81.87), (-2.72, 86.37), (-4.92, 86.37), (-4.92, 84.07), (-9.49, 84.07),
                                           (-9.49, 94.77), (-4.92, 94.77), (-4.92, 92.37), (-2.72, 92.37), (-2.72, 96.97), (-40, 96.97)]).close()
             .extrude(-2).translate((0, yl - 1, 0)).val())
    plot_section(ax, cq.Workplane().add(table), pb, "xz", np.array([0.8, 0.8, 0.82]))
    ax.add_patch(plt.Rectangle((-40, 40), 38.18, 41.87, color=np.array([0.8, 0.8, 0.82]), alpha=0.5, lw=0))
    ax.text(-38, 60, "back end plate\n(in front of the cut)", fontsize=8, color="0.3")
    plot_section(ax, b, pb, "xz", ORANGE)
    # M4 x 12 (tip on the table side, head about 2.3 mm proud) and its nyloc
    ax.add_patch(plt.Rectangle((-2.72, zl - 2.0), 12.0, 4.0, color="0.55"))
    ax.add_patch(plt.Rectangle((9.28, zl - 3.5), 4.0, 7.0, color="0.4"))
    ax.add_patch(plt.Rectangle((0.1, zl - 4.04), 5.0, 8.08, color="0.4"))
    ax.annotate("M4 x 12", (11.3, zl + 3.5), (14, zl + 10), fontsize=8, arrowprops={"arrowstyle": "-", "lw": 0.6})
    ax.annotate("tongue in the\ntable's T-slot", (-7.2, 89.4), (-36, 104), fontsize=8, arrowprops={"arrowstyle": "-", "lw": 0.6})
    ax.annotate("stop tab (rests on the\nend plate's back face)", (-3.8, 76), (-36, 46), fontsize=8, arrowprops={"arrowstyle": "-", "lw": 0.6})
    ax.text(-38, 98.5, "table", fontsize=8, color="0.3")
    ax.set_xlim(-40, 32); ax.set_ylim(40, 112); ax.set_aspect("equal")
    ax.set_xlabel("x (mm)"); ax.set_ylabel("z (mm)")
    ax.set_title("Y: bracket in the T-slot on the table's right edge\n(cut on the lock screw, seen from the back)", fontsize=10)


def scene_z():
    b, sw, _ = fm.z_mount()
    hx, hy = fm.Z_HEAD
    head = rod((hx, hy, 369.74), (0, 0, 1), 5.0, 4.25)
    return [(head, DARK), (b.val(), ORANGE)], (-55, 200), \
        "Z: fork slides onto the Z rod's top screw head\n(plate hidden, seen from below)"


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    fig = plt.figure(figsize=(17, 6.2), dpi=130)
    section_x(fig.add_subplot(1, 3, 1))
    section_y(fig.add_subplot(1, 3, 2))
    parts, (el, az), title = scene_z()
    ax = fig.add_subplot(1, 3, 3, projection="3d")
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
