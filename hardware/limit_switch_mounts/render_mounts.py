"""Close-up renders of each bracket with its switch (lever free), from frame_mounts.py."""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import cadquery as cq
import frame_mounts as fm

VIEWS = {  # (elevation, azimuth) chosen so the lever face is visible
    "X": (28, -55, "X: saddle over the LEFT gantry side plate\nlever faces +X (toward the carriage)"),
    "Y": (22, -125, "Y: clamp on the back end of the right Y rail\nlever faces -Y (toward the gantry)"),
    "Z": (-28, -40, "Z: clip on the Z top plate (seen from below)\nlever faces down onto the spindle-holder ear"),
}


def tris(shape, tol=0.05):
    verts, faces = shape.tessellate(tol, 0.2)
    v = np.array([(p.x, p.y, p.z) for p in verts])
    return v[np.array(faces)]


def shade(t, base):
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    light = np.array([0.4, -0.5, 0.75]); light /= np.linalg.norm(light)
    k = 0.45 + 0.55 * np.abs(n @ light)
    return np.clip(np.outer(k, base), 0, 1)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    fig = plt.figure(figsize=(15, 5.6), dpi=130)
    for i, (axis, fn) in enumerate(fm.MOUNTS.items()):
        bracket, sw, _ = fn()
        parts = [(tris(bracket.val()), np.array([1.0, 0.5, 0.1])),
                 (tris(fm.ss5gl.body().val().moved(cq.Location(cq.Plane(origin=sw.origin, xDir=sw.a, normal=sw.t)))), np.array([0.15, 0.15, 0.15])),
                 (tris(fm.ss5gl.lever().val().moved(cq.Location(cq.Plane(origin=sw.origin, xDir=sw.a, normal=sw.t)))), np.array([0.7, 0.7, 0.75]))]
        ax = fig.add_subplot(1, 3, i + 1, projection="3d")
        # one collection so matplotlib depth-sorts all triangles together
        T = np.vstack([t for t, _ in parts])
        C = np.vstack([shade(t, col) for t, col in parts])
        ax.add_collection3d(Poly3DCollection(T, facecolors=C, edgecolors=(0, 0, 0, 0.1), linewidths=0.2))
        allv = T.reshape(-1, 3)
        if axis == "Z":   # frame the switch end of the long arm
            allv = allv[allv[:, 1] < sw.origin[1] + 25]
        c = (allv.max(0) + allv.min(0)) / 2
        r = (allv.max(0) - allv.min(0)).max() / 2 * 1.05
        ax.set_xlim(c[0] - r, c[0] + r); ax.set_ylim(c[1] - r, c[1] + r); ax.set_zlim(c[2] - r, c[2] + r)
        ax.set_box_aspect((1, 1, 1))
        el, az, title = VIEWS[axis]
        ax.view_init(el, az)
        ax.set_title(title, fontsize=10)
        ax.set_axis_off()
    plt.tight_layout()
    out = os.path.join(here, "renders", "mounts_closeup.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    plt.savefig(out, facecolor="white")
    print(out)


if __name__ == "__main__":
    main()
