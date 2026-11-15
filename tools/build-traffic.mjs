// Traffic data from the photograph itself.
//   1. carriageway polygons from the traced kerb sections (tools/roads-config.mjs)
//   2. baked cars found per day-time photo as outliers against the modal asphalt colour
//   3. empty road plates: the cars are inpainted along the lane; night photos get the empty plate relit
//   4. strict visible-asphalt mask (what is asphalt in EVERY day photo), lanes inside it, hide segments
//   5. a library of real car sprites cut from the photographs
// Outputs: public/scenes/ndk/{road.png, cars.png, traffic.json, photos/*}, assets/source/work/plates/*, debug sheets.
// Fails (exit 1) if a lane leaves the asphalt: see validate().
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { W, H, WORK, SCENE, loadRGB, luma, blur, blurMasked, loadMaskRGB, saveRGB, rgbToBuffer, smoothstep, clamp, ensureDir, rgb2hsv } from './lib/img.mjs';
import { groundPoint } from './lib/roads.mjs';
import { CARRIAGEWAYS, CAMERA_HEIGHT_M, UNTOUCHED } from './roads-config.mjs';

const N = W * H, DEBUG = process.argv.includes('--debug'), NO_ENCODE = process.argv.includes('--no-encode');
const MASK_FROM = process.argv.includes('--mask-from') ? process.argv[process.argv.indexOf('--mask-from') + 1].split(',') : null; // debugging: which photos may veto asphalt
const cam = JSON.parse(fs.readFileSync(path.join(WORK, 'calib.json')));
const CT = Math.cos(cam.pitchRad);
/** Lateral pixels per metre on the ground at image row y. */
export const ppm = y => Math.max(0.2, CT * (y - cam.horizonY) / CAMERA_HEIGHT_M);
const CAR_W = 1.9, CAR_L = 4.5; // metres
const DAY = ['master', 'autumn', 'winter-snow', 'fog', 'dawn-golden', 'spring', 'evening-golden'];      // get their own empty plate
const NIGHT = ['night', 'dawn-bluehour', 'evening-bluehour', 'rain-night', 'winter-night', 'winter-night-snow']; // road = master plate relit
const LIBS = ['master', 'autumn', 'winter-snow'];                                                         // sprite sources
const P = id => path.join(WORK, 'processed', id + '.png');

// ---------- 1. carriageway geometry ----------
function catmull(p, t) { // p: array of [x,y], t in [0, n-1]
  const n = p.length, i = Math.min(n - 2, Math.floor(t)), f = t - i, a = p[Math.max(0, i - 1)], b = p[i], c = p[i + 1], d = p[Math.min(n - 1, i + 2)];
  const q = (k) => 0.5 * ((2 * b[k]) + (-a[k] + c[k]) * f + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * f * f + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * f * f * f);
  return [q(0), q(1)];
}
// Live carriageways and clean-only zones get SEPARATE geometry. The live pipeline below is exactly the one the lanes and the
// strict mask come from; clean-only zones (tools/roads-config.mjs: cleanOnly) only get a second, plate-cleaning pass, may not
// take a single pixel of a live carriageway, never veto asphalt and never get a lane.
let cwId, kMap, uMap, edgeD, cws; // edgeD: px to the nearest kerb
const use = G => { ({ cwId, kMap, uMap, edgeD, cws } = G); return G; };
function buildGeometry(list, ownedBy = null) {
 const G = { cwId: new Uint8Array(N), kMap: new Float32Array(N).fill(-1), uMap: new Float32Array(N), edgeD: new Float32Array(N), cws: null };
 const { cwId, kMap, uMap, edgeD } = G;
 G.cws = list.map((c, ci) => {
  const Ls = c.sections.map(s => s[0]), Rs = c.sections.map(s => s[1]), n = Ls.length;
  let len = 0; for (let i = 1; i < n; i++) len += Math.hypot((Ls[i][0] + Rs[i][0] - Ls[i - 1][0] - Rs[i - 1][0]) / 2, (Ls[i][1] + Rs[i][1] - Ls[i - 1][1] - Rs[i - 1][1]) / 2);
  const M = Math.ceil(len * 2.5), L = [], R = [];
  for (let k = 0; k <= M; k++) { const t = k / M * (n - 1); L.push(catmull(Ls, t)); R.push(catmull(Rs, t)); }
  for (let k = 0; k <= M; k++) {
    const wpx = Math.hypot(R[k][0] - L[k][0], R[k][1] - L[k][1]), J = Math.ceil(wpx * 2.5);
    for (let j = 0; j <= J; j++) {
      const u = j / J, x = Math.round(L[k][0] + (R[k][0] - L[k][0]) * u), y = Math.round(L[k][1] + (R[k][1] - L[k][1]) * u);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x; if (ownedBy && ownedBy[i]) continue; cwId[i] = ci + 1; kMap[i] = k; uMap[i] = u; edgeD[i] = Math.min(u, 1 - u) * wpx;
    }
  }
  const at = (k, u) => { const kk = clamp(k, 0, M), k0 = Math.min(M - 1, Math.floor(kk)), f = kk - k0, lx = L[k0][0] + (L[k0 + 1][0] - L[k0][0]) * f, ly = L[k0][1] + (L[k0 + 1][1] - L[k0][1]) * f, rx = R[k0][0] + (R[k0 + 1][0] - R[k0][0]) * f, ry = R[k0][1] + (R[k0 + 1][1] - R[k0][1]) * f; return [lx + (rx - lx) * u, ly + (ry - ly) * u, Math.hypot(rx - lx, ry - ly)]; };
  const xs = [...L, ...R].map(p => p[0]), ys = [...L, ...R].map(p => p[1]);
  return { ...c, ci, M, L, R, at, bbox: [Math.max(0, Math.floor(Math.min(...xs)) - 3), Math.max(0, Math.floor(Math.min(...ys)) - 3), Math.min(W - 1, Math.ceil(Math.max(...xs)) + 3), Math.min(H - 1, Math.ceil(Math.max(...ys)) + 3)] };
 });
 G.owner = Uint8Array.from(cwId); // raw ownership, before occluders are cut out
 return G;
}
const [, , vegM] = await loadMaskRGB(path.join(SCENE, 'masks-a.png'));
// Occluders: tree crowns and anything standing above the carriageway hide the road. Those pixels stay part of the lane geometry
// (cars pass behind them) but are never analysed, inpainted or drawn on. Height is relative to the carriageway's own level.
const fullD0 = path.join(WORK, 'masks-full', 'masks-d.png'), [, , hN] = await loadMaskRGB(fs.existsSync(fullD0) ? fullD0 : path.join(SCENE, 'masks-d.png'));
function cutOccluders() {
  const occ = new Uint8Array(N);
  for (const c of cws) { const hs = []; for (let i = 0; i < N; i++) if (cwId[i] === c.ci + 1) hs.push(hN[i]); hs.sort((a, b) => a - b); const base = hs[hs.length >> 1] || 0; for (let i = 0; i < N; i++) if (cwId[i] === c.ci + 1 && (hN[i] > base + 0.2 || vegM[i] > 0.22)) occ[i] = 1; }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (cwId[i] && (occ[i] || occ[i - 1] || occ[i + 1] || occ[i - W] || occ[i + W])) cwId[i] = 255; }
  for (let i = 0; i < N; i++) if (cwId[i] === 255) cwId[i] = 0;
}
const LIVE = use(buildGeometry(CARRIAGEWAYS.filter(c => !c.cleanOnly))); cutOccluders();
const CLEAN = use(buildGeometry(CARRIAGEWAYS.filter(c => c.cleanOnly), LIVE.owner)); cutOccluders();
use(LIVE);

// ---------- 2. baked cars: outliers against the modal asphalt colour of the neighbourhood ----------
const CLS = { BG: 0, CAR: 1, STATIC: 2, POST: 3, MARK: 4, NOISE: 5, SHADOW: 6 };
function analyse(src, skip = []) {
  const rgb = new Float32Array(N * 3); for (let ch = 0; ch < 3; ch++) { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = src[i * 3 + ch]; const b = blur(a, W, H, 1.2, 2); for (let i = 0; i < N; i++) rgb[i * 3 + ch] = b[i]; }
  const L = luma(rgb), cls = new Uint8Array(N), comps = [], nonBg = new Uint8Array(N), G = 4;
  for (const c of cws) {
    if (skip.includes(c.id)) continue;
    const [x0, y0, x1, y1] = c.bbox, gw = Math.ceil((x1 - x0 + 1) / G) + 1, gh = Math.ceil((y1 - y0 + 1) / G) + 1, refs = new Array(gw * gh).fill(null);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const px = x0 + gx * G, py = y0 + gy * G, R = clamp(Math.round(2.6 * CAR_W * ppm(py)), 6, 18), hist = new Float32Array(48); let cnt = 0;
      for (let y = Math.max(0, py - R); y <= Math.min(H - 1, py + R); y++) for (let x = Math.max(0, px - R); x <= Math.min(W - 1, px + R); x++) { const i = y * W + x; if (cwId[i] !== c.ci + 1 || edgeD[i] < 1) continue; hist[Math.min(47, (L[i] * 48) | 0)]++; cnt++; }
      if (cnt < 14) continue;
      const sm = hist.map((v, b) => (hist[Math.max(0, b - 1)] + 2 * v + hist[Math.min(47, b + 1)]) / 4);
      let m1 = 0; for (let b = 1; b < 48; b++) if (sm[b] > sm[m1]) m1 = b;
      let m2 = -1; for (let b = 0; b < 48; b++) if (Math.abs(b - m1) >= 5 && sm[b] >= 0.35 * sm[m1] && (m2 < 0 || sm[b] > sm[m2])) m2 = b;
      const mean = (m) => { const a = [0, 0, 0, 0]; for (let y = Math.max(0, py - R); y <= Math.min(H - 1, py + R); y++) for (let x = Math.max(0, px - R); x <= Math.min(W - 1, px + R); x++) { const i = y * W + x; if (cwId[i] !== c.ci + 1 || edgeD[i] < 1 || Math.abs(L[i] * 48 - (m + .5)) > 1.6) continue; a[0] += rgb[i * 3]; a[1] += rgb[i * 3 + 1]; a[2] += rgb[i * 3 + 2]; a[3]++; } return a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : null; };
      const r1 = mean(m1); let r2 = m2 >= 0 ? mean(m2) : null;
      // a second mode is accepted only as the sunlit/shadowed pair of the same asphalt (one neutral, one clearly bluish and darker)
      if (r1 && r2) { const b1 = r1[2] - r1[0], b2 = r2[2] - r2[0], ok = (b1 > 0.05 && b2 < 0.035 && luma(r1)[0] < luma(r2)[0]) || (b2 > 0.05 && b1 < 0.035 && luma(r2)[0] < luma(r1)[0]); if (!ok) r2 = null; }
      refs[gy * gw + gx] = r1 ? [r1, r2] : null;
    }
    const match = (i, r) => { if (!r) return false; const lr = 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2], dl = L[i] - lr; if (Math.abs(dl) > 0.06 + 0.07 * lr) return false; return Math.max(Math.abs(rgb[i * 3] - r[0] - dl), Math.abs(rgb[i * 3 + 1] - r[1] - dl), Math.abs(rgb[i * 3 + 2] - r[2] - dl)) < 0.07; };
    const refL = new Float32Array((x1 - x0 + 1) * (y1 - y0 + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x; if (cwId[i] !== c.ci + 1) continue;
      const gx = (x - x0) / G, gy = (y - y0) / G, g0 = Math.floor(gx), h0 = Math.floor(gy); let bg = false, rl = 0, rn = 0;
      for (const [a, b] of [[g0, h0], [g0 + 1, h0], [g0, h0 + 1], [g0 + 1, h0 + 1]]) { const r = refs[Math.min(gh - 1, b) * gw + Math.min(gw - 1, a)]; if (!r) continue; if (match(i, r[0]) || match(i, r[1])) bg = true; rl += 0.2126 * r[0][0] + 0.7152 * r[0][1] + 0.0722 * r[0][2]; rn++; }
      if (!rn) bg = true; // no reference (too few road pixels around): leave alone
      nonBg[i] = bg ? 0 : 1; refL[(y - y0) * (x1 - x0 + 1) + x - x0] = rn ? rl / rn : L[i];
    }
    c._refL = refL;
  }
  // refine: the asphalt is a smooth surface; re-estimate it from the pixels currently believed to be asphalt and re-test, three times
  for (let it = 0; it < 3; it++) {
    const bg = new Float32Array(N); for (let i = 0; i < N; i++) bg[i] = cwId[i] && !nonBg[i] && !skip.includes(cws[cwId[i] - 1].id) ? 1 : 0;
    const lo = [0, 1, 2].map(ch => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = rgb[i * 3 + ch]; return blurMasked(a, bg, W, H, 7); }), cov = blur(bg, W, H, 7);
    for (let i = 0; i < N; i++) {
      if (!cwId[i] || cov[i] < 0.08 || skip.includes(cws[cwId[i] - 1].id)) continue;
      const lr = 0.2126 * lo[0][i] + 0.7152 * lo[1][i] + 0.0722 * lo[2][i], dl = L[i] - lr;
      const chroma = Math.max(Math.abs(rgb[i * 3] - lo[0][i] - dl), Math.abs(rgb[i * 3 + 1] - lo[1][i] - dl), Math.abs(rgb[i * 3 + 2] - lo[2][i] - dl));
      nonBg[i] = Math.abs(dl) > 0.05 + 0.03 * lr || chroma > 0.05 ? 1 : 0;
      const c = cws[cwId[i] - 1]; if (skip.includes(c.id)) continue; c._refL[((i / W | 0) - c.bbox[1]) * (c.bbox[2] - c.bbox[0] + 1) + (i % W) - c.bbox[0]] = lr;
    }
  }
  // connected components of non-background pixels
  const seen = new Uint8Array(N), stack = [];
  for (let s = 0; s < N; s++) {
    if (!nonBg[s] || seen[s]) continue;
    const c = cws[cwId[s] - 1], px = []; stack.push(s); seen[s] = 1;
    let minx = W, miny = H, maxx = 0, maxy = 0, sl = 0, sr = 0, edge = 0, vegLike = 0, darker = 0, lighter = 0, blue = 0;
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0; px.push(i);
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      const [hh, ss, vv] = rgb2hsv(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]); if (ss > 0.3 && hh > 25 && hh < 170 && vv > 0.12) vegLike++;
      { const rl = c._refL[(y - c.bbox[1]) * (c.bbox[2] - c.bbox[0] + 1) + x - c.bbox[0]]; if (L[i] < rl - 0.035) darker++; else if (L[i] > rl + 0.035) lighter++; blue += (rgb[i * 3 + 2] - rgb[i * 3]); }
      sl += L[i]; sr += c._refL[(y - c.bbox[1]) * (c.bbox[2] - c.bbox[0] + 1) + x - c.bbox[0]]; if (edgeD[i] < 1.1 || kMap[i] < 2 || kMap[i] > c.M - 2) edge++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx; if (nonBg[j] && !seen[j] && cwId[j] === c.ci + 1) { seen[j] = 1; stack.push(j); } }
    }
    const A = px.length, bw = maxx - minx + 1, bh = maxy - miny + 1, cy = (miny + maxy) / 2, wc = Math.max(2.6, CAR_W * ppm(cy)), brighter = sl / A > sr / A + 0.03;
    let kind;
    if (A < 0.2 * wc * wc || Math.min(bw, bh) <= Math.max(1, 0.4 * wc)) kind = brighter ? CLS.MARK : (bh >= 2.5 * bw && bh > wc) ? CLS.POST : CLS.NOISE;
    else if (edge / A > 0.4 || A > 16 * wc * wc || vegLike / A > 0.4) kind = CLS.STATIC;
    else if (c.markings && darker / A < 0.06 && lighter / A > 0.5) kind = CLS.MARK;                 // painted arrows, zebra: only brighter than the asphalt, no dark parts (a white car has windows and a shadow)
    else if (lighter / A < 0.04 && blue / A > 0.075 && sl / A > 0.12) kind = CLS.SHADOW; // a cast shadow: only darker and clearly bluer than sunlit asphalt
    else kind = CLS.CAR;
    for (const i of px) cls[i] = kind;
    comps.push({ kind, px, A, bbox: [minx, miny, maxx, maxy], wc, cw: c.id, cars: kind === CLS.CAR ? Math.max(1, Math.round(A / (1.25 * wc * wc))) : 0, lum: sl / A });
  }
  return { cls, comps };
}

// ---------- 3. empty plate: fill every removable car from the asphalt before and after it in the same lane ----------
function inpaint(rgb, an) {
  const hole = new Uint8Array(N), valid = new Float32Array(N);
  for (const c of an.comps) if (c.kind === CLS.CAR) for (const i of c.px) { const x = i % W, y = (i / W) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && cwId[yy * W + xx]) hole[yy * W + xx] = 1; } }
  for (let i = 0; i < N; i++) valid[i] = cwId[i] && !hole[i] && (an.cls[i] === CLS.BG || an.cls[i] === CLS.NOISE || an.cls[i] === CLS.SHADOW) && edgeD[i] >= 0.8 ? 1 : 0;
  const sm = [0, 1, 2].map(ch => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = rgb[i * 3 + ch]; return blurMasked(a, valid, W, H, 1.4); });
  const lo = [0, 1, 2].map(ch => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = rgb[i * 3 + ch]; return blur(a, W, H, 1.6); });
  const out = Float32Array.from(rgb), fill = new Float32Array(N * 3), damaged = new Uint8Array(N); let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < N; i++) {
    if (!hole[i]) continue;
    const c = cws[cwId[i] - 1], k = kMap[i], u = uMap[i], acc = [0, 0, 0]; let wsum = 0, src = -1;
    const probe = (dk, du, weight) => {
      for (let d = 1; d <= 70; d++) {
        const [x, y, wpx] = c.at(k + dk * d * 2, clamp(u + du * d / Math.max(4, c.at(k, u)[2]), 0.02, 0.98));
        if (dk && (k + dk * d * 2 < 0 || k + dk * d * 2 > c.M)) return;
        if (du && d > 12) return;
        const j = Math.round(y) * W + Math.round(x); if (j < 0 || j >= N) return;
        if (valid[j]) { const w = weight / ((d + 0.5) * (d + 0.5)); acc[0] += sm[0][j] * w; acc[1] += sm[1][j] * w; acc[2] += sm[2][j] * w; wsum += w; if (src < 0 || rnd() < 0.5) src = j; return; }
      }
    };
    probe(1, 0, 2.5); probe(-1, 0, 2.5); probe(0, 1, 1); probe(0, -1, 1);
    if (!wsum) { damaged[i] = 1; continue; }
    // photographic grain borrowed from a real asphalt pixel nearby
    const g = src >= 0 ? src + ((rnd() * 3 - 1) | 0) + W * ((rnd() * 3 - 1) | 0) : -1, gv = g >= 0 && g < N && valid[g] ? g : src;
    for (let ch = 0; ch < 3; ch++) fill[i * 3 + ch] = acc[ch] / wsum + (gv >= 0 ? (rgb[gv * 3 + ch] - lo[ch][gv]) * 0.6 : 0);
  }
  const hf = new Float32Array(N); for (let i = 0; i < N; i++) hf[i] = hole[i] && !damaged[i] ? 1 : 0;
  const soft = blur(hf, W, H, 0.9);
  // smooth the fill itself a little so neighbouring pixels that looked in different directions do not stripe
  const fs2 = [0, 1, 2].map(ch => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = fill[i * 3 + ch]; return blurMasked(a, hf, W, H, 1.1); });
  for (let i = 0; i < N; i++) {
    if (!cwId[i] || soft[i] < 0.02) continue;
    const a = hole[i] && !damaged[i] ? Math.max(soft[i], 0.85) : Math.min(soft[i], an.cls[i] === CLS.BG || an.cls[i] === CLS.NOISE ? 0.6 : 0);
    if (a <= 0) continue;
    for (let ch = 0; ch < 3; ch++) { const f = hole[i] && !damaged[i] ? fs2[ch][i] * 0.6 + fill[i * 3 + ch] * 0.4 : fs2[ch][i]; out[i * 3 + ch] = clamp(rgb[i * 3 + ch] * (1 - a) + f * a); }
  }
  { const Lo = luma(out), Lv = luma(rgb), tgt = blurMasked(Lv, valid, W, H, 9), cur = blur(Lo, W, H, 3), cov = blur(valid, W, H, 9);
    for (let i = 0; i < N; i++) { if (!hole[i] || damaged[i] || cov[i] < 0.05) continue; const g = clamp((tgt[i] + 0.01) / (cur[i] + 0.01), 0.8, 1.25), a = soft[i]; for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] = clamp(out[i * 3 + ch] * (1 + (g - 1) * a)); } }
  let dmg = 0; for (let i = 0; i < N; i++) dmg += damaged[i];
  return { plate: out, hole, damagedPx: dmg };
}

// ---------- night photos: the carriageways are the empty master plate, relit by the local night/day gain ----------
function relitRoad(rgb, plate) {
  const T = new Float32Array(N); for (let i = 0; i < N; i++) T[i] = LIVE.cwId[i] || CLEAN.cwId[i] ? 1 : 0;
  const Ts = blur(T, W, H, 1.6), L = luma(rgb), Lp = luma(plate), keep = new Float32Array(N), out = Float32Array.from(rgb);
  for (let i = 0; i < N; i++) keep[i] = (1 - smoothstep(0.02, 0.3, Ts[i])) * (L[i] < 0.6 ? 1 : 0.1) * (1 - vegM[i]) + 1e-5;
  const gl = blurMasked(L, keep, W, H, 22), gp = blurMasked(Lp, keep, W, H, 22);
  // inside the carriageway the photo itself tells how bright the road is (lamp pools): take its low frequencies, the plate's detail
  const inside = new Float32Array(N); for (let i = 0; i < N; i++) inside[i] = (LIVE.cwId[i] || CLEAN.cwId[i]) && L[i] < 0.75 ? 1 : 1e-5;
  const lowN = [0, 1, 2].map(ch => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = rgb[i * 3 + ch]; return blurMasked(a, inside, W, H, 7); });
  const lowP = blurMasked(Lp, inside, W, H, 7);
  for (let i = 0; i < N; i++) {
    const a = smoothstep(0.35, 0.8, Ts[i]); if (a <= 0) continue;
    const detail = clamp((Lp[i] + 0.02) / (lowP[i] + 0.02), 0.6, 1.5), gain = clamp((gl[i] + 0.004) / (gp[i] + 0.02), 0, 2.5);
    for (let ch = 0; ch < 3; ch++) { const v = lowN[ch][i] * detail * 0.75 + plate[i * 3 + ch] * gain * 0.25; out[i * 3 + ch] = clamp(rgb[i * 3 + ch] * (1 - a) + v * a); }
  }
  return out;
}

// ---------- run over the photographs ----------
// Two strict masks: 'base' = asphalt in every day photo except the autumn one, 'all' = asphalt in every day photo.
// (The autumn photo redrew the kerb of the outbound carriageway a few pixels to the side; lanes that are not asphalt there are switched off in autumn.)
ensureDir(path.join(WORK, 'plates'));
const AUTUMN_FAMILY = ['autumn'];
const plates = {}, stats = {}, strictBase = new Uint8Array(N).fill(1), strictAll = new Uint8Array(N).fill(1), sprites = [], analyses = {};
for (const id of DAY) {
  if (!fs.existsSync(P(id))) continue;
  const skip = UNTOUCHED[id] || [];
  let rgb = await loadRGB(P(id)), an = analyse(rgb, skip), first = an, damagedPx = 0;
  for (let pass = 0; pass < 3; pass++) { const r = inpaint(rgb, an); rgb = r.plate; damagedPx = r.damagedPx; an = analyse(rgb, skip); if (!an.comps.some(c => c.kind === CLS.CAR)) break; }
  // second pass, clean-only zones: remove their baked cars from the plate; no vetoes, no stats in the live totals
  const cleanStats = {};
  if (CLEAN.cws.length) {
    use(CLEAN); const cskip = UNTOUCHED[id] || [];
    let ca = analyse(rgb, cskip); const cfirst = ca;
    for (let pass = 0; pass < 3; pass++) { if (!ca.comps.some(c => c.kind === CLS.CAR)) break; const r = inpaint(rgb, ca); rgb = r.plate; ca = analyse(rgb, cskip); }
    for (const c of CLEAN.cws) cleanStats[c.id] = { baked: cfirst.comps.filter(q => q.kind === CLS.CAR && q.cw === c.id).reduce((t, q) => t + q.cars, 0), remaining: ca.comps.filter(q => q.kind === CLS.CAR && q.cw === c.id).reduce((t, q) => t + q.cars, 0), untouched: cskip.includes(c.id) };
    use(LIVE);
  }
  plates[id] = rgb; analyses[id] = first;
  const count = (a2, cw) => a2.comps.filter(c => c.kind === CLS.CAR && (!cw || c.cw === cw)).reduce((t, c) => t + c.cars, 0);
  stats[id] = { bakedCars: count(first), remainingCars: count(an), byCarriageway: Object.fromEntries(cws.map(c => [c.id, { baked: count(first, c.id), remaining: count(an, c.id) }])), staticObjects: first.comps.filter(c => c.kind === CLS.STATIC).length, damagedPx, cleanZones: cleanStats };
  // what is NOT drivable asphalt in this photo: big foreign objects, posts, crowns over the road, and whatever could not be cleaned
  let veto = 0, poly = 0; const targets = AUTUMN_FAMILY.includes(id) ? [strictAll] : [strictBase, strictAll];
  if (!MASK_FROM || MASK_FROM.includes(id)) for (let i = 0; i < N; i++) { if (!cwId[i]) continue; poly++; const k = first.cls[i], k2 = an.cls[i]; if (skip.includes(cws[cwId[i] - 1].id) || k === CLS.STATIC || k === CLS.POST || k2 === CLS.STATIC || k2 === CLS.POST || k2 === CLS.CAR) { for (const t of targets) t[i] = 0; veto++; } }
  stats[id].vetoShare = poly ? +(veto / poly).toFixed(3) : 0; stats[id].untouched = skip;
  await saveRGB(path.join(WORK, 'plates', id + '.png'), rgb);
  console.log(id.padEnd(14), 'baked cars', String(stats[id].bakedCars).padStart(3), '-> remaining', stats[id].remainingCars, '| static', stats[id].staticObjects, '| unfilled px', damagedPx, '| vetoes', stats[id].vetoShare, '| clean-only zones', Object.entries(cleanStats).map(([k, v]) => `${k} ${v.baked}->${v.remaining}${v.untouched ? ' (untouched)' : ''}`).join(', ') || '-');
}
for (const id of NIGHT) { if (!fs.existsSync(P(id)) || !plates.master) continue; plates[id] = relitRoad(await loadRGB(P(id)), plates.master); await saveRGB(path.join(WORK, 'plates', id + '.png'), plates[id]); }

// ---------- 4. strict masks ----------
function finish(strict) { // outside the carriageways nothing is road; grow vetoes by one pixel, drop the kerb row, forbid vegetation, drop islands
  const ex = new Uint8Array(N); for (let i = 0; i < N; i++) { if (!cwId[i]) strict[i] = 0; ex[i] = cwId[i] && !strict[i] ? 1 : 0; }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (!cwId[i]) continue; if (ex[i - 1] || ex[i + 1] || ex[i - W] || ex[i + W]) strict[i] = 0; if (edgeD[i] < 1.0 || vegM[i] > 0.5) strict[i] = 0; }
  const seen = new Uint8Array(N);
  for (let s0 = 0; s0 < N; s0++) { if (!strict[s0] || seen[s0]) continue; const st = [s0], px = []; seen[s0] = 1; while (st.length) { const i = st.pop(); px.push(i); for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < N && strict[j] && !seen[j]) { seen[j] = 1; st.push(j); } } if (px.length < 30) for (const i of px) strict[i] = 0; }
}
finish(strictBase); finish(strictAll);
const strict = strictBase;
const at2 = (m, x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < W && yi < H ? m[yi * W + xi] : 0; };
const maskAt = (x, y) => at2(strictBase, x, y);

// ---------- lanes: traced inside the mask (per cross-section: the widest run of asphalt), in metres on the ground ----------
function traceLanes(mask, set) {
 const lanes = [];
 for (const c of cws) {
  const lo = new Float32Array(c.M + 1), hi = new Float32Array(c.M + 1), ok = new Uint8Array(c.M + 1);
  for (let k = 0; k <= c.M; k++) {
    const wpx = c.at(k, 0.5)[2], J = Math.ceil(wpx * 2); let best = 0, ba = 0, bb = 0, run = 0, ra = 0;
    for (let j = 0; j <= J + 1; j++) { const [x, y] = c.at(k, Math.min(1, j / J)), on = j <= J && at2(mask, x, y); if (on) { if (!run) ra = j; run++; } else { if (run > best) { best = run; ba = ra; bb = j - 1; } run = 0; } }
    if (best >= 3) { ok[k] = 1; lo[k] = ba / J * wpx; hi[k] = bb / J * wpx; }
  }
  // fill hidden stretches from their neighbours, then smooth (median, then average) so lanes never jerk sideways
  const fill = a => { let last = -1; for (let k = 0; k <= c.M; k++) if (ok[k]) { if (last < 0) for (let q = 0; q < k; q++) a[q] = a[k]; else for (let q = last + 1; q < k; q++) a[q] = a[last] + (a[k] - a[last]) * (q - last) / (k - last); last = k; } if (last >= 0) for (let q = last + 1; q <= c.M; q++) a[q] = a[last]; };
  const smooth = a => { const m = new Float32Array(a.length), o = new Float32Array(a.length); for (let k = 0; k < a.length; k++) { const w = []; for (let q = Math.max(0, k - 10); q <= Math.min(a.length - 1, k + 10); q++) w.push(a[q]); w.sort((x, y) => x - y); m[k] = w[w.length >> 1]; } for (let k = 0; k < a.length; k++) { let t = 0, n = 0; for (let q = Math.max(0, k - 18); q <= Math.min(a.length - 1, k + 18); q++) { t += m[q]; n++; } o[k] = t / n; } return o; };
  if (!ok.some(v => v)) continue; // nothing drivable in this mask (the photo keeps its own pixels there)
  fill(lo); fill(hi); const sLo = smooth(lo), sHi = smooth(hi);
  const wm = []; for (let k = 0; k <= c.M; k++) if (ok[k]) wm.push((sHi[k] - sLo[k]) / ppm(c.at(k, 0.5)[1]));
  wm.sort((x, y) => x - y); const widthM = wm[Math.floor(wm.length * 0.25)] || 0, n = clamp(Math.floor(widthM / 2.6), 1, 3);
  (c.sets ||= {})[set] = { lanes: n, widthM: +widthM.toFixed(1) };
  for (let j = 0; j < n; j++) {
    const dense = []; let m = 0, prev = null;
    for (let k = 0; k <= c.M; k++) {
      const [, y0, wpx] = c.at(k, 0.5), half = 0.5 * CAR_W * ppm(y0) + 1.2, a0 = sLo[k] + half, b0 = sHi[k] - half;
      const t = b0 > a0 ? a0 + (b0 - a0) * (j + 0.5) / n : (sLo[k] + sHi[k]) / 2, [x, y] = c.at(k, clamp(t / wpx, 0, 1)), g = groundPoint(cam, x, y);
      if (prev) m += Math.hypot(g.gx - prev.gx, g.gz - prev.gz) * CAMERA_HEIGHT_M; prev = g; dense.push({ x, y, m, k, wpx: Math.max(0, b0 - a0) / n });
    }
    const pts = []; let di = 0;
    for (let sM = 0; sM <= m; sM += 1) {
      while (di + 1 < dense.length - 1 && dense[di + 1].m < sM) di++;
      const a = dense[di], b = dense[di + 1], f = clamp((sM - a.m) / (b.m - a.m + 1e-9)), x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, p = ppm(y), half = 0.5 * CAR_W * p;
      const dx = c.R[a.k][0] - c.L[a.k][0], dy = c.R[a.k][1] - c.L[a.k][1], dl = Math.hypot(dx, dy) || 1;
      const inside = at2(mask, x, y) && at2(mask, x + dx / dl * half, y + dy / dl * half) && at2(mask, x - dx / dl * half, y - dy / dl * half) ? 1 : 0;
      pts.push({ x: +x.toFixed(2), y: +y.toFixed(2), ppm: +p.toFixed(3), vis: inside, wpx: +a.wpx.toFixed(1) });
    }
    lanes.push({ id: `${c.id}-${j}`, cw: c.id, seen: c.seen, start: c.start, end: c.end, set, lengthM: pts.length - 1, signalM: c.signal ? Math.max(5, pts.length - 1 - c.signal.beforeEnd) : null, signal: c.signal || null, pts });
  }
}
 return lanes;
}
// 'base' lanes are used in spring, summer and winter; 'autumn' lanes whenever the autumn photo is on screen
const lanes = traceLanes(strictBase, 'base'), lanesAutumn = traceLanes(strictAll, 'autumn');

// ---------- validation (the build fails here if a lane is not on the asphalt) ----------
const [sky, mtn] = await loadMaskRGB(path.join(SCENE, 'masks-a.png'));
const fullD = path.join(WORK, 'masks-full', 'masks-d.png'), [, , heightN] = await loadMaskRGB(fs.existsSync(fullD) ? fullD : path.join(SCENE, 'masks-d.png'));
const PLAZA = [380, 470, 1330, 941]; // paved plaza and park, no carriageway inside
export function validate(list) {
  const errors = [];
  for (const l of list) {
    let run = 0, runStart = 0; const n = l.pts.length;
    for (let i = 0; i <= n; i++) {
      const p = l.pts[i];
      if (p && p.vis) {
        const xi = Math.round(p.x), yi = Math.round(p.y), j = yi * W + xi;
        if (sky[j] > 0.05 || mtn[j] > 0.05) errors.push(`${l.id} @${i} m touches sky/mountain`);
        if (vegM[j] > 0.35) errors.push(`${l.id} @${i} m touches vegetation`);
        if (heightN[j] > 0.45) errors.push(`${l.id} @${i} m is on an elevated object (building)`);
        if (xi > PLAZA[0] && xi < PLAZA[2] && yi > PLAZA[1]) errors.push(`${l.id} @${i} m is on the plaza`);
      }
      if (p && !p.vis) { if (!run) runStart = i; run++; continue; }
      if (run) { // a hidden run must be a declared end (far/hide/edge) or a short pass behind a post or crown
        const atStart = runStart === 0, atEnd = !p;
        if (!(atStart && l.start !== 'far') && !(atEnd && l.end !== 'far') && !(atStart || atEnd) && run > 14) errors.push(`${l.id}: ${run} m off the asphalt at ${runStart} m (not a declared hide segment)`);
        if ((atStart && l.start === 'far' && run > 25) || (atEnd && l.end === 'far' && run > 25)) errors.push(`${l.id}: far end leaves the asphalt for ${run} m`);
        run = 0;
      }
    }
    const visible = l.pts.filter(p => p.vis).length; if (visible < 40) errors.push(`${l.id} (${l.set}): only ${visible} m of visible asphalt`);
  }
  return errors;
}
const errors = [...validate(lanes), ...validate(lanesAutumn)];

// ---------- 5. sprite library: isolated baked cars with a soft alpha edge ----------
const CELL = 30;
for (const lib of LIBS) {
  const an = analyses[lib]; if (!an) continue; const rgb = await loadRGB(P(lib));
  for (const c of an.comps) {
    if (c.kind !== CLS.CAR) continue;
    const [x0, y0, x1, y1] = c.bbox, bw = x1 - x0 + 1, bh = y1 - y0 + 1, wc = c.wc;
    const rej = c.A < 0.45 * wc * wc ? 'small' : c.A > 2.6 * wc * wc ? 'large' : bw > 2.6 * wc || bh > 2.6 * wc ? 'bbox' : bw < 0.6 * wc ? 'narrow' : bw + 8 > CELL || bh + 8 > CELL ? 'cell' : null;
    if (process.env.SPRITE_DEBUG && lib === 'master') console.log('comp', c.cw, 'A/wc2', (c.A / wc / wc).toFixed(2), 'bw/wc', (bw / wc).toFixed(2), 'bh/wc', (bh / wc).toFixed(2), 'wc', wc.toFixed(1), rej || 'size-ok');
    if (rej) continue;
    // isolation: a ring around the car must be clean road
    const inC = new Uint8Array((bw + 10) * (bh + 10)); for (const i of c.px) inC[((i / W | 0) - y0 + 5) * (bw + 10) + (i % W) - x0 + 5] = 1;
    let ring = 0, bad = 0; for (let y = y0 - 3; y <= y1 + 3; y++) for (let x = x0 - 3; x <= x1 + 3; x++) { if (x < 0 || y < 0 || x >= W || y >= H) { bad++; ring++; continue; } const i = y * W + x; if (inC[(y - y0 + 5) * (bw + 10) + x - x0 + 5]) continue; ring++; if (!cwId[i] || (an.cls[i] !== CLS.BG && an.cls[i] !== CLS.NOISE && an.cls[i] !== CLS.MARK)) bad++; }
    if (process.env.SPRITE_DEBUG && lib === 'master') console.log('   ring bad', (bad / ring).toFixed(2));
    if (bad / ring > 0.5) continue;
    sprites.push({ lib, cw: c.cw, comp: c, rgb, plate: plates[lib], x0: x0 - 4, y0: y0 - 4, w: bw + 8, h: bh + 8, ppm: ppm((y0 + y1) / 2), lum: c.lum });
  }
}
// Difference matte: a sprite is everything in which the photograph differs from its own empty plate, near the detected blob.
// So the whole car comes along (body, glass, highlights, its shadow on the asphalt), with the photograph's own soft edge.
const spriteMeta = [];
for (const s of sprites) {
  const near = new Float32Array(s.w * s.h); for (const i of s.comp.px) near[((i / W | 0) - s.y0) * s.w + (i % W) - s.x0] = 1;
  const reach = blur(near, s.w, s.h, 2.2), al = new Float32Array(s.w * s.h); let sum = 0, sx = 0, sl = 0, minx = s.w, maxx = 0, miny = s.h, maxy = 0;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const X = s.x0 + x, Y = s.y0 + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const i = (Y * W + X) * 3, dr = s.rgb[i] - s.plate[i], dg = s.rgb[i + 1] - s.plate[i + 1], db = s.rgb[i + 2] - s.plate[i + 2], dl = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
    const d = Math.max(Math.abs(dl), Math.abs(dr - dl), Math.abs(dg - dl), Math.abs(db - dl)), a = smoothstep(0.022, 0.085, d) * smoothstep(0.04, 0.3, reach[y * s.w + x]);
    al[y * s.w + x] = a; if (a > 0.3) { sum += a; sx += x * a; sl += a * (0.2126 * s.rgb[i] + 0.7152 * s.rgb[i + 1] + 0.0722 * s.rgb[i + 2]); if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  }
  const wc = s.comp.wc; if (sum < 0.5 * wc * wc || maxx - minx + 1 < 0.6 * wc) continue;   // a fragment, not a car
  s.al = al; s.cx = sx / sum; s.lumA = sl / sum; s.box = [minx, miny, maxx, maxy]; s.area = sum; spriteMeta.push(s);
}
const cols = 16, rows = Math.max(1, Math.ceil((spriteMeta.length + 1) / cols)), AW = cols * CELL, AH = rows * CELL, atlas = Buffer.alloc(AW * AH * 4);
{ // cell 0: a soft blob for contact shadows
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) { const dx = (x + .5 - CELL / 2) / (CELL / 2 - 2), dy = (y + .5 - CELL / 2) / (CELL / 2 - 2), a = Math.exp(-(dx * dx + dy * dy) * 3.2); const o = (y * AW + x) * 4; atlas[o] = atlas[o + 1] = atlas[o + 2] = 255; atlas[o + 3] = Math.round(clamp(a - 0.04) * 255); }
}
for (let si = 0; si < spriteMeta.length; si++) {
  const s = spriteMeta[si], cell = si + 1, ox = (cell % cols) * CELL + ((CELL - s.w) >> 1), oy = Math.floor(cell / cols) * CELL + ((CELL - s.h) >> 1), al = s.al;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const o = ((oy + y) * AW + ox + x) * 4;
    // colour: the photograph's own pixel; where the matte is empty, the nearest car pixel (filtering then never pulls in road or black)
    let px = x, py = y; if (al[y * s.w + x] < 0.3) { let best = 1e9; for (let yy = Math.max(0, y - 3); yy <= Math.min(s.h - 1, y + 3); yy++) for (let xx = Math.max(0, x - 3); xx <= Math.min(s.w - 1, x + 3); xx++) if (al[yy * s.w + xx] >= 0.3) { const d = (xx - x) ** 2 + (yy - y) ** 2; if (d < best) { best = d; px = xx; py = yy; } } }
    const i = (clamp(s.y0 + py, 0, H - 1) * W + clamp(s.x0 + px, 0, W - 1)) * 3; atlas[o] = Math.round(s.rgb[i] * 255); atlas[o + 1] = Math.round(s.rgb[i + 1] * 255); atlas[o + 2] = Math.round(s.rgb[i + 2] * 255); atlas[o + 3] = Math.round(al[y * s.w + x] * 255);
  }
  const [bx0, by0, bx1, by1] = s.box, hcar = by1 - by0 + 1;
  spriteMeta[si] = { lib: s.lib, cw: s.cw, u: ox, v: oy, w: s.w, h: s.h, ax: +s.cx.toFixed(1), ay: +(by1 - 0.3 * hcar).toFixed(1), ppm: +s.ppm.toFixed(3), lum: +s.lumA.toFixed(3), wm: +((bx1 - bx0 + 1) / s.ppm).toFixed(2), big: s.area > 1.9 * s.comp.wc * s.comp.wc };
}

// ---------- write ----------
ensureDir(SCENE);
const roadBuf = Buffer.alloc(N * 3); for (let i = 0; i < N; i++) { roadBuf[i * 3] = strictBase[i] ? 255 : 0; roadBuf[i * 3 + 1] = strictAll[i] ? 255 : 0; }
await sharp(roadBuf, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(SCENE, 'road.png'));
await sharp(atlas, { raw: { width: AW, height: AH, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(SCENE, 'cars.png'));
const rects = cws.map(c => [c.bbox[0] - 4, c.bbox[1] - 4, c.bbox[2] - c.bbox[0] + 9, c.bbox[3] - c.bbox[1] + 9]);
const traffic = {
  note: 'Generated by tools/build-traffic.mjs from the photographs. Lanes are sampled every metre on the ground.',
  cameraHeightM: CAMERA_HEIGHT_M, cell: CELL, atlas: [AW, AH], rects,
  carriageways: [...CLEAN.cws.map(c => ({ id: c.id, cleanOnly: true, sets: {}, bakedCars: stats.master?.cleanZones?.[c.id]?.baked ?? 0, polygon: [...c.L.filter((_, k) => k % 6 === 0), ...c.R.filter((_, k) => k % 6 === 0).reverse()].map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]) }))].concat(cws.map(c => ({ id: c.id, cleanOnly: false, seen: c.seen, start: c.start, end: c.end, sets: c.sets, bakedCars: stats.master?.byCarriageway[c.id].baked ?? 0, polygon: [...c.L.filter((_, k) => k % 6 === 0), ...c.R.filter((_, k) => k % 6 === 0).reverse()].map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]) }))),
  lanes: [...lanes, ...lanesAutumn].map(l => ({ ...l, pts: l.pts.map(p => [p.x, p.y, p.ppm, p.vis]) })),
  sprites: spriteMeta, stats,
};
fs.writeFileSync(path.join(SCENE, 'traffic.json'), JSON.stringify(traffic));
fs.writeFileSync(path.join(WORK, 'traffic-stats.json'), JSON.stringify({ stats, lanes: [...lanes, ...lanesAutumn].map(l => ({ id: l.id, set: l.set, lengthM: l.lengthM, visibleM: l.pts.filter(p => p.vis).length })), sprites: Object.fromEntries(LIBS.map(l => [l, spriteMeta.filter(s => s.lib === l).length])), errors }, null, 2));
if (!NO_ENCODE) {
  const PH = path.join(SCENE, 'photos');
  for (const [id, rgb] of Object.entries(plates)) { const buf = rgbToBuffer(rgb), raw = { raw: { width: W, height: H, channels: 3 } }; await sharp(buf, raw).avif({ quality: 64, effort: 6, chromaSubsampling: '4:4:4' }).toFile(path.join(PH, id + '.avif')); await sharp(buf, raw).webp({ quality: 86, effort: 5, smartSubsample: true }).toFile(path.join(PH, id + '.webp')); }
}
for (const [n, list] of [['base', lanes], ['autumn', lanesAutumn]]) console.log(`lanes (${n}):`, list.map(l => `${l.id} ${l.lengthM} m (${l.pts.filter(p => p.vis).length} visible)`).join(' | '));
console.log('sprites:', spriteMeta.length, Object.fromEntries(LIBS.map(l => [l, spriteMeta.filter(s => s.lib === l).length])), '| road px', strictBase.reduce((t, v) => t + v, 0), '(autumn-safe', strictAll.reduce((t, v) => t + v, 0) + ')');

// ---------- debug sheets: original | empty plate | mask + lanes, 4x ----------
if (DEBUG) {
  const id = process.argv[process.argv.indexOf('--debug') + 1] && !process.argv[process.argv.indexOf('--debug') + 1].startsWith('--') ? process.argv[process.argv.indexOf('--debug') + 1] : 'master';
  const src = await loadRGB(P(id)), an = analyses[id] || analyses.master, Z = 4, dbgLanes = AUTUMN_FAMILY.includes(id) ? lanesAutumn : lanes, dbgMask = AUTUMN_FAMILY.includes(id) ? strictAll : strictBase;
  for (const [name, x0, y0, w, h] of [['L', 214, 440, 130, 130]]) {
    const tile = async (rgb, overlay) => {
      const buf = Buffer.alloc(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y0 + y) * W + x0 + x, o = (y * w + x) * 3; let r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
        if (overlay) { const k = an.cls[i]; if (!cwId[i]) { r *= .45; g *= .45; b *= .45; } else if (!dbgMask[i]) { r = r * .5 + .5; g *= .5; b *= .5; } if (k === CLS.CAR) { g = g * .5 + .5; } else if (k === CLS.STATIC) { r = r * .4 + .6; b = b * .4 + .6; } else if (k === CLS.POST) { b = b * .3 + .7; } }
        buf[o] = clamp(r) * 255; buf[o + 1] = clamp(g) * 255; buf[o + 2] = clamp(b) * 255; }
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * Z}" height="${h * Z}">`;
      if (overlay) for (const l of dbgLanes) { let d = '', dh = ''; l.pts.forEach((p, i) => { const X = (p.x - x0) * Z, Y = (p.y - y0) * Z; if (X < -20 || Y < -20 || X > w * Z + 20 || Y > h * Z + 20) return; if (p.vis) d += `M${X.toFixed(1)} ${Y.toFixed(1)}h.1`; else dh += `M${X.toFixed(1)} ${Y.toFixed(1)}h.1`; if (i % 25 === 12 && p.vis) { const q = l.pts[Math.min(l.pts.length - 1, i + 3)]; const a = Math.atan2(q.y - p.y, q.x - p.x); svg += `<path d="M${X} ${Y}l${-7 * Math.cos(a - .5)} ${-7 * Math.sin(a - .5)}M${X} ${Y}l${-7 * Math.cos(a + .5)} ${-7 * Math.sin(a + .5)}" stroke="#ff0" stroke-width="1.6" fill="none"/>`; } }); svg += `<path d="${d}" stroke="#ff0" stroke-width="2" stroke-linecap="round"/><path d="${dh}" stroke="#f33" stroke-width="2" stroke-linecap="round"/>`; if (l.signalM != null) { const p = l.pts[l.signalM]; svg += `<circle cx="${(p.x - x0) * Z}" cy="${(p.y - y0) * Z}" r="4" fill="#0f0" stroke="#000"/>`; } }
      for (let gx = Math.ceil(x0 / 10) * 10; gx < x0 + w; gx += 10) svg += `<text x="${(gx - x0) * Z + 1}" y="9" font-size="9" fill="#ff0" stroke="#000" stroke-width="2" paint-order="stroke" font-family="Arial">${gx}</text>`;
      for (let gy = Math.ceil(y0 / 10) * 10; gy < y0 + h; gy += 10) svg += `<text x="1" y="${(gy - y0) * Z + 3}" font-size="9" fill="#0ff" stroke="#000" stroke-width="2" paint-order="stroke" font-family="Arial">${gy}</text>`;
      svg += '</svg>';
      return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).resize(w * Z, h * Z, { kernel: 'cubic' }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
    };
    const a = await tile(src, false), b = await tile(plates[id] || src, false), c = await tile(src, true);
    await sharp({ create: { width: w * Z * 3 + 8, height: h * Z, channels: 3, background: '#000' } }).composite([{ input: a, left: 0, top: 0 }, { input: b, left: w * Z + 4, top: 0 }, { input: c, left: 2 * w * Z + 8, top: 0 }]).png().toFile(path.join(WORK, `traffic-debug-${name}-${id}.png`));
  }
}
if (errors.length) { console.error('\nLANE VALIDATION FAILED:\n' + errors.slice(0, 20).join('\n')); process.exit(1); }
console.log('lane validation passed');
