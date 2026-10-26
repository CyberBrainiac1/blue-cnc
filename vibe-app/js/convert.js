// Turns G-code from a CAM program into G-code GRBL 1.1 can run.
// Same rules as cam/solidworks_to_grbl.py, widened to cover Onshape CAM Studio, Kiri:Moto and Fusion output.

export const TEAM_MACHINE = {
  name: 'Blue desktop CNC',
  travel: { x: 376, y: 572, z: 65 },   // mm
  maxFeed: { x: 1200, y: 1200, z: 640 }, // mm/min
  spindleMax: 24000,
  safeZ: 10,
};

const WORD = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
const DROP_G = {
  '43': 'Removed G43 tool length offsets. GRBL doesn\'t have them, so zero Z on each tool instead.',
  '64': 'Removed G64 (path blending). GRBL already blends moves together.',
};
const DRILL_G = new Set(['81', '82', '83', '73']);
const MOTION_G = new Set(['0', '1', '2', '3']);
const GRBL_G = new Set(['0', '1', '2', '3', '4', '10', '17', '18', '19', '20', '21', '28', '28.1', '30', '30.1',
  '38.2', '38.3', '38.4', '38.5', '40', '43.1', '49', '53', '54', '55', '56', '57', '58', '59', '61', '80', '90',
  '91', '91.1', '92', '92.1', '94']);
const GRBL_M = new Set(['0', '1', '2', '3', '4', '5', '8', '9', '30']);
const REFUSE_G = {
  '41': 'cutter compensation (G41). Turn cutter compensation off in your CAM, so the toolpath is already offset',
  '42': 'cutter compensation (G42). Turn cutter compensation off in your CAM, so the toolpath is already offset',
  '93': 'inverse time feed (G93). Set your CAM to feed in mm per minute',
  '95': 'feed per revolution (G95). Set your CAM to feed in mm per minute',
  '68': 'coordinate rotation (G68). GRBL has no rotation, so rotate the part in CAM instead',
  '51': 'scaling (G51). GRBL has no scaling, so scale the part in CAM instead',
};

export class ConvertError extends Error {
  constructor(lineNo, text, reason) {
    super(`Line ${lineNo}: ${reason}`);
    this.lineNo = lineNo;
    this.text = text;
    this.reason = reason;
  }
}

export function fmt(v) {
  let s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' || s === '' ? '0' : s;
}

function words(code) {
  return [...code.matchAll(WORD)].map(m => [m[1], m[2]]);
}

function gKey(v) {
  return fmt(parseFloat(v));
}

// GRBL comments can't contain brackets, and we keep them short so the output stays readable.
function cleanComment(text) {
  return '(' + text.replace(/[()]/g, '').trim() + ')';
}

export function convert(source, machine = TEAM_MACHINE) {
  const c = new Converter(machine);
  const lines = source.split(/\r?\n/);
  lines.forEach((raw, i) => c.line(raw, i + 1));
  c.checkFit();
  return { lines: c.out, changes: c.changes, warnings: c.warnings, bounds: c.bounds };
}

// Cuts a converted job into one file per tool, at the pauses toolChange() writes.
// Each later file gets the units, distance mode and spindle it would have had, so it runs on its own.
export function splitByTool(lines) {
  const parts = [[]];
  let units = 'G21', distance = 'G90', spindle = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pause = line === 'M0' && /^\(Change to tool/.test(lines[i - 1] || '');
    if (pause) {
      parts[parts.length - 1].pop(); // the "Change to tool" comment
      parts[parts.length - 1].push('M30');
      const next = [units, distance];
      next.spindleAfter = spindle;
      parts.push(next);
      continue;
    }
    const code = line.replace(/\([^)]*\)/g, '');
    if (/\bG20\b/.test(code)) units = 'G20';
    if (/\bG21\b/.test(code)) units = 'G21';
    if (/\bG90\b/.test(code)) distance = 'G90';
    if (/\bG91\b/.test(code)) distance = 'G91';
    if (/\bM[34]\b/.test(code)) spindle = (code.match(/M[34]/)[0] + (code.match(/S[\d.]+/) ? ' ' + code.match(/S[\d.]+/)[0] : '')).trim();
    parts[parts.length - 1].push(line);
  }
  // a later file that cuts before it starts the spindle gets the last spindle command added
  for (const part of parts.slice(1)) {
    const firstCut = part.findIndex(l => /\bG[123]\b/.test(l.replace(/\([^)]*\)/g, '')));
    const firstSpin = part.findIndex(l => /\bM[34]\b/.test(l.replace(/\([^)]*\)/g, '')));
    if (part.spindleAfter && firstCut >= 0 && (firstSpin < 0 || firstSpin > firstCut)) part.splice(2, 0, part.spindleAfter);
  }
  return parts.map(p => [...p]);
}

class Converter {
  constructor(machine) {
    this.machine = machine;
    this.out = [];
    this.changes = [];   // what we changed, one entry per kind of change
    this.warnings = [];  // things to look at before running
    this.seen = new Set();
    this.inches = false;
    this.absolute = true;
    this.arcCentresAbsolute = false;
    this.retractToStart = true; // G98 goes back to the starting Z, G99 back to R
    this.pos = { X: 0, Y: 0, Z: null };
    this.drill = null;
    this.motion = null;
    this.feed = null;
    this.tool = null;
    this.bounds = null;
  }

  // Report each kind of change once, with the first line it happened on.
  note(key, lineNo, text, list = this.changes) {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    list.push({ line: lineNo, text });
  }

  mm(v) {
    return this.inches ? v * 25.4 : v;
  }

  safeZ() {
    return this.inches ? this.machine.safeZ / 25.4 : this.machine.safeZ;
  }

  emit(line) {
    this.out.push(line);
  }

  // Emit moves that have to be in absolute mode, even if the file is in G91 right now.
  emitAbsolute(lines) {
    if (!this.absolute) this.emit('G90');
    lines.forEach(l => this.emit(l));
    if (!this.absolute) this.emit('G91');
  }

  line(raw, n) {
    let text = raw.trim();
    if (!text || text === '%') return;
    if (text.startsWith('/')) {
      text = text.slice(1).trim();
      this.note('blockdelete', n, 'Removed the block delete slash (/) from the start of lines. GRBL always runs them.');
    }

    // A ; comment runs to the end of the line, brackets and all, so split it off first.
    const comments = [];
    let tail = '';
    const semi = text.indexOf(';');
    if (semi >= 0) {
      tail = text.slice(semi + 1);
      text = text.slice(0, semi);
    }
    let code = text.replace(/\(([^)]*)\)/g, (_, c) => { comments.push(c); return ' '; });
    if (tail.trim()) comments.push(tail);
    code = code.toUpperCase().trim();

    const program = code.match(/^O\d+/);
    if (program) {
      code = code.slice(program[0].length).trim();
      this.note('onum', n, 'Removed the O program number. GRBL has no use for it.');
    }
    if (!code) {
      comments.filter(c => c.trim()).forEach(c => this.emit(cleanComment(c)));
      return;
    }
    if (/[#\[\]]/.test(code)) {
      throw new ConvertError(n, raw, 'this line uses variables or math (# or [ ]), which GRBL can\'t do. Post the file without macros.');
    }

    const ws = words(code);
    const leftover = code.replace(WORD, '').trim();
    if (leftover) throw new ConvertError(n, raw, `GRBL can't read "${leftover}" on this line.`);

    let g = ws.filter(([k]) => k === 'G').map(([, v]) => gKey(v));
    let m = ws.filter(([k]) => k === 'M').map(([, v]) => String(parseInt(v, 10)));
    const v = {};
    for (const [k, val] of ws) {
      if (k === 'N') {
        this.note('nnum', n, 'Removed N line numbers.');
      } else if (k !== 'G' && k !== 'M') {
        v[k] = parseFloat(val);
      }
    }

    for (const code of g) {
      if (REFUSE_G[code]) throw new ConvertError(n, raw, `this file uses ${REFUSE_G[code]}, then post again.`);
    }
    if (m.includes('98') || m.includes('99')) {
      throw new ConvertError(n, raw, 'this file calls subprograms (M98/M99). Post it without subprograms.');
    }
    for (const axis of ['A', 'B', 'C', 'U', 'V', 'W']) {
      if (axis in v) throw new ConvertError(n, raw, `this file moves a ${axis} axis. GRBL on this machine only has X, Y and Z.`);
    }

    if (g.includes('20')) this.inches = true;
    if (g.includes('21')) this.inches = false;
    if (g.includes('90')) this.absolute = true;
    if (g.includes('91')) this.absolute = false;
    if (g.includes('90.1')) this.arcCentresAbsolute = true;
    if (g.includes('91.1')) this.arcCentresAbsolute = false;
    if (g.includes('98')) this.retractToStart = true;
    if (g.includes('99')) this.retractToStart = false;
    if (g.includes('90.1')) this.note('g901', n, 'Changed absolute arc centres (G90.1) into the relative I/J/K that GRBL uses.');
    for (const code of g) {
      if (DROP_G[code]) this.note('g' + code, n, DROP_G[code]);
    }
    g = g.filter(x => !DROP_G[x] && x !== '90.1' && x !== '98' && x !== '99');
    if (v.F !== undefined) this.feed = v.F;

    if (m.includes('7')) {
      m = m.filter(x => x !== '7');
      this.note('m7', n, 'Removed M7 (mist coolant). This GRBL build has no M7. Turn the pump on by hand.');
    }
    for (const code of m) {
      if (!GRBL_M.has(code) && code !== '6') {
        this.note('m' + code, n, `Removed M${code}, which GRBL doesn't have.`, this.warnings);
      }
    }
    m = m.filter(x => GRBL_M.has(x) || x === '6');

    if (v.S !== undefined && v.S > this.machine.spindleMax) {
      this.note('smax', n, `The file asks for S${fmt(v.S)} but the spindle tops out at ${this.machine.spindleMax} RPM. GRBL will run it at full speed instead.`, this.warnings);
    }

    if ('T' in v || m.includes('6')) {
      // a real tool change puts this line's comment into its pause message
      if (this.toolChange(n, v, comments)) comments.length = 0;
      m = m.filter(x => x !== '6');
      delete v.T;
    }
    delete v.H;
    delete v.D;

    if (g.includes('28')) {
      this.homeMove(n, v);
      return;
    }

    if (g.includes('4')) {
      this.dwell(n, g, m, v, comments);
      return;
    }

    if (g.includes('80')) {
      this.drill = null;
      g = g.filter(x => x !== '80');
    }
    const drillG = g.find(x => DRILL_G.has(x));
    const hasMotion = g.some(x => MOTION_G.has(x));
    if (drillG) {
      if (!this.absolute) throw new ConvertError(n, raw, 'drilling cycles in incremental mode (G91) aren\'t supported. Post in absolute mode (G90).');
      if (v.R === undefined || v.Z === undefined) throw new ConvertError(n, raw, `G${drillG} needs both an R and a Z.`);
      g = g.filter(x => x !== drillG);
      this.drill = { type: drillG, R: v.R, Z: v.Z, Q: v.Q, P: v.P || 0, startZ: this.pos.Z ?? v.R };
      this.note('drill', n, 'Turned drilling cycles (G81, G82, G83, G73) into plain moves. GRBL has no drilling cycles.');
    } else if (this.drill && hasMotion) {
      this.drill = null;
    } else if (this.drill) {
      for (const k of ['R', 'Z', 'Q', 'P']) if (k in v) this.drill[k] = v[k];
    }

    if (this.drill && ('X' in v || 'Y' in v || drillG)) {
      const others = g.filter(x => !MOTION_G.has(x)).map(x => 'G' + x).concat(m.map(x => 'M' + x));
      if (others.length) this.emit(others.join(' '));
      comments.forEach(c => this.emit(cleanComment(c)));
      this.drillHole(v);
      return;
    }

    this.plain(n, g, m, v, comments);
  }

  toolChange(n, v, comments) {
    const tool = 'T' in v ? Math.round(v.T) : this.tool;
    let paused = false;
    if (this.tool === null) {
      this.note('firsttool', n, 'Removed the first tool change (T/M6). Put the first end mill in before you start.');
    } else if (tool !== this.tool) {
      const label = comments.map(c => c.trim().replace(/^change tool to\s*/i, '')).filter(Boolean).join(' ');
      this.emit('M5');
      this.emitAbsolute([`G0 Z${fmt(this.safeZ())}`]);
      this.emit(cleanComment(`Change to tool ${tool}${label ? ' ' + label : ''}, re-zero Z, then resume`));
      this.emit('M0');
      this.pos.Z = this.safeZ();
      this.note('toolchange', n, 'Each later tool change now stops the spindle, lifts Z and pauses (M0). Swap the end mill, re-zero Z, then resume.');
      paused = true;
    }
    this.tool = tool;
    return paused;
  }

  homeMove(n, v) {
    // G28 would send the machine to its stored home spot, not back to the job's zero.
    const moves = [`G0 Z${fmt(this.safeZ())}`];
    if ('X' in v || 'Y' in v) {
      moves.push('G0 X0 Y0');
      this.pos.X = 0;
      this.pos.Y = 0;
    }
    this.emitAbsolute(moves);
    this.pos.Z = this.safeZ();
    this.note('g28', n, `Replaced G28 with a lift to Z${fmt(this.machine.safeZ)} and a move back to X0 Y0 (the job's zero).`);
  }

  // GRBL reads G4 P in seconds. Kiri:Moto and some Fanuc style posts write milliseconds.
  dwellSeconds(n, p, comments) {
    const saysMs = comments.some(c => /\bms\b|millisec/i.test(c));
    if (saysMs || p >= 100) {
      this.note('dwellms', n, `Changed G4 P${fmt(p)} from milliseconds to seconds (P${fmt(p / 1000)}). GRBL reads P as seconds.`);
      return p / 1000;
    }
    return p;
  }

  dwell(n, g, m, v, comments) {
    const p = v.P ?? 0;
    const others = g.filter(x => x !== '4').map(x => 'G' + x).concat(m.map(x => 'M' + x));
    comments.forEach(c => this.emit(cleanComment(c)));
    if (others.length) this.emit(others.join(' '));
    this.emit(`G4 P${fmt(this.dwellSeconds(n, p, comments))}`);
  }

  drillHole(v) {
    const d = this.drill;
    const x = v.X ?? this.pos.X;
    const y = v.Y ?? this.pos.Y;
    const top = this.retractToStart ? Math.max(d.startZ, d.R) : d.R;
    const feed = this.feed ? ` F${fmt(this.feed)}` : '';
    if (this.pos.Z !== null && this.pos.Z < d.R) this.emit(`G0 Z${fmt(d.R)}`);
    this.emit(`G0 X${fmt(x)} Y${fmt(y)}`);
    this.emit(`G0 Z${fmt(d.R)}`);
    if ((d.type === '83' || d.type === '73') && d.Q) {
      let depth = d.R;
      while (depth > d.Z) {
        depth = Math.max(depth - Math.abs(d.Q), d.Z);
        this.emit(`G1 Z${fmt(depth)}${feed}`);
        if (depth > d.Z) {
          // G83 pulls all the way out to clear chips, G73 just backs off a little
          if (d.type === '83') {
            this.emit(`G0 Z${fmt(d.R)}`);
            this.emit(`G0 Z${fmt(depth + 0.5)}`);
          } else {
            this.emit(`G0 Z${fmt(depth + 0.5)}`);
          }
        }
      }
    } else {
      this.emit(`G1 Z${fmt(d.Z)}${feed}`);
      if (d.type === '82' && d.P) this.emit(`G4 P${fmt(d.P >= 100 ? d.P / 1000 : d.P)}`);
    }
    this.emit(`G0 Z${fmt(top)}`);
    this.track({ X: x, Y: y, Z: d.Z }, true);
    this.track({ X: x, Y: y, Z: top }, true);
    this.motion = '0';
  }

  plain(n, g, m, v, comments) {
    const motion = g.find(x => MOTION_G.has(x));
    if (motion) this.motion = motion;
    for (const code of g) {
      if (!GRBL_G.has(code)) this.note('g' + code, n, `Removed G${code}, which GRBL doesn't have.`, this.warnings);
    }
    g = g.filter(x => GRBL_G.has(x));

    if (this.arcCentresAbsolute && (this.motion === '2' || this.motion === '3')) {
      for (const [axis, centre] of [['X', 'I'], ['Y', 'J'], ['Z', 'K']]) {
        if (centre in v) v[centre] -= this.pos[axis] ?? 0;
      }
    }
    if (v.F !== undefined) this.checkFeed(n, v);

    const parts = g.map(x => 'G' + x).concat(m.map(x => 'M' + x));
    for (const k of ['X', 'Y', 'Z', 'I', 'J', 'K', 'R', 'F', 'S', 'P', 'L', 'Q']) {
      if (k in v) parts.push(k + fmt(v[k]));
    }
    for (const k of Object.keys(v)) {
      if (!'XYZIJKRFSPLQ'.includes(k)) this.note('word' + k, n, `Removed the ${k} word, which GRBL doesn't use.`, this.warnings);
    }
    comments.filter(c => c.trim()).forEach(c => this.emit(cleanComment(c)));
    if (parts.length) this.emit(parts.join(' '));

    const moved = {};
    for (const axis of ['X', 'Y', 'Z']) {
      if (axis in v) moved[axis] = this.absolute ? v[axis] : (this.pos[axis] ?? 0) + v[axis];
    }
    // G53 moves are in machine coordinates, so they don't belong in the job's size
    if (Object.keys(moved).length) this.track(moved, !g.includes('53') && !g.includes('92') && !g.includes('10'));
  }

  checkFeed(n, v) {
    const f = this.mm(v.F);
    const fastest = Math.max(this.machine.maxFeed.x, this.machine.maxFeed.y);
    if (f > fastest) {
      this.note('feedmax', n, `The file feeds at up to ${fmt(f)} mm/min, but X and Y top out at ${fastest}. GRBL will slow those moves down to its limit.`, this.warnings);
    }
  }

  track(moved, countIt) {
    Object.assign(this.pos, moved);
    if (!countIt) return;
    const p = { x: this.mm(this.pos.X ?? 0), y: this.mm(this.pos.Y ?? 0), z: this.pos.Z === null ? null : this.mm(this.pos.Z) };
    if (!this.bounds) this.bounds = { min: { x: p.x, y: p.y, z: p.z ?? 0 }, max: { x: p.x, y: p.y, z: p.z ?? 0 } };
    for (const a of ['x', 'y', 'z']) {
      if (p[a] === null) continue;
      this.bounds.min[a] = Math.min(this.bounds.min[a], p[a]);
      this.bounds.max[a] = Math.max(this.bounds.max[a], p[a]);
    }
  }

  // The job has to fit inside the machine's travel, wherever you zero it.
  checkFit() {
    if (!this.bounds) return;
    for (const a of ['x', 'y', 'z']) {
      const size = this.bounds.max[a] - this.bounds.min[a];
      const travel = this.machine.travel[a];
      if (size > travel) {
        this.warnings.push({ line: null, text: `The job is ${fmt(size)} mm in ${a.toUpperCase()}, but the machine only travels ${travel} mm. It won't fit.` });
      }
    }
  }
}
