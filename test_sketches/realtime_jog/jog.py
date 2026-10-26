"""Real-time keyboard jog for the CNC, talking to realtime_jog.ino on the Nano.

Hold a key and the axis moves; let go and it stops.
    Left / Right   X- / X+
    Up / Down      Y+ / Y-
    D / A          Z+ / Z-
    1-8            speed preset (100 up to 8000 steps/s)
    Space or Esc   stop now
    0              zero the step counters

The window must have focus to jog. If it loses focus, everything stops, and the Nano
also stops by itself if it hears nothing from this app for 300 ms.
The real E-stop is still the power-cut switch at the outlet.

Usage:  python jog.py          (finds the CH340 Nano by itself)
        python jog.py COM8
"""

import queue
import sys
import threading
import time
import tkinter as tk

import serial
from serial.tools import list_ports

BAUD = 115200
TICK_MS = 50  # how often the jog command is re-sent (the Nano's dead-man is 300 ms)
# steps/s; the Nano accepts up to 8000. Above ~4000 the motors may stall or the
# optocouplers may drop steps, so check positions with a ruler at the top presets.
SPEED_PRESETS = {
    "1": 100, "2": 300, "3": 800, "4": 1500,
    "5": 2500, "6": 4000, "7": 6000, "8": 8000,
}
START_SPEED_KEY = "2"

# Flip an axis here once you know which way "+" really moves it.
INVERT = {"X": False, "Y": False, "Z": False}

# key -> (axis index, direction)
KEYMAP = {
    "Right": (0, +1), "Left": (0, -1),
    "Up": (1, +1), "Down": (1, -1),
    "d": (2, +1), "a": (2, -1),
}
AXES = "XYZ"


def find_port():
    ports = list(list_ports.comports())
    for p in ports:
        if p.vid == 0x1A86:  # CH340, the Nano's USB chip
            return p.device
    if len(ports) == 1:
        return ports[0].device
    names = ", ".join(p.device for p in ports) or "none"
    sys.exit(f"Couldn't pick a port by myself (found: {names}). Run: python jog.py COM8")


class JogApp:
    def __init__(self, root, port):
        self.root = root
        self.ser = serial.Serial(port, BAUD, timeout=0.1)
        self.lines = queue.Queue()
        self.held = set()
        self.release_timers = {}
        self.running = True

        self.status = tk.StringVar(value=f"Connecting to {port}...")
        self.pos = tk.StringVar(value="X 0    Y 0    Z 0")
        self.jog = tk.StringVar(value="Jog: stopped")
        self.speed = tk.StringVar(value="")
        self.build_ui()

        threading.Thread(target=self.read_serial, daemon=True).start()
        self.wait_for_ready()
        self.set_speed(START_SPEED_KEY)

        root.bind("<KeyPress>", self.on_press)
        root.bind("<KeyRelease>", self.on_release)
        root.bind("<FocusOut>", self.on_focus_out)
        root.protocol("WM_DELETE_WINDOW", self.close)
        self.tick()

    def build_ui(self):
        self.root.title("CNC jog")
        self.root.geometry("460x300")
        tk.Label(self.root, textvariable=self.status, anchor="w").pack(fill="x", padx=12, pady=(12, 4))
        tk.Label(self.root, textvariable=self.pos, font=("Consolas", 20)).pack(pady=8)
        tk.Label(self.root, textvariable=self.jog, font=("Consolas", 12)).pack()
        tk.Label(self.root, textvariable=self.speed, font=("Consolas", 12)).pack(pady=(0, 8))
        help_text = (
            "Hold: arrows = X / Y     D / A = Z+ / Z-\n"
            "1-8 = speed     Space / Esc = stop     0 = zero counters\n"
            "Positions are motor steps, not mm."
        )
        tk.Label(self.root, text=help_text, justify="center", fg="gray25").pack(pady=8)

    def send(self, text):
        try:
            self.ser.write((text + "\n").encode("ascii"))
        except serial.SerialException as e:
            self.status.set(f"Serial error: {e}")

    def read_serial(self):
        while self.running:
            try:
                raw = self.ser.readline()
            except serial.SerialException:
                break
            if raw:
                self.lines.put(raw.decode("ascii", "replace").strip())

    def wait_for_ready(self):
        # Opening the port resets the Nano; it prints READY when the sketch starts.
        deadline = time.time() + 4
        while time.time() < deadline:
            try:
                line = self.lines.get(timeout=0.2)
            except queue.Empty:
                continue
            if line.startswith("READY realtime_jog"):
                self.status.set(f"Connected on {self.ser.port}. Click here, then hold keys.")
                return
        self.status.set("No READY from the Nano. Is realtime_jog.ino uploaded?")

    def set_speed(self, key):
        self.speed_value = SPEED_PRESETS[key]
        self.send(f"F{self.speed_value}")
        self.speed.set(f"Speed: {self.speed_value} steps/s  (preset {key})")

    def on_press(self, event):
        key = event.keysym if event.keysym in KEYMAP else event.keysym.lower()
        # Key auto-repeat can send release+press pairs; cancel the pending release.
        if key in self.release_timers:
            self.root.after_cancel(self.release_timers.pop(key))
        if key in KEYMAP:
            self.held.add(key)
        elif key in SPEED_PRESETS:
            self.set_speed(key)
        elif key in ("space", "escape"):
            self.stop()
        elif key == "0":
            self.send("Z")

    def on_release(self, event):
        key = event.keysym if event.keysym in KEYMAP else event.keysym.lower()
        if key in KEYMAP:
            self.release_timers[key] = self.root.after(30, self.release_key, key)

    def release_key(self, key):
        self.release_timers.pop(key, None)
        self.held.discard(key)

    def on_focus_out(self, _event):
        self.stop()
        self.status.set("Window lost focus: stopped. Click here to jog again.")

    def stop(self):
        self.held.clear()
        for timer in self.release_timers.values():
            self.root.after_cancel(timer)
        self.release_timers.clear()
        self.send("J000")
        self.send("S")

    def jog_vector(self):
        vec = [0, 0, 0]
        for key in self.held:
            axis, direction = KEYMAP[key]
            vec[axis] += direction  # opposite keys held together cancel out
        for i, name in enumerate(AXES):
            if INVERT[name]:
                vec[i] = -vec[i]
        return vec

    def tick(self):
        vec = self.jog_vector()
        self.send("J" + "".join("+" if v > 0 else "-" if v < 0 else "0" for v in vec))
        moving = [f"{name}{'+' if v > 0 else '-'}" for name, v in zip(AXES, vec) if v]
        self.jog.set("Jog: " + (" ".join(moving) if moving else "stopped"))

        while not self.lines.empty():
            line = self.lines.get()
            if line.startswith("P "):
                x, y, z = line.split()[1:4]
                self.pos.set(f"X {x}    Y {y}    Z {z}")
            elif line.startswith("ERR"):
                self.status.set(f"Nano says: {line}")

        if self.running:
            self.root.after(TICK_MS, self.tick)

    def close(self):
        self.stop()
        self.running = False
        time.sleep(0.05)
        self.ser.close()
        self.root.destroy()


def main():
    port = sys.argv[1] if len(sys.argv) > 1 else find_port()
    root = tk.Tk()
    JogApp(root, port)
    root.mainloop()


if __name__ == "__main__":
    main()
