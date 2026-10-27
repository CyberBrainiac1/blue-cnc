// The page loads js/vendor/clipper.js with a plain script tag. Node treats every .js in this
// folder as a module, so run the file by hand here and hand Clipper over the same way.

import { readFileSync } from 'node:fs';

if (!globalThis.ClipperLib) {
  const src = readFileSync(new URL('../js/vendor/clipper.js', import.meta.url), 'utf8');
  const module = { exports: {} };
  new Function('module', 'exports', src)(module, module.exports);
  globalThis.ClipperLib = module.exports;
}
