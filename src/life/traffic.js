// Live traffic. Cars are sprites cut from the photographs (see tools/build-traffic.mjs); they drive in metres along lanes
// traced inside the strict asphalt mask, follow each other with a car-following model, queue at a signal, and may only
// appear or leave at the far end of a lane (through the haze) or under a tree crown. Nothing here draws a shape.
import { clamp, lerp } from '../engine/blend.js';
import { groundFog } from '../render/compositor.js';
import { State } from '../engine/state.js';

const CAR_W = 1.9, FAR_FADE = 32;                    // metres
const NOON = State.activityAt(13);                   // the photograph was taken around midday: its car count is the reference
// multiplicative tints for light-coloured sprites (white/silver base) and for dark ones: the realistic palette of a city street
const TINT_LIGHT = [[1, 1, 1], [1, 1, 1], [0.86, 0.87, 0.89], [0.7, 0.71, 0.74], [0.52, 0.53, 0.56], [0.3, 0.31, 0.34], [0.26, 0.3, 0.42], [0.5, 0.2, 0.19], [0.93, 0.9, 0.84]];
// dark sprites carry the blue of their own shadow: brightening is biased warm so a lighter car comes out grey or silver, not sky-blue
// (strong brightening turns a small dark sprite into a pale smear, so it stays mild: the variety comes from the sprites themselves)
const TINT_DARK = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1.22, 1.19, 1.12], [1.42, 1.37, 1.27], [1.04, 1.1, 1.24], [1.18, 0.98, 0.94]];
const HEAD = [1.0, 0.94, 0.80], TAIL = [1.0, 0.13, 0.08];

export class Traffic {
  constructor(scene, rnd) {
    this.rnd = rnd; this.data = scene.traffic; this.cpuRoad = scene.cpu.road; this.size = scene.size;
    this.sets = { base: [], autumn: [] };
    const phase = {};   // one signal per carriageway: all its lanes share the phase
    const live = new Set(this.data.carriageways.filter(c => !c.cleanOnly).map(c => c.id));
    for (const l of this.data.lanes) if (live.has(l.cw)) this.sets[l.set].push({ ...l, cars: [], nextSpawn: 0, phase: phase[l.cw] ??= rnd() * 60, maxPpm: l.pts.reduce((m, p) => p[3] ? Math.max(m, p[2]) : m, 0) });
    this.sprites = this.data.sprites; this.cell = this.data.cell;
    this.setName = null; this.lib = null; this.events = { spawn: 0, despawn: 0, midRoad: 0, log: [] }; this.time = 0;
    this.bakedOf = lib => { const st = this.data.stats[lib] || this.data.stats.master; return cw => (st.byCarriageway[cw] || { baked: 0 }).baked; };
    // clean-only carriageways exist only for the plate cleaning: no lanes, no density, no spawning
    this.lanesBase = Object.fromEntries(this.data.carriageways.filter(c => !c.cleanOnly).map(c => [c.id, c.sets?.base?.lanes || 1]));
  }
  get lanes() { return this.sets[this.setName] || []; }
  get count() { return this.lanes.reduce((n, l) => n + l.cars.length, 0); }
  /** Position on a lane at s metres: image x, y, lateral px per metre, visibility (1 = on visible asphalt). */
  at(lane, s, out) {
    const p = lane.pts, f = clamp(s, 0, lane.lengthM - 0.001), i = Math.floor(f), t = f - i, a = p[i], b = p[Math.min(p.length - 1, i + 1)];
    out.x = lerp(a[0], b[0], t); out.y = lerp(a[1], b[1], t); out.ppm = lerp(a[2], b[2], t); out.vis = a[3] && b[3] ? 1 : 0;
    return out;
  }
  pickSprite(lane) {
    const s = this.sprites, pool = [];
    // cars of the photo on screen (seen end-on on both carriageways); prefer the larger ones so a car is never magnified much near the camera
    const need = lane.maxPpm * 0.74;
    for (let i = 0; i < s.length; i++) if (s[i].lib === this.lib && s[i].ppm >= need) pool.push(i);
    if (pool.length < 4) { pool.length = 0; for (let i = 0; i < s.length; i++) if (s[i].lib === this.lib) pool.push(i); }
    if (!pool.length) for (let i = 0; i < s.length; i++) if (s[i].cw === lane.cw) pool.push(i);
    return pool.length ? this.rnd.pick(pool) : -1;
  }
  makeCar(lane, s, v) {
    const si = this.pickSprite(lane); if (si < 0) return null;
    const sp = this.sprites[si], tint = sp.lum > 0.5 ? this.rnd.pick(TINT_LIGHT) : this.rnd.pick(TINT_DARK);
    return { s, v, v0k: 0.8 + this.rnd() * 0.32, sprite: si, tint, len: sp.big ? 6.2 : 4.5, age: 0, lat: (this.rnd() - 0.5) * 2 };
  }
  /** How many cars a lane should carry right now. */
  /** Carriageways closed to new cars right now: the golden-hour photo on screen left them untouched (frozen baked cars). */
  closedFor(ctx) {   // golden photo weight as actually visible (winter mornings are computed, not the photo)
    const b = ctx.blend, golden = b && b.wGold * (1 - (b.cover || 0)) > 0.02 ? (b.morning ? 'dawn-golden' : 'evening-golden') : null, list = golden && this.data.untouched ? this.data.untouched[golden] || [] : [];
    return list.length ? new Set(list) : NONE;
  }
  target(lane, ctx) {
    if (this.closed && this.closed.has(lane.cw)) return 0;   // no new cars; those already on it drive on to the end
    const e = ctx.env, weather = (1 - 0.3 * e.rain) * (1 - 0.35 * e.fog) * (1 - 0.92 * clamp(e.snow * 1.15)) * (1 - 0.3 * e.storm);
    return 0.8 * Math.max(4, this.bakedOf(this.lib)(lane.cw)) / (this.lanesBase[lane.cw] || 1) * (ctx.activity / NOON) * weather;
  }
  /** Start (or restart after a season change) with cars already on the road, as in the photograph. */
  populate(ctx) {
    for (const lane of this.lanes) {
      lane.cars.length = 0; const n = this.target(lane, ctx); let s = lane.lengthM - this.rnd() * 14;
      const gap = Math.max(9, lane.lengthM / Math.max(0.5, n));
      while (s > 2) { if (this.rnd() < Math.min(1, n / (lane.lengthM / gap))) { const c = this.makeCar(lane, s, 8 + this.rnd() * 3); if (c) lane.cars.push(c); } s -= gap * (0.3 - Math.log(1 - this.rnd() * 0.95) * 0.7); }
      lane.nextSpawn = this.rnd() * 3;
    }
  }
  red(lane) { if (lane.signalM == null) return false; const g = lane.signal; return ((this.time + lane.phase) % (g.green + g.red)) >= g.green; }
  update(dt, ctx) {
    // which lanes and which photo's cars: the autumn photo has its own (narrower) asphalt
    this.closed = this.closedFor(ctx);
    const setName = ctx.season.autumn > 0.02 ? 'autumn' : 'base', lib = ctx.blend.cover > 0.5 ? 'winter-snow' : ctx.season.autumn > 0.5 ? 'autumn' : 'master';
    if (setName !== this.setName || lib !== this.lib) { this.setName = setName; this.lib = lib; this.populate(ctx); }
    if (dt <= 0) return;
    this.time += dt;
    const e = ctx.env, vWeather = (1 - 0.22 * e.rain) * (1 - 0.3 * e.fog) * (1 - 0.5 * e.snow), V0 = 12.5 * vWeather;   // 45 km/h in town
    for (const lane of this.lanes) {
      const cars = lane.cars, red = this.red(lane);                                     // cars[0] is the leader (largest s)
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i], v0 = V0 * c.v0k; let gap = 1e9, dv = 0;
        if (i > 0) { const l = cars[i - 1]; gap = l.s - l.len - c.s; dv = c.v - l.v; }
        if (red && c.s < lane.signalM - 0.5) { const g2 = lane.signalM - c.s; if (g2 < gap) { gap = g2; dv = c.v; } }   // a red light is a standing obstacle at the stop line
        // intelligent-driver model: free-road term and interaction term
        const sStar = 2.2 + c.v * 1.25 + c.v * dv / (2 * Math.sqrt(1.3 * 2.2)), acc = 1.3 * (1 - (c.v / v0) ** 4 - (gap < 1e8 ? (Math.max(0, sStar) / Math.max(0.3, gap)) ** 2 : 0));
        c.v = clamp(c.v + clamp(acc, -6, 1.3) * dt, 0, v0 * 1.15);
        c.s += c.v * dt; c.age += dt;
        if (i > 0) { const l = cars[i - 1], lim = l.s - l.len - 0.6; if (c.s > lim) { c.s = lim; c.v = Math.min(c.v, l.v); } }   // never overlap
      }
      // leave: only at the declared end of the lane
      while (cars.length && cars[0].s >= lane.lengthM - 0.5) { const c = cars.shift(); this.event('despawn', lane, lane.lengthM - 1, lane.end); }
      // arrive: only at the declared start, when there is room
      lane.nextSpawn -= dt;
      if (lane.nextSpawn <= 0) {
        const n = this.target(lane, ctx), last = cars[cars.length - 1], room = !last || last.s - last.len > 9;
        if (n > 0.05 && room && cars.length < n * 1.15 + 1) {
          const c = this.makeCar(lane, 0, Math.min(V0 * 0.8, last ? last.v + 1 : V0 * 0.8)); if (c) { cars.push(c); this.event('spawn', lane, 0, lane.start); }
        }
        const mean = n > 0.05 ? lane.lengthM / (n * V0 * 0.72) : 6;               // seconds between arrivals for the wanted density
        lane.nextSpawn = mean * (0.35 - Math.log(1 - this.rnd() * 0.98) * 0.65);
      }
    }
  }
  event(type, lane, s, zone) {
    const p = this.at(lane, s, P), ok = zone === 'far' || zone === 'edge' || (zone === 'hide' && !p.vis);
    this.events[type]++; if (!ok) { this.events.midRoad++; this.events.log.push({ type, lane: lane.id, set: lane.set, zone, x: +p.x.toFixed(1), y: +p.y.toFixed(1) }); }
  }
  /** Alpha of a car from where it is on its lane: 0 while hidden, fades through the haze at a far end. */
  alpha(lane, c, p) {
    if (!p.vis) return 0;
    let a = 1;
    if (lane.start === 'far') a *= clamp(c.s / FAR_FADE);
    if (lane.end === 'far') a *= clamp((lane.lengthM - c.s) / FAR_FADE);
    return a;
  }
  /** Draw: bodies into the traffic layer (relit with the photo), lights into the sprite layer. Far cars first. */
  draw(layer, sp, ctx) {
    layer.begin();
    const list = this.list || (this.list = []); list.length = 0;
    for (const lane of this.lanes) for (const c of lane.cars) { const p = this.at(lane, c.s, P), a = this.alpha(lane, c, p); if (a > 0.01) list.push({ lane, c, x: p.x, y: p.y, ppm: p.ppm, a }); }
    list.sort((u, v) => u.y - v.y);
    const b = ctx.blend, night = b.lightsOn, e = ctx.env, C = this.cell, sun = ctx.sunDir || [0, 1, 0];
    // contact shadow: mostly ambient occlusion; the directional part only when the sun is not where the photo has it
    const shA = 0.10 + 0.20 * b.sunVis * b.relight, shX = clamp(-sun[0] / Math.max(0.18, sun[1]), -1.6, 1.6);
    for (const it of list) {
      const s = this.sprites[it.c.sprite], k = clamp(it.ppm / s.ppm, 0.45, 1.4), wCar = CAR_W * it.ppm, t = it.c.tint;
      layer.add(it.x - wCar * 0.62 + shX * wCar * 0.3, it.y - wCar * 0.2, wCar * 1.24, wCar * 0.5, 2, 2, C - 4, C - 4, 0, 0, 0, shA * it.a);
      const jx = it.c.lat * Math.min(1.2, wCar * 0.2);   // a little lateral scatter inside the lane (the lane keeps > 1.2 px to the kerb)
      layer.add(it.x + jx - s.ax * k, it.y - s.ay * k, s.w * k, s.h * k, s.u, s.v, s.w, s.h, t[0], t[1], t[2], it.a);
    }
    layer.flush(this.setName === 'autumn');
    if (night > 0.03) for (const it of list) {
      const head = it.lane.seen === 'head', col = head ? HEAD : TAIL, wCar = CAR_W * it.ppm, fg = groundFog(e, it.y), inten = night * it.a * (1 - fg * 0.6);
      const depth = clamp((it.y - 318) / 623 / 1.25 + 0.012, 0, 1), r = (head ? 0.8 + 0.42 * wCar : 0.7 + 0.32 * wCar) * (1 + e.fog * 1.0 + e.rain * 0.12), ly = it.y - wCar * 0.2;
      if (wCar > 4.2) { // near enough to resolve the pair of lamps
        sp.add(it.x - wCar * 0.3, ly, r, r, 0, 11, -depth, 0, col[0], col[1], col[2], -inten * (head ? 0.8 : 0.7));
        sp.add(it.x + wCar * 0.3, ly, r, r, 0, 11, -depth, 0, col[0], col[1], col[2], -inten * (head ? 0.8 : 0.7));
      } else sp.add(it.x, ly, r * 1.15, r * 1.15, 0, 11, -depth, 0, col[0], col[1], col[2], -inten * (head ? 0.95 : 0.8));
      // light on the asphalt in front of / behind the car (toward the camera for oncoming cars), longer and brighter when wet
      const spill = (head ? 0.12 : 0.05) + e.wet * (head ? 0.16 : 0.13);
      sp.add(it.x, it.y + wCar * (0.25 + 0.3 * e.wet), wCar * 0.5, wCar * (0.45 + 0.5 * e.wet), 0, 12, -depth, 0, col[0], col[1], col[2], -inten * spill);
    }
  }
  /** QA: every drawn car must have its footprint on the asphalt mask, and no two cars of a lane may overlap. */
  audit() {
    let overlaps = 0, offRoad = 0, visible = 0; const m = this.cpuRoad, ch = this.setName === 'autumn' ? 1 : 0;
    for (const lane of this.lanes) {
      for (let i = 0; i < lane.cars.length; i++) {
        const c = lane.cars[i]; if (i > 0 && lane.cars[i - 1].s - lane.cars[i - 1].len < c.s - 1e-6) overlaps++;
        const p = this.at(lane, c.s, P); if (this.alpha(lane, c, p) < 0.01) continue; visible++;
        const xi = Math.round(p.x), yi = Math.round(p.y); if (!m || !m.data[(yi * m.w + xi) * 4 + ch]) offRoad++;
      }
    }
    return { cars: this.count, visible, overlaps, offRoad, spawn: this.events.spawn, despawn: this.events.despawn, midRoad: this.events.midRoad };
  }
}
const P = { x: 0, y: 0, ppm: 1, vis: 1 }, NONE = new Set();
