import { lerp, sstep } from '../engine/blend.js';

// A lightweight lunar cycle for the cinematic sky. The reference is a known new moon
// (6 January 2000, 18:14 UTC); this is phase-aware, not a lunar ephemeris.
const NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_DAYS = 29.530588853;

export function moonPhase(y, m, d, hour) {
  const days = (Date.UTC(y, m, d) + hour * 3600000 - NEW_MOON_UTC) / 86400000;
  return ((days / SYNODIC_DAYS) % 1 + 1) % 1;
}

export function moonParameters(S, darkness, env) {
  const phase = moonPhase(S.y, S.m, S.d, S.hour);
  const clear = Math.max(0, 1 - env.cloud * 0.65 - env.fog * 0.95 - env.storm * 0.9);
  // Quarter phases can be seen by daylight. Fade toward new and full Moon in
  // daylight without changing the scene's existing lunar path or phase.
  const age = Math.min(phase, 1 - phase);
  const daylight = .38 * sstep(.07, .18, age) * (1 - sstep(.34, .46, age));
  const visibility = clear * lerp(daylight, 1, darkness);
  // A small date and time variation avoids pinning the moon to one sky pixel.
  const x = 0.48 + 0.055 * Math.sin(phase * Math.PI * 2 + S.hour * 0.08);
  const y = 0.15 + 0.015 * Math.cos(S.hour * 0.19 + phase * Math.PI * 2);
  return [x, y, phase, visibility];
}
