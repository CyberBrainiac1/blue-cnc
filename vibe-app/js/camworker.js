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
    ...(await import('./mesh.js')),
    ...(await import('./cam3d.js')),
  };
})();

// A flat part gets the flat cut. One that isn't (and anything with "3D cut" ticked) gets the 3D
// cut, from the part's surface triangles.
self.onmessage = async ({ data }) => {
  const { compactPart, readPlate, makeToolpaths, PartError, CamError, compactMesh, readSolid, make3dToolpaths } = await ready;
  const answer = (kind, job, thickness) => {
    const { lines, done, skipped, warnings, minutes, stock } = job;
    postMessage({ ok: true, kind, job: { lines, done, skipped, warnings, minutes, stock, thickness } });
  };
  try {
    const mesh = data.mesh || (data.faces && compactMesh(data.faces));
    let notFlat = null;
    if (!data.cut3d && (data.part || data.body)) {
      try {
        const plate = readPlate(data.part || compactPart(data.body, data.edges));
        return answer('flat', makeToolpaths(plate, data.settings, data.machine), plate.thickness);
      } catch (err) {
        if (!(err instanceof PartError) || !mesh?.triangles.length) throw err;
        notFlat = err;
      }
    }
    if (!mesh?.triangles.length) throw new PartError("Onshape didn't send this part's surface, so it can't be cut in 3D. Pick the part again.");
    const m = data.machine;
    const solid = readSolid(mesh, m.travel.z - m.safeZ - data.settings.overcut);
    const job = make3dToolpaths(solid, data.settings, data.finish, m);
    if (notFlat) job.warnings.unshift("This part isn't a flat plate, so it gets a 3D cut.");
    answer('3d', job, solid.height);
  } catch (err) {
    const plain = err instanceof PartError || err instanceof CamError;
    postMessage({ ok: false, message: plain ? err.message : `Something went wrong with that part (${err.message}).` });
  }
};
