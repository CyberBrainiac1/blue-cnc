// Draws the toolpath from above (X/Y) or from the front (X/Z).

export function drawPath(canvas, path, view = 'top', done = 0) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!path || !path.bounds) return;

  const across = 'x';
  const up = view === 'top' ? 'y' : 'z';
  const { min, max } = path.bounds;
  const pad = 16;
  const spanA = Math.max(max[across] - min[across], 1);
  const spanU = Math.max(max[up] - min[up], 1);
  const s = Math.min((w - 2 * pad) / spanA, (h - 2 * pad) / spanU);
  const ox = pad + ((w - 2 * pad) - spanA * s) / 2;
  const oy = pad + ((h - 2 * pad) - spanU * s) / 2;
  const px = p => ox + (p[across] - min[across]) * s;
  const py = p => h - (oy + (p[up] - min[up]) * s); // canvas y goes down

  // the work zero, so you can see where the job sits relative to it
  ctx.strokeStyle = '#c33';
  ctx.lineWidth = 1;
  const zx = px({ x: 0, y: 0, z: 0 }), zy = py({ x: 0, y: 0, z: 0 });
  ctx.beginPath();
  ctx.moveTo(zx - 6, zy); ctx.lineTo(zx + 6, zy);
  ctx.moveTo(zx, zy - 6); ctx.lineTo(zx, zy + 6);
  ctx.stroke();

  path.segs.forEach((seg, i) => {
    ctx.beginPath();
    ctx.setLineDash(seg.rapid ? [4, 4] : []);
    ctx.strokeStyle = seg.rapid ? '#aaa' : i < done ? '#2a8' : '#246';
    ctx.lineWidth = seg.rapid ? 1 : 1.5;
    ctx.moveTo(px(seg.from), py(seg.from));
    ctx.lineTo(px(seg.to), py(seg.to));
    ctx.stroke();
  });
  ctx.setLineDash([]);
}
