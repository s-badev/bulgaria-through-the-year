// Writes public/scenes/ndk/scene.json: everything the scene-agnostic engine needs (photos, masks, camera, geometry).
import path from 'node:path';
import fs from 'node:fs';
import { W, H, WORK, SCENE, loadRGB, luma, loadMaskRGB, clamp } from './lib/img.mjs';
import { CAMERA, BASINS, JETS, BEACONS, CORRIDORS, EMBLEM, NDK_BOX } from './scene-geometry.mjs';

const calib = JSON.parse(fs.readFileSync(path.join(WORK, 'calib.json')));
const variants = JSON.parse(fs.readFileSync(path.join(WORK, 'variants.json')));
const fullC = path.join(WORK, 'masks-full', 'masks-c.png');
const [bld, roads] = await loadMaskRGB(fs.existsSync(fullC) ? fullC : path.join(SCENE, 'masks-c.png'));
const [sky, mtn] = await loadMaskRGB(path.join(SCENE, 'masks-a.png'));
const at = (a, x, y) => a[clamp(Math.round(y), 0, H - 1) * W + clamp(Math.round(x), 0, W - 1)];
const scaleAt = y => +clamp((y - CAMERA.horizonY) / (H - CAMERA.horizonY), 0.05, 1.2).toFixed(3);

// lamps: bright, small, warm maxima on the ground of each night-type photo
async function lamps(id) {
  const f = path.join(WORK, 'processed', id + '.png'); if (!fs.existsSync(f)) return null;
  const rgb = await loadRGB(f), L = luma(rgb), cand = [];
  for (let y = 350; y < H - 10; y++) for (let x = 10; x < W - 10; x++) {
    const i = y * W + x, v = L[i]; if (v < 0.8 || bld[i] > 0.5 || sky[i] > 0.1 || mtn[i] > 0.1) continue;
    if (rgb[i * 3] < rgb[i * 3 + 2]) continue; // warm or neutral only
    let mx = true; for (let dy = -3; dy <= 3 && mx; dy++) for (let dx = -3; dx <= 3; dx++) { if (L[i + dy * W + dx] > v) { mx = false; break; } }
    if (!mx) continue;
    let ring = 0; for (const [dx, dy] of [[-9, 0], [9, 0], [0, -9], [0, 9]]) ring += at(L, x + dx, y + dy);
    if (ring / 4 > 0.7) continue; // large bright surface, not a lamp
    cand.push([x, y, v - ring / 4]);
  }
  cand.sort((a, b) => b[2] - a[2]); const out = [];
  for (const c of cand) { if (out.length >= 260) break; if (out.every(o => Math.hypot(o[0] - c[0], o[1] - c[1]) > 9)) out.push(c); }
  return out.map(([x, y, s]) => [x, y, scaleAt(y), +s.toFixed(2)]); // [x, y, scale, strength]
}
const lampSets = {};
for (const id of ['night', 'winter-night', 'rain-night', 'dawn-bluehour', 'evening-bluehour']) { const l = await lamps(id); if (l) lampSets[id] = l; }

const photos = {};
for (const [id, v] of Object.entries(variants)) { const { file, ...tags } = v; photos[id] = { src: 'photos/' + file, ...tags }; }

const scene = {
  id: 'ndk', title: 'София · НДК и Витоша', subtitle: 'Жива снимка', size: [W, H],
  location: { name: 'София', lat: 42.6977, lon: 23.3219, timeZone: 'Europe/Sofia' },
  camera: { facingAzimuth: 180, focalPx: calib.focalPx, horizonY: calib.horizonY, pitchRad: +calib.pitchRad.toFixed(5), z0: +calib.z0CameraHeights.toFixed(4), invDepthScale: calib.invDepthScale, focusX: 0.48 },
  referenceSun: { azimuth: 105, altitude: 40 }, // light baked into the master photo (sun from the left, shadows fall right)
  formats: ['avif', 'webp'],
  photos,
  masks: { a: 'masks-a.png', b: 'masks-b.png', c: 'masks-c.png', d: 'masks-d.png', geo: 'geo.png' },
  clouds: { deck: 'clouds-deck.webp', cumulus: 'clouds-cumulus.webp' },
  traffic: fs.existsSync(path.join(SCENE, 'traffic.json')) ? { data: 'traffic.json', road: 'road.png', atlas: 'cars.png' } : null,
  channels: { a: ['sky', 'mountain', 'vegetation'], b: ['water', 'trees', 'paved'], c: ['buildings', 'roads', 'glass'], d: ['bakedShadow', 'ground', 'height'], geo: ['normalX', 'normalY', 'invDepth'] },
  geometry: { basins: BASINS, jets: JETS, beacons: BEACONS, corridors: CORRIDORS, emblem: EMBLEM, ndkBox: NDK_BOX, lamps: lampSets, windows: { cell: 5 } },
};
fs.writeFileSync(path.join(SCENE, 'scene.json'), JSON.stringify(scene));
console.log('scene.json', (fs.statSync(path.join(SCENE, 'scene.json')).size / 1024).toFixed(1), 'KB; photos:', Object.keys(photos).join(', '), '; lamps:', Object.entries(lampSets).map(([k, v]) => k + ':' + v.length).join(' '));
