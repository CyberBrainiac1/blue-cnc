// A pretend GRBL for tests and for trying the page without a machine (add ?mock to the URL).
// It holds a 128 byte receive buffer like the real one and complains if anyone overfills it.

import { RX_BUFFER } from './grbl.js';

export class MockGrbl {
  constructor({ reply, msPerLine = 5, failLine = null, alarmAt = null } = {}) {
    this.reply = reply;          // function that gets GRBL's answers
    this.msPerLine = msPerLine;
    this.failLine = failLine;    // answer error:20 to this line number (1 = first)
    this.alarmAt = alarmAt;      // throw ALARM:1 after this many lines
    this.buffer = '';
    this.received = [];
    this.state = 'Idle';
    this.pos = { x: 0, y: 0, z: 0 };
    this.overflowed = false;
    this.timer = null;
    setTimeout(() => this.reply("\r\nGrbl 1.1h ['$' for help]\r\n"), 1);
  }

  write(data) {
    for (const ch of data) {
      if (ch === '?') this.reply(`<${this.state}|MPos:${this.pos.x.toFixed(3)},${this.pos.y.toFixed(3)},${this.pos.z.toFixed(3)}|FS:0,0>\r\n`);
      else if (ch === '!') this.state = this.state === 'Run' || this.state === 'Idle' ? 'Hold' : this.state;
      else if (ch === '~') { if (this.state === 'Hold') this.state = 'Run'; this.tick(); }
      else if (ch === '\x18') this.softReset();
      else {
        this.buffer += ch;
        if (this.buffer.length > RX_BUFFER) this.overflowed = true;
      }
    }
    this.tick();
  }

  softReset() {
    clearTimeout(this.timer);
    this.timer = null;
    this.buffer = '';
    this.state = this.state === 'Run' || this.state === 'Hold' ? 'Alarm' : 'Idle';
    setTimeout(() => {
      this.reply("\r\nGrbl 1.1h ['$' for help]\r\n");
      if (this.state === 'Alarm') this.reply('ALARM:3\r\n');
    }, 1);
  }

  tick() {
    if (this.timer || this.state === 'Hold') return;
    // in an alarm GRBL only listens to $H (home) and $X (unlock)
    if (this.state === 'Alarm' && !/^\$[HX]\n/.test(this.buffer)) return;
    const nl = this.buffer.indexOf('\n');
    if (nl < 0) {
      if (this.state === 'Run') this.state = 'Idle';
      return;
    }
    const cmd = this.buffer.slice(0, nl);
    if (cmd === '$H' || cmd === '$X') {
      this.buffer = this.buffer.slice(nl + 1);
      this.state = 'Idle';
      if (cmd === '$H') this.pos = { x: 0, y: 0, z: 0 };
      this.reply('ok\r\n');
      this.tick();
      return;
    }
    this.state = 'Run';
    this.timer = setTimeout(() => {
      this.timer = null;
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      this.received.push(line);
      this.move(line);
      if (this.alarmAt && this.received.length === this.alarmAt) {
        this.state = 'Alarm';
        this.buffer = '';
        this.reply('ALARM:1\r\n');
        return;
      }
      this.reply(this.received.length === this.failLine ? 'error:20\r\n' : 'ok\r\n');
      if (line === 'M0') this.state = 'Hold'; // real GRBL holds after an M0 until it gets ~
      this.tick();
    }, this.msPerLine);
  }

  move(line) {
    for (const [, k, v] of line.matchAll(/([XYZ])([-.\d]+)/g)) this.pos[k.toLowerCase()] = parseFloat(v);
  }
}
