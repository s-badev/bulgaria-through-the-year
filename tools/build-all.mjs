// Full data-prep pipeline. Needs the raw inputs in assets/source/ (git-ignored). Without them it exits quietly:
// the processed web assets in public/scenes/ are committed, so a clean clone builds without this step.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// Paths are derived here on purpose: importing ./lib/img.mjs would load `sharp` (a native module) even on a clean clone
// (for example on Vercel) where this script only has to notice that there is nothing to do.
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), SRC = path.join(ROOT, 'assets', 'source'), WORK = path.join(SRC, 'work');
const special = spawnSync('node', ['tools/build-special.mjs', '--if-changed'], { stdio: 'inherit', cwd: ROOT });
if (special.status !== 0) process.exit(special.status || 1);

if (!fs.existsSync(path.join(SRC, 'ndk-photo.png'))) { console.log('[assets] no raw inputs in assets/source - using committed web assets.'); process.exit(0); }
// --if-changed (used by predev/prebuild): skip unless a photo was added, removed or replaced since the last run.
// This is how optional variants (evening-golden.png, evening-bluehour.png, spring.png) are picked up automatically.
const inputs = [path.join(SRC, 'ndk-photo.png'), ...(fs.existsSync(path.join(SRC, 'variants')) ? fs.readdirSync(path.join(SRC, 'variants')).filter(f => f.toLowerCase().endsWith('.png')).sort().map(f => path.join(SRC, "variants", f)) : [])];
const stamp = inputs.map(f => { const s = fs.statSync(f); return path.basename(f) + ':' + s.size + ':' + Math.round(s.mtimeMs); }).join('|'), stampFile = path.join(WORK, '.inputs-stamp');
if (process.argv.includes('--if-changed') && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp) { console.log('[assets] inputs unchanged.'); process.exit(0); }
const run = (cmd, args) => { console.log('\n> ' + [cmd, ...args].join(' ')); const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT }); if (r.status !== 0) { console.error('step failed'); process.exit(1); } };
if (!fs.existsSync(path.join(SRC, 'mock', 'M2.png')) && fs.existsSync(path.join(SRC, 'ndk-motion-mock.html'))) run('node', ['tools/extract-mock.mjs']);
if (!fs.existsSync(path.join(WORK, 'depth-raw16.png'))) {
  const py = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(py)) run(py, ['tools/depth.py']); else { console.error('Depth map missing. Create the venv (see docs/README.md) and run tools/depth.py.'); process.exit(1); }
}
run('node', ['tools/align.mjs']);
run('node', ['tools/build-masks.mjs']);
run('node', ['tools/process-variants.mjs']);
run('node', ['tools/build-traffic.mjs']);   // empty road plates, strict asphalt mask, lanes, car sprites; fails if a lane leaves the asphalt
run('node', ['tools/build-scene.mjs']);
fs.mkdirSync(WORK, { recursive: true }); fs.writeFileSync(stampFile, stamp);
