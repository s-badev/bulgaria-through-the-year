// Processes the master + AI variants into aligned, artifact-free web assets.
//  - resize 1671 -> 1672, sub-pixel global shift correction (from tools/align.mjs)
//  - 4.4 Vitosha rule: master's high-frequency luminance detail + variant's low-frequency colour/snow, through the mountain mask
//  - 4.3 baked artifacts: car light trails on the avenues replaced by relit asphalt from the matching day image; warm glow under the rain clouds neutralised
//  - photographic cloud textures (tileable) for the live sky
//  - AVIF + WebP encoding, scene manifest fragment (assets/source/work/variants.json)
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { W, H, SRC, WORK, SCENE, loadRGB, luma, blur, blurMasked, loadMaskRGB, saveRGB, rgbToBuffer, polylineDist, smoothstep, clamp, ensureDir, variantFiles } from './lib/img.mjs';
import { LANES } from './scene-geometry.mjs';

const N = W * H;
const align = fs.existsSync(path.join(WORK, 'alignment.json')) ? JSON.parse(fs.readFileSync(path.join(WORK, 'alignment.json'))) : { variants: {} };
const [sky, mtn, veg] = await loadMaskRGB(path.join(SCENE, 'masks-a.png'));
const inv = new Float32Array(fs.readFileSync(path.join(WORK, 'inv.f32')).buffer.slice(0));
const master = await loadRGB(path.join(SRC, 'ndk-photo.png'));
const lumM = luma(master);
const OUT = path.join(WORK, 'processed'); ensureDir(OUT);
const PHOTOS = path.join(SCENE, 'photos'); ensureDir(PHOTOS);

// Which variants exist, which are used, and their role (anchor tags are consumed by src/engine/blend.js).
const ROLES = {
  'autumn': { season: 'autumn', tod: 'day', sky: 'clear', dayFill: null },
  'autumn-clouds': { use: 'clouds-only' },
  'winter-snow': { season: 'winter', tod: 'day', sky: 'overcast' },
  'winter-night': { season: 'winter', tod: 'night', fill: 'master' },
  'winter-night-snow': { season: 'winter', tod: 'night', fill: 'master', fallbackFor: 'winter-night', deflake: true },
  'night': { season: 'summer', tod: 'night', fill: 'master' },
  'rain-night': { season: 'autumn', tod: 'night', wet: true, fill: 'master', coolSky: true },
  'fog': { season: 'autumn', tod: 'day', fog: true },
  'dawn-bluehour': { season: 'summer', tod: 'bluehour', side: 'morning', fill: 'master' },
  'dawn-golden': { season: 'summer', tod: 'golden', side: 'morning' },
  'evening-golden': { season: 'summer', tod: 'golden', side: 'evening', optional: true },
  'evening-bluehour': { season: 'summer', tod: 'bluehour', side: 'evening', fill: 'master', optional: true },
  'spring': { season: 'spring', tod: 'day', sky: 'clear', optional: true },
};

function shift(rgb, dx, dy) { // Catmull-Rom resample: out(x,y) = in(x+dx, y+dy)
  if (Math.hypot(dx, dy) < 0.25) return rgb;
  const out = new Float32Array(rgb.length), cr = t => { const t2 = t * t, t3 = t2 * t; return [(2 * t2 - t3 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (4 * t2 - 3 * t3 + t) / 2, (t3 - t2) / 2]; };
  const ix = Math.floor(dx), iy = Math.floor(dy), wx = cr(dx - ix), wy = cr(dy - iy);
  const tmp = new Float32Array(rgb.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let k = 0; k < 4; k++) s += wx[k] * rgb[(y * W + clamp(x + ix + k - 1, 0, W - 1)) * 3 + c]; tmp[(y * W + x) * 3 + c] = s; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let k = 0; k < 4; k++) s += wy[k] * tmp[(clamp(y + iy + k - 1, 0, H - 1) * W + x) * 3 + c]; out[(y * W + x) * 3 + c] = clamp(s); }
  return out;
}
const chan = (rgb, c) => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = rgb[i * 3 + c]; return o; };

// ---- 4.4 Vitosha: keep the photograph's texture, take only colour + snow from the variant ----
const mtnErode = blur(mtn, W, H, 2.5), mIn = new Float32Array(N), mApply = new Float32Array(N);
for (let i = 0; i < N; i++) { mIn[i] = mtn[i] > 0.9 && mtnErode[i] > 0.9 ? 1 : 0; mApply[i] = smoothstep(0.72, 0.98, mtnErode[i]) * mtn[i]; } // never touch the ridge edge itself
const R_LOW = 6, lowM = blurMasked(lumM, mIn, W, H, R_LOW), hfM = new Float32Array(N);
for (let i = 0; i < N; i++) hfM[i] = Math.abs(lumM[i] - lowM[i]);
const hfMb = blurMasked(hfM, mIn, W, H, 10);
function vitosha(rgb) {
  const L = luma(rgb), lowL = blurMasked(L, mIn, W, H, R_LOW), hf = new Float32Array(N);
  for (let i = 0; i < N; i++) hf[i] = Math.abs(L[i] - lowL[i]);
  const hfb = blurMasked(hf, mIn, W, H, 10);
  const low = [0, 1, 2].map(c => blurMasked(chan(rgb, c), mIn, W, H, R_LOW));
  let meanL = 0, cnt = 0; for (let i = 0; i < N; i++) if (mtn[i] > .5) { meanL += L[i]; cnt++; }
  meanL /= cnt || 1; const night = meanL < 0.16;
  const out = Float32Array.from(rgb);
  for (let i = 0; i < N; i++) {
    const m = mApply[i]; if (m < 0.004) continue;
    const vis = smoothstep(0.12, 0.5, hfb[i] / (hfMb[i] + 1e-4));          // 0 where the variant hides the mountain (fog, cloud bank)
    const detail = clamp(lumM[i] / (lowM[i] + 1e-3), 0.55, 1.7) - 1;
    const amp = vis * (night ? 0.55 : 1) * (1 - smoothstep(0.55, 0.9, lowL[i]) * 0.45); // gentler on bright snow
    const emis = night ? Math.max(0, L[i] - lowL[i] - 0.10) : 0;            // keep real point lights on the slopes at night
    for (let c = 0; c < 3; c++) { const v = low[c][i] * (1 + amp * detail) + emis * (rgb[i * 3 + c] / (L[i] + 1e-3)); out[i * 3 + c] = clamp(rgb[i * 3 + c] * (1 - m) + v * m); }
  }
  return out;
}

// ---- 4.3 baked light trails: rebuild the carriageways from the matching day image, relit by the local night/day gain ----
const laneD = new Float32Array(N).fill(80); for (const l of LANES) polylineDist(l.pts, 80, W, H, laneD);
function removeTrails(rgb, fill) {
  const L = luma(rgb), T = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (laneD[i] >= 79) continue;
    const sc = clamp(inv[i] * 2.4, 0.3, 1.6), r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    const core = 1 - smoothstep(13 * sc, 22 * sc, laneD[i]);
    const wide = 1 - smoothstep(30 * sc, 46 * sc, laneD[i]);
    const white = smoothstep(0.62, 0.8, L[i]) * (1 - smoothstep(0.25, 0.5, (Math.max(r, g, b) - Math.min(r, g, b)) / (Math.max(r, g, b) + 1e-3)));
    const red = smoothstep(1.5, 2.2, r / (g + 0.02)) * smoothstep(0.25, 0.45, r);
    T[i] = Math.max(core, wide * Math.max(white, red)) * (1 - veg[i] * 0.85);
  }
  const Tb = blur(T, W, H, 2.5); for (let i = 0; i < N; i++) T[i] = clamp(Math.max(T[i], smoothstep(0.25, 0.6, Tb[i])));
  const keep = new Float32Array(N); for (let i = 0; i < N; i++) keep[i] = (1 - smoothstep(0.02, 0.2, T[i])) * (L[i] < 0.6 ? 1 : 0.1) * (1 - veg[i]) * (1 - sky[i]) * (1 - mtn[i]) + 1e-5; // gain is learnt from unlit surroundings
  const out = Float32Array.from(rgb);
  const Lf = luma(fill), gl = blurMasked(L, keep, W, H, 26), gf = blurMasked(Lf, keep, W, H, 26);
  for (let c = 0; c < 3; c++) {
    const a = blurMasked(chan(rgb, c), keep, W, H, 26), b = blurMasked(chan(fill, c), keep, W, H, 26);
    for (let i = 0; i < N; i++) { if (T[i] < 0.004) continue; const gL = clamp((gl[i] + 0.004) / (gf[i] + 0.02), 0, 2.5), gC = clamp((a[i] + 0.004) / (b[i] + 0.02), 0, 2.5), g = gL * 0.55 + gC * 0.45, v = (fill[i * 3 + c] * 0.6 + Lf[i] * 0.4) * g; out[i * 3 + c] = clamp(rgb[i * 3 + c] * (1 - T[i]) + v * T[i]); }
  }
  return out;
}
function coolSky(rgb) { // rain-night: the baked orange glow under the clouds would contradict the computed sun
  const out = Float32Array.from(rgb);
  for (let i = 0; i < N; i++) {
    const s = Math.max(sky[i], mtn[i] * 0.8); if (s < 0.01) continue;
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2], L = .2126 * r + .7152 * g + .0722 * b;
    const warm = smoothstep(-0.01, 0.07, r - b), L2 = Math.min(L, 0.2 + (L - 0.2) * 0.3);
    const cool = [L2 * 0.86, L2 * 0.95, L2 * 1.16];
    for (let c = 0; c < 3; c++) out[i * 3 + c] = clamp(rgb[i * 3 + c] * (1 - warm * s) + cool[c] * warm * s);
  }
  return out;
}
function deflake(rgb) { // fallback winter-night-snow only: remove small bright falling flakes (median-like: clamp to local blurred max)
  const out = Float32Array.from(rgb), L = luma(rgb), Lb = blur(L, W, H, 3);
  for (let i = 0; i < N; i++) { const ex = L[i] - Lb[i]; if (ex > 0.10 && L[i] > 0.35) { const k = Lb[i] / (L[i] + 1e-3); for (let c = 0; c < 3; c++) out[i * 3 + c] = rgb[i * 3 + c] * k; } }
  return out;
}

// ---- cloud textures: photographic, tileable; R = shade, G = density ----
async function cloudTexture(rgb, name, mode) {
  const SH = 184, B = 220, TW = W - B, L = luma(rgb), strip = new Float32Array(W * SH), dens = new Float32Array(W * SH);
  for (let y = 0; y < SH; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    strip[i] = L[i];
    dens[i] = mode === 'deck' ? 1 : smoothstep(0.45, 0.2, (b - r) / (b + 0.05)) * smoothstep(0.45, 0.7, L[i]); // white vs blue
  }
  const low = blur(strip, W, SH, 120), out = Buffer.alloc(TW * SH * 3), gain = mode === 'deck' ? 2.6 : 1.3;
  for (let y = 0; y < SH; y++) for (let x = 0; x < TW; x++) {
    const t = x < B ? x / B : 1, i0 = y * W + x, i1 = y * W + x + TW; // cross-fade the wrap seam
    const w = t * t * (3 - 2 * t);
    const shade = (strip[i0] / (low[i0] + 1e-3)) * w + (x < B ? (strip[i1] / (low[i1] + 1e-3)) * (1 - w) : 0);
    const de = dens[i0] * w + (x < B ? dens[i1] * (1 - w) : 0);
    const o = (y * TW + x) * 3; out[o] = clamp(0.5 + (shade - 1) * gain) * 255; out[o + 1] = clamp(de) * 255; out[o + 2] = 0;
  }
  // vertical tile: mirror-blend top/bottom 36 rows
  const VB = 36, TH = SH - VB, fin = Buffer.alloc(TW * TH * 3);
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) for (let c = 0; c < 3; c++) { const t = y < VB ? y / VB : 1, w = t * t * (3 - 2 * t); fin[(y * TW + x) * 3 + c] = out[(y * TW + x) * 3 + c] * w + (y < VB ? out[((y + TH) * TW + x) * 3 + c] * (1 - w) : 0); }
  await sharp(fin, { raw: { width: TW, height: TH, channels: 3 } }).resize(1024, 128, { fit: 'fill' }).webp({ quality: 90 }).toFile(path.join(SCENE, name + '.webp'));
}

async function encode(id, rgb) {
  const raw = { raw: { width: W, height: H, channels: 3 } }, buf = rgbToBuffer(rgb);
  await sharp(buf, raw).avif({ quality: 64, effort: 6, chromaSubsampling: '4:4:4' }).toFile(path.join(PHOTOS, id + '.avif'));
  await sharp(buf, raw).webp({ quality: 86, effort: 5, smartSubsample: true }).toFile(path.join(PHOTOS, id + '.webp'));
}

const files = Object.fromEntries(variantFiles().map(f => [f.replace(/\.png$/i, ''), path.join(SRC, 'variants', f)]));
const processed = { master };
const manifest = { master: { file: 'master', season: 'summer', tod: 'day', sky: 'clear' } };
await saveRGB(path.join(OUT, 'master.png'), master); await encode('master', master);

const order = ['autumn', 'winter-snow', 'spring', 'dawn-golden', 'evening-golden', 'fog', 'night', 'dawn-bluehour', 'evening-bluehour', 'rain-night', 'winter-night', 'winter-night-snow', 'autumn-clouds'];
for (const id of order) {
  if (!files[id]) continue;
  const role = ROLES[id];
  if (role.fallbackFor && files[role.fallbackFor]) { console.log(id.padEnd(18), 'skipped (preferred variant present)'); continue; }
  const g = align.variants[id]?.global || { dx: 0, dy: 0 };
  let rgb = shift(await loadRGB(files[id]), g.dx, g.dy);
  if (role.use === 'clouds-only') { await cloudTexture(rgb, 'clouds-cumulus', 'cumulus'); console.log(id.padEnd(18), 'cloud texture only'); continue; }
  const steps = ['shift ' + g.dx.toFixed(2) + ',' + g.dy.toFixed(2)];
  if (role.deflake) { rgb = deflake(rgb); steps.push('deflake'); }
  if (role.coolSky) { rgb = coolSky(rgb); steps.push('cool sky'); }
  rgb = vitosha(rgb); steps.push('vitosha detail');
  if (role.fill && processed[role.fill]) { rgb = removeTrails(rgb, processed[role.fill]); steps.push('trails -> ' + role.fill); }
  if (id === 'winter-snow') await cloudTexture(rgb, 'clouds-deck', 'deck');
  processed[id] = rgb;
  await saveRGB(path.join(OUT, id + '.png'), rgb); await encode(id, rgb);
  const { use, fill, deflake: _d, coolSky: _c, optional, fallbackFor, ...tags } = role;
  manifest[role.fallbackFor || id] = { file: id, ...tags };
  console.log(id.padEnd(18), steps.join(' | '));
}
fs.writeFileSync(path.join(WORK, 'variants.json'), JSON.stringify(manifest, null, 2));
const total = fs.readdirSync(PHOTOS).reduce((s, f) => s + fs.statSync(path.join(PHOTOS, f)).size, 0);
console.log('photos total', (total / 1048576).toFixed(2), 'MB');
