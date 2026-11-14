// Full data-prep pipeline. Needs the raw inputs in assets/source/ (git-ignored). Without them it exits quietly:
// the processed web assets in public/scenes/ are committed, so a clean clone builds without this step.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SRC, WORK, ROOT } from './lib/img.mjs';

if (!fs.existsSync(path.join(SRC, 'ndk-photo.png'))) { console.log('[assets] no raw inputs in assets/source - using committed web assets.'); process.exit(0); }
const run = (cmd, args) => { console.log('\n> ' + [cmd, ...args].join(' ')); const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT }); if (r.status !== 0) { console.error('step failed'); process.exit(1); } };
if (!fs.existsSync(path.join(SRC, 'mock', 'M2.png')) && fs.existsSync(path.join(SRC, 'ndk-motion-mock.html'))) run('node', ['tools/extract-mock.mjs']);
if (!fs.existsSync(path.join(WORK, 'depth-raw16.png'))) {
  const py = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(py)) run(py, ['tools/depth.py']); else { console.error('Depth map missing. Create the venv (see docs/README.md) and run tools/depth.py.'); process.exit(1); }
}
run('node', ['tools/align.mjs']);
run('node', ['tools/build-masks.mjs']);
run('node', ['tools/process-variants.mjs']);
run('node', ['tools/build-scene.mjs']);
