"""Make the steppers play music: each axis's step rate is the pitch of the note it plays.

A move lasting t seconds in which an axis with S steps/mm travels d mm makes d*S/t steps
per second on that axis, and a stepper hums at its step rate. So for note frequency f:
    distance on that axis = f * t / S
GRBL moves all axes together in one straight line, so in each slice of time X, Y and Z
can each travel their own distance and play their own note: up to three notes at once.
The move's feed is the length of that line divided by the time.

Each new note starts heading back toward where that axis began, so every axis just
wiggles a few mm in place.

Usage:  python stepper_song.py fur_elise ../gcode/fur_elise.nc
        python stepper_song.py ode_to_joy ../gcode/ode_to_joy.nc
"""

import math
import sys

STEPS_PER_MM = {"X": 344.828, "Y": 344.828, "Z": 266.667}   # from calibration
MAX_RATE = {"X": 1200, "Y": 1200, "Z": 640}                  # $110-$112, mm/min

NAMES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6,
         "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def freq(note, transpose=0):
    """'D#5' -> Hz. A4 = 440."""
    name, octave = note[:-1], int(note[-1])
    midi = 12 * (octave + 1) + NAMES[name] + transpose
    return 440.0 * 2 ** ((midi - 69) / 12)


def parse(voice):
    """'E5/1 r/2 ...' -> [(note or None, length), ...]; lengths in grid units."""
    out = []
    for tok in voice.split():
        note, length = tok.split("/")
        out.append((None if note == "r" else note, float(length)))
    return out


# --- Songs -----------------------------------------------------------------------------
# Each song: unit (seconds per grid unit), transpose (semitones), and one string per axis.

ODE_TO_JOY = {  # Beethoven, public domain. Grid unit = one beat.
    "title": "Ode to Joy",
    "unit": 0.40,
    "transpose": 0,
    "voices": {"X": (
        "E5/1 E5/1 F5/1 G5/1 G5/1 F5/1 E5/1 D5/1 C5/1 C5/1 D5/1 E5/1 E5/1.5 D5/0.5 D5/2 "
        "E5/1 E5/1 F5/1 G5/1 G5/1 F5/1 E5/1 D5/1 C5/1 C5/1 D5/1 E5/1 D5/1.5 C5/0.5 C5/2")},
}


def fur_elise():
    """Fur Elise (Beethoven, public domain), A section twice, the first B phrase, then A
    again. Grid unit = one sixteenth; a 3/8 bar is 6 units. Right hand on X; the left
    hand's broken chord is split into its bass note (Z, held) and the two notes above it (Y)."""
    rh = {
        "pick": "E5/1 D#5/1",
        "m1": "E5/1 D#5/1 E5/1 B4/1 D5/1 C5/1",
        "m2": "A4/2 r/1 C4/1 E4/1 A4/1",
        "m3": "B4/2 r/1 E4/1 G#4/1 B4/1",
        "m4": "C5/2 r/1 E4/1 E5/1 D#5/1",
        "m7": "B4/2 r/1 E4/1 C5/1 B4/1",
        "m8a": "A4/2 r/2 E5/1 D#5/1",       # first ending, leads back to the start
        "m8b": "A4/2 r/1 B4/1 C5/1 D5/1",   # second ending, leads into the B phrase
        "m10": "E5/3 G4/1 F5/1 E5/1",
        "m11": "D5/3 F4/1 E5/1 D5/1",
        "m12": "C5/3 E4/1 D5/1 C5/1",
        "m13": "B4/2 r/1 E4/1 E5/1 D#5/1",  # leads back into the A section
        "end": "A4/6",
    }
    chord = {  # bass, then the two notes above it
        "Am": ("A2", "E3", "A3"), "E": ("E2", "E3", "G#3"),
        "C": ("C3", "G3", "C4"), "G": ("G2", "G3", "B3"),
    }
    lh = {"pick": None, "m1": None, "m2": "Am", "m3": "E", "m4": "Am", "m7": "E",
          "m8a": "Am", "m8b": "Am", "m10": "C", "m11": "G", "m12": "Am", "m13": "E",
          "end": "Am"}
    a_section = ["m1", "m2", "m3", "m4", "m1", "m2", "m7"]
    form = (["pick"] + a_section + ["m8a"] + a_section + ["m8b", "m10", "m11", "m12", "m13"]
            + a_section + ["end"])

    x, y, z = [], [], []
    for bar in form:
        x.append(rh[bar])
        length = sum(float(t.split("/")[1]) for t in rh[bar].split())
        name = lh[bar]
        if name is None:
            y.append(f"r/{length:g}")
            z.append(f"r/{length:g}")
        elif bar == "end":
            bass, mid, top = chord[name]
            z.append(f"{bass}/6")
            y.append(f"r/1 {mid}/1 {top}/4")
        else:
            bass, mid, top = chord[name]
            z.append(f"{bass}/3 r/3")
            y.append(f"r/1 {mid}/1 {top}/1 r/3")
    return {
        "title": "Fur Elise",
        "unit": 0.16,
        "transpose": 12,  # up an octave: steppers sing more clearly above ~200 Hz
        "voices": {"X": " ".join(x), "Y": " ".join(y), "Z": " ".join(z)},
    }


def toccata():
    """Opening of Bach's Toccata and Fugue in D minor, BWV 565 (public domain), arranged:
    the A-G-A / G-F-E-D-C# / D call three times, each an octave lower, in octaves on X and Y;
    Z enters on the low D and holds it as a pedal while X runs up the diminished chord
    (C#-E-G-Bb) and Y holds E; then all three land on a D chord. Grid unit = 0.06 s."""
    call = [("A", 1), ("G", 1), ("A", 10), (None, 6), ("G", 2), ("F", 2), ("E", 2), ("D", 2),
            ("C#", 12), ("D", 20)]

    def phrase(octave, rest_after):
        notes = [f"{n}{octave}/{d}" if n else f"r/{d}" for n, d in call]
        return " ".join(notes + ([f"r/{rest_after}"] if rest_after else []))

    run = " ".join(f"{n}/2" for n in ["C#3", "E3", "G3", "A#3", "C#4", "E4", "G4", "A#4"])
    x = " ".join([phrase(5, 8), phrase(4, 8), phrase(3, 0), run, "C#5/24", "D5/30"])
    y = " ".join([phrase(4, 8), phrase(3, 8), phrase(2, 0), "r/10 E4/30", "F#4/30"])
    z = " ".join(["r/66", "r/66", "r/38 D2/60", "D3/30"])
    return {
        "title": "Toccata and Fugue in D minor (opening)",
        "unit": 0.06,
        "transpose": 12,  # up an octave: steppers sing more clearly above ~200 Hz
        "voices": {"X": x, "Y": y, "Z": z},
    }


def bumblebee():
    """Flight of the Bumblebee (Rimsky-Korsakov, public domain), arranged: X flies the
    non-stop sixteenths (the chromatic dive from high E, then the bee figure in A and up a
    fourth in D); Z plays the bass on the beat and Y the off-beat chords. Ends with a
    chromatic climb to A. Grid unit = one sixteenth; a 2/4 bar is 8 units."""
    def sixteenths(notes):
        return " ".join(f"{n}/1" for n in notes.split())

    intro = ["E6 D#6 D6 C#6 D6 C#6 C6 B5", "C6 B5 A#5 A5 G#5 G5 F#5 F5",
             "E5 D#5 D5 C#5 D5 C#5 C5 B4", "C5 B4 A#4 A4 G#4 G4 F#4 F4"]
    bee_a = ["E4 D#4 D4 C#4 C4 F4 E4 D#4", "E4 D#4 D4 C#4 C4 C#4 D4 D#4"] * 2
    bee_d = ["A4 G#4 G4 F#4 F4 A#4 A4 G#4", "A4 G#4 G4 F#4 F4 F#4 G4 G#4"] * 2
    climb = ["E4 F4 F#4 G4 G#4 A4 A#4 B4", "C5 C#5 D5 D#5 E5 F5 F#5 G5"]

    # Oom-pah per bar: Z = (bass on beat 1, bass on beat 2); Y = off-beat chord note.
    harmony = {"Am": ("A3", "E3", "C4"), "Dm": ("D3", "A3", "F4"), "E": ("E3", "B3", "G#4")}

    def accompaniment(chord):
        if chord is None:
            return "r/8", "r/8"
        low, high, off = harmony[chord]
        return f"r/2 {off}/1 r/3 {off}/1 r/1", f"{low}/1 r/3 {high}/1 r/3"

    bars = ([(b, None) for b in intro]
            + [(b, "Am") for b in bee_a] + [(b, "Dm") for b in bee_d]
            + [(b, "Am") for b in bee_a] + [(b, "Dm") for b in bee_d]
            + [(b, "Am") for b in bee_a] + [(b, "E") for b in climb])
    x, y, z = [], [], []
    for notes, chord in bars:
        x.append(sixteenths(notes))
        acc_y, acc_z = accompaniment(chord)
        y.append(acc_y)
        z.append(acc_z)
    # Final A minor chord: X lands on A after a G# pickup, Y and Z land with it.
    x.append("G#5/1 A5/15")
    y.append("r/1 E4/15")
    z.append("r/1 A3/15")
    return {
        "title": "Flight of the Bumblebee",
        "unit": 0.08,
        "transpose": 0,
        "voices": {"X": " ".join(x), "Y": " ".join(y), "Z": " ".join(z)},
    }


def entertainer():
    """The Entertainer (Joplin, 1902, public domain), arranged: X plays the A-strain tune,
    Z the ragtime "oom" bass on each beat and Y the "pah" chord note on each off-beat.
    Grid unit = one sixteenth; a 2/4 bar is 8 units."""
    call = "E4/1 C5/2 E4/1 C5/2 E4/1 C5/5"  # the "E-C-E-C-E-C" opening, 2 bars
    phrases = [
        # (tune, one chord per bar)
        (call + " C5/1 D5/1 D#5/1 E5/1 C5/1 D5/1 E5/2 B4/1 D5/2 C5/5 r/2 D4/1 D#4/1",
         ["C", "C", "G7", "C"]),
        (call + " r/1 A4/1 G4/1 F#4/1 A4/1 C5/1 E5/2 D5/1 C5/1 A4/1 D5/5 r/2 D4/1 D#4/1",
         ["C", "C", "D7", "G7"]),
        (call + " C5/1 D5/1 D#5/1 E5/1 C5/1 D5/1 E5/2 B4/1 D5/2 C5/5 r/4",
         ["C", "C", "G7", "C"]),
        ("C5/1 D5/1 E5/1 C5/1 D5/1 E5/2 C5/1 D5/1 C5/1 E5/1 C5/1 D5/1 E5/2 C5/1 "
         "D5/1 C5/1 E5/1 C5/1 D5/1 E5/2 B4/1 D5/2 C5/6",
         ["C", "F", "G7", "C"]),
    ]
    # Per chord: Z bass on beats 1 and 2 (root, then fifth), Y chord note on the off-beats.
    harmony = {"C": ("C3", "G2", "E4"), "F": ("F2", "C3", "A4"),
               "G7": ("G2", "D3", "F4"), "D7": ("D3", "A2", "F#4")}
    x, y, z = ["D4/1 D#4/1"], ["r/2"], ["r/2"]  # pickup
    for tune, chords in phrases:
        x.append(tune)
        for name in chords:
            root, fifth, off = harmony[name]
            z.append(f"{root}/1 r/3 {fifth}/1 r/3")
            y.append(f"r/2 {off}/1 r/3 {off}/1 r/1")
    return {
        "title": "The Entertainer",
        "unit": 0.17,
        "transpose": 12,  # up an octave: steppers sing more clearly above ~200 Hz
        "voices": {"X": " ".join(x), "Y": " ".join(y), "Z": " ".join(z)},
    }


def canon():
    """Canon in D (Pachelbel, public domain), arranged: Z plays the 8-note ground bass the
    whole way through; X enters after one round with the tune, and Y enters two rounds after
    X with the same tune an octave lower, so the motors join one by one. Ends on a D chord.
    Grid unit = one quarter note; one round of the bass is 8 units."""
    ground = "D4/1 A3/1 B3/1 F#3/1 G3/1 D3/1 G3/1 A3/1"  # an octave up from the original

    def tune(octave_shift):
        def n(name):
            return f"{name[:-1]}{int(name[-1]) + octave_shift}"
        p1 = " ".join(f"{n(x)}/2" for x in "F#5 E5 D5 C#5 B4 A4 B4 C#5".split())
        p2 = " ".join(f"{n(x)}/1" for x in
                      "D5 F#5 A5 G5 F#5 D5 F#5 E5 D5 B4 D5 A5 G5 B5 A5 G5".split())
        return p1, p2

    x1, x2 = tune(0)
    y1, y2 = tune(-1)
    x = " ".join(["r/8", x1, x2, x1, "D5/4"])
    y = " ".join(["r/24", y1, y2, "F#4/4"])
    z = " ".join([ground] * 7 + ["D4/4"])
    return {
        "title": "Canon in D",
        "unit": 0.55,
        "transpose": 0,
        "voices": {"X": x, "Y": y, "Z": z},
    }


def steps_per_minute():
    """"Steps Per Minute": an original trap-style track written for this machine.
    140 BPM in C minor, chords Cm - Ab - Fm - G. X raps the hook and the flow, Z is the 808
    (deep notes with octave bounces), Y is the hi-hats (short high blips, with rolls).
    Form: intro, build-up, silence, DROP, verse, breakdown, silence, DROP 2, final hit.
    Grid unit = 1/12 of a beat, so a 16th note is 3 units, a 16th triplet 2, and a 4/4
    bar 48."""
    BAR = 48

    def x3(voice):  # written in 16ths -> grid units
        return " ".join(f"{t.split('/')[0]}/{float(t.split('/')[1]) * 3:g}" for t in voice.split())

    def check(voice, bars, label):
        length = sum(float(t.split("/")[1]) for t in voice.split())
        assert length == bars * BAR, f"{label}: {length} units, expected {bars * BAR}"
        return voice

    # Hook, written in 16ths: syncopated, landing on the off-beats.
    hook = [x3("G5/2 D#5/2 C5/3 D#5/1 G5/2 G#5/1 G5/2 D#5/3"),    # Cm
            x3("G#5/2 G5/2 D#5/3 C5/1 D#5/2 G5/1 D#5/2 C5/3"),    # Ab
            x3("F5/2 G#5/2 C6/3 G#5/1 F5/2 G5/1 G#5/2 F5/3"),     # Fm
            x3("G5/2 B4/2 D5/3 F5/1 D#5/2 D5/1 B4/2 G4/3")]       # G
    # Drop 2 hook: busier, starts off the beat, with triplet fills (grid units).
    hook2 = ["r/3 G5/3 r/3 D#5/3 C5/2 D#5/2 G5/2 G#5/3 G5/3 r/3 D#5/6 C5/3 D#5/2 F5/2 G5/2 C6/6",
             "G#5/3 r/3 G5/3 D#5/3 r/3 C5/3 D#5/2 G5/2 G#5/2 G5/6 D#5/3 C5/3 D#5/2 C5/2 G#4/2 C5/6",
             "r/3 F5/3 G#5/3 C6/3 r/3 C6/3 G#5/2 G5/2 F5/2 G#5/6 r/3 F5/3 G5/2 G#5/2 G5/2 F5/6",
             "G5/3 r/3 F5/3 D#5/3 D5/2 D#5/2 D5/2 B4/6 r/3 G4/3 B4/3 D5/3 F5/2 G5/2 B5/2 G5/6"]
    # Verse flow: rapid repeated notes, triplets and rests, like a rap cadence (grid units).
    flow = ["C5/3 C5/3 r/3 C5/3 D#5/2 D#5/2 D#5/2 C5/6 r/3 G4/3 C5/3 D#5/3 F5/2 D#5/2 C5/2 r/6",
            "C5/3 C5/3 D#5/3 C5/3 G#4/6 r/3 C5/3 D#5/2 D#5/2 D#5/2 F5/2 D#5/2 C5/2 G4/6 r/6",
            "F5/3 F5/3 r/3 F5/3 G#5/2 G#5/2 G#5/2 F5/6 r/3 C5/3 F5/3 G#5/3 G5/2 F5/2 D#5/2 r/6",
            "G5/3 G5/3 F5/3 D#5/3 D5/3 D5/3 B4/6 G4/2 G4/2 G4/2 B4/2 D5/2 F5/2 G5/12"]

    roots = [("C3", "C4"), ("G#2", "G#3"), ("F2", "F3"), ("G2", "G3")]  # Cm, Ab, Fm, G

    def b808(root, octave, busy):
        if busy:  # verse / drop 2: more hits, off-beat bounces
            return x3(f"{root}/2 r/1 {root}/3 r/2 {root}/2 r/2 {octave}/2 {root}/2")
        return x3(f"{root}/3 r/3 {root}/2 {octave}/2 {root}/4 r/2")

    def hats(roll=False, busy=False):
        beat8 = "C7/2 r/4 E7/2 r/4"                                  # closed / open-ish
        beat16 = "C7/1 r/2 E7/1 r/2 C7/1 r/2 E7/1 r/2"
        beats = [beat16 if busy and i % 2 == 0 else beat8 for i in range(4)]
        if roll:
            beats[3] = " ".join(["C7/1 r/1"] * 6)                    # triplet-32nd roll
        return " ".join(beats)

    x, y, z = [], [], []

    def add(bars, xv, yv, zv, label):
        x.append(check(xv, bars, label + " X"))
        y.append(check(yv, bars, label + " Y"))
        z.append(check(zv, bars, label + " Z"))

    # Intro: the hook teased alone.
    add(2, hook[0] + " " + hook[1], "r/96", "r/96", "intro")
    # Build-up: hats speed up, the melody climbs and stutters, the 808 pulses faster, then silence.
    add(2,
        "C5/6 r/6 C5/6 r/6 D#5/6 r/6 D#5/6 r/6 "
        "F5/3 F5/3 G5/3 G5/3 G#5/3 G#5/3 B5/3 B5/3 C6/2 C6/2 C6/2 C6/2 C6/2 C6/2 r/12",
        " ".join(["C7/2 r/4"] * 8) + " " + " ".join(["C7/1 r/2"] * 8) + " "
        + " ".join(["C7/1 r/1"] * 6) + " r/12",
        " ".join(["C3/3 r/9"] * 4) + " " + " ".join(["C3/3 r/3 C4/3 r/3"] * 3) + " r/12",
        "build")
    # DROP 1.
    add(4, " ".join(hook),
        " ".join(hats(roll=(i == 3)) for i in range(4)),
        " ".join(b808(r, o, busy=False) for r, o in roots), "drop 1")
    # Verse: the flow over a busier 808.
    add(4, " ".join(flow),
        " ".join(hats(roll=(i % 2 == 1)) for i in range(4)),
        " ".join(b808(r, o, busy=True) for r, o in roots), "verse")
    # Breakdown: drums out, long 808 notes, then hats build back into a beat of silence.
    add(2,
        hook[2] + " G5/6 B4/6 D5/6 F5/6 D#5/6 D5/6 r/12",
        "r/48 " + " ".join(["C7/1 r/2"] * 12) + " r/12",
        "F2/24 r/24 G2/24 r/24", "breakdown")
    # DROP 2: the off-beat hook, busy 808, 16th hats with rolls.
    add(4, " ".join(hook2),
        " ".join(hats(roll=(i % 2 == 1), busy=True) for i in range(4)),
        " ".join(b808(r, o, busy=True) for r, o in roots), "drop 2")
    # Final hit on C minor.
    add(1, "C5/12 r/36", "G4/12 r/36", "C3/24 r/24", "end")

    return {
        "title": "Steps Per Minute (original)",
        "unit": 60 / 140 / 12,
        "transpose": 0,
        "voices": {"X": " ".join(x), "Y": " ".join(y), "Z": " ".join(z)},
    }


SONGS = {"ode_to_joy": ODE_TO_JOY, "fur_elise": fur_elise(), "toccata": toccata(),
         "bumblebee": bumblebee(), "entertainer": entertainer(), "canon": canon(),
         "steps_per_minute": steps_per_minute()}


# --- G-code ------------------------------------------------------------------------------

def song_gcode(song):
    unit, tr = song["unit"], song["transpose"]
    voices = {ax: parse(v) for ax, v in song["voices"].items()}

    # Absolute start times of every note and rest, per axis.
    timeline = {}
    for ax, items in voices.items():
        t, spans = 0.0, []
        for note, length in items:
            spans.append((t, t + length, note))
            t += length
        timeline[ax] = spans
    ends = {round(spans[-1][1], 6) for spans in timeline.values()}
    if len(ends) != 1:
        raise ValueError(f"voices have different lengths: {ends}")

    cuts = sorted({round(s, 6) for spans in timeline.values() for s, _, _ in spans} | ends)
    pos = {ax: 0.0 for ax in voices}
    direction = {ax: 1 for ax in voices}
    peak_rate = {ax: 0.0 for ax in voices}
    out = [
        f"({song['title']} played by the steppers: each axis's step rate is its note's pitch.)",
        f"(Axes used: {', '.join(sorted(voices))}. Each wiggles a few mm around where it starts.)",
        "(NO BIT, SPINDLE OFF, pen removed. Start with a few mm of room around every axis.)",
        "G21",
        "G91",
    ]
    for t0, t1 in zip(cuts, cuts[1:]):
        secs = (t1 - t0) * unit
        move = {}
        for ax, spans in timeline.items():
            span = next(s for s in spans if s[0] <= t0 + 1e-9 < s[1])
            if span[2] is None:
                continue
            if abs(span[0] - t0) < 1e-9:  # a new note: head back toward the start
                direction[ax] = -1 if pos[ax] > 0 else 1
            d = freq(span[2], tr) * secs / STEPS_PER_MM[ax] * direction[ax]
            move[ax] = d
            pos[ax] += d
            peak_rate[ax] = max(peak_rate[ax], abs(d) / secs * 60)
        if not move:
            out.append(f"G4 P{secs:.3f}")
            continue
        feed = math.sqrt(sum(d * d for d in move.values())) / secs * 60
        words = " ".join(f"{ax}{d:.4f}" for ax, d in sorted(move.items()))
        out.append(f"G1 {words} F{feed:.2f}")

    back = {ax: -p for ax, p in pos.items() if abs(p) > 1e-6}
    if back:
        out.append("G0 " + " ".join(f"{ax}{d:.4f}" for ax, d in sorted(back.items())))
    out += ["G90", "M2"]
    total_s = (cuts[-1] - cuts[0]) * unit
    return out, total_s, peak_rate


def main():
    song = SONGS[sys.argv[1]]
    lines, total_s, peak_rate = song_gcode(song)
    for ax, rate in peak_rate.items():
        if rate > MAX_RATE[ax]:
            raise SystemExit(f"{ax} would need {rate:.0f} mm/min, over its {MAX_RATE[ax]} limit")
    with open(sys.argv[2], "w") as f:
        f.write("\n".join(lines) + "\n")
    rates = ", ".join(f"{ax} {r:.0f}" for ax, r in sorted(peak_rate.items()))
    print(f"{song['title']}: {len(lines)} lines, about {total_s:.0f} s; peak axis rates (mm/min): {rates}")


if __name__ == "__main__":
    main()
