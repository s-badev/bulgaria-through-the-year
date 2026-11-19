// One clock for every system: a single requestAnimationFrame loop, paused while the tab is hidden.
export class Clock {
  constructor() { this.systems = []; this.time = 0; this.frame = 0; this.running = false; this.raf = 0; this.last = 0; this.dtAvg = 1 / 60; this.fixed = 0; }
  add(fn) { this.systems.push(fn); return this; }
  start() {
    if (this.running) return; this.running = true; this.last = performance.now();
    const loop = now => {
      if (!this.running) return;
      const raw = (now - this.last) / 1000; this.last = now;
      const dt = this.fixed || Math.min(0.05, Math.max(0, raw));
      this.dtAvg += (Math.min(0.25, raw) - this.dtAvg) * 0.05;
      this.step(dt);
      if (this.running) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', this.onVis = () => { if (document.hidden) { cancelAnimationFrame(this.raf); } else if (this.running) { this.last = performance.now(); this.raf = requestAnimationFrame(loop); } });
  }
  /** Advance all systems by dt (also used by tests and frame-exact screenshots). */
  step(dt) { this.time += dt; this.frame++; for (const fn of this.systems) fn(dt, this.time); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); document.removeEventListener('visibilitychange', this.onVis); }
}
/** Deterministic PRNG (mulberry32) so tests and screenshots are repeatable. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (a2, b) => a2 + (b - a2) * f(); f.int = n => Math.floor(f() * n); f.pick = arr => arr[Math.floor(f() * arr.length)];
  return f;
}
