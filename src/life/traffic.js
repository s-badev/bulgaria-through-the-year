// Traffic along the traced lanes: perspective-correct size and speed, white headlights / red taillights with
// glow and spill on wet asphalt at night, small moving bodies by day, density by the hour.
import { clamp, lerp } from '../engine/blend.js';
import { groundFog } from '../render/compositor.js';

const BODY = [[0.80, 0.80, 0.82], [0.80, 0.80, 0.82], [0.58, 0.60, 0.63], [0.58, 0.60, 0.63], [0.10, 0.11, 0.13], [0.10, 0.11, 0.13], [0.34, 0.35, 0.38], [0.36, 0.11, 0.10], [0.13, 0.17, 0.27], [0.66, 0.62, 0.54]];
export class Traffic {
  constructor(scene, rnd) {
    this.lanes = scene.cfg.geometry.lanes; this.rnd = rnd; this.cars = [];
    for (const lane of this.lanes) {
      const n = Math.max(2, Math.round(lane.length / 13));
      for (let i = 0; i < n; i++) this.cars.push({ lane, s: rnd() * lane.length, v: 0.85 + rnd() * 0.4, off: (i % 2 ? 1 : -1) * (0.9 + rnd() * 0.5), rank: rnd(), body: rnd.pick(BODY), bus: rnd() < 0.05 });
    }
  }
  at(lane, s, out) {
    const p = lane.pts, f = clamp(s / lane.length, 0, 0.9999) * (p.length - 1), i = Math.floor(f), t = f - i, a = p[i], b = p[i + 1];
    out.x = lerp(a[0], b[0], t); out.y = lerp(a[1], b[1], t); out.sc = lerp(a[2], b[2], t); out.vis = lerp(a[3], b[3], t);
    out.ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return out;
  }
  update(dt, ctx) {
    const act = ctx.activity, slow = 1 - 0.35 * ctx.env.snow - 0.2 * ctx.env.rain - 0.25 * ctx.env.fog;
    for (const c of this.cars) {
      c.on = c.rank < act * (0.55 + 0.45 * ctx.quality) * (0.62 + 0.38 * ctx.blend.lightsOn) ? 1 : 0;
      const sc = this.at(c.lane, c.s, P).sc;
      c.s += 78 * sc * c.v * slow * dt;
      if (c.s >= c.lane.length) { c.s -= c.lane.length; c.rank = this.rnd(); c.body = this.rnd.pick(BODY); }
    }
  }
  draw(sp, ctx) {
    const night = ctx.blend.lightsOn, day = clamp(1 - night * 1.4), wet = ctx.env.wet, fog = ctx.env.fog;
    for (const c of this.cars) {
      if (!c.on) continue;
      const p = this.at(c.lane, c.s, P); if (p.vis < 0.05) continue;
      const edge = clamp(Math.min(c.s, c.lane.length - c.s) / 14); // fade in/out at lane ends
      const fg = groundFog(ctx.env, p.y), a = p.vis * edge * (1 - fg * 0.92), sc = p.sc, depth = clamp((p.y - 318) / 623 / 1.25 + 0.012, 0, 1);
      const nx = -Math.sin(p.ang), ny = Math.cos(p.ang), x = p.x + nx * c.off * c.lane.width * 0.5 * sc, y = p.y + ny * c.off * c.lane.width * 0.5 * sc;
      const len = (c.bus ? 26 : 11) * sc, wid = 5.2 * sc;
      if (day > 0.02) { // bodies with a soft contact shadow
        sp.add(x + 1.2 * sc, y + 2.2 * sc, len * 1.05, wid * 0.9, p.ang, 10, -depth, 0, 0, 0, 0, 0.26 * a * day * ctx.blend.sunVis);
        const k = (0.45 + 0.5 * ctx.dayLight) * (1 - 0.25 * ctx.env.wet);
        sp.add(x, y, len, wid, p.ang, 10, -depth, 0, c.body[0] * k, c.body[1] * k, c.body[2] * k, 0.85 * a * day);
        sp.add(x, y - 0.5 * sc, len * 0.32, wid * 0.6, p.ang, 10, -depth, 0, 0.07, 0.09, 0.12, 0.38 * a * day);
      }
      if (night > 0.03) {
        const head = c.lane.kind === 'head', col = head ? HEAD : TAIL, inten = night * p.vis * edge * (1 - fg * 0.6);
        const sgn = head ? 1 : -1, fx = x + Math.cos(p.ang) * len * 0.5 * sgn, fy = y + Math.sin(p.ang) * len * 0.5 * sgn; // headlights at the nose, taillights at the rear
        const g = (head ? 2.6 + 6.5 * sc : 2.1 + 4.6 * sc) * (1 + fog * 1.6 + ctx.env.rain * 0.4);
        sp.add(fx, fy, g, g, 0, 0, -depth, 0, col[0], col[1], col[2], -inten * (head ? 1.25 : 1.05));
        if (head) sp.add(fx + Math.cos(p.ang) * 9 * sc, fy + Math.sin(p.ang) * 9 * sc, 4 + 13 * sc, 1.5 + 5.5 * sc, p.ang + Math.PI, 7, -depth, 0, 1.0, 0.9, 0.7, -inten * 0.26); // beam on the asphalt ahead
        if (wet > 0.05) sp.add(fx, fy + 3 + 9 * sc, 1 + 2.2 * sc, 3 + 11 * sc, 0, 1, -depth, 0, col[0], col[1], col[2], -inten * wet * (head ? 0.5 : 0.42)); // spill on wet road
      }
    }
  }
}
const P = { x: 0, y: 0, sc: 1, vis: 1, ang: 0 }, HEAD = [1.0, 0.94, 0.80], TAIL = [1.0, 0.13, 0.08];
