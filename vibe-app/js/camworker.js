// Runs the CAM in the background, so the page doesn't freeze while a big part works out.
// Clipper is a plain script, not a module, so it gets run by hand here the same way the tests do it.

const ready = (async () => {
  const src = await (await fetch(new URL('./vendor/clipper.js', import.meta.url))).text();
  const module = { exports: {} };
  new Function('module', 'exports', src)(module, module.exports);
  globalThis.ClipperLib = module.exports;
  return {
    ...(await import('./part.js')),
    ...(await import('./cam.js')),
  };
})();

self.onmessage = async ({ data }) => {
  const { compactPart, readPlate, makeToolpaths, PartError, CamError } = await ready;
  try {
    const part = data.part || compactPart(data.body, data.edges);
    const plate = readPlate(part);
    const job = makeToolpaths(plate, data.settings, data.machine);
    const { lines, done, skipped, warnings, minutes, stock } = job;
    postMessage({ ok: true, job: { lines, done, skipped, warnings, minutes, stock, thickness: plate.thickness } });
  } catch (err) {
    const plain = err instanceof PartError || err instanceof CamError;
    postMessage({ ok: false, message: plain ? err.message : `Something went wrong with that part (${err.message}). Try Kiri:Moto for it.` });
  }
};
