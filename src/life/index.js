// Life + weather orchestration: one update and one draw per frame into the shared sprite layer.
import { Sprites } from '../render/sprites.js';
import { Traffic } from './traffic.js';
import { Lamps, Fountains, Insects, Leaves } from './ground.js';
import { Planes, Birds } from './air.js';
import { Rain, Snow, Lightning } from '../weather/precip.js';
import { rng } from '../engine/clock.js';
import { sstep } from '../engine/blend.js';

const FOUNTAIN_COLORS = [[0.2, 0.5, 1], [0.5, 0.3, 1], [0.15, 0.8, 0.7]];
export class Life {
  constructor(gl, scene, { seed = 20260715, hooks = {} } = {}) {
    this.scene = scene; this.sprites = new Sprites(gl);
    const r = rng(seed);
    this.traffic = new Traffic(scene, r); this.lamps = new Lamps(scene); this.fountains = new Fountains(scene);
    this.insects = new Insects(scene, r); this.leaves = new Leaves(scene, r);
    this.planes = new Planes(scene, r, hooks.onPlane); this.birds = new Birds(scene, r);
    this.rain = new Rain(scene, r); this.snow = new Snow(scene, r); this.lightning = new Lightning(scene, r, hooks.onBolt);
    this.ctx = { quality: 1, fountainColor: FOUNTAIN_COLORS[0] };
  }
  /** Build the per-frame context shared by all systems. */
  context(state, blend, time, quality) {
    const c = this.ctx;
    c.env = state.V; c.season = state.season; c.blend = blend; c.time = time; c.hour = state.S.hour; c.activity = state.activity; c.quality = quality;
    c.flashes = state.S.flashes; c.reduced = state.S.reducedMotion; c.dayLight = sstep(-7, 14, blend.alt) * (1 - 0.35 * state.V.cloud) * (1 - 0.3 * state.V.storm);
    const k = Math.floor(time / 4) % 3, f = (time / 4) % 1, a = FOUNTAIN_COLORS[k], b = FOUNTAIN_COLORS[(k + 1) % 3], t = sstep(0.75, 1, f);
    c.fountainColor = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    return c;
  }
  update(dt, ctx) {
    if (ctx.reduced) dt = 0; // reduced motion: everything holds still (lights and seasons still follow the state)
    this.traffic.update(dt, ctx); this.insects.update(dt || 0.016, ctx); this.leaves.update(dt, ctx);
    this.planes.update(dt, ctx); this.birds.update(dt, ctx); this.rain.update(dt, ctx); this.snow.update(dt, ctx);
    this.lightning.update(dt || 0.016, ctx);
  }
  draw(ctx, view) {
    const sp = this.sprites; sp.begin();
    this.lamps.draw(sp, ctx); this.traffic.draw(sp, ctx); this.fountains.draw(sp, ctx);
    this.planes.draw(sp, ctx); this.birds.draw(sp, ctx); this.insects.draw(sp, ctx); this.leaves.draw(sp, ctx);
    this.lightning.draw(sp, ctx); this.snow.draw(sp, ctx); this.rain.draw(sp, ctx);
    sp.flush(view, this.scene.size, this.scene.tex.geo);
  }
}
