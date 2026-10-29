// Makes GRBL toolpaths for a flat plate (from part.js): pockets, holes, cutouts and the outline with tabs.
// Every way into the material ramps or spirals down. Nothing plunges straight in.

import {
  SCALE, toMm, tidy, offset, union, difference, intersection, pieces, totalArea, area, reversed, perimeter, asCircle, bounds,
} from './geom.js';
import { closeGaps } from './part.js';
import { fmt } from './convert.js';

export const MATERIALS = {
  aluminium: { name: '6061 aluminium', overcut: 0.3 },
  polycarbonate: { name: 'Polycarbonate', overcut: 0.4 },
  wood: { name: 'Plywood or MDF', overcut: 0.5 },
};

export const BITS = {
  eighth: { name: '1/8" single flute', diameter: 3.175 },
  quarter: { name: '1/4" single flute', diameter: 6.35 },
  mm3: { name: '3 mm single flute', diameter: 3 },
  // ball-nose bits, only for finishing 3D parts
  eighthBall: { name: '1/8" ball nose', diameter: 3.175, ball: true },
  quarterBall: { name: '1/4" ball nose', diameter: 6.35, ball: true },
};

// Gentle numbers for a light 3040 router (1200 mm/min top speed, 24000 RPM spindle).
const PRESETS = {
  aluminium: {
    eighth: { rpm: 18000, feed: 500, doc: 0.4, stepover: 0.35 },
    quarter: { rpm: 16000, feed: 650, doc: 0.5, stepover: 0.35 },
    mm3: { rpm: 18000, feed: 450, doc: 0.35, stepover: 0.35 },
    // a ball-nose finish only takes the thin layer the roughing leaves, so its stepover is small
    eighthBall: { rpm: 18000, feed: 600, doc: 0.4, stepover: 0.15 },
    quarterBall: { rpm: 16000, feed: 700, doc: 0.5, stepover: 0.15 },
  },
  polycarbonate: {
    eighth: { rpm: 16000, feed: 1000, doc: 1.5, stepover: 0.45 },
    quarter: { rpm: 14000, feed: 1200, doc: 2.5, stepover: 0.45 },
    mm3: { rpm: 16000, feed: 900, doc: 1.2, stepover: 0.45 },
    eighthBall: { rpm: 16000, feed: 1000, doc: 1.5, stepover: 0.15 },
    quarterBall: { rpm: 14000, feed: 1200, doc: 2.5, stepover: 0.15 },
  },
  wood: {
    eighth: { rpm: 18000, feed: 1200, doc: 2, stepover: 0.45 },
    quarter: { rpm: 16000, feed: 1200, doc: 3.5, stepover: 0.45 },
    mm3: { rpm: 18000, feed: 1100, doc: 1.8, stepover: 0.45 },
    eighthBall: { rpm: 18000, feed: 1200, doc: 2, stepover: 0.15 },
    quarterBall: { rpm: 16000, feed: 1200, doc: 3.5, stepover: 0.15 },
  },
};

const TABS = {
  aluminium: { height: 0.8, length: 4 },
  polycarbonate: { height: 1.2, length: 5 },
  wood: { height: 2, length: 6 },
};

export function settingsFor(material, bit) {
  const p = PRESETS[material][bit];
  return {
    material, bit,
    diameter: BITS[bit].diameter,
    rpm: p.rpm,
    feed: p.feed,
    rampFeed: Math.round(p.feed * 0.6),
    doc: p.doc,
    stepover: p.stepover,
    rampAngle: material === 'aluminium' ? 2 : 4, // degrees
    climb: true,
    overcut: MATERIALS[material].overcut,
    tabHeight: TABS[material].height,
    tabLength: TABS[material].length,
  };
}

export class CamError extends Error {}

export const CLEARANCE = 0.5; // rapid down to this much above the top, then feed the rest
const AIR = 0.2;         // start ramps this far above the floor already cut
export const mm = v => String(+v.toFixed(1)); // sizes in messages, to a tenth of a millimetre

// Settings typed into "More settings" can be anything. Refuse the ones that make no sense and pull
// the rest back inside what the machine can do.
export function tidySettings(given, machine, thickness, warnings) {
  const s = { ...given };
  const bad = (v, lo, hi) => typeof v !== 'number' || !isFinite(v) || v <= lo || v > hi;
  if (bad(s.diameter, 0.2, 25)) throw new CamError('The bit size has to be between 0.2 and 25 mm.');
  if (bad(s.doc, 0.01, 50)) throw new CamError('The depth per pass has to be more than 0.01 mm.');
  if (bad(s.stepover, 0.05, 0.9)) throw new CamError('The stepover has to be between 5% and 90% of the bit size.');
  if (bad(s.feed, 10, 1e6) || bad(s.rampFeed, 5, 1e6)) throw new CamError('The feed rates have to be more than 10 mm/min.');
  if (bad(s.rpm, 0, 1e6)) throw new CamError('The spindle speed has to be more than 0 RPM.');
  if (bad(s.rampAngle, 0.2, 30)) throw new CamError('The ramp angle has to be between 0.2 and 30 degrees.');
  if (bad(s.overcut, -0.001, 5) || bad(s.tabHeight, -0.001, 50) || bad(s.tabLength, -0.001, 100)) {
    throw new CamError("The overcut and tab sizes can't be negative.");
  }
  const top = Math.min(machine.maxFeed.x, machine.maxFeed.y);
  if (s.feed > top) {
    warnings.push(`The feed was lowered to ${top} mm/min, the machine's top speed.`);
    s.feed = top;
  }
  s.rampFeed = Math.min(s.rampFeed, s.feed);
  if (s.rpm > machine.spindleMax) {
    warnings.push(`The spindle speed was lowered to ${machine.spindleMax} RPM, the spindle's top speed.`);
    s.rpm = machine.spindleMax;
  }
  // a tab taller than the plate would just be the plate
  s.tabHeight = Math.min(s.tabHeight, (thickness + s.overcut) / 2);
  return s;
}

export function makeToolpaths(plate, given, machine) {
  const warnings = [...plate.notes];
  // a long part that only fits the other way round gets turned a quarter turn
  const fits = size => size.x + 2 * (given.diameter + 2) <= machine.travel.x && size.y + 2 * (given.diameter + 2) <= machine.travel.y;
  if (!fits(plate.size) && fits({ x: plate.size.y, y: plate.size.x })) {
    plate = quarterTurn(plate);
    warnings.push('The part is turned a quarter turn so it fits on the machine.');
  }
  const s = tidySettings(given, machine, plate.thickness, warnings);
  const r = s.diameter / 2;
  const zBottom = -plate.thickness;
  const zThrough = zBottom - s.overcut;
  const margin = s.diameter + 2;

  if (plate.thickness + s.overcut + machine.safeZ > machine.travel.z) {
    throw new CamError(`The part is ${mm(plate.thickness)} mm thick, which is more than the machine's Z travel (${machine.travel.z} mm) can cut with a ${mm(machine.safeZ)} mm lift.`);
  }
  const stock = { x: plate.size.x + 2 * margin, y: plate.size.y + 2 * margin };
  if (stock.x > machine.travel.x || stock.y > machine.travel.y) {
    throw new CamError(`The part needs ${mm(stock.x)} x ${mm(stock.y)} mm of stock, but the machine only travels ${machine.travel.x} x ${machine.travel.y} mm. It won't fit.`);
  }

  const job = new Job(s, machine, margin);
  const skipped = [];
  const done = [];

  // material that has to stay at height z: every face higher than z
  const keepCache = new Map();
  const keepAbove = z => {
    const key = z.toFixed(4);
    if (!keepCache.has(key)) keepCache.set(key, closeGaps(union(plate.faces.filter(f => f.h > z + 0.001).flatMap(f => f.region))));
    return keepCache.get(key);
  };

  // ---- pockets: everything inside the part that's lower than the top
  const levels = [...new Set(plate.faces.map(f => +f.h.toFixed(4)))].filter(h => h < -0.001 && h > zBottom + 0.001).sort((a, b) => b - a);
  if (levels.length) {
    const lowered = difference(plate.footprint, keepAbove(-0.002)); // everything not at the top
    for (const pocket of pieces(lowered)) {
      const region = [pocket.outer, ...pocket.holes];
      if (!offset(region, -0.1).length) continue; // a hairline between faces, not a real pocket
      // as deep as the lowest floor face inside it, never deeper
      const floors = plate.faces.filter(f => f.h < -0.001 && totalArea(intersection(region, f.region)) > 0.01);
      const deepest = Math.min(...floors.map(f => f.h));
      if (!isFinite(deepest)) {
        skipped.push({ what: 'a low area', why: 'the part has no floor face there, so its depth is unknown.', where: bounds(region) });
        continue;
      }
      const label = `pocket ${mm(-deepest)} mm deep`;
      job.note(label);
      const cut = job.pocket(region, depthsDown(0, deepest, s.doc, levels), keepAbove);
      if (cut.loops) done.push(label);
      else skipped.push({ what: label, why: `it's narrower than the ${mm(s.diameter)} mm bit, so the bit can't get in. Use a smaller bit.`, where: bounds(region) });
      if (cut.missed > 0.5) warnings.push(`About ${mm(cut.missed)} mm² of a ${label} is in corners or slots too narrow for the bit and stays uncut.`);
    }
  }

  // ---- holes and cutouts that go all the way through
  const bodies = pieces(plate.footprint);
  for (const body of bodies) {
    for (const hole of nearestFirst(body.holes)) {
      const shape = reversed(hole); // holes come back clockwise, cut them as regions of their own
      const circle = asCircle(shape);
      const where = bounds([shape]);
      if (circle) {
        const d = circle.r * 2;
        const label = `${mm(d)} mm hole`;
        if (d < s.diameter - 0.02) {
          skipped.push({ what: label, why: `it's smaller than the ${mm(s.diameter)} mm bit. Drill it by hand, or use a smaller bit.`, where });
        } else if (circle.inside - r < 0.1 * s.diameter) {
          skipped.push({ what: label, why: `it's too close to the bit size for the bit to spiral down into it. Drill it by hand, or use a smaller bit.`, where });
        } else {
          job.note(label);
          job.helix(circle, circle.inside - r, zThrough);
          done.push(label);
        }
        continue;
      }
      const size = Math.max(where.maxX - where.minX, where.maxY - where.minY);
      const label = `${mm(where.maxX - where.minX)} x ${mm(where.maxY - where.minY)} mm cutout`;
      const paths = closeGaps(difference([shape], offset(plate.footprint, r))); // outward offsets only, see pocket()
      if (!paths.length) {
        skipped.push({ what: label, why: `it's narrower than the ${mm(s.diameter)} mm bit. Use a smaller bit.`, where });
        continue;
      }
      if (paths.some(p => perimeter(p) < tightLoop(s))) {
        skipped.push({ what: label, why: `it's too close to the bit size for the bit to ramp down into it. Use a smaller bit.`, where });
        continue;
      }
      // a big scrap piece gets tabs so it can't fly out at the end
      job.note(label);
      for (const p of paths) job.profile(p, zThrough, !s.climb, size > 25);
      done.push(label);
      const missed = totalArea(difference([shape], offset(paths, r))) - perimeterSlack(paths, r);
      if (missed > 0.5) warnings.push(`Parts of a ${label} are narrower than the bit and stay uncut.`);
    }
  }

  // ---- the outline last, with tabs so the part stays put. Pieces closer together than the bit
  // share one path round the lot, so the bit never runs through a neighbour.
  const outlines = offset(bodies.map(b => b.outer), r);
  for (const p of outlines) {
    // climb on the outside means going clockwise, with the part on the bit's right. A gap boxed
    // in between pieces is the other way round.
    job.note('outline');
    job.profile(p, zThrough, area(p) > 0 ? s.climb : !s.climb, true);
  }
  for (const body of bodies) done.push(`outline (${mm(perimeter(body.outer))} mm around)`);
  // the bit can't follow the outline into a gap narrower than itself (comb or sprocket teeth)
  const filled = totalArea(difference(offset(outlines, -r), bodies.map(b => b.outer))) - perimeterSlack(outlines, r);
  if (filled > 1) {
    warnings.push(`Gaps in the outline narrower than the ${mm(s.diameter)} mm bit (about ${mm(filled)} mm²) stay filled in. Use a smaller bit, or cut them by hand.`);
  }
  if (outlines.filter(p => area(p) > 0).length < bodies.length) {
    warnings.push('Some pieces of this part are closer together than the bit, so they stay joined where they nearly touch.');
  }

  if (-zThrough > s.diameter * 4) {
    warnings.push(`The cut goes ${mm(-zThrough)} mm deep. Check that your ${BITS[s.bit].name} bit's flutes are at least that long.`);
  }
  if (bodies.length > 1) warnings.push(`This part is ${bodies.length} separate pieces. Each one gets its own outline and tabs.`);

  const lines = job.finish([
    `GRBL Prep flat part, ${MATERIALS[s.material].name}, ${BITS[s.bit].name} end mill`,
    `Stock: at least ${mm(stock.x)} x ${mm(stock.y)} mm, ${mm(plate.thickness)} mm thick`,
    'Zero X0 Y0 on the front left corner of the stock and Z0 on its top',
  ]);
  return { lines, done, skipped, warnings, minutes: job.minutes(), stock, margin, settings: s, plate };
}

// Turns the plate 90 degrees anticlockwise and moves it back to X0 Y0.
function quarterTurn(plate) {
  const dy = Math.round(plate.size.y * SCALE);
  const turn = paths => paths.map(path => path.map(p => ({ X: dy - p.Y, Y: p.X })));
  return {
    ...plate,
    faces: plate.faces.map(f => ({ ...f, region: turn(f.region) })),
    footprint: turn(plate.footprint),
    size: { x: plate.size.y, y: plate.size.x },
  };
}

// A loop shorter than this is too tight to ramp down along. It would be close to a straight plunge.
const tightLoop = s => 0.2 * Math.PI * s.diameter;

// A rounded bit can't reach right into sharp inside corners. That bit is expected, not a miss.
function perimeterSlack(paths, r) {
  return paths.reduce((a, p) => a + perimeter(p), 0) * r * 0.02;
}

// Depths for each pass from `from` down to `to`, never more than `doc` apart, and landing exactly
// on every pocket floor on the way.
export function depthsDown(from, to, doc, floors = []) {
  const out = [];
  let z = from;
  const stops = floors.filter(h => h < from - 1e-6 && h > to + 1e-6).concat(to).sort((a, b) => b - a);
  for (const stop of stops) {
    const n = Math.max(1, Math.ceil((z - stop) / doc - 1e-9));
    for (let i = 1; i <= n; i++) out.push(z - (z - stop) * i / n);
    z = stop;
  }
  return out;
}

export class Job {
  constructor(s, machine, margin) {
    this.s = s;
    this.first = s;
    this.tools = 1;
    this.m = machine;
    this.margin = margin;
    this.moves = []; // { rapid, x, y, z, f, arc? }, { note } or { tool }
    this.pos = { x: 0, y: 0, z: machine.safeZ };
  }

  at(x, y) {
    return [x + this.margin, y + this.margin];
  }

  rapidZ(z) {
    this.moves.push({ rapid: true, x: this.pos.x, y: this.pos.y, z });
    this.pos.z = z;
  }

  rapidXY(x, y) {
    if (this.pos.z < this.m.safeZ) this.rapidZ(this.m.safeZ);
    this.moves.push({ rapid: true, x, y, z: this.pos.z });
    Object.assign(this.pos, { x, y });
  }

  feed(x, y, z, f = this.s.feed) {
    if (Math.abs(x - this.pos.x) < 1e-6 && Math.abs(y - this.pos.y) < 1e-6 && Math.abs(z - this.pos.z) < 1e-6) return;
    this.moves.push({ rapid: false, x, y, z, f });
    this.pos = { x, y, z };
  }

  // Go to (x, y) and get down to just above `floor`, which is already cut. Only air below that.
  enter(x, y, floor) {
    this.rapidXY(x, y);
    this.rapidZ(CLEARANCE);
    this.feed(x, y, floor + AIR, Math.min(this.s.rampFeed, this.m.maxFeed.z));
  }

  // a comment in the G-code, so you can tell which feature is which
  note(text) {
    this.moves.push({ note: text });
  }

  lift() {
    this.rapidZ(this.m.safeZ);
  }

  // Stops for a bit change. Everything after it cuts with the new settings.
  changeTool(s) {
    this.lift();
    this.tools++;
    this.moves.push({ tool: s, n: this.tools });
    this.s = s;
  }

  // Walks a closed loop at a z that can change along it. zAt(distance) gives the height, and
  // `marks` are the distances where zAt bends, so the path is exact without chopping it up.
  walk(pts, zAt, marks, startS = 0, endS) {
    const n = pts.length;
    const seg = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      seg.push({ a, b, s0: total, len });
      total += len;
    }
    if (total < 1e-6) return 0;
    const sorted = marks.filter(m => m > startS && m < endS).sort((x, y) => x - y);
    let mi = 0;
    for (let lap = Math.floor(startS / total); lap * total < endS; lap++) {
      for (const sg of seg) {
        const from = lap * total + sg.s0, to = from + sg.len;
        if (to <= startS || from >= endS) continue;
        while (mi < sorted.length && sorted[mi] <= from) mi++;
        let k = mi;
        while (k < sorted.length && sorted[k] < Math.min(to, endS)) {
          this.feedAlong(sg, sorted[k] - from, zAt(sorted[k]));
          k++;
        }
        const stop = Math.min(to, endS);
        this.feedAlong(sg, stop - from, zAt(stop));
      }
    }
    return total;
  }

  feedAlong(sg, d, z) {
    const t = sg.len ? d / sg.len : 0;
    const x = sg.a[0] + (sg.b[0] - sg.a[0]) * t, y = sg.a[1] + (sg.b[1] - sg.a[1]) * t;
    const descending = z < this.pos.z - 1e-6;
    this.feed(x, y, z, descending ? this.s.rampFeed : this.s.feed);
  }

  // Cuts a closed loop down to `bottom` in passes, ramping into each one along the loop itself.
  // With tabs, the last bit of every pass rides over the tab tops instead.
  // `top` is how far down the material around the loop is already cut away.
  profile(path, bottom, clockwise, withTabs, top = 0) {
    let pts = toMm(tidy(path)).map(([x, y]) => this.at(x, y));
    // Clipper hands back anticlockwise outers. Turn it round for clockwise cuts.
    const ccw = area(path) > 0;
    if (ccw === clockwise) pts = pts.reverse();
    const len = loopLength(pts);
    if (len < 0.01) return;

    const s = this.s;
    const slope = Math.tan(s.rampAngle * Math.PI / 180);
    const tabTop = bottom + s.overcut + s.tabHeight;
    const tabRun = s.tabHeight * 2; // the sloped ends of each tab
    // on a short loop, shorter tabs, so they don't take up most of the way round
    // Each tab takes up its length, the bit's width and the two ramps. On a short loop use fewer,
    // shorter tabs, so they don't take up most of the way round.
    const ends = s.diameter + 2 * tabRun;
    const tabs = withTabs ? tabCenters(len, s.tabLength + ends) : [];
    const tabLength = Math.max(1, Math.min(s.tabLength, len * 0.35 / Math.max(1, tabs.length) - ends));
    const tabHalf = (tabLength + s.diameter) / 2;
    const tabZ = sAbs => {
      const sl = ((sAbs % len) + len) % len;
      let z = -Infinity;
      for (const c of tabs) {
        for (const cc of [c - len, c, c + len]) {
          const d = Math.abs(sl - cc);
          if (d <= tabHalf) z = Math.max(z, tabTop);
          else if (d < tabHalf + tabRun) z = Math.max(z, tabTop - (d - tabHalf) / tabRun * s.tabHeight * 1.5);
        }
      }
      return z;
    };

    // the pass depths, each lap ramping down from the last one
    const depths = depthsDown(top, bottom, s.doc);
    const laps = [];
    let zNow = top + AIR, sNow = 0;
    for (const target of depths) {
      // a short loop can't drop a whole pass in one lap at a gentle angle, so it spirals down over a few
      while (zNow > target + 1e-6) {
        const drop = Math.min(zNow - target, len * slope);
        laps.push({ s0: sNow, from: zNow, to: zNow - drop, rampLen: drop / slope });
        zNow -= drop;
        sNow += len;
      }
    }
    laps.push({ s0: sNow, from: zNow, to: zNow, rampLen: 0 }); // one clean lap at full depth
    const extra = laps[0] ? Math.min(len, laps[0].rampLen || 0) : 0;
    const endS = sNow + len + Math.max(extra, s.diameter);

    const zAt = sAbs => {
      const lap = laps.find(l => sAbs >= l.s0 - 1e-9 && sAbs <= l.s0 + len + 1e-9) || laps[laps.length - 1];
      const into = sAbs - lap.s0;
      const ramp = lap.rampLen ? lap.from - Math.min(into, lap.rampLen) * slope : lap.to;
      return Math.max(ramp, tabZ(sAbs));
    };
    const marks = [];
    for (const l of laps) {
      marks.push(l.s0, l.s0 + l.rampLen);
    }
    for (let k = 0; k * len <= endS; k++) {
      for (const c of tabs) for (const d of [-tabHalf - tabRun, -tabHalf, tabHalf, tabHalf + tabRun]) marks.push(k * len + c + d);
    }

    this.enter(pts[0][0], pts[0][1], top);
    this.walk(pts, zAt, marks, 0, endS);
    this.lift();
  }

  // Spirals down a round hole, then goes round once more at the bottom.
  helix(circle, radius, bottom) {
    const s = this.s;
    const [cx, cy] = this.at(circle.x, circle.y);
    const pitch = Math.min(s.doc, 2 * Math.PI * radius * Math.tan(s.rampAngle * Math.PI / 180));
    const g = s.climb ? 3 : 2; // climb inside a hole means going anticlockwise
    this.enter(cx + radius, cy, 0);
    let z = this.pos.z;
    let turns = 0;
    while (z > bottom + 1e-6 && turns < 5000) {
      z = Math.max(bottom, z - pitch);
      this.moves.push({ rapid: false, arc: g, x: cx + radius, y: cy, z, i: -radius, j: 0, f: s.rampFeed, cx, cy, r: radius });
      turns++;
    }
    this.moves.push({ rapid: false, arc: g, x: cx + radius, y: cy, z: bottom, i: -radius, j: 0, f: s.feed, cx, cy, r: radius });
    this.pos = { x: cx + radius, y: cy, z: bottom };
    this.lift();
  }

  // Clears a pocket one depth at a time, in rings from the middle out.
  pocket(region, depths, keepAbove) {
    const s = this.s;
    const r = s.diameter / 2;
    let floor = 0;
    let loops = 0;
    let missed = 0;
    // Where the pocket opens onto the edge of the part or a hole, the bit can run on past it,
    // so let it go up to a bit width outside as long as it stays off the part.
    const past = offset(region, s.diameter), centres = offset(region, s.diameter - r);
    for (const z of depths) {
      const open = difference(past, keepAbove(z));
      // Where the bit's centre can go at this depth without touching the part. Built from outward
      // offsets only: shrinking a messy region in one go can come back closer to the wall than asked.
      const allowed = closeGaps(difference(centres, offset(keepAbove(z), r)));
      const rings = [];
      let ring = allowed;
      while (ring.length && rings.length < 400) {
        rings.push(ring);
        ring = intersection(offset(ring, -s.stepover * s.diameter), allowed);
      }
      if (!rings.length) break;

      const slope = Math.tan(s.rampAngle * Math.PI / 180);
      let here = null;
      const specks = []; // loops too tight to ramp into, cut sideways once the bit is down next to them
      const sideways = pts => {
        this.feed(pts[0][0], pts[0][1], z);
        this.walk(pts, () => z, [], 0, loopLength(pts));
        here = [this.pos.x, this.pos.y];
        loops++;
      };
      const reachable = pts => here && Math.abs(this.pos.z - z) < 1e-6 && insideAll([here, pts[0]], allowed, this.margin);
      for (const set of rings.slice().reverse()) {
        for (const p of set) {
          // Clipper's rings already run with the material on the right, which is climb
          let pts = toMm(tidy(p)).map(([x, y]) => this.at(x, y));
          if (!s.climb) pts.reverse();
          const len = loopLength(pts);
          if (len < 0.3) continue;
          const start = nearestIndex(pts, here);
          pts = pts.slice(start).concat(pts.slice(0, start));
          if (reachable(pts)) {
            sideways(pts);
          } else if (len < tightLoop(s)) {
            specks.push(pts);
            continue;
          } else {
            // ramp down along the ring itself, then go once more round at depth
            this.lift();
            this.enter(pts[0][0], pts[0][1], floor);
            const top = this.pos.z;
            const rampLen = (top - z) / slope;
            this.walk(pts, d => Math.max(z, top - d * slope), [rampLen], 0, rampLen + len);
            here = [this.pos.x, this.pos.y];
            loops++;
          }
          for (let i = specks.length - 1; i >= 0; i--) {
            if (!reachable(specks[i])) continue;
            const back = here;
            sideways(specks.splice(i, 1)[0]);
            if (insideAll([here, back], allowed, this.margin)) this.feed(back[0], back[1], z);
            here = [this.pos.x, this.pos.y];
          }
        }
      }
      // The rings sit closer together than the bit is wide, so they clear everything inside the
      // outermost one. Areas too tight to ramp into were skipped, so they don't count.
      const reach = offset(pieces(allowed).filter(pc => perimeter(pc.outer) >= tightLoop(s)).flatMap(pc => [pc.outer, ...pc.holes]), r);
      missed = Math.max(missed, totalArea(difference(intersection(open, region), reach)) - perimeterSlack(rings[0], r));
      floor = z;
    }
    this.lift();
    return { loops, missed };
  }

  // The G-code, with `heading` as comments at the top.
  finish(heading) {
    const out = [
      ...heading.map(h => `(${h.replace(/[()]/g, '')})`),
      'G21 G90 G17 G94',
      `G0 Z${fmt(this.m.safeZ)}`,
      `M3 S${this.first.rpm}`,
      'G4 P3',
    ];
    const fresh = { x: null, y: null, z: null, f: null };
    let last = fresh;
    for (const mv of this.moves) {
      if (mv.note) {
        out.push(`(${mv.note.replace(/[()]/g, '')})`);
        continue;
      }
      if (mv.tool) {
        // The same stop the converter puts in at a tool change, so "one file per tool" splits here.
        // After the pause Z is zeroed on the new bit's tip, so lift before anything else moves.
        out.push('M5', `(Change to tool ${mv.n} ${BITS[mv.tool.bit].name}, re-zero Z only on the uncut stock near X0 Y0, then resume)`, 'M0',
          `G0 Z${fmt(this.m.safeZ)}`, `M3 S${mv.tool.rpm}`, 'G4 P3');
        last = { ...fresh, z: this.m.safeZ }; // a file split off here has to set its own X, Y and feed
        continue;
      }
      const parts = [];
      const g = mv.arc ? `G${mv.arc}` : mv.rapid ? 'G0' : 'G1';
      parts.push(g);
      if (mv.arc || mv.x !== last.x) parts.push(`X${fmt(mv.x)}`);
      if (mv.arc || mv.y !== last.y) parts.push(`Y${fmt(mv.y)}`);
      if (mv.z !== last.z) parts.push(`Z${fmt(mv.z)}`);
      if (mv.arc) parts.push(`I${fmt(mv.i)}`, `J${fmt(mv.j)}`);
      if (!mv.rapid && mv.f !== last.f) parts.push(`F${fmt(mv.f)}`);
      if (parts.length > 1) out.push(parts.join(' '));
      last = { x: mv.x, y: mv.y, z: mv.z, f: mv.rapid ? last.f : mv.f };
    }
    out.push(`G0 Z${fmt(this.m.safeZ)}`, 'M5', 'G0 X0 Y0', 'M30');
    return out;
  }

  minutes() {
    let t = 0, p = { x: 0, y: 0, z: this.m.safeZ };
    for (const mv of this.moves) {
      if (mv.note || mv.tool) continue;
      let d;
      if (mv.arc) d = Math.hypot(2 * Math.PI * mv.r, p.z - mv.z);
      else d = Math.hypot(mv.x - p.x, mv.y - p.y, mv.z - p.z);
      const f = mv.rapid ? (Math.abs(mv.z - p.z) > 1e-6 && mv.x === p.x ? this.m.maxFeed.z : this.m.maxFeed.x) : mv.f;
      t += d / f;
      p = mv;
    }
    return t * 1.15 + 0.1; // a bit extra for speeding up and slowing down, and the spindle start
  }
}

function loopLength(pts) {
  let t = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    t += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return t;
}

function tabCenters(len, tabWidth) {
  let n = len < 60 ? 2 : Math.min(8, Math.max(3, Math.round(len / 120)));
  while (n > 1 && n * tabWidth > len * 0.35) n--;
  // the cut starts halfway between the last tab and the first, as far from both as it can be
  return Array.from({ length: n }, (_, k) => (k + 0.5) * len / n);
}

function nearestIndex(pts, here) {
  if (!here) return 0;
  let best = 0, bestD = Infinity;
  pts.forEach((p, i) => {
    const d = Math.hypot(p[0] - here[0], p[1] - here[1]);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// Is every point along this line inside the area the bit's centre is allowed in?
export function insideAll([a, b], allowed, margin) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
  for (let i = 0; i <= steps; i++) {
    const x = a[0] + (b[0] - a[0]) * i / steps - margin;
    const y = a[1] + (b[1] - a[1]) * i / steps - margin;
    const pt = { X: Math.round(x * SCALE), Y: Math.round(y * SCALE) };
    let inside = 0;
    for (const path of allowed) {
      const res = globalThis.ClipperLib.Clipper.PointInPolygon(pt, path);
      if (res !== 0) inside++;
    }
    if (inside % 2 === 0) return false;
  }
  return true;
}


// Orders holes so each one is the closest to the last, starting near X0 Y0, to cut down on travel.
function nearestFirst(holes) {
  const left = holes.map(h => { const b = bounds([h]); return { h, x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; });
  const out = [];
  let at = { x: 0, y: 0 };
  while (left.length) {
    let best = 0;
    left.forEach((c, i) => { if (Math.hypot(c.x - at.x, c.y - at.y) < Math.hypot(left[best].x - at.x, left[best].y - at.y)) best = i; });
    at = left.splice(best, 1)[0];
    out.push(at.h);
  }
  return out;
}
