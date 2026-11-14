// Shared image helpers for the data-prep tools (Node + sharp). All images are 1672x941 unless noted.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

export const W = 1672, H = 941;
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
export const SRC = path.join(ROOT, 'assets', 'source');
export const SCENE = path.join(ROOT, 'public', 'scenes', 'ndk');
export const WORK = path.join(ROOT, 'assets', 'source', 'work'); // git-ignored intermediates

export const ensureDir = d => fs.mkdirSync(d, { recursive: true });

/** Load any image, resized to WxH exactly (fill), as Float32 RGB in 0..1 (sRGB-encoded). */
export async function loadRGB(file, w = W, h = H) {
  const { data } = await sharp(file).removeAlpha().resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(w * h * 3);
  for (let i = 0; i < out.length; i++) out[i] = data[i] / 255;
  return out;
}
export async function loadGray(file, w = W, h = H) {
  const { data } = await sharp(file).removeAlpha().resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = data[i] / 255;
  return out;
}
export const srgb2lin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
export const lin2srgb = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const LUT = new Float32Array(4096); for (let i = 0; i < 4096; i++) LUT[i] = srgb2lin(i / 4095);
export function toLinear(rgb) { const o = new Float32Array(rgb.length); for (let i = 0; i < rgb.length; i++) o[i] = LUT[Math.min(4095, Math.max(0, (rgb[i] * 4095 + .5) | 0))]; return o; }
export function toSRGB(lin) { const o = new Float32Array(lin.length); for (let i = 0; i < lin.length; i++) o[i] = lin2srgb(Math.min(1, Math.max(0, lin[i]))); return o; }
export function luma(rgb) { const n = rgb.length / 3, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = .2126 * rgb[i * 3] + .7152 * rgb[i * 3 + 1] + .0722 * rgb[i * 3 + 2]; return o; }

/** Separable box blur, repeated 3x ~ gaussian. radius in px. Single channel. */
export function blur(src, w, h, radius, passes = 3) {
  if (radius < 1) return Float32Array.from(src);
  let a = Float32Array.from(src), b = new Float32Array(w * h);
  const r = Math.max(1, Math.round(radius * 0.6));
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) { // horizontal
      let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { b[row + x] = acc / (2 * r + 1); acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < w; x++) { // vertical
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { a[y * w + x] = acc / (2 * r + 1); acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; }
    }
  }
  return a;
}
export function blurRGB(rgb, w, h, radius) {
  const n = w * h, out = new Float32Array(n * 3), ch = new Float32Array(n);
  for (let c = 0; c < 3; c++) { for (let i = 0; i < n; i++) ch[i] = rgb[i * 3 + c]; const b = blur(ch, w, h, radius); for (let i = 0; i < n; i++) out[i * 3 + c] = b[i]; }
  return out;
}
/** Mask-normalised blur: blurs only where mask>0 and renormalises (no bleeding across the mask edge). */
export function blurMasked(src, mask, w, h, radius) {
  const n = w * h, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = src[i] * mask[i];
  const num = blur(a, w, h, radius), den = blur(mask, w, h, radius), o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = den[i] > 1e-4 ? num[i] / den[i] : src[i];
  return o;
}
export function gradMag(g, w, h) {
  const o = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, gx = g[i + 1] - g[i - 1], gy = g[i + w] - g[i - w];
    o[i] = Math.sqrt(gx * gx + gy * gy);
  }
  return o;
}
export async function saveGray(file, data, w = W, h = H, scale = 255) {
  const buf = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) buf[i] = Math.min(255, Math.max(0, Math.round(data[i] * scale)));
  ensureDir(path.dirname(file));
  await sharp(buf, { raw: { width: w, height: h, channels: 1 } }).png({ compressionLevel: 9 }).toFile(file);
}
export function rgbToBuffer(rgb, w = W, h = H) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.min(255, Math.max(0, Math.round(rgb[i] * 255)));
  return buf;
}
export async function saveRGB(file, rgb, w = W, h = H) {
  ensureDir(path.dirname(file));
  await sharp(rgbToBuffer(rgb, w, h), { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 6 }).toFile(file);
}
/** Pack up to 3 single-channel float masks into an RGB PNG. */
export async function saveMaskRGB(file, r, g, b, w = W, h = H) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { buf[i * 3] = Math.round(Math.min(1, Math.max(0, r[i])) * 255); buf[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, g[i])) * 255); buf[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, b[i])) * 255); }
  ensureDir(path.dirname(file));
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 9 }).toFile(file);
}
export async function loadMaskRGB(file, w = W, h = H) {
  const rgb = await loadRGB(file, w, h), n = w * h, r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { r[i] = rgb[i * 3]; g[i] = rgb[i * 3 + 1]; b[i] = rgb[i * 3 + 2]; }
  return [r, g, b];
}
export function bilinear(src, w, h, x, y) {
  x = Math.min(w - 1.001, Math.max(0, x)); y = Math.min(h - 1.001, Math.max(0, y));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (src[i] * (1 - fx) + src[i + 1] * fx) * (1 - fy) + (src[i + w] * (1 - fx) + src[i + w + 1] * fx) * fy;
}
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
export const variantFiles = () => fs.existsSync(path.join(SRC, 'variants')) ? fs.readdirSync(path.join(SRC, 'variants')).filter(f => /\.png$/i.test(f)).sort() : [];
