// Alignment audit: every variant vs the master photo.
//  1) global shift by phase correlation on lighting-invariant structure images
//  2) local check on 6 named anchors (ZNCC search)
//  3) dense grid of local shifts -> smooth displacement field (used by process-variants when drift > 2 px)
// Output: assets/source/work/alignment.json + docs/ALIGNMENT.md
import path from 'node:path';
import fs from 'node:fs';
import { W, H, SRC, WORK, ROOT, loadRGB, luma, blur, variantFiles, ensureDir } from './lib/img.mjs';

const ANCHORS = [
  { id: 'vitosha-ridge', name: 'Билото на Витоша', x: 742, y: 216 },
  { id: 'tv-tower', name: 'ТВ кулата (Копитото)', x: 1015, y: 192 },
  { id: 'glass-tower-top', name: 'Връх на стъклената кула', x: 1272, y: 256 },
  { id: 'ndk-emblem', name: 'Слънчевият диск на НДК', x: 800, y: 502 },
  { id: 'fountain-upper', name: 'Горен басейн на фонтана', x: 862, y: 716 },
  { id: 'fountain-lower', name: 'Долен басейн на фонтана', x: 926, y: 852 },
];

/** Structure image: local-contrast-normalised log-luminance. Robust to day/night relighting. */
export function structure(rgb) {
  const n = W * H, l = luma(rgb), lg = new Float32Array(n);
  for (let i = 0; i < n; i++) lg[i] = Math.log(l[i] + 0.02);
  const m = blur(lg, W, H, 6), d = new Float32Array(n), d2 = new Float32Array(n);
  for (let i = 0; i < n; i++) { d[i] = lg[i] - m[i]; d2[i] = d[i] * d[i]; }
  const v = blur(d2, W, H, 12);
  for (let i = 0; i < n; i++) d[i] = d[i] / Math.sqrt(v[i] + 0.004);
  return d;
}

// ---- radix-2 FFT (in place, complex arrays re/im) ----
function fft1(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function fft2(re, im, w, h, inv) {
  const rr = new Float64Array(w), ri = new Float64Array(w);
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) { rr[x] = re[y * w + x]; ri[x] = im[y * w + x]; } fft1(rr, ri, inv); for (let x = 0; x < w; x++) { re[y * w + x] = rr[x]; im[y * w + x] = ri[x]; } }
  const cr = new Float64Array(h), ci = new Float64Array(h);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) { cr[y] = re[y * w + x]; ci[y] = im[y * w + x]; } fft1(cr, ci, inv); for (let y = 0; y < h; y++) { re[y * w + x] = cr[y]; im[y * w + x] = ci[y]; } }
}
/** Phase correlation of two structure images. Returns the shift (dx,dy) of b relative to a, in px. */
export function phaseCorrelate(a, b) {
  const FW = 2048, FH = 1024, n = FW * FH;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  for (let y = 0; y < H; y++) { const wy = 0.5 - 0.5 * Math.cos(2 * Math.PI * y / (H - 1)); for (let x = 0; x < W; x++) { const wx = 0.5 - 0.5 * Math.cos(2 * Math.PI * x / (W - 1)), k = wx * wy; ar[y * FW + x] = a[y * W + x] * k; br[y * FW + x] = b[y * W + x] * k; } }
  fft2(ar, ai, FW, FH, false); fft2(br, bi, FW, FH, false);
  for (let i = 0; i < n; i++) { // cross-power spectrum conj(A)*B, normalised
    const r = ar[i] * br[i] + ai[i] * bi[i], im = ar[i] * bi[i] - ai[i] * br[i], m = Math.hypot(r, im) + 1e-9;
    ar[i] = r / m; ai[i] = im / m;
  }
  fft2(ar, ai, FW, FH, true);
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const v = ar[y * FW + x]; if (v > best) { best = v; bx = x; by = y; } }
  const at = (x, y) => ar[((y + FH) % FH) * FW + ((x + FW) % FW)];
  const sub = (m, c, p) => { const d = m - 2 * c + p; return Math.abs(d) < 1e-12 ? 0 : 0.5 * (m - p) / d; };
  let dx = bx + sub(at(bx - 1, by), best, at(bx + 1, by)), dy = by + sub(at(bx, by - 1), best, at(bx, by + 1));
  if (dx > FW / 2) dx -= FW; if (dy > FH / 2) dy -= FH;
  return { dx, dy, peak: best };
}
/** ZNCC patch search: where does the master patch centred at (cx,cy) sit in the variant? */
export function localShift(a, b, cx, cy, half = 40, search = 8) {
  const x0 = Math.round(cx) - half, y0 = Math.round(cy) - half, s = half * 2;
  if (x0 - search < 0 || y0 - search < 0 || x0 + s + search >= W || y0 + s + search >= H) return null;
  let ma = 0, va = 0; for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) ma += a[(y0 + y) * W + x0 + x];
  ma /= s * s; for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const d = a[(y0 + y) * W + x0 + x] - ma; va += d * d; }
  const sc = new Float32Array((2 * search + 1) ** 2); let best = -2, bdx = 0, bdy = 0;
  for (let dy = -search; dy <= search; dy++) for (let dx = -search; dx <= search; dx++) {
    let mb = 0; for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) mb += b[(y0 + y + dy) * W + x0 + x + dx];
    mb /= s * s; let vb = 0, cc = 0;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const da = a[(y0 + y) * W + x0 + x] - ma, db = b[(y0 + y + dy) * W + x0 + x + dx] - mb; cc += da * db; vb += db * db; }
    const z = cc / Math.sqrt(va * vb + 1e-9); sc[(dy + search) * (2 * search + 1) + dx + search] = z;
    if (z > best) { best = z; bdx = dx; bdy = dy; }
  }
  const g = (dx, dy) => (Math.abs(dx) > search || Math.abs(dy) > search) ? best - 0.01 : sc[(dy + search) * (2 * search + 1) + dx + search];
  const sub = (m, c, p) => { const d = m - 2 * c + p; return Math.abs(d) < 1e-9 ? 0 : Math.max(-.5, Math.min(.5, 0.5 * (m - p) / d)); };
  return { dx: bdx + sub(g(bdx - 1, bdy), best, g(bdx + 1, bdy)), dy: bdy + sub(g(bdx, bdy - 1), best, g(bdx, bdy + 1)), score: best };
}

export async function analyse() {
  const master = structure(await loadRGB(path.join(SRC, 'ndk-photo.png')));
  const out = { anchors: ANCHORS, variants: {} };
  for (const f of variantFiles()) {
    const id = f.replace(/\.png$/i, '');
    const s = structure(await loadRGB(path.join(SRC, 'variants', f)));
    const g = phaseCorrelate(master, s);
    const anchors = ANCHORS.map(a => { const r = localShift(master, s, a.x, a.y, 40, 8); return { id: a.id, ...(r || { dx: 0, dy: 0, score: 0 }) }; });
    // dense grid (cell 64px) for local drift + displacement field
    const grid = []; const GX = 26, GY = 14;
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
      const cx = 36 + i * (W - 72) / (GX - 1), cy = 36 + j * (H - 72) / (GY - 1);
      const r = localShift(master, s, cx, cy, 28, 6);
      grid.push(r ? { x: cx, y: cy, ...r } : { x: cx, y: cy, dx: 0, dy: 0, score: 0 });
    }
    const conf = grid.filter(c => c.score > 0.55);
    const mags = conf.map(c => Math.hypot(c.dx, c.dy)).sort((a, b) => a - b);
    const med = mags.length ? mags[mags.length >> 1] : 0, p95 = mags.length ? mags[Math.floor(mags.length * .95)] : 0;
    const good = anchors.filter(a => a.score > 0.45);
    const maxAnchor = good.length ? Math.max(...good.map(a => Math.hypot(a.dx, a.dy))) : 0;
    out.variants[id] = { global: g, anchors, grid: { gx: GX, gy: GY, cells: grid.map(c => [+c.dx.toFixed(2), +c.dy.toFixed(2), +c.score.toFixed(2)]) }, confidentCells: conf.length, medianLocal: med, p95Local: p95, maxAnchor };
    console.log(id.padEnd(18), `global ${g.dx.toFixed(2)},${g.dy.toFixed(2)} (peak ${g.peak.toFixed(3)})  local median ${med.toFixed(2)} p95 ${p95.toFixed(2)} (${conf.length} cells)  anchors max ${maxAnchor.toFixed(2)}`);
    console.log('   ', anchors.map(a => `${a.id}:${a.dx.toFixed(1)},${a.dy.toFixed(1)}@${a.score.toFixed(2)}`).join('  '));
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('align.mjs')) {
  const res = await analyse();
  ensureDir(WORK); fs.writeFileSync(path.join(WORK, 'alignment.json'), JSON.stringify(res));
  let md = '# Подравняване на вариантите спрямо ndk-photo.png\n\nМетод: фазова корелация върху структурни изображения (локално нормализиран лог-луминанс, инвариантен към осветлението) за глобалното отместване; ZNCC търсене ±8 px върху 6 котви; гъста мрежа 26×14 от локални отмествания за локален дрейф. Вариантите с ширина 1671 px са преоразмерени до 1672 px преди измерването.\n\n';
  md += '| Вариант | Глобално dx, dy (px) | Локална медиана (px) | Локален p95 (px) | Макс. при котвите (px) | Решение |\n|---|---|---|---|---|---|\n';
  for (const [id, v] of Object.entries(res.variants)) {
    const gmag = Math.hypot(v.global.dx, v.global.dy);
    const verdict = (gmag <= 2 && v.medianLocal <= 2 && v.maxAnchor <= 2) ? (gmag > 0.25 ? 'приет; глобалното подпикселно отместване се коригира при обработката' : 'приет без корекция') : (v.medianLocal <= 6 ? 'приет с изглаждащо поле на отместване (warp)' : 'изключен');
    v.verdict = verdict;
    md += `| ${id} | ${v.global.dx.toFixed(2)}, ${v.global.dy.toFixed(2)} | ${v.medianLocal.toFixed(2)} | ${v.p95Local.toFixed(2)} | ${v.maxAnchor.toFixed(2)} | ${verdict} |\n`;
  }
  md += '\n## Котви (dx, dy @ увереност ZNCC)\n\n| Вариант | ' + ANCHORS.map(a => a.name).join(' | ') + ' |\n|---|' + ANCHORS.map(() => '---').join('|') + '|\n';
  for (const [id, v] of Object.entries(res.variants)) md += `| ${id} | ` + v.anchors.map(a => a.score > 0.45 ? `${a.dx.toFixed(1)}, ${a.dy.toFixed(1)} @${a.score.toFixed(2)}` : `скрита/променена (@${a.score.toFixed(2)})`).join(' | ') + ' |\n';
  md += '\nКотва с увереност под 0.45 означава, че мястото е скрито или прерисувано в този вариант (напр. билото в мъглата), а не че е отместено.\n';
  fs.writeFileSync(path.join(WORK, 'alignment.json'), JSON.stringify(res));
  ensureDir(path.join(ROOT, 'docs')); fs.writeFileSync(path.join(ROOT, 'docs', 'ALIGNMENT.md'), md);
  console.log('written docs/ALIGNMENT.md');
}
