// Builds calibrated depth, normals and region masks from the master photo + Depth Anything output.
// Outputs (web assets, PNG) in public/scenes/ndk/:
//   masks-a.png  R sky        G mountain   B vegetation (all)
//   masks-b.png  R water      G trees(sway) B paved ground (plaza + roads, wettable)
//   masks-c.png  R buildings  G roads       B glass
//   masks-d.png  R baked sun shadow (master)  G ground (non-elevated)  B height above ground (0..1 = 0..64 px)
//   geo.png      R normal.x   G normal.y    B calibrated inverse depth (0 far .. 1 = ground at bottom edge)
//   depth16.png  16-bit calibrated inverse depth (archival / future scenes)
import path from 'node:path';
import fs from 'node:fs';
import { W, H, SRC, WORK, SCENE, loadRGB, loadGray16, saveGray16, luma, blur, blurMasked, guided, saveMaskRGB, fillPoly, polylineDist, rgb2hsv, smoothstep, clamp, loadMaskRGB, ensureDir, box } from './lib/img.mjs';
import { CAMERA, LANES, BASINS, GLASS_BOXES, NDK_BOX } from './scene-geometry.mjs';

const N = W * H;
const master = await loadRGB(path.join(SRC, 'ndk-photo.png'));
const lum = luma(master);
const d = await loadGray16(path.join(WORK, 'depth-raw16.png'));

// ---------- 1. calibrate depth against the ground plane ----------
// Ground is planar => true inverse depth is linear in the image row. Map every raw depth to the row at which the ground has that depth.
const Y0 = 346, groundD = new Float32Array(H);
for (let y = Y0; y < H; y++) { const row = Array.from(d.subarray(y * W, y * W + W)).sort((a, b) => a - b); groundD[y] = row[Math.floor(W * 0.05)]; }
for (let y = Y0 + 1; y < H; y++) groundD[y] = Math.max(groundD[y], groundD[y - 1] + 1e-6); // monotone
const rowOf = v => { // inverse lookup: raw depth -> equivalent ground row (may exceed H for things nearer than the bottom edge)
  if (v <= groundD[Y0]) return CAMERA.horizonY + (Y0 - CAMERA.horizonY) * clamp(v / groundD[Y0]);
  if (v >= groundD[H - 1]) return H - 1 + (v - groundD[H - 1]) / ((groundD[H - 1] - groundD[H - 60]) / 59);
  let lo = Y0, hi = H - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (groundD[m] < v) lo = m; else hi = m; }
  return lo + (v - groundD[lo]) / (groundD[hi] - groundD[lo] + 1e-9);
};
const eq = new Float32Array(N), inv = new Float32Array(N), hpx = new Float32Array(N);
for (let i = 0; i < N; i++) { eq[i] = rowOf(d[i]); inv[i] = (eq[i] - CAMERA.horizonY) / (H - CAMERA.horizonY); }
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) hpx[y * W + x] = Math.max(0, eq[y * W + x] - y); // px the object base sits below this pixel

// ---------- 2. sky ----------
// Depth alone loses the hazy left end of Vitosha, so the skyline is traced as a seam: per column the strongest
// sky->land luminance edge that is consistent across several aligned variants, joined by dynamic programming.
const edgeSrc = ['ndk-photo.png', 'variants/autumn.png', 'variants/dawn-golden.png', 'variants/dawn-bluehour.png', 'variants/night.png', 'variants/winter-snow.png'].filter(f => fs.existsSync(path.join(SRC, f)));
const YA = 150, YB = 348, BH = YB - YA, E = new Float32Array(W * BH);
for (const f of edgeSrc) {
  const l = blur(luma(await loadRGB(path.join(SRC, f))), W, H, 1.2), e = new Float32Array(W * BH); let mx = 1e-6;
  for (let y = YA; y < YB; y++) for (let x = 0; x < W; x++) { const v = Math.max(0, Math.log(l[(y - 3) * W + x] + .03) - Math.log(l[(y + 3) * W + x] + .03)); e[(y - YA) * W + x] = v; }
  const srt = Array.from(e).sort((p, q) => p - q); mx = srt[Math.floor(srt.length * .995)] || 1;
  for (let i = 0; i < e.length; i++) E[i] += Math.min(1, e[i] / mx) / edgeSrc.length;
}
// prior from depth: the seam must not run below clearly non-sky depth, nor far above it where depth is confident
for (let y = YA; y < YB; y++) for (let x = 0; x < W; x++) { if (d[y * W + x] > 0.012 && d[(y - 4) * W + x] > 0.012) E[(y - YA) * W + x] *= 0.15; }
const cost = new Float32Array(W * BH), from = new Int16Array(W * BH), LAM = 0.06, STEP = 3;
for (let y = 0; y < BH; y++) cost[y * W] = -E[y * W];
for (let x = 1; x < W; x++) for (let y = 0; y < BH; y++) {
  let best = 1e9, by = y;
  for (let k = -STEP; k <= STEP; k++) { const yy = y + k; if (yy < 0 || yy >= BH) continue; const c = cost[yy * W + x - 1] + LAM * Math.abs(k); if (c < best) { best = c; by = yy; } }
  cost[y * W + x] = best - E[y * W + x]; from[y * W + x] = by;
}
const seam = new Float32Array(W); { let y = 0, best = 1e9; for (let yy = 0; yy < BH; yy++) if (cost[yy * W + W - 1] < best) { best = cost[yy * W + W - 1]; y = yy; } for (let x = W - 1; x >= 0; x--) { seam[x] = y + YA; y = from[y * W + x]; } }
const sky0 = new Float32Array(N);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { const i = y * W + x; sky0[i] = y < seam[x] - 0.5 ? 1 : 0; }
// structures rising above the seam (TV tower, tower tops): depth says solid, or colour differs from the local sky
const skyCol = [0, 1, 2].map(c => { const ch = new Float32Array(N); for (let i = 0; i < N; i++) ch[i] = master[i * 3 + c]; return blurMasked(ch, sky0, W, H, 10); });
const sky1 = new Float32Array(N);
for (let x = 0; x < W; x++) for (let y = 0; y < Math.min(H, seam[x] + 2); y++) {
  const i = y * W + x; if (!sky0[i]) continue;
  let v = 1;
  if (y > seam[x] - 30) { const ls = .2126 * skyCol[0][i] + .7152 * skyCol[1][i] + .0722 * skyCol[2][i]; const darker = smoothstep(0.05, 0.13, ls - lum[i]); v = 1 - Math.max(darker, smoothstep(0.012, 0.02, d[i])); }
  sky1[i] = v;
}
const sky = guided(lum, sky1, W, H, 2, 3e-4);
for (let i = 0; i < N; i++) sky[i] = smoothstep(0.3, 0.7, sky[i]);
fs.writeFileSync(path.join(WORK, 'skyline.json'), JSON.stringify(Array.from(seam)));

// ---------- 3. mountain ----------
const lumB = blur(lum, W, H, 5);
const mtn = new Float32Array(N);
for (let x = 0; x < W; x++) for (let y = Math.floor(seam[x]) - 2; y < 352; y++) {
  const i = y * W + x, [, s, v] = rgb2hsv(master[i * 3], master[i * 3 + 1], master[i * 3 + 2]);
  const far = 1 - smoothstep(0.05, 0.075, d[i]);                // buildings in front of the mountain are much nearer
  const foot = smoothstep(346, 318, y);                          // soft foot line into the city haze
  const pale = (1 - smoothstep(0.10, 0.16, s)) * smoothstep(0.42, 0.52, v) * smoothstep(286, 300, y); // distant towers and city blocks
  const notCity = 1 - Math.max(pale, smoothstep(0.50, 0.62, lumB[i]) * smoothstep(300, 322, y));
  mtn[i] = (1 - sky[i]) * far * foot * notCity;
}
for (const [x0, y0, x1, y1] of [[244, 308, 274, 352], [124, 326, 150, 352], [538, 300, 574, 352]]) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mtn[y * W + x] = 0; // towers standing in front of the foothills
const mtnClose = blur(mtn, W, H, 3);
for (let x = 0; x < W; x++) for (let y = Math.floor(seam[x]); y < 300; y++) { const i = y * W + x; mtn[i] = Math.max(mtn[i], smoothstep(0.4, 0.7, mtnClose[i]) * (1 - sky[i]) * (1 - smoothstep(0.05, 0.075, d[i]))); }
const mtnS = blur(mtn, W, H, 1.2);

// ---------- 4. vegetation ----------
const veg0 = new Float32Array(N);
for (let y = 300; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, r = master[i * 3], g = master[i * 3 + 1], b = master[i * 3 + 2];
  const [hh, s, v] = rgb2hsv(r, g, b);
  let k = smoothstep(52, 66, hh) * (1 - smoothstep(150, 172, hh)) * smoothstep(0.16, 0.30, s);
  const dark = (1 - smoothstep(0.16, 0.3, v)) * smoothstep(60, 80, hh) * (1 - smoothstep(175, 200, hh)) * smoothstep(0.10, 0.22, s); // conifers, shaded crowns
  k = Math.max(k, dark);
  if (x > NDK_BOX[0] && x < NDK_BOX[2] && y > NDK_BOX[1] && y < 452 && hh > 135) k = 0; // copper roof of NDK is teal, not foliage
  veg0[i] = k * (1 - sky[i]) * (1 - mtnS[i]);
}
let veg = guided(lum, blur(veg0, W, H, 1.2), W, H, 3, 2e-3);
// fill small holes inside crowns (shadow gaps between leaves)
const vegWide = blur(veg, W, H, 4);
for (let i = 0; i < N; i++) veg[i] = clamp(Math.max(veg[i], smoothstep(0.55, 0.8, vegWide[i]) * 0.9));

// ---------- 5. ground / elevated ----------
const hS = blur(hpx, W, H, 2), ground = new Float32Array(N), trees = new Float32Array(N), bld = new Float32Array(N), heightN = new Float32Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, el = smoothstep(5, 16, hS[i]) * smoothstep(338, 356, y);
  ground[i] = (1 - el) * smoothstep(336, 352, y) * (1 - sky[i]);
  trees[i] = veg[i] * Math.max(el, smoothstep(0.30, 0.16, lum[i]) * 0.5);
  const cityBand = smoothstep(312, 330, y) * (1 - smoothstep(430, 470, y));
  bld[i] = (1 - veg[i]) * (1 - sky[i]) * (1 - mtnS[i]) * Math.max(el, cityBand * 0.85);
  heightN[i] = clamp(hS[i] / 64) * smoothstep(338, 356, y);
}

// ---------- 6. water ----------
const [m2r] = await loadMaskRGB(path.join(SRC, 'mock', 'M2.png'));
const basin = new Float32Array(N); for (const p of BASINS) fillPoly(p, W, H, basin);
const basinS = blur(basin, W, H, 5), water0 = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const r = master[i * 3], g = master[i * 3 + 1], b = master[i * 3 + 2], [hh, s, v] = rgb2hsv(r, g, b);
  const watery = smoothstep(0.42, 0.55, v) * (1 - smoothstep(0.42, 0.6, s)) * (hh > 90 && hh < 260 || s < 0.08 ? 1 : 0); // pale cyan / white spray
  water0[i] = smoothstep(0.2, 0.6, basinS[i]) * Math.max(watery, m2r[i] * 0.8);
}
const water = guided(lum, blur(water0, W, H, 1.5), W, H, 3, 2e-3);

// ---------- 7. roads + paved ----------
const roadD = new Float32Array(N).fill(60);
for (const l of LANES) polylineDist(l.pts, 60, W, H, roadD);
const roads = new Float32Array(N), paved = new Float32Array(N);
for (let y = 340; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, r = master[i * 3], g = master[i * 3 + 1], b = master[i * 3 + 2], [, s, v] = rgb2hsv(r, g, b);
  const scale = clamp(inv[i] * 2.4, 0.25, 1.6);                        // carriageway gets wider toward the camera
  const corridor = 1 - smoothstep(9 * scale, 15 * scale, roadD[i]);
  const asphalt = (1 - smoothstep(0.28, 0.5, s)) * smoothstep(0.08, 0.16, v);
  roads[i] = corridor * (1 - veg[i]) * Math.max(asphalt, 0.6);
  const stone = (1 - smoothstep(0.22, 0.4, s)) * smoothstep(0.2, 0.36, v);
  paved[i] = clamp(Math.max(roads[i], Math.max(ground[i], corridor) * (1 - veg[i]) * (1 - water[i]) * stone * smoothstep(400, 440, y)));
}
const roadsS = guided(lum, blur(roads, W, H, 1.2), W, H, 3, 3e-3), pavedS = guided(lum, blur(paved, W, H, 1.2), W, H, 3, 3e-3);

// ---------- 8. glass ----------
const glass0 = new Float32Array(N);
for (const { id, box: [x0, y0, x1, y1] } of GLASS_BOXES) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const i = y * W + x, r = master[i * 3], b = master[i * 3 + 2];
  const k = id === 'ndk' ? (1 - smoothstep(0.16, 0.26, lum[i])) : Math.max(smoothstep(0.02, 0.09, b - r), (1 - smoothstep(0.18, 0.3, lum[i])) * 0.8);
  glass0[i] = Math.max(glass0[i], k * (1 - veg[i]) * (1 - sky[i]));
}
const glass = guided(lum, blur(glass0, W, H, 1), W, H, 2, 2e-3);

// ---------- 9. baked sun shadows of the master ----------
// Reference without cast shadows: the blue-hour variant (same summer scene, ambient light only). Used for analysis only, never displayed here.
let shadow = new Float32Array(N);
const bhFile = path.join(SRC, 'variants', 'dawn-bluehour.png');
if (fs.existsSync(bhFile)) {
  const bh = luma(await loadRGB(bhFile));
  const a = blur(lum, W, H, 2), b = blur(bh, W, H, 2), ratio = new Float32Array(N);
  for (let i = 0; i < N; i++) ratio[i] = (a[i] + 0.01) / (b[i] + 0.03);
  // local sunlit level = high percentile approximated by dilation at low res, then blur
  const sw = Math.ceil(W / 8), sh = Math.ceil(H / 8), small = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let s = 0, c = 0; for (let yy = y * 8; yy < Math.min(H, y * 8 + 8); yy++) for (let xx = x * 8; xx < Math.min(W, x * 8 + 8); xx++) { s += ratio[yy * W + xx]; c++; } small[y * sw + x] = s / c; }
  const dil = new Float32Array(sw * sh), R = 6;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const v = []; for (let yy = Math.max(0, y - R); yy <= Math.min(sh - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(sw - 1, x + R); xx++) v.push(small[yy * sw + xx]); v.sort((p, q) => p - q); dil[y * sw + x] = v[Math.floor(v.length * 0.85)]; }
  const dilB = blur(dil, sw, sh, 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, ref = dilB[Math.min(sh - 1, y >> 3) * sw + Math.min(sw - 1, x >> 3)];
    const rel = ratio[i] / (ref + 1e-6);
    shadow[i] = (1 - smoothstep(0.42, 0.78, rel)) * (1 - sky[i]) * (1 - mtnS[i]) * smoothstep(340, 380, y) * (1 - water[i]) * (1 - glass[i]);
  }
  shadow = guided(lum, blur(shadow, W, H, 1.5), W, H, 3, 2e-3);
}

// ---------- 10. normals (world space: x right/west, y up, z toward camera/north) ----------
const f = CAMERA.focalPx, cx = W / 2, cy = H / 2, theta = Math.atan((cy - CAMERA.horizonY) / f);
const z0 = f / (Math.cos(theta) * (H - CAMERA.horizonY)); // distance to the ground at the bottom edge, in camera heights
const invS = blur(inv, W, H, 3.5), P = new Float32Array(N * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, z = z0 / Math.max(invS[i], 0.02); P[i * 3] = (x - cx) / f * z; P[i * 3 + 1] = (y - cy) / f * z; P[i * 3 + 2] = z; }
const nx = new Float32Array(N), ny = new Float32Array(N), ct = Math.cos(theta), st = Math.sin(theta);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, xl = Math.max(0, x - 2), xr = Math.min(W - 1, x + 2), yu = Math.max(0, y - 2), yd = Math.min(H - 1, y + 2);
  const a = [P[(y * W + xr) * 3] - P[(y * W + xl) * 3], P[(y * W + xr) * 3 + 1] - P[(y * W + xl) * 3 + 1], P[(y * W + xr) * 3 + 2] - P[(y * W + xl) * 3 + 2]];
  const b = [P[(yd * W + x) * 3] - P[(yu * W + x) * 3], P[(yd * W + x) * 3 + 1] - P[(yu * W + x) * 3 + 1], P[(yd * W + x) * 3 + 2] - P[(yu * W + x) * 3 + 2]];
  let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; // camera space: x right, y down, z forward; points toward camera (-z)
  const L = Math.hypot(...n) || 1; n = n.map(v => v / L); if (n[2] > 0) n = n.map(v => -v);
  // camera -> world: up = -y_cam rotated by pitch; toward camera(north) = -z_cam
  const up = -(n[1] * ct + n[2] * st), north = -(n[2] * ct - n[1] * st);
  let wx = n[0], wy = up, wz = north;
  if (sky[i] > 0.5) { wx = 0; wy = 0; wz = 1; }
  nx[i] = wx; ny[i] = wy;
}
const nxS = blur(nx, W, H, 2), nyS = blur(ny, W, H, 2);

// ---------- write ----------
ensureDir(SCENE);
await saveMaskRGB(path.join(SCENE, 'masks-a.png'), sky, mtnS, veg);
await saveMaskRGB(path.join(SCENE, 'masks-b.png'), water, trees, pavedS);
await saveMaskRGB(path.join(SCENE, 'masks-c.png'), bld, roadsS, glass);
await saveMaskRGB(path.join(SCENE, 'masks-d.png'), shadow, ground, heightN);
await saveMaskRGB(path.join(SCENE, 'geo.png'), nxS.map(v => v * .5 + .5), nyS.map(v => v * .5 + .5), inv.map(v => clamp(v / 1.25)));
await saveGray16(path.join(SCENE, 'depth16.png'), inv.map(v => clamp(v / 1.25)));
const calib = { focalPx: f, horizonY: CAMERA.horizonY, pitchRad: theta, z0CameraHeights: z0, invDepthScale: 1.25, groundRow0: Y0 };
fs.writeFileSync(path.join(WORK, 'calib.json'), JSON.stringify(calib, null, 2));
// keep CPU copies for the next tools
fs.writeFileSync(path.join(WORK, 'inv.f32'), Buffer.from(inv.buffer));
console.log('masks ok', calib);
