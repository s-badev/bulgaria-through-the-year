// Rain and snow as depth-layered particles (far ones small, slow and hidden by nearer buildings and trees),
// splashes on the paved plaza, and lightning with a WCAG 2.3.1-safe flash envelope.
import { clamp, lerp, sstep } from '../engine/blend.js';
import { sampleMask } from '../engine/scene.js';

export class Rain {
  constructor(scene, rnd) {
    this.scene = scene; this.rnd = rnd; const [W, H] = scene.size; this.W = W; this.H = H;
    this.drops = Array.from({ length: 1500 }, () => ({ x: rnd() * W * 1.2 - W * 0.1, y: rnd() * H, d: Math.pow(rnd(), 1.6) * 0.95 + 0.05, v: 0.8 + rnd() * 0.4 }));
    this.splashes = Array.from({ length: 160 }, () => ({ x: 0, y: 0, t: 1, sc: 1 }));
    this.acc = 0;
  }
  update(dt, ctx) {
    const rain = ctx.env.rain; this.n = rain > 0.02 ? Math.round(this.drops.length * rain * (0.35 + 0.65 * ctx.quality)) : 0;
    const angle = (ctx.env.wind + ctx.env.storm * 0.3) * 0.55; this.angle = angle;
    for (let i = 0; i < this.n; i++) {
      const p = this.drops[i], sp = (520 + 1250 * p.d) * p.v;
      p.y += sp * dt; p.x += sp * dt * angle;
      if (p.y > this.H + 20) { p.y = -20 - this.rnd() * 40; p.x = this.rnd() * this.W * 1.3 - this.W * 0.3; }
    }
    // splashes where drops meet the paved ground
    this.acc += dt * rain * 110 * (0.4 + 0.6 * ctx.quality);
    for (const s of this.splashes) {
      if (s.t < 1) { s.t += dt * 3.4; continue; }
      if (this.acc < 1) continue;
      for (let k = 0; k < 4; k++) { const x = this.rnd() * this.W, y = 440 + Math.pow(this.rnd(), 0.7) * (this.H - 440); if (sampleMask(this.scene.cpu.b, x, y, 2) > 0.6) { s.x = x; s.y = y; s.t = 0; s.sc = clamp((y - 318) / 623, 0.1, 1.1); this.acc -= 1; break; } }
    }
  }
  draw(sp, ctx) {
    const rain = ctx.env.rain; if (rain < 0.02) return;
    const L = clamp(ctx.dayLight), c = [lerp(0.32, 0.80, L), lerp(0.36, 0.84, L), lerp(0.46, 0.90, L)], rot = -Math.atan(this.angle), glow = ctx.blend.lightsOn * 0.25;
    for (let i = 0; i < this.n; i++) {
      const p = this.drops[i], len = 6 + 24 * p.d, w = 0.5 + 0.8 * p.d;
      sp.add(p.x, p.y, w, len, rot, 1, p.d, 0, c[0] + glow, c[1] + glow * 0.8, c[2] + glow * 0.5, (0.16 + 0.40 * p.d) * (0.6 + 0.4 * L + glow));
    }
    for (const s of this.splashes) {
      if (s.t >= 1) continue;
      const r = (1.5 + 5.5 * s.t) * (0.35 + s.sc);
      sp.add(s.x, s.y, r, r * 0.42, 0, 9, clamp((s.y - 318) / 623 / 1.25 + 0.02), 0, c[0], c[1], c[2], (1 - s.t) * 0.30 * rain);
    }
  }
}

export class Snow {
  constructor(scene, rnd) {
    this.rnd = rnd; const [W, H] = scene.size; this.W = W; this.H = H;
    this.flakes = Array.from({ length: 1400 }, () => ({ x: rnd() * W, y: rnd() * H, d: Math.pow(rnd(), 1.5) * 0.95 + 0.05, ph: rnd() * 6.28, v: 0.7 + rnd() * 0.6 }));
  }
  update(dt, ctx) {
    const snow = ctx.env.snow; this.n = snow > 0.02 ? Math.round(this.flakes.length * snow * (0.35 + 0.65 * ctx.quality)) : 0;
    const wind = ctx.env.wind, T = ctx.time;
    for (let i = 0; i < this.n; i++) {
      const f = this.flakes[i], k = 0.3 + f.d;
      f.y += (26 + 60 * f.d) * f.v * dt; f.x += (Math.sin(T * 0.9 + f.ph) * 16 + wind * 150) * k * dt;
      if (f.y > this.H + 6) { f.y = -6; f.x = this.rnd() * this.W; }
      if (f.x > this.W + 6) f.x -= this.W + 12; else if (f.x < -6) f.x += this.W + 12;
    }
  }
  draw(sp, ctx) {
    if (!this.n) return;
    const L = clamp(ctx.dayLight), night = ctx.blend.lightsOn, c = [lerp(0.40, 0.97, L) + night * 0.2, lerp(0.42, 0.98, L) + night * 0.14, lerp(0.50, 1.0, L) + night * 0.06];
    for (let i = 0; i < this.n; i++) { const f = this.flakes[i], r = 0.8 + 2.9 * f.d * f.d; sp.add(f.x, f.y, r, r, 0, 2, f.d, 0, c[0], c[1], c[2], 0.45 + 0.5 * f.d); }
  }
}

/**
 * Lightning. One smooth pulse per bolt and at least 1.4 s between bolts: never more than one flash per second,
 * well inside WCAG 2.3.1 (max three per second). With "Без проблясвания" or reduced motion there is no flash at all:
 * the bolt is drawn dim and the clouds only swell gently.
 */
export class Lightning {
  constructor(scene, rnd, onBolt) { this.rnd = rnd; this.W = scene.size[0]; this.bolt = null; this.next = 2.5; this.flash = 0; this.glow = 0; this.last = -10; this.onBolt = onBolt; this.count = 0; }
  make() {
    const r = this.rnd, x0 = 200 + r() * (this.W - 400), y0 = 16 + r() * 40, x1 = x0 + (r() - 0.5) * 170, y1 = 200 + r() * 80;
    const seg = (ax, ay, bx, by, d, out) => { if (d <= 0) { out.push([bx, by]); return; } const mx = (ax + bx) / 2 + (r() - 0.5) * Math.hypot(bx - ax, by - ay) * 0.28, my = (ay + by) / 2 + (r() - 0.5) * 8; seg(ax, ay, mx, my, d - 1, out); seg(mx, my, bx, by, d - 1, out); };
    const main = [[x0, y0]]; seg(x0, y0, x1, y1, 6, main); const br = [];
    for (let i = 0; i < 3; i++) { const p = main[Math.floor(main.length * (0.15 + r() * 0.5))], b = [[p[0], p[1]]]; seg(p[0], p[1], p[0] + (r() - 0.5) * 150, p[1] + 40 + r() * 60, 4, b); br.push(b); }
    return { main, br, t: 0, km: 1 + r() * 5, x: (x0 + x1) / 2 };
  }
  update(dt, ctx) {
    if (ctx.env.storm > 0.5) {
      this.next -= dt;
      if (this.next <= 0 && ctx.time - this.last >= 1.4) { this.bolt = this.make(); this.last = ctx.time; this.count++; this.onBolt && this.onBolt(this.bolt.km); this.next = 2.4 + this.rnd() * 5.2; }
    }
    const b = this.bolt, safe = !ctx.flashes || ctx.reduced;
    if (b) { b.t += dt; if (b.t > (safe ? 1.6 : 0.5)) this.bolt = null; }
    // envelope: fast attack, single decay (no flicker)
    const target = b && !safe ? (b.t < 0.05 ? b.t / 0.05 : Math.exp(-(b.t - 0.05) / 0.12)) : 0;
    this.flash = target;
    const gT = b && safe ? Math.sin(Math.min(1, b.t / 1.6) * Math.PI) * 0.16 : 0; this.glow += (gT - this.glow) * Math.min(1, dt * 4);
    this.boltX = b ? b.x / this.W : this.boltX ?? 0.5;
  }
  /** Value for the compositor's flash uniform. */
  get level() { return this.flash * 0.6 + this.glow; }
  draw(sp, ctx) {
    const b = this.bolt; if (!b) return;
    const safe = !ctx.flashes || ctx.reduced, a = safe ? Math.sin(Math.min(1, b.t / 1.6) * Math.PI) * 0.22 : (b.t < 0.05 ? 1 : Math.exp(-(b.t - 0.05) / 0.11));
    if (a < 0.01) return;
    for (const [w, al] of [[6, 0.10], [2.6, 0.3], [1.0, 1]]) {
      for (let i = 1; i < b.main.length; i++) sp.line(b.main[i - 1][0], b.main[i - 1][1], b.main[i][0], b.main[i][1], w, -0.02, 0.82, 0.86, 1.0, -al * a);
      for (const br of b.br) for (let i = 1; i < br.length; i++) sp.line(br[i - 1][0], br[i - 1][1], br[i][0], br[i][1], w * 0.5, -0.02, 0.82, 0.86, 1.0, -al * a * 0.7);
    }
  }
}
export { sstep };
