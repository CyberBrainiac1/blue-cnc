"""Turn SOLIDWORKS CAM G-code (posted with the Mach3 "mach_iii" post) into G-code GRBL 1.1 accepts.

GRBL can't run some of what that post writes, so this script:
  - drops the % and O#### program lines and N line numbers
  - drops tool length offsets (G43 H.., G49) and Mach3-only modes (G64, G61, G91.1)
  - drops M7 mist coolant, which this GRBL build doesn't have
  - removes T.. / M6 tool changes. A change to a different tool after the first one becomes
    M5 + M0 so the job pauses (spindle off) while you swap the bit and re-zero Z
  - turns G28 "go home" moves into a plain retract to SAFE_Z and a move back to X0 Y0,
    because this machine has no homing switches
  - expands drilling cycles (G81, G82, G83, G73) into ordinary G0/G1 moves
  - converts absolute arc centres (G90.1) into the relative I/J/K GRBL uses
It refuses to convert files with cutter compensation (G41/G42), inverse-time or per-rev feed
(G93/G95), subprograms (M98/M99) or macros, since those would cut the wrong shape.

Usage:
    python solidworks_to_grbl.py part.txt              writes part_grbl.nc next to it
    python solidworks_to_grbl.py part.txt out.nc
    python solidworks_to_grbl.py part.txt --safe-z 15
"""

import argparse
import re
import sys
from pathlib import Path

SAFE_Z = 10.0  # mm above work zero used when replacing G28 moves

WORD = re.compile(r"([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))")
COMMENT = re.compile(r"\([^)]*\)|;.*$")
DROP_G = {"43", "49", "64", "61", "91.1", "94"}  # G94 is GRBL's default, the rest it can't use
REFUSE_G = {"41", "42", "93", "95", "68", "51"}
DRILL_G = {"81", "82", "83", "73"}


class ConvertError(Exception):
    pass


def fmt(v):
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


class Converter:
    def __init__(self, safe_z):
        self.safe_z = safe_z
        self.out = []
        self.warnings = []
        self.pos = {"X": 0.0, "Y": 0.0, "Z": safe_z}
        self.absolute = True
        self.ijk_absolute = False
        self.motion = None
        self.drill = None  # active canned cycle: dict of its parameters
        self.retract_initial = True  # G98 (back to the starting Z) vs G99 (back to R)
        self.feed = None
        self.first_tool = None
        self.current_tool = None

    def emit(self, line):
        self.out.append(line)

    def convert(self, lines):
        for n, raw in enumerate(lines, 1):
            try:
                self.line(raw)
            except ConvertError as e:
                raise ConvertError(f"line {n}: {e}\n    {raw.strip()}") from None
        return self.out

    def line(self, raw):
        text = raw.strip()
        if not text or text == "%":
            return
        comments = [c for c in COMMENT.findall(text) if c.startswith("(")]
        code = COMMENT.sub("", text).upper().strip()
        if code.startswith("O") and re.fullmatch(r"O\d+", code.split()[0]):
            code = code[len(code.split()[0]):].strip()
        if not code:
            for c in comments:
                self.emit(c)
            return

        words = WORD.findall(code)
        leftover = WORD.sub("", code).strip()
        if leftover:
            raise ConvertError(f"can't read '{leftover}' (macros or variables aren't supported)")

        g = [fmt(float(v)) for k, v in words if k == "G"]
        m = [str(int(float(v))) for k, v in words if k == "M"]
        vals = {k: float(v) for k, v in words if k not in ("G", "M", "N")}

        for code_g in g:
            if code_g in REFUSE_G:
                raise ConvertError(f"G{code_g} isn't supported by GRBL. Turn off cutter compensation and "
                                   "use feed per minute in SOLIDWORKS CAM, then post again")
        if any(x in ("98", "99") for x in m):
            raise ConvertError("subprograms (M98/M99) aren't supported. Post without subprograms")
        if "7" in m:  # this GRBL build has no mist coolant, so M7 would stop the job with error 20
            m.remove("7")
            self.warnings.append("dropped M7 (mist coolant). Start the water pump by hand")

        if "90.1" in g:
            self.ijk_absolute = True
        if "91.1" in g:
            self.ijk_absolute = False
        if "90" in g:
            self.absolute = True
        if "91" in g:
            self.absolute = False
        if "98" in g:
            self.retract_initial = True
        if "99" in g:
            self.retract_initial = False
        g = [x for x in g if x not in ("90.1", "98", "99") and x not in DROP_G]
        if "F" in vals:
            self.feed = vals["F"]

        # tool changes
        if "T" in vals or "6" in m:
            tool = int(vals.pop("T", self.current_tool or 0))
            m = [x for x in m if x != "6"]
            vals.pop("H", None)
            vals.pop("D", None)
            if self.first_tool is None:
                self.first_tool = tool
            elif tool != self.current_tool:
                self.emit("M5")
                self.emit(f"G0 Z{fmt(self.safe_z)}")
                self.emit(f"M0 (Change to tool {tool}, re-zero Z, then press resume)")
                self.warnings.append(f"tool change to T{tool}: the job pauses so you can swap the bit")
            self.current_tool = tool
        vals.pop("H", None)

        # G28 home moves: retract to safe Z, then go to X0 Y0 if X/Y were given
        if "28" in g:
            moves = [f"G0 Z{fmt(self.safe_z)}"]
            if "X" in vals or "Y" in vals:
                moves.append("G0 X0 Y0")
                self.pos.update(X=0.0, Y=0.0)
            if not self.absolute:
                moves = ["G90"] + moves + ["G91"]
            for line in moves:
                self.emit(line)
            self.pos["Z"] = self.safe_z
            return

        if "80" in g:
            self.drill = None
            g.remove("80")

        drill_g = next((x for x in g if x in DRILL_G), None)
        if drill_g:
            if not self.absolute:
                raise ConvertError("drilling cycles in G91 (incremental) mode aren't supported")
            g.remove(drill_g)
            self.drill = {"type": drill_g, "R": vals.get("R"), "Z": vals.get("Z"),
                          "Q": vals.get("Q"), "P": vals.get("P", 0.0), "start_z": self.pos["Z"]}
            if self.drill["R"] is None or self.drill["Z"] is None:
                raise ConvertError(f"G{drill_g} needs both R and Z")
        elif self.drill and any(k in vals for k in "XYZRQP") and not any(x in ("0", "1", "2", "3") for x in g):
            for k in "RZQP":
                if k in vals:
                    self.drill[k] = vals[k]
        elif any(x in ("0", "1", "2", "3") for x in g):
            self.drill = None

        if self.drill and ("X" in vals or "Y" in vals or drill_g):
            self.prefix(g, m, comments)
            self.do_drill(vals)
            return

        self.normal(g, m, vals, comments)

    def prefix(self, g, m, comments):
        others = [f"G{x}" for x in g if x not in ("0", "1", "2", "3")]
        if others or m:
            self.emit(" ".join(others + [f"M{x}" for x in m]))
        for c in comments:
            self.emit(c)

    def do_drill(self, vals):
        d = self.drill
        x = vals.get("X", self.pos["X"])
        y = vals.get("Y", self.pos["Y"])
        top = max(d["start_z"], d["R"]) if self.retract_initial else d["R"]
        feed = f" F{fmt(self.feed)}" if self.feed else ""
        if self.pos["Z"] < d["R"]:
            self.emit(f"G0 Z{fmt(d['R'])}")
        self.emit(f"G0 X{fmt(x)} Y{fmt(y)}")
        self.emit(f"G0 Z{fmt(d['R'])}")
        if d["type"] in ("83", "73") and d["Q"]:
            depth = d["R"]
            while depth > d["Z"]:
                depth = max(depth - abs(d["Q"]), d["Z"])
                self.emit(f"G1 Z{fmt(depth)}{feed}")
                if depth > d["Z"]:
                    # G83 pulls all the way out to clear chips, G73 just backs off a little
                    back = d["R"] if d["type"] == "83" else depth + 0.5
                    self.emit(f"G0 Z{fmt(back)}")
                    if d["type"] == "83":
                        self.emit(f"G0 Z{fmt(depth + 0.5)}")
        else:
            self.emit(f"G1 Z{fmt(d['Z'])}{feed}")
            if d["type"] == "82" and d["P"]:
                secs = d["P"] / 1000 if d["P"] > 50 else d["P"]  # Fanuc gives ms, Mach3 gives seconds
                self.emit(f"G4 P{fmt(secs)}")
        self.emit(f"G0 Z{fmt(top)}")
        self.pos.update(X=x, Y=y, Z=top)
        self.motion = "0"

    def normal(self, g, m, vals, comments):
        motion = next((x for x in g if x in ("0", "1", "2", "3")), None)
        if motion:
            self.motion = motion
        if self.ijk_absolute and self.motion in ("2", "3"):
            for axis, centre in (("X", "I"), ("Y", "J"), ("Z", "K")):
                if centre in vals:
                    vals[centre] -= self.pos[axis]
        parts = [f"G{x}" for x in g] + [f"M{x}" for x in m]
        for k in ("X", "Y", "Z", "I", "J", "K", "R", "F", "S", "P"):
            if k in vals:
                parts.append(f"{k}{fmt(vals[k])}")
        for k in vals:
            if k not in "XYZIJKRFSPTHD":
                self.warnings.append(f"dropped unknown word {k}{fmt(vals[k])}")
        for c in comments:
            self.emit(c)
        if parts:
            self.emit(" ".join(parts))
        for axis in "XYZ":
            if axis in vals:
                self.pos[axis] = vals[axis] if self.absolute else self.pos[axis] + vals[axis]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("input", type=Path)
    ap.add_argument("output", type=Path, nargs="?")
    ap.add_argument("--safe-z", type=float, default=SAFE_Z, help="retract height in mm for G28 moves and tool changes")
    args = ap.parse_args()

    out_path = args.output or args.input.with_name(args.input.stem + "_grbl.nc")
    conv = Converter(args.safe_z)
    try:
        lines = conv.convert(args.input.read_text(errors="replace").splitlines())
    except ConvertError as e:
        sys.exit(f"Couldn't convert {args.input.name}: {e}")
    out_path.write_text("\n".join(lines) + "\n")
    print(f"Wrote {out_path} ({len(lines)} lines)")
    for w in dict.fromkeys(conv.warnings):
        print("  note:", w)


if __name__ == "__main__":
    main()
