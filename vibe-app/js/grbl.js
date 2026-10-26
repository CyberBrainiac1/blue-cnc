// Streams G-code to GRBL 1.1 and keeps track of what it says back.
// Uses character counting: GRBL has a 128 byte receive buffer, so we only send a line
// when it fits next to the lines GRBL hasn't answered yet.

export const RX_BUFFER = 128;

export const ERRORS = {
  1: 'A line had a number with no letter in front of it.',
  2: 'A G-code word is missing its number, or the number is badly written.',
  3: 'GRBL doesn\'t know that $ command.',
  4: 'A value that has to be positive was negative.',
  5: 'Homing isn\'t turned on ($22=1), so $H can\'t run.',
  8: 'That $ command only works while GRBL is idle.',
  9: 'GRBL is in an alarm, so it won\'t move. Home the machine first.',
  11: 'A line was too long for GRBL (over 80 characters).',
  15: 'A jog would go past the machine\'s travel.',
  20: 'The file has a G or M code GRBL doesn\'t have. Run it through the converter first.',
  21: 'A line has two commands from the same group, like G0 and G1 together.',
  22: 'A cutting move came before any feed rate (F) was set.',
  23: 'A command needs a whole number and got a decimal.',
  24: 'A line has two commands that both want X/Y/Z values.',
  25: 'A letter shows up twice on one line.',
  26: 'A move command has no X, Y or Z.',
  28: 'A command is missing a value it needs.',
  29: 'G59.1 and up aren\'t supported.',
  30: 'G53 only works with G0 or G1.',
  31: 'A line has X/Y/Z values but no command that uses them.',
  32: 'An arc (G2/G3) has no end point in its plane.',
  33: 'A move has an impossible target, usually an arc that doesn\'t close.',
  34: 'An arc radius doesn\'t work for its start and end points.',
  35: 'An arc (G2/G3) has no I, J or K centre.',
  36: 'A line has extra values nothing uses.',
  38: 'The tool number is too big.',
};

export const ALARMS = {
  1: 'A limit switch got hit and GRBL stopped dead. The position is probably off now, so home the machine ($H) before you carry on.',
  2: 'A move would go past the machine\'s travel, so GRBL refused it. Check where you zeroed the job.',
  3: 'The machine was reset while it was moving, so it may have lost its position. Home it ($H).',
  4: 'The probe was already touching when the probe move started.',
  5: 'The probe never touched anything.',
  6: 'Homing was cut off by a reset. Home again.',
  7: 'Homing was stopped because a door switch opened.',
  8: 'Homing couldn\'t back off a limit switch. Check the switch wiring and the pull-off setting ($27).',
  9: 'Homing never found a limit switch. Check that each switch clicks and is wired to the Nano.',
};

// What actually goes down the wire: no comments, no spaces, upper case.
export function cleanLine(line) {
  return line.replace(/\([^)]*\)/g, '').replace(/;.*/, '').replace(/\s+/g, '').toUpperCase();
}

export class GrblSender {
  constructor(write, on = {}) {
    this.write = write;
    this.on = on;
    this.inbox = '';
    this.reset();
  }

  reset() {
    this.queue = [];      // lines still to send
    this.inFlight = [];   // lengths of lines GRBL hasn't answered yet
    this.sent = 0;
    this.acked = 0;
    this.total = 0;
    this.running = false;
    this.held = false;
  }

  // Bytes arrive in random chunks, so piece them back into lines.
  receive(chunk) {
    this.inbox += chunk;
    let nl;
    while ((nl = this.inbox.indexOf('\n')) >= 0) {
      const line = this.inbox.slice(0, nl).trim();
      this.inbox = this.inbox.slice(nl + 1);
      if (line) this.handle(line);
    }
  }

  handle(line) {
    if (line === 'ok' || line.startsWith('error:')) {
      this.inFlight.shift();
      if (this.running || this.inFlight.length) this.acked++;
      if (line.startsWith('error:')) {
        const code = parseInt(line.slice(6), 10);
        if (this.running) {
          // stop feeding and hold, so nothing else runs until a person looks at it
          this.held = true;
          this.write('!');
        }
        this.on.error?.(code, ERRORS[code] || `GRBL error ${code}.`, this.acked);
      }
      this.progress();
      this.pump();
    } else if (line.startsWith('<')) {
      this.on.status?.(parseStatus(line));
    } else if (line.startsWith('ALARM:')) {
      const code = parseInt(line.slice(6), 10);
      this.reset();
      this.on.alarm?.(code, ALARMS[code] || `GRBL alarm ${code}.`);
    } else if (line.startsWith('Grbl ')) {
      // GRBL just started up, which also happens after every soft reset
      this.reset();
      this.on.ready?.(line);
    } else {
      this.on.message?.(line);
    }
  }

  start(lines) {
    const clean = lines.map(cleanLine).filter(Boolean);
    const tooLong = clean.find(l => l.length >= RX_BUFFER);
    if (tooLong) throw new Error(`A line is too long to send: ${tooLong.slice(0, 40)}...`);
    this.reset();
    this.queue = clean;
    this.total = clean.length;
    this.running = true;
    this.progress();
    this.pump();
  }

  pump() {
    if (!this.running || this.held) return;
    while (this.queue.length) {
      const next = this.queue[0] + '\n';
      const used = this.inFlight.reduce((a, b) => a + b, 0);
      if (used + next.length > RX_BUFFER - 1) break;
      this.queue.shift();
      this.inFlight.push(next.length);
      this.sent++;
      this.write(next);
    }
    if (!this.queue.length && !this.inFlight.length) {
      this.running = false;
      this.on.done?.();
    }
  }

  progress() {
    this.on.progress?.(this.acked, this.total);
  }

  // these three are real-time commands, so GRBL acts on them right away
  pause() {
    this.write('!');
  }

  resume() {
    this.write('~');
    if (this.held) {
      this.held = false;
      this.pump();
    }
  }

  stop() {
    this.write('!');      // feed hold first, so the axes slow down instead of slamming
    this.write('\x18');   // then soft reset, which throws away everything GRBL had queued
    this.reset();
  }

  status() {
    this.write('?');
  }

  home() {
    if (this.running) return;
    this.inFlight.push(3);
    this.write('$H\n');
  }
}

export function parseStatus(line) {
  const parts = line.replace(/[<>]/g, '').split('|');
  const s = { state: parts[0].split(':')[0], raw: line };
  for (const p of parts.slice(1)) {
    const [key, val] = p.split(':');
    if (key === 'MPos' || key === 'WPos') {
      const [x, y, z] = val.split(',').map(Number);
      s[key] = { x, y, z };
    } else if (key === 'WCO') {
      const [x, y, z] = val.split(',').map(Number);
      s.WCO = { x, y, z };
    } else if (key === 'FS') {
      const [feed, speed] = val.split(',').map(Number);
      s.feed = feed;
      s.speed = speed;
    }
  }
  return s;
}

export const STATES = {
  Idle: 'Ready',
  Run: 'Running',
  Hold: 'Paused',
  Jog: 'Jogging',
  Alarm: 'Alarm',
  Door: 'Door open',
  Check: 'Check mode',
  Home: 'Homing',
  Sleep: 'Asleep',
};
