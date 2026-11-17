// Application state: what the user chose (S) and the smoothed environment the renderer sees (V).
import { sunPosition, sunTimes, sofiaToUtc, utcToSofia, dayOfYear } from './sun.js';
import { seasonWeights, WEATHER, snowAllowed, clamp, dominantSeason, SEASON_DATE } from './blend.js';

export class State {
  constructor(location) {
    this.loc = location;
    this.S = { y: 2026, m: 6, d: 15, hour: 18.75, weather: 'clear', volcano: false, live: null, wind: 0.3, fogLvl: 0.55, playing: false, flashes: true, sound: false, vol: 0.7, reducedMotion: false };
    this.V = { cloud: 0.04, rain: 0, snow: 0, fog: 0, storm: 0, volcano: 0, wind: 0.3, fogLvl: 0.55, cover: 0, wet: 0, water: 1 };
    this.season = seasonWeights(196); this.seasonTarget = this.season; this.times = null; this.sun = { elevation: 30, azimuth: 180 }; this.morning = false;
    this.listeners = new Set();
    this.setDate(2026, 6, 15);
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what) { for (const fn of this.listeners) fn(what, this); }
  get doy() { return dayOfYear(this.S.y, this.S.m, this.S.d); }
  setDate(y, m, d) {
    const t = new Date(Date.UTC(y, m, d)); // normalises overflow (e.g. day 32)
    Object.assign(this.S, { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() });
    this.times = sunTimes(this.S.y, this.S.m, this.S.d, this.loc.lat, this.loc.lon);
    this.seasonTarget = seasonWeights(this.doy);
    this.emit('date');
  }
  setSeason(name) { const [m, d] = SEASON_DATE[name]; this.setDate(this.S.y, m, d); }
  setHour(h) { this.S.hour = ((h % 24) + 24) % 24; this.emit('hour'); }
  setWeather(w) { if (WEATHER[w]) { this.S.weather = w; this.S.live = null; this.emit('weather'); } }
  /** Live weather (Open-Meteo): exact cloud/rain/fog amounts instead of a preset. */
  setLive(m) { this.S.weather = m.preset; this.S.live = m.env; this.S.wind = m.wind; this.S.fogLvl = m.fogLvl; this.emit('weather'); this.emit('wind'); }
  set(key, value) { this.S[key] = value; this.emit(key); }
  /** Set the real current Sofia date and time. */
  setNow(ms = Date.now()) {
    const t = utcToSofia(ms);
    // Only recompute sunrise/sunset when the Sofia date changes.
    if (this.S.y !== t.y || this.S.m !== t.m || this.S.d !== t.d) this.setDate(t.y, t.m, t.d);
    // Live clock displays the *current* minute, not the next minute at second 30.
    this.setHour(Math.floor(t.hour * 60 + 1e-7) / 60);
  }
  get seasonName() { return dominantSeason(this.seasonTarget); }
  /** Snow needs the cold part of the year; otherwise the same clouds bring rain. */
  get effectiveWeather() { return this.S.weather === 'snow' && !snowAllowed(this.doy) ? 'rain' : this.S.weather; }
  targets() {
    const live = this.S.live; if (!live) return WEATHER[this.effectiveWeather];
    return snowAllowed(this.doy) || !live.snow ? live : { ...live, rain: Math.max(live.rain, live.snow), snow: 0 };
  }

  /** Advance the smoothed environment. dt in seconds. */
  update(dt) {
    const S = this.S, V = this.V, tg = this.targets();
    if (S.playing) { let h = S.hour + dt * 24 / 60; if (h >= 24) { h -= 24; this.setDate(S.y, S.m, S.d + 1); } S.hour = h; this.emit('tick'); }
    // seasons glide into each other (a jump of the date never pops); at most two seasons are ever mixed
    const ks = 1 - Math.exp(-dt / 1.3), se = this.season, tgs = this.seasonTarget, next = {}; let changed = false;
    for (const n of ['spring', 'summer', 'autumn', 'winter']) { next[n] = se[n] + (tgs[n] - se[n]) * ks; if (Math.abs(next[n] - tgs[n]) < 0.002) next[n] = tgs[n]; else changed = true; }
    if (changed) { const top = Object.keys(next).sort((a, b) => next[b] - next[a]).slice(0, 2), sum = next[top[0]] + next[top[1]]; this.season = { spring: 0, summer: 0, autumn: 0, winter: 0 }; for (const n of top) this.season[n] = next[n] / sum; } else this.season = tgs;
    const k = 1 - Math.exp(-dt / 1.6);
    for (const key of ['cloud', 'rain', 'snow', 'fog', 'storm']) V[key] += (tg[key] - V[key]) * k;
    V.volcano += ((S.volcano ? 1 : 0) - V.volcano) * (1 - Math.exp(-dt / 1.1));
    const k2 = 1 - Math.exp(-dt / 1.2);
    V.wind += (clamp(S.wind + (S.weather === 'storm' ? 0.35 : 0)) - V.wind) * k2;
    V.fogLvl += (S.fogLvl - V.fogLvl) * k2;
    // snow settles while it falls and melts afterwards (slowly in the cold season); rain wets the ground quickly and it dries slowly
    const winter = this.season.winter;
    V.cover = clamp(V.cover + (V.snow > 0.4 ? dt / 14 : -dt / (snowAllowed(this.doy) ? 70 : 12)), 0, 1);
    V.wet = clamp(V.wet + (V.rain > 0.3 ? dt / 5 : -dt / 28) + (V.snow > 0.4 && winter < 0.5 ? dt / 30 : 0), 0, 1);
    const waterOn = winter < 0.4 && V.cover < 0.25 && V.snow < 0.3 ? 1 : 0;
    V.water += (waterOn - V.water) * (1 - Math.exp(-dt / 1.5));
    this.computeSun();
  }
  /** Jump straight to the target environment (screenshots, tests, reduced motion). */
  settle() {
    const V = this.V, tg = this.targets(); this.season = this.seasonTarget;
    Object.assign(V, tg, { wind: clamp(this.S.wind + (this.S.weather === 'storm' ? 0.35 : 0)), fogLvl: this.S.fogLvl });
    V.volcano = this.S.volcano ? 1 : 0;
    V.cover = tg.snow > 0.4 ? 1 : 0; V.wet = tg.rain > 0.3 ? 1 : 0; delete V.wind2;
    V.water = this.season.winter < 0.4 && V.cover < 0.25 ? 1 : 0;
    this.computeSun();
  }
  computeSun() {
    const S = this.S, p = sunPosition(sofiaToUtc(S.y, S.m, S.d, S.hour), this.loc.lat, this.loc.lon);
    this.sun = p; this.morning = p.hourAngle < 0;
    return p;
  }
  /** City activity 0..1 by local hour (traffic density, city hum). */
  get activity() { return State.activityAt(this.S.hour); }
  static activityAt(h) { const s = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); }; return 0.08 + 0.92 * s(4.5, 8, h) * s(23.8, 19.5, h) * (0.75 + 0.25 * (s(7, 8.5, h) * s(10.5, 9, h) + s(16.5, 17.5, h) * s(19.5, 18.5, h))); }
  snapshot() { return { sun: this.sun, morning: this.morning, season: this.season, env: this.V, date: this.S }; }
}
