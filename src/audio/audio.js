// Sound: everything is synthesised with Web Audio (no audio files). Off until the user presses the sound button.
import { clamp, lerp } from '../engine/blend.js';
import { SPECIAL_AUDIO } from '../special/audio-profiles.js';

export class Sound {
  constructor() { this.ctx = null; this.on = false; this.vol = 0.7; this.tick = 0; this.nextChirp = 1; this.specialId = null; this.nextSpecialEvent = 18; this.voices = new Set(); }
  get available() { return !!(window.AudioContext || window.webkitAudioContext); }
  noise(brown) {
    const ac = this.ctx, len = ac.sampleRate * 4, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0); let l = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (brown) { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; } else d[i] = w; }
    return b;
  }
  /** Must be called from a user gesture. */
  enable() {
    this.on = true;
    if (this.ctx) { this.ctx.resume && this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ac = this.ctx = new AC();
    this.master = ac.createGain(); this.master.gain.value = 0;
    this.lp = ac.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 16000;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(this.lp); this.lp.connect(comp); comp.connect(ac.destination);
    this.white = this.noise(false); this.brown = this.noise(true);
    const f = (type, fr, q) => { const x = ac.createBiquadFilter(); x.type = type; x.frequency.value = fr; if (q) x.Q.value = q; return x; };
    const g = () => { const x = ac.createGain(); x.gain.value = 0; return x; };
    const loop = (buf, chain) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; let n = s; for (const c of chain) { n.connect(c); n = c; } n.connect(this.master); s.start(0, Math.random() * 3); };
    this.rainG = g(); loop(this.white, [f('highpass', 900), f('lowpass', 7000), this.rainG]);
    this.rainLowG = g(); loop(this.brown, [f('lowpass', 400), this.rainLowG]);
    this.windBp = f('bandpass', 380, 0.9); this.windG = g(); loop(this.brown, [this.windBp, this.windG]);
    this.windBp2 = f('bandpass', 900, 6); this.windG2 = g(); loop(this.white, [this.windBp2, this.windG2]);
    this.cityG = g(); loop(this.brown, [f('lowpass', 240), this.cityG]);
    this.cityHiG = g(); loop(this.white, [f('bandpass', 1100, 0.6), this.cityHiG]);
    this.fountG = g(); loop(this.white, [f('bandpass', 2600, 0.7), this.fountG]);
    // crickets: a 4.4 kHz tone chopped by two square LFOs
    const osc = ac.createOscillator(); osc.frequency.value = 4400;
    const am1 = ac.createGain(); am1.gain.value = 0; const l1 = ac.createOscillator(); l1.type = 'square'; l1.frequency.value = 32; const l1g = ac.createGain(); l1g.gain.value = 0.5; l1.connect(l1g); l1g.connect(am1.gain);
    const am2 = ac.createGain(); am2.gain.value = 0; const l2 = ac.createOscillator(); l2.type = 'square'; l2.frequency.value = 1.6; const l2g = ac.createGain(); l2g.gain.value = 0.5; l2.connect(l2g); l2g.connect(am2.gain);
    this.crickG = g(); osc.connect(am1); am1.connect(am2); am2.connect(this.crickG); this.crickG.connect(this.master); osc.start(); l1.start(); l2.start();
    const drone = ac.createOscillator(); drone.type = 'sine'; drone.frequency.value = 82;
    this.droneG = g(); drone.connect(this.droneG); this.droneG.connect(this.master); drone.start();
  }
  disable() { this.on = false; if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.025); }
  setVolume(v) { this.vol = clamp(v); }
  suspend(hidden) { if (this.ctx) hidden ? this.ctx.suspend() : (this.on && this.ctx.resume()); }
  setSpecialScene(id) {
    if (this.specialId === id) return;
    this.specialId = id;
    this.nextSpecialEvent = 12 + Math.random() * 18;
    this.nextChirp = 3 + Math.random() * 7;
    for (const source of this.voices) { try { source.stop(); } catch { /* Already ended. */ } }
    this.voices.clear();
  }
  track(source) {
    this.voices.add(source);
    source.addEventListener('ended', () => { this.voices.delete(source); source.disconnect(); }, { once: true });
  }
  chirp(level = .045) {
    const ac = this.ctx, t = ac.currentTime, n = 2 + Math.floor(Math.random() * 4), b = 2600 + Math.random() * 2400;
    for (let i = 0; i < n; i++) {
      const o = ac.createOscillator(), g = ac.createGain(), st = t + i * (0.09 + Math.random() * 0.06);
      o.frequency.setValueAtTime(b * (1 + Math.random() * 0.3), st); o.frequency.exponentialRampToValueAtTime(b * (0.7 + Math.random() * 0.7), st + 0.07);
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(level, st + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.09);
      o.connect(g); g.connect(this.master); o.start(st); o.stop(st + 0.1);
    }
  }
  /** Thunder arrives about 2.9 s per kilometre after the flash. */
  thunder(km) {
    if (!this.ctx || !this.on) return;
    const ac = this.ctx, t = ac.currentTime + km * 2.9, near = clamp(1 - km / 6), s = ac.createBufferSource(); s.buffer = this.brown;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220 + near * 900;
    const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25 + near * 0.9, t + 0.03 + (1 - near) * 0.45);
    const dur = 3 + (1 - near) * 4; g.gain.setTargetAtTime(0.0001, t + 0.4, dur / 4);
    s.connect(lp); lp.connect(g); g.connect(this.master); this.track(s); s.start(t, Math.random() * 2); s.stop(t + dur + 2);
  }
  plane(dur) {
    if (!this.ctx || !this.on) return;
    const ac = this.ctx, t = ac.currentTime, s = ac.createBufferSource(); s.buffer = this.brown; s.loop = true;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(160, t); lp.frequency.linearRampToValueAtTime(330, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(170, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t + dur * 0.5); g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(lp); lp.connect(g); g.connect(this.master); this.track(s); s.start(t); s.stop(t + dur + 0.1);
  }
  specialAccent(kind, level) {
    if (!this.ctx || !this.on) return;
    const ac = this.ctx, t = ac.currentTime, oscillator = ac.createOscillator(), gain = ac.createGain();
    oscillator.type = kind === 'ice' ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(kind === 'ice' ? 520 : 160, t);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'ice' ? 95 : 70, t + .55);
    gain.gain.setValueAtTime(.0001, t);
    gain.gain.linearRampToValueAtTime((kind === 'ice' ? .025 : .012) * level, t + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, t + .58);
    oscillator.connect(gain); gain.connect(this.master); this.track(oscillator); oscillator.start(t); oscillator.stop(t + .6);
  }
  updateSpecial(step, special, time, tgt) {
    this.setSpecialScene(special.id);
    const profile = SPECIAL_AUDIO[special.id], level = .35 + .75 * special.intensity;
    const night = special.light?.night || 0, day = special.light?.day || 0;
    const gust = .7 + .3 * Math.sin(time * .51) * Math.sin(time * .17 + 1);
    const quiet = special.id === 'abandoned' ? .32 + .68 * day : 1;
    const rain = ['abandoned', 'cyberpunk'].includes(special.id) ? (special.condition === 'rain' ? .18 * level : 0) : profile.rain * level;
    tgt(this.lp.frequency, special.id === 'ice-age' ? 3400 : special.id === 'sandstorm' ? 5000 : 10500, .7);
    tgt(this.rainG.gain, rain); tgt(this.rainLowG.gain, rain * .5);
    tgt(this.windG.gain, profile.wind * level * quiet * gust);
    tgt(this.windBp.frequency, special.id === 'ice-age' ? 240 + 190 * gust : 340 + 340 * gust, .5);
    tgt(this.windG2.gain, profile.highWind * level * quiet * gust);
    tgt(this.cityG.gain, profile.city * (special.id === 'cyberpunk' ? .4 + .6 * night : 1), .7);
    tgt(this.cityHiG.gain, profile.city * .05, .7);
    tgt(this.fountG.gain, 0, .4); tgt(this.crickG.gain, 0, .4);
    tgt(this.droneG.gain, profile.drone * (.35 + .65 * night), .7);
    this.nextSpecialEvent -= step;
    if (this.on && profile.event && this.nextSpecialEvent <= 0) {
      this.specialAccent(profile.event, quiet);
      this.nextSpecialEvent = 15 + Math.random() * 26;
    }
    this.nextChirp -= step;
    if (this.on && special.id === 'abandoned' && day > .45 && special.condition !== 'rain' && this.nextChirp <= 0) {
      this.chirp(.012); this.nextChirp = 9 + Math.random() * 16;
    }
  }
  /** Follow the scene. Called every frame; applies changes about ten times a second. */
  update(dt, { env, season, alt, activity, time, special = null }) {
    if (!this.ctx) return; this.tick += dt; if (this.tick < 0.1) return; const step = this.tick; this.tick = 0;
    const t = this.ctx.currentTime, k = 0.35, tgt = (p, v, tc = k) => p.setTargetAtTime(v, t, tc);
    tgt(this.master.gain, this.on ? this.vol : 0, this.on ? .25 : .025);
    if (special) { this.updateSpecial(step, special, time, tgt); return; }
    this.setSpecialScene(null);
    tgt(this.droneG.gain, 0, .5);
    const muffle = Math.max(env.snow, env.cover * 0.6); tgt(this.lp.frequency, lerp(16000, 1400, muffle), 0.6); // snow swallows the highs
    tgt(this.rainG.gain, env.rain * 0.32); tgt(this.rainLowG.gain, env.rain * 0.18);
    const gust = 0.65 + 0.35 * Math.sin(time * 0.7) * Math.sin(time * 0.23 + 1), w = (0.04 + env.wind * 0.5 + env.storm * 0.2) * gust;
    tgt(this.windG.gain, w * 0.5, 0.3); tgt(this.windBp.frequency, 260 + 500 * env.wind * gust, 0.4); tgt(this.windG2.gain, Math.max(0, env.wind - 0.45) * 0.05 * gust, 0.4);
    tgt(this.cityG.gain, activity * 0.2 * (1 - muffle * 0.7), 0.8); tgt(this.cityHiG.gain, activity * 0.012 * (1 - muffle) * (1 + env.wet), 0.8);
    tgt(this.fountG.gain, env.water * 0.045 * (1 - muffle), 0.8);
    const warm = season.summer + season.spring * 0.3;
    tgt(this.crickG.gain, warm > 0.6 && alt < -3 && env.rain < 0.1 && env.storm < 0.1 ? 0.03 * warm : 0, 1);
    const birds = season.winter < 0.35 && alt > -3 && alt < 35 && env.rain < 0.15 && env.snow < 0.2 && env.storm < 0.1;
    this.nextChirp -= step;
    if (this.on && birds && this.nextChirp <= 0) { this.chirp(); this.nextChirp = (season.autumn > 0.5 ? 2.5 : 0.7) * (0.4 + Math.random() * 1.4) * (alt < 12 ? 0.6 : 1); }
  }
}
