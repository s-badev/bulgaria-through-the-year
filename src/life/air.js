// Things in the air: aircraft (contrails by day, lights at night) and birds (swallows in summer, V-flocks in autumn, none in winter).
import { clamp, lerp, sstep } from '../engine/blend.js';

export class Planes {
  constructor(scene, rnd, onPlane) { this.W = scene.size[0]; this.cor = scene.cfg.geometry.corridors; this.rnd = rnd; this.plane = null; this.next = 6; this.onPlane = onPlane; }
  spawn(forceLow = false) {
    const r = this.rnd, low = forceLow || r() < 0.55, c = this.cor;
    this.plane = low
      ? { t: 0, dur: 26 + r() * 10, y0: lerp(c.planesLow.y0[0], c.planesLow.y0[1], r()), y1: lerp(c.planesLow.y1[0], c.planesLow.y1[1], r()), ltr: false, high: false, trail: [], tt: 0 }
      : { t: 0, dur: 38 + r() * 12, y0: lerp(c.planesHigh.y[0], c.planesHigh.y[1], r()), y1: lerp(c.planesHigh.y[0], c.planesHigh.y[1], r()), ltr: r() < 0.5, high: true, trail: [], tt: 0 };
    this.onPlane && this.onPlane(this.plane.dur);
  }
  update(dt, ctx) {
    this.next -= dt;
    if (!this.plane && this.next <= 0) { if (ctx.env.storm < 0.5) this.spawn(); this.next = 18 + this.rnd() * 26; }
    const p = this.plane; if (!p) return;
    p.t += dt; if (p.t >= p.dur) { this.plane = null; return; }
    const k = p.t / p.dur; p.x = p.ltr ? lerp(-50, this.W + 50, k) : lerp(this.W + 50, -50, k); p.y = lerp(p.y0, p.y1, k);
    p.tt += dt; if (p.high && p.tt > 0.3) { p.tt = 0; p.trail.push([p.x, p.y, p.t]); if (p.trail.length > 70) p.trail.shift(); }
  }
  draw(sp, ctx) {
    const p = this.plane; if (!p) return;
    const e = ctx.env, cl = e.cloud, dayL = ctx.dayLight, vis = clamp(p.high ? 1 - (cl - 0.3) * 2.2 : 1 - (cl - 0.85) * 4 - e.rain * 0.4) * (1 - e.fog * 0.8);
    if (vis < 0.02) return;
    const d = p.ltr ? 1 : -1, s = p.high ? 3.4 : 6.2, ang = Math.atan2(p.y1 - p.y0, (p.ltr ? 1 : -1) * (this.W + 100));
    if (p.high && dayL > 0.05) for (let i = 1; i < p.trail.length; i++) { // contrail: widens and fades with age
      const a = p.trail[i - 1], b = p.trail[i], age = p.t - b[2], k = clamp(1 - age / 16) * vis * dayL;
      const warm = ctx.blend.golden; sp.line(a[0], a[1], b[0], b[1], 0.7 + age * 0.22, -0.02, 1, 1 - warm * 0.25, 1 - warm * 0.4, 0.42 * k);
    }
    if (dayL > 0.2) sp.add(p.x, p.y, s * 2, s * 1.5, p.ltr ? ang : Math.PI - ang, 5, -0.02, 0, 0.82 * dayL, 0.84 * dayL, 0.88 * dayL, vis * clamp(dayL * 1.4));
    if (dayL < 0.65) { // navigation lights and a strobe
      const n = vis * (1 - dayL);
      sp.add(p.x - s * 0.5 * d, p.y + s * 0.2, 2.6, 2.6, 0, 0, -0.02, 0, 1.0, 0.2, 0.15, -n * 0.9);
      if ((ctx.time * 1.1) % 1 < 0.1 || ctx.reduced) sp.add(p.x, p.y, 4.2, 4.2, 0, 0, -0.02, 0, 1, 1, 1, -n * (ctx.reduced ? 0.5 : 1));
      if (!p.high) sp.add(p.x + s * 1.7 * d, p.y, 9, 9, 0, 0, -0.02, 0, 1.0, 0.97, 0.88, -n * 0.8); // landing light
    }
  }
}

export class Birds {
  constructor(scene, rnd) { this.W = scene.size[0]; this.cor = scene.cfg.geometry.corridors; this.rnd = rnd; this.flocks = []; this.next = 3; this.vis = 1; }
  spawn(kind) {
    const r = this.rnd, ltr = kind === 'v' ? true : r() < 0.5, dir = ltr ? 1 : -1, n = kind === 'v' ? 9 + r.int(6) : kind === 'swallow' ? 3 + r.int(3) : 7 + r.int(8), birds = [];
    for (let i = 0; i < n; i++) {
      if (kind === 'v') { const k = Math.ceil(i / 2), sd = i % 2 ? 1 : -1; birds.push({ dx: -dir * k * 15, dy: sd * k * 8, ph: r() * 6 }); }
      else birds.push({ dx: (r() - 0.5) * (kind === 'swallow' ? 140 : 70), dy: (r() - 0.5) * (kind === 'swallow' ? 50 : 26), ph: r() * 6, sw: 2 + r() * 2 });
    }
    const band = kind === 'swallow' ? this.cor.swallows.y : this.cor.birds.y;
    this.flocks.push({ kind, x: ltr ? -60 : this.W + 60, y: lerp(band[0], band[1], r()), dir, speed: kind === 'v' ? 40 : kind === 'swallow' ? 170 : 70 + r() * 30, size: kind === 'v' ? 5.2 : kind === 'swallow' ? 4.0 : 3, birds, t: 0 });
  }
  ok(ctx) { const e = ctx.env; return ctx.season.winter < 0.35 && ctx.blend.alt > -1 && e.rain < 0.2 && e.storm < 0.1 && e.snow < 0.1 && e.fog < 0.7; }
  update(dt, ctx) {
    const ok = this.ok(ctx), h = ctx.hour;
    this.next -= dt * (h > 5.5 && h < 10 ? 1.8 : 1);
    if (ok && this.next <= 0) {
      const r = this.rnd(), a = ctx.season.autumn, su = ctx.season.summer;
      this.spawn(a > 0.5 && r < 0.55 ? 'v' : su > 0.5 && r < 0.45 ? 'swallow' : 'flock'); this.next = 7 + this.rnd() * 10;
    }
    this.vis = clamp(this.vis + (ok ? dt : -dt * 0.8));
    this.flocks = this.flocks.filter(f => { f.t += dt; f.x += f.dir * f.speed * dt; return f.x > -320 && f.x < this.W + 320; });
    if (ctx.season.winter > 0.6) this.flocks.length = 0; // never in winter
  }
  draw(sp, ctx) {
    if (this.vis < 0.02) return;
    const k = clamp(ctx.dayLight), col = [lerp(0.02, 0.10, k), lerp(0.025, 0.105, k), lerp(0.04, 0.12, k)];
    for (const f of this.flocks) for (const b of f.birds) {
      let x = f.x + b.dx, y = f.y + b.dy;
      if (f.kind === 'flock') { x += Math.sin(f.t * 1.3 + b.ph) * 10; y += Math.cos(f.t * 1.1 + b.ph) * 6; }
      if (f.kind === 'swallow') { y += Math.sin(f.t * b.sw + b.ph) * 40; x += Math.sin(f.t * b.sw * 0.7 + b.ph) * 40; }
      const flap = Math.sin(f.t * (f.kind === 'v' ? 4 : f.kind === 'swallow' ? 14 : 10) + b.ph);
      sp.add(x, y, f.size * 1.7, f.size * 1.1, 0, 4, f.kind === 'swallow' ? -0.5 : -0.03, flap * 0.8, col[0], col[1], col[2], 0.85 * this.vis);
    }
  }
}
export { sstep };
