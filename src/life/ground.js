// Things on the ground: lamp halos and their wet reflections, obstacle beacons, fountains, fireflies and midges, leaves.
import { clamp, sstep } from '../engine/blend.js';
import { groundFog } from '../render/compositor.js';

const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Street and park lamps. The lamps themselves are in the night photographs; this adds what the air does to them. */
export class Lamps {
  constructor(scene) { this.sets = scene.cfg.geometry.lamps; this.beacons = scene.cfg.geometry.beacons; }
  draw(sp, ctx) {
    const b = ctx.blend, on = b.lightsOn; if (on < 0.02) return;
    const env = ctx.env, set = b.cover > 0.5 ? this.sets['winter-night'] : b.wRainNight > 0.5 ? this.sets['rain-night'] : (b.wBlue > 0.5 && this.sets['dawn-bluehour']) || this.sets.night;
    if (set) {
      const air = env.fog * 0.9 + env.rain * 0.35 + env.snow * 0.45, n = Math.round(set.length * (0.45 + 0.55 * ctx.quality));
      for (let i = 0; i < n; i++) {
        const [x, y, sc, st] = set[i], th = hash(i) * 0.7, k = clamp((on - th) * 4) * clamp(st * 2.5); if (k <= 0) continue;
        const depth = clamp((y - 318) / 623 / 1.25 + 0.03, 0, 1), fl = 0.94 + 0.06 * Math.sin(ctx.time * (2 + hash(i + 9) * 3) + i);
        if (air > 0.03) { const r = (4 + air * 12) * (0.5 + sc); sp.add(x, y, r, r, 0, 0, depth, 0, 1.0, 0.78, 0.48, -k * fl * (0.05 + air * 0.11) * (1 - groundFog(env, y) * 0.75)); }
        if (env.wet > 0.05 && b.wRainNight < 0.6) sp.add(x, y + 16 * (0.4 + sc), 2.2 * (0.5 + sc), 15 * (0.4 + sc), 0, 1, depth, 0, 1.0, 0.76, 0.46, -k * env.wet * 0.2 * (1 - b.wRainNight));
      }
    }
    if (Math.sin(ctx.time * 3.1) > 0 || ctx.reduced) for (const { x, y } of this.beacons) sp.add(x, y, 3.2, 3.2, 0, 0, -0.05, 0, 1.0, 0.16, 0.10, -on * 0.9 * (1 - env.fog * 0.5));
  }
}

/** Fountain jets: run in the warm months, stop in winter; lit from below at night. */
export class Fountains {
  constructor(scene) { this.jets = scene.cfg.geometry.jets; }
  draw(sp, ctx) {
    const w = ctx.env.water; if (w < 0.03) return;
    const b = ctx.blend, T = ctx.reduced ? 0 : ctx.time, wind = ctx.env.wind, fc = ctx.fountainColor, night = b.lightsOn;
    const dayA = (0.20 + 0.5 * ctx.dayLight) * w, r = 0.93 * (1 - night) + (0.55 + fc[0] * 0.45) * night, g = 0.96 * (1 - night) + (0.6 + fc[1] * 0.4) * night, bl = 1.0 * (1 - night) + (0.65 + fc[2] * 0.35) * night;
    for (let i = 0; i < this.jets.length; i++) {
      const j = this.jets[i], depth = clamp((j.y - 318) / 623 / 1.25 + 0.03, 0, 1), h = j.h * (0.86 + 0.14 * Math.sin(T * 6.5 + j.x)) * w, lean = Math.sin(T * 2.6 + j.y) * wind * 2.5 + wind * 3;
      sp.add(j.x + lean * 0.5, j.y - h * 0.5, 2.3, h * 0.5, lean * 0.03, 6, depth, T * 9 + i, r, g, bl, -(dayA * 0.42 + night * w * 0.42));
      for (let k = 0; k < 3; k++) { const ph = (T * 1.5 + k / 3 + i * 0.37) % 1; sp.add(j.x + (k - 1) * 2.6 + lean * ph * 2.2 + wind * ph * 7, j.y - h * (1 - ph * ph) * 0.92, 0.9, 0.9, 0, 2, depth, 0, r, g, bl, -(1 - ph) * (dayA * 0.5 + night * 0.4)); }
      sp.add(j.x, j.y + 1, 5, 2, 0, 0, depth, 0, r, g, bl, -(dayA * 0.16 + night * 0.25)); // foam at the foot
    }
  }
}

/** Fireflies on warm nights, midges dancing in the low sun of warm evenings. Nothing in the cold months. */
export class Insects {
  constructor(scene, rnd) {
    const [W, H] = scene.size;
    this.flies = Array.from({ length: 54 }, () => ({ x: rnd() < 0.5 ? rnd() * W * 0.42 : W * 0.62 + rnd() * W * 0.38, y: 640 + rnd() * 290, ph: rnd() * 6.28, sp: 0.6 + rnd() * 0.9 }));
    this.swarms = Array.from({ length: 5 }, () => ({ x: 120 + rnd() * (W - 240), y: 700 + rnd() * 200, n: 16, ph: rnd() * 6 }));
    this.ff = 0; this.mg = 0;
  }
  update(dt, ctx) {
    const warm = clamp(ctx.season.summer + ctx.season.spring * 0.35 - ctx.season.winter * 5), e = ctx.env, alt = ctx.blend.alt, calm = e.rain < 0.1 && e.snow < 0.05 && e.storm < 0.1;
    this.ff = clamp(this.ff + (warm > 0.6 && alt < -3 && calm && e.fog < 0.5 ? dt * 0.3 : -dt * 0.8));
    this.mg = clamp(this.mg + (warm > 0.5 && alt > 0.5 && alt < 14 && calm && e.cloud < 0.6 && e.wind < 0.6 ? dt * 0.4 : -dt * 0.8));
  }
  draw(sp, ctx) {
    const T = ctx.time;
    if (this.ff > 0.01) for (const f of this.flies) {
      const a = Math.pow(Math.max(0, Math.sin(T * f.sp * 1.4 + f.ph)), 3) * this.ff; if (a < 0.02) continue;
      const x = f.x + Math.sin(T * 0.3 + f.ph) * 20, y = f.y + Math.sin(T * f.sp + f.ph) * 8;
      sp.add(x, y, 4.5, 4.5, 0, 0, clamp((y - 318) / 623 / 1.25 + 0.1), 0, 0.78, 1.0, 0.42, -a * 0.9);
    }
    if (this.mg > 0.01) for (const s of this.swarms) for (let i = 0; i < s.n; i++) {
      const p = s.ph + i * 2.4, x = s.x + Math.sin(T * 1.7 + p) * 14 + Math.sin(T * 0.4 + p * 3) * 20, y = s.y + Math.cos(T * 2.3 + p * 1.3) * 10 + Math.sin(T * 0.9 + p) * 6;
      sp.add(x, y, 0.9, 0.9, 0, 2, -0.9, 0, 1.0, 0.86, 0.55, -this.mg * 0.5 * (0.5 + 0.5 * Math.sin(T * 9 + p)));
    }
  }
}

/** Autumn leaves carried by the wind, in depth layers. */
const LEAF = [[0.84, 0.47, 0.16], [0.89, 0.69, 0.23], [0.71, 0.27, 0.16], [0.77, 0.55, 0.24]];
export class Leaves {
  constructor(scene, rnd) {
    this.size = scene.size; this.rnd = rnd; this.amount = 0;
    this.items = Array.from({ length: 110 }, () => ({ x: rnd() * scene.size[0], y: 420 + rnd() * 520, d: 0.35 + rnd() * 0.65, k: 0.6 + rnd() * 0.9, rot: rnd() * 6, spin: (rnd() - 0.5) * 8, ph: rnd() * 6, col: rnd.pick(LEAF) }));
  }
  update(dt, ctx) {
    const [W, H] = this.size, e = ctx.env, want = ctx.season.autumn * (0.3 + e.wind * 0.7) * (1 - e.snow) * (1 - ctx.season.winter) * (1 - e.rain * 0.6);
    this.amount += (want - this.amount) * Math.min(1, dt);
    const gust = 0.6 + 0.4 * Math.sin(ctx.time * 0.7) * Math.sin(ctx.time * 0.23 + 1), n = Math.round(this.items.length * this.amount * (0.5 + 0.5 * ctx.quality));
    this.n = ctx.season.winter > 0.5 ? 0 : n; // never in winter
    for (let i = 0; i < this.n; i++) {
      const L = this.items[i];
      L.x += (26 + e.wind * 330 * gust + e.storm * 220) * dt * L.k * L.d; L.y += (20 + 26 * Math.sin(ctx.time * 2 + L.ph)) * dt * L.k * L.d; L.rot += L.spin * dt * (1 + e.wind * 3);
      if (L.x > W + 30 || L.y > H + 30) { L.x = -20 - this.rnd() * 300; L.y = 380 + this.rnd() * 520; L.d = 0.35 + this.rnd() * 0.65; }
    }
  }
  draw(sp, ctx) {
    const light = clamp(ctx.dayLight * 0.9 + 0.05 + ctx.blend.lightsOn * 0.16), alpha = 0.25 + 0.67 * clamp(ctx.dayLight * 1.5);
    for (let i = 0; i < (this.n || 0); i++) {
      const L = this.items[i], s = 5.2 * L.k * (0.35 + L.d);
      sp.add(L.x, L.y, s, s, L.rot, 3, L.d, Math.abs(Math.sin(L.rot * 0.7)) * 0.8 + 0.2, L.col[0] * light, L.col[1] * light, L.col[2] * light, alpha);
    }
  }
}
export { sstep };
