"""Turn line art (light-on-dark or dark-on-light) into pen G-code for GRBL.

Thins every line down to a 1-pixel centre line (one pen pass per line), follows the
centre lines into strokes, simplifies them, orders them to keep pen-up travel short,
and scales the drawing so its longest side is SIZE_MM.

Usage:  python trace_to_gcode.py tiger_source.png tiger_sharpie.nc [size_mm]
            [--center] [--pen-down Z]
  --center      X0 Y0 is the middle of the drawing (default: its front-left corner)
  --pen-down Z  pen-down height; 0 when you zero Z with the pen already pressing the
                paper the way you want (default -0.5: zero Z with the tip just touching)
Also writes <output>_preview.png showing what the pen will draw, and <output>_clean.png,
a crisp white-on-black render of the cleaned-up lines.
"""

import argparse

import cv2
import numpy as np

SIZE_MM = 90.0
WORK_PX = 600          # small sources are upscaled to about this size before thinning
THRESHOLD = 60         # 0-255, after making lines light; brighter than this counts as line
MIN_STROKE_PX = 12     # drop dangling whiskers shorter than this (in working pixels)
JOIN_PX = 4            # stroke ends this close together (across a junction) may be joined
SIMPLIFY_PX = 1.2      # Douglas-Peucker tolerance (in working pixels)
SMOOTH_PASSES = 3      # Chaikin passes for upscaled (low-res) sources; sharp sources get none

PEN_DOWN_Z = -0.5      # default: Z0 = pen tip just touching the paper
PEN_UP_Z = 5.0         # clears a spring-mounted pen between strokes
DRAW_FEED = 400        # mm/min; slow enough for a Sharpie to lay down ink
PLUNGE_FEED = 300

NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def line_mask(path):
    """Returns (mask of line pixels, upscale factor used)."""
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if np.median(img) > 128:
        img = 255 - img  # dark lines on a light background: flip so lines are light
    else:
        # Light-on-dark screenshot: crop to the black artwork panel (the surround is dark grey).
        rows, cols = np.where(img < 12)
        img = img[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
    upscale = max(1, int(np.ceil(WORK_PX / min(img.shape))))
    if upscale > 1:
        img = cv2.resize(img, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)
    img = cv2.GaussianBlur(img, (3, 3), 0)
    mask = (img > THRESHOLD).astype(np.uint8)
    close_px = upscale + 2  # bridge tiny gaps in faint lines, never the art's deliberate gaps
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((close_px, close_px), np.uint8))

    # Drop anything touching the image edge: bits of other drawings cut off by the screenshot.
    n, labels = cv2.connectedComponents(mask)
    edge = set(np.unique(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1]))))
    for lab in edge - {0}:
        mask[labels == lab] = 0
    return mask, upscale


def thin(mask):
    """Zhang-Suen thinning: reduce every line to a 1-pixel-wide centre line."""
    m = np.pad(mask.copy(), 1)
    while True:
        changed = False
        for step in (0, 1):
            p2, p3, p4 = m[:-2, 1:-1], m[:-2, 2:], m[1:-1, 2:]
            p5, p6, p7 = m[2:, 2:], m[2:, 1:-1], m[2:, :-2]
            p8, p9 = m[1:-1, :-2], m[:-2, :-2]
            ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            count = sum(ring[:8])
            transitions = sum(((ring[i] == 0) & (ring[i + 1] == 1)).astype(int) for i in range(8))
            if step == 0:
                cond = (p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)
            else:
                cond = (p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0)
            remove = (m[1:-1, 1:-1] == 1) & (count >= 2) & (count <= 6) & (transitions == 1) & cond
            if remove.any():
                m[1:-1, 1:-1][remove] = 0
                changed = True
        if not changed:
            return m[1:-1, 1:-1]


def strokes_from_skeleton(skel):
    """Follow the skeleton into polylines, splitting at line ends and junctions."""
    pixels = set(zip(*np.nonzero(skel)))

    def nbrs(p):
        return [(p[0] + dy, p[1] + dx) for dy, dx in NEIGHBOURS if (p[0] + dy, p[1] + dx) in pixels]

    degree = {p: len(nbrs(p)) for p in pixels}
    # Thinning leaves little clumps of 3+-neighbour pixels on stair-steps and at forks.
    # Treat each clump as one junction: walks stop when they reach it, and never walk inside it.
    junction = {p for p in pixels if degree[p] >= 3}
    used = set()  # edges already drawn, as frozenset pairs
    strokes = []

    def walk(start, nxt):
        path = [start, nxt]
        used.add(frozenset((start, nxt)))
        while path[-1] not in junction and degree[path[-1]] == 2:
            step = [q for q in nbrs(path[-1]) if frozenset((path[-1], q)) not in used]
            if not step:
                break
            used.add(frozenset((path[-1], step[0])))
            path.append(step[0])
        return path

    starts = list(junction) + [p for p in pixels if degree[p] <= 1] + list(pixels)  # last: loops
    for p in starts:
        for q in nbrs(p):
            if p in junction and q in junction:
                continue
            if frozenset((p, q)) not in used:
                strokes.append(walk(p, q))
    # Short strokes with a loose end are thinning whiskers; short links between junctions
    # are real connections, so they stay.
    strokes = [s for s in strokes
               if len(s) >= MIN_STROKE_PX or (s[0] in junction and s[-1] in junction)]

    # Snap stroke ends to the centre of their junction clump, so lines meeting there touch.
    centre = {}
    for p in junction:
        if p in centre:
            continue
        clump, todo = [], [p]
        centre[p] = None
        while todo:
            q = todo.pop()
            clump.append(q)
            for n in nbrs(q):
                if n in junction and n not in centre:
                    centre[n] = None
                    todo.append(n)
        mid = tuple(np.mean(clump, axis=0))
        for q in clump:
            centre[q] = mid
    snapped = []
    for s in strokes:
        s = [tuple(map(float, q)) for q in s]
        if tuple(map(int, s[0])) in centre:
            s[0] = centre[tuple(map(int, s[0]))]
        if tuple(map(int, s[-1])) in centre:
            s[-1] = centre[tuple(map(int, s[-1]))]
        snapped.append(s)
    return snapped


def join_strokes(strokes, gap_px=JOIN_PX, max_turn_deg=60):
    """Join strokes whose ends meet at a junction and carry on in roughly the same direction,
    so a line passing through a junction is drawn in one pen-down move."""
    strokes = [np.asarray(s, dtype=float) for s in strokes]

    def end_dir(s, at_start):
        # Direction pointing out of the stroke at that end, averaged over a few points.
        a, b = (s[0], s[min(4, len(s) - 1)]) if at_start else (s[-1], s[max(-5, -len(s))])
        d = a - b
        n = np.linalg.norm(d)
        return d / n if n else d

    cos_limit = np.cos(np.radians(180 - max_turn_deg))
    while True:
        best = None
        for i, a in enumerate(strokes):
            for j in range(i + 1, len(strokes)):
                b = strokes[j]
                for a_start in (False, True):
                    for b_start in (False, True):
                        pa, pb = (a[0] if a_start else a[-1]), (b[0] if b_start else b[-1])
                        gap = np.linalg.norm(pa - pb)
                        if gap > gap_px:
                            continue
                        # Both directions point outward; a straight continuation makes them opposite.
                        straightness = np.dot(end_dir(a, a_start), end_dir(b, b_start))
                        if straightness > cos_limit:
                            continue
                        if best is None or straightness < best[0]:
                            best = (straightness, i, j, a_start, b_start)
        if best is None:
            return strokes
        _, i, j, a_start, b_start = best
        a, b = strokes[i], strokes[j]
        a = a[::-1] if a_start else a          # make a end at the joint
        b = b if b_start else b[::-1]          # make b start at the joint
        strokes[i] = np.vstack((a, b))
        strokes.pop(j)


def simplify(stroke):
    pts = np.asarray(stroke, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.approxPolyDP(pts, SIMPLIFY_PX, False).reshape(-1, 2)


def smooth(stroke, passes=SMOOTH_PASSES):
    """Chaikin corner cutting: each pass replaces every corner with two points 1/4 and 3/4
    along its edges. Keeps both end points, so strokes still meet where they should."""
    s = np.asarray(stroke, dtype=float)
    for _ in range(passes):
        if len(s) < 3:
            return s
        a, b = s[:-1], s[1:]
        cut = np.empty((2 * len(a), 2))
        cut[0::2] = 0.75 * a + 0.25 * b
        cut[1::2] = 0.25 * a + 0.75 * b
        s = np.vstack((s[:1], cut[1:-1], s[-1:]))
    return s


def order_strokes(strokes, start):
    """Greedy nearest-neighbour ordering from where the pen starts, reversing strokes
    when that end is closer."""
    remaining = list(strokes)
    ordered, pos = [], np.asarray(start, dtype=float)
    while remaining:
        best = min(
            ((i, rev, np.linalg.norm((s[-1] if rev else s[0]) - pos))
             for i, s in enumerate(remaining) for rev in (False, True)),
            key=lambda t: t[2])
        s = remaining.pop(best[0])
        s = s[::-1] if best[1] else s
        ordered.append(s)
        pos = s[-1]
    return ordered


def origin_px(strokes, center):
    """Where X0 Y0 sits, in image pixels: the drawing's middle, or its front-left corner
    (bottom-left of the picture)."""
    allpts = np.vstack(strokes)
    lo, hi = allpts.min(axis=0), allpts.max(axis=0)
    return (lo + hi) / 2 if center else np.array([lo[0], hi[1]])


def to_mm(strokes, size_mm, origin):
    allpts = np.vstack(strokes)
    span = max(np.ptp(allpts[:, 0]), np.ptp(allpts[:, 1]))
    scale = size_mm / span
    # Image rows grow downward; flip so the top of the picture is towards the back (Y+).
    return [np.column_stack(((s[:, 0] - origin[0]) * scale, (origin[1] - s[:, 1]) * scale))
            for s in strokes]


def write_gcode(strokes, path, source, size_mm, center, pen_down):
    where = "middle" if center else "front-left corner"
    touch = ("pen already pressing the paper the way you want"
             if pen_down >= 0 else "pen tip just touching the paper")
    out = [
        f"(Sharpie drawing traced from {source}, longest side {size_mm:g} mm.)",
        "(NO BIT. SPINDLE OFF. There is no M3 in this file.)",
        f"(X0 Y0 = {where} of the drawing. Z0 = {touch}; pen-down Z{pen_down:g}.)",
        "(The first move lifts the pen before travelling.)",
        "G21", "G90", f"G0 Z{PEN_UP_Z:g}",
    ]
    for s in strokes:
        out.append(f"G0 X{s[0, 0]:.2f} Y{s[0, 1]:.2f}")
        out.append(f"G1 Z{pen_down:g} F{PLUNGE_FEED}")
        out.append(f"G1 X{s[1, 0]:.2f} Y{s[1, 1]:.2f} F{DRAW_FEED}")
        out.extend(f"G1 X{x:.2f} Y{y:.2f}" for x, y in s[2:])
        out.append(f"G0 Z{PEN_UP_Z:g}")
    out += ["G0 Z10", "G0 X0 Y0", "M2"]
    with open(path, "w") as f:
        f.write("\n".join(out) + "\n")
    return len(out)


def write_clean_image(strokes, path, px_per_mm=12, line_mm=1.0, margin_mm=6):
    """Crisp white-on-black render of the cleaned-up drawing, like the source art."""
    allpts = np.vstack(strokes)
    lo, hi = allpts.min(axis=0), allpts.max(axis=0)
    w = int((hi[0] - lo[0] + 2 * margin_mm) * px_per_mm)
    h = int((hi[1] - lo[1] + 2 * margin_mm) * px_per_mm)
    img = np.zeros((h, w), np.uint8)
    for s in strokes:
        pts = np.column_stack(((s[:, 0] - lo[0] + margin_mm) * px_per_mm,
                               h - (s[:, 1] - lo[1] + margin_mm) * px_per_mm))
        cv2.polylines(img, [np.round(pts * 16).astype(np.int32)], False, 255,
                      thickness=max(1, int(line_mm * px_per_mm)), lineType=cv2.LINE_AA, shift=4)
    cv2.imwrite(path, img)


def write_preview(strokes, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(6, 6))
    pos = np.array([0.0, 0.0])
    for s in strokes:
        ax.plot([pos[0], s[0, 0]], [pos[1], s[0, 1]], color="#cccccc", lw=0.5, ls="--")
        ax.plot(s[:, 0], s[:, 1], color="black", lw=1.6)
        pos = s[-1]
    ax.set_aspect("equal")
    ax.set_xlabel("X (mm)")
    ax.set_ylabel("Y (mm)")
    ax.set_title("Pen down = black, pen-up travel = grey dashes")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=110)


def main():
    ap = argparse.ArgumentParser(description="Trace line art into pen G-code for GRBL.")
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("size_mm", nargs="?", type=float, default=SIZE_MM)
    ap.add_argument("--center", action="store_true", help="X0 Y0 = middle of the drawing")
    ap.add_argument("--pen-down", type=float, default=PEN_DOWN_Z, help="pen-down Z height")
    a = ap.parse_args()

    mask, upscale = line_mask(a.src)
    passes = SMOOTH_PASSES if upscale > 1 else 0
    raw = strokes_from_skeleton(thin(mask))
    joined = join_strokes([[(c, r) for r, c in s] for s in raw])  # (row, col) -> (x, y)
    print(f"strokes: {len(raw)} traced, {len(joined)} after joining")
    strokes = [simplify(s).astype(float) for s in joined]
    strokes = [s for s in strokes if len(s) >= 2]
    origin = origin_px(strokes, a.center)
    strokes = order_strokes(strokes, start=origin)  # start where the pen is
    strokes = [smooth(s, passes) for s in to_mm(strokes, a.size_mm, origin)]
    source = a.src.replace("\\", "/").split("/")[-1]
    n_lines = write_gcode(strokes, a.dst, source, a.size_mm, a.center, a.pen_down)
    write_preview(strokes, a.dst.rsplit(".", 1)[0] + "_preview.png")
    write_clean_image(strokes, a.dst.rsplit(".", 1)[0] + "_clean.png")

    allpts = np.vstack(strokes)
    draw = sum(np.linalg.norm(np.diff(s, axis=0), axis=1).sum() for s in strokes)
    travel = sum(np.linalg.norm(b[0] - a[-1]) for a, b in zip(strokes, strokes[1:]))
    print(f"strokes: {len(strokes)}, G-code lines: {n_lines}")
    print(f"size: X {allpts[:, 0].min():.1f}..{allpts[:, 0].max():.1f} mm, "
          f"Y {allpts[:, 1].min():.1f}..{allpts[:, 1].max():.1f} mm")
    print(f"pen-down length: {draw:.0f} mm, pen-up travel: {travel:.0f} mm, "
          f"drawing time ~{draw / DRAW_FEED + len(strokes) * 0.05:.1f} min")


if __name__ == "__main__":
    main()
