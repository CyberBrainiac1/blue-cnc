// Picks the cut for a part, the same way for the page (in camworker.js) and the tests. A flat part
// gets the flat cut. One that isn't, one too big or thick to cut flat, and anything with "3D cut"
// ticked get the 3D cut, from the part's surface triangles.

import { compactPart, readPlate, PartError } from './part.js';
import { makeToolpaths, CamError } from './cam.js';
import { compactMesh, readSolid } from './mesh.js';
import { make3dToolpaths } from './cam3d.js';

export { PartError, CamError };

export function cutPart(data) {
  const mesh = data.mesh || (data.faces && compactMesh(data.faces));
  let notFlat = null;
  if (!data.cut3d && (data.part || data.body)) {
    try {
      const plate = readPlate(data.part || compactPart(data.body, data.edges));
      return { kind: 'flat', job: makeToolpaths(plate, data.settings, data.machine), thickness: plate.thickness };
    } catch (err) {
      // A domed block can read as a tall plate lying on its side, say, which won't fit flat.
      const another = err instanceof PartError || (err instanceof CamError && err.wontFit);
      if (!another || !mesh?.triangles.length) throw err;
      notFlat = err;
    }
  }
  if (!mesh?.triangles.length) throw new PartError("Onshape didn't send this part's surface, so it can't be cut in 3D. Pick the part again.");
  const m = data.machine;
  let solid, job;
  try {
    solid = readSolid(mesh, m.travel.z - m.safeZ - data.settings.overcut);
    job = make3dToolpaths(solid, data.settings, data.finish, m);
  } catch (err) {
    // a plain plate too big for the machine is better told as one
    const plain = err instanceof PartError || err instanceof CamError;
    throw plain && notFlat instanceof CamError ? notFlat : err;
  }
  if (notFlat instanceof PartError) job.warnings.unshift("This part isn't a flat plate, so it gets a 3D cut.");
  if (notFlat instanceof CamError) job.warnings.unshift("This part doesn't fit on the machine as a flat plate, so it gets a 3D cut.");
  return { kind: '3d', job, thickness: solid.height };
}
