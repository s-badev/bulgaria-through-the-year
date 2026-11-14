// Adaptive quality: watches the real frame time and steps render scale, particle counts and shadow steps down
// (and cautiously back up). Never judges by a software renderer's fps: QA runs with a fixed level.
const LEVELS = [
  { name: 'high', scale: 1, dprCap: 2, particles: 1, shadowSteps: 30, grain: 0.022, maxPhotos: 12 },
  { name: 'medium', scale: 1, dprCap: 1.5, particles: 0.7, shadowSteps: 24, grain: 0.022, maxPhotos: 12 },
  { name: 'low', scale: 0.85, dprCap: 1.25, particles: 0.45, shadowSteps: 18, grain: 0.02, maxPhotos: 8 },
  { name: 'minimum', scale: 0.7, dprCap: 1, particles: 0.25, shadowSteps: 14, grain: 0.016, maxPhotos: 6 },
];
export class Quality {
  constructor({ mobile = false, fixed = false } = {}) { this.level = mobile ? 1 : 0; this.fixed = fixed; this.mobile = mobile; this.slow = 0; this.fast = 0; this.cool = 3; this.onChange = null; this.changes = 0; }
  get cur() { return LEVELS[this.level]; }
  get scale() { return this.cur.scale; } get dprCap() { return this.cur.dprCap; } get particles() { return this.cur.particles; }
  get shadowSteps() { return this.cur.shadowSteps; } get grain() { return this.cur.grain; } get maxPhotos() { return this.mobile ? Math.min(8, this.cur.maxPhotos) : this.cur.maxPhotos; }
  get name() { return this.cur.name; }
  /** dtAvg: smoothed real frame time (s). */
  update(dtAvg, dt) {
    if (this.fixed) return;
    if (this.cool > 0) { this.cool -= dt; return; }
    const target = this.mobile ? 1 / 30 : 1 / 60;
    if (dtAvg > target * 1.45) { this.slow += dt; this.fast = 0; } else if (dtAvg < target * 1.08) { this.fast += dt; this.slow = Math.max(0, this.slow - dt); } else { this.fast = 0; }
    if (this.slow > 2 && this.level < LEVELS.length - 1) this.set(this.level + 1);
    else if (this.fast > 25 && this.level > (this.mobile ? 1 : 0) && this.changes < 6) this.set(this.level - 1);
  }
  set(level) { this.level = level; this.slow = this.fast = 0; this.cool = 4; this.changes++; this.onChange && this.onChange(this); }
}
export { LEVELS };
