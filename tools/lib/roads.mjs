// Road geometry helpers: smooth guides, lane-aligned ("straightened") strips, ground-plane metrics.
import { W, H, clamp } from './img.mjs';

/** Chaikin-smooth a polyline, then resample at `step` px. Returns points with unit tangent (tx,ty) and right-hand normal (rx,ry). */
export function resample(pts, step = 1, smooth = 3) {
  let p = pts.map(q => [q[0], q[1]]);
  for (let k = 0; k < smooth; k++) { const o = [p[0]]; for (let i = 0; i + 1 < p.length; i++) { const a = p[i], b = p[i + 1]; o.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } o.push(p[p.length - 1]); p = o; }
  const out = []; let carry = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1], L = Math.hypot(bx - ax, by - ay); if (L < 1e-6) continue;
    for (let d = carry; d < L; d += step) out.push({ x: ax + (bx - ax) * d / L, y: ay + (by - ay) * d / L });
    carry = (carry + Math.ceil((L - carry) / step) * step) - L;
  }
  const last = p[p.length - 1]; out.push({ x: last[0], y: last[1] });
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 3)], b = out[Math.min(out.length - 1, i + 3)], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    out[i].tx = (b.x - a.x) / L; out[i].ty = (b.y - a.y) / L; out[i].rx = -out[i].ty; out[i].ry = out[i].tx; out[i].s = i * step; // r = driver's right
  }
  return out;
}
export function bilinear3(rgb, x, y, out = [0, 0, 0]) {
  x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001);
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = (y0 * W + x0) * 3;
  for (let c = 0; c < 3; c++) out[c] = (rgb[i + c] * (1 - fx) + rgb[i + 3 + c] * fx) * (1 - fy) + (rgb[i + W * 3 + c] * (1 - fx) + rgb[i + W * 3 + 3 + c] * fx) * fy;
  return out;
}
export function bilinear1(a, x, y) {
  x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001);
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0;
  return (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + W] * (1 - fx) + a[i + W + 1] * fx) * fy;
}
/** Straighten an RGB image along a guide: strip[s][t], t in [-half, half] px (t>0 = driver's right). sub = samples per px. */
export function strip(rgb, path, half, sub = 1) {
  const n = path.length, tw = (2 * half) * sub + 1, out = new Float32Array(n * tw * 3), v = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let j = 0; j < tw; j++) { const t = j / sub - half, p = path[i]; bilinear3(rgb, p.x + p.rx * t, p.y + p.ry * t, v); out.set(v, (j * n + i) * 3); }
  return { data: out, w: n, h: tw, half, sub };
}
/** Ground-plane metrics from the calibrated camera: ground coordinates (in camera heights) of an image point lying on the ground. */
export function groundPoint(cam, x, y) {
  const ct = Math.cos(cam.pitchRad), st = Math.sin(cam.pitchRad), X = (x - W / 2) / cam.focalPx, Y = (y - H / 2) / cam.focalPx;
  const den = Y * ct + st; if (den <= 1e-4) return null;              // at or above the horizon
  const z = 1 / den;                                                  // camera height = 1
  return { gx: X * z, gz: z * (ct - Y * st) };                        // right, forward (horizontal distance)
}
