import path from 'node:path';
import { W, H, WORK, SCENE, loadRGB, toLinear, loadMaskRGB } from './lib/img.mjs';
const P = f => path.join(WORK, 'processed', f + '.png'), N = W * H;
const day = toLinear(await loadRGB(P('master')));
const [sky, mtn, veg] = await loadMaskRGB(path.join(SCENE, 'masks-a.png'));
const [shadow, ground] = await loadMaskRGB(path.join(SCENE, 'masks-d.png'));
const [, , paved] = await loadMaskRGB(path.join(SCENE, 'masks-b.png'));
const lum = (a, i) => .2126 * a[i * 3] + .7152 * a[i * 3 + 1] + .0722 * a[i * 3 + 2];
const med = a => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : NaN; };
async function stat(id, label, sel) {
  const v = toLinear(await loadRGB(P(id))); const idx = [];
  for (let i = 0; i < N; i += 7) if (sel(i, v)) idx.push(i);
  const r = [0, 1, 2].map(c => med(idx.map(i => v[i * 3 + c] / Math.max(day[i * 3 + c], 0.004))));
  console.log(id.padEnd(14), label.padEnd(26), 'n=' + idx.length, r.map(x => x.toFixed(3)).join(' '));
}
const gnd = i => sky[i] < .05 && mtn[i] < .05 && i > 400 * W;
await stat('night', 'unlit paved sunlit-ref', (i, v) => gnd(i) && paved[i] > .6 && shadow[i] < .1 && lum(v, i) < 0.02);
await stat('night', 'unlit veg', (i, v) => gnd(i) && veg[i] > .6 && lum(v, i) < 0.01);
await stat('night', 'all paved', (i, v) => gnd(i) && paved[i] > .6 && shadow[i] < .1);
await stat('dawn-bluehour', 'paved sunlit-ref dim', (i, v) => gnd(i) && paved[i] > .6 && shadow[i] < .1 && lum(v, i) < 0.25);
await stat('dawn-bluehour', 'paved shadow-ref', (i, v) => gnd(i) && paved[i] > .6 && shadow[i] > .7 && lum(v, i) < 0.25);
await stat('dawn-bluehour', 'veg', (i, v) => gnd(i) && veg[i] > .6 && shadow[i] < .1);
await stat('dawn-golden', 'paved sunlit-ref', (i, v) => gnd(i) && paved[i] > .6 && shadow[i] < .1);
await stat('dawn-golden', 'paved shadow-ref', (i, v) => gnd(i) && paved[i] > .6 && shadow[i] > .7);
await stat('dawn-golden', 'veg sunlit', (i, v) => gnd(i) && veg[i] > .6 && shadow[i] < .1);
await stat('winter-snow', 'paved', (i, v) => gnd(i) && paved[i] > .6 && shadow[i] < .1);
await stat('fog', 'paved near', (i, v) => i > 650 * W && paved[i] > .6 && shadow[i] < .1);
await stat('master', 'shadow/sunlit paved lum', () => false);
// shadow depth in master: median luminance of paved in shadow vs sunlit
const a = [], b = []; for (let i = 500 * W; i < N; i += 5) { if (paved[i] > .7) { if (shadow[i] > .8) a.push(i); else if (shadow[i] < .05) b.push(i); } }
console.log('master paved shadow rgb', [0, 1, 2].map(c => med(a.map(i => day[i * 3 + c])).toFixed(3)).join(' '), ' sunlit rgb', [0, 1, 2].map(c => med(b.map(i => day[i * 3 + c])).toFixed(3)).join(' '));
// sky colours: zenith (y=20) and near-ridge horizon for several variants
for (const id of ['master', 'dawn-golden', 'dawn-bluehour', 'night', 'winter-snow', 'autumn']) {
  const v = toLinear(await loadRGB(P(id))); const s = (x, y) => [0, 1, 2].map(c => v[(y * W + x) * 3 + c].toFixed(3)).join(',');
  console.log('sky', id.padEnd(14), 'top-left', s(100, 20), 'top-mid', s(836, 20), 'top-right', s(1570, 20), '| low-left', s(60, 280), 'mid(836,150)', s(836, 150), 'low-right', s(1600, 200));
}
