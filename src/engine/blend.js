// State blending: (time of day, season, weather) -> anchor weights + lighting parameters for the compositor.
// Pure functions, no DOM/GL: this is what tests/unit/blend.test.js exercises.
export const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Continuous season weights from the day of year. Plateaus follow Sofia's climate; transitions are smooth. */
const SEASON_PLATEAUS = [ // [start, end] day-of-year of the pure season
  ['winter', 344, 51 + 365], ['spring', 91, 140], ['summer', 171, 244], ['autumn', 283, 319],
];
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export function seasonWeights(doy) {
  const w = { spring: 0, summer: 0, autumn: 0, winter: 0 };
  const P = [['winter', -21, 51], ['spring', 91, 140], ['summer', 171, 244], ['autumn', 283, 319], ['winter', 344, 416]];
  const x = doy < 51.0001 ? doy : doy; // winter plateau is listed twice so the year wraps
  for (let i = 0; i < P.length; i++) {
    const [name, a, b] = P[i];
    if (x >= a && x <= b) { w[name] = 1; return w; }
    if (i + 1 < P.length && x > b && x < P[i + 1][1]) { const t = sstep(b, P[i + 1][1], x); w[name] += 1 - t; w[P[i + 1][0]] += t; return w; }
  }
  w.winter = 1; return w;
}
/** Representative date (month 0-based, day) for each season button. */
export const SEASON_DATE = { spring: [3, 22], summer: [6, 15], autumn: [9, 20], winter: [0, 18] };
export function dominantSeason(w) { return SEASONS.reduce((a, b) => (w[b] > w[a] ? b : a), 'summer'); }

/** Weather presets -> target environment (smoothed over time by the state). */
export const WEATHER = {
  clear: { cloud: 0.04, rain: 0, snow: 0, fog: 0, storm: 0 },
  cloudy: { cloud: 0.85, rain: 0, snow: 0, fog: 0, storm: 0 },
  fog: { cloud: 0.22, rain: 0, snow: 0, fog: 1, storm: 0 },
  rain: { cloud: 0.95, rain: 0.75, snow: 0, fog: 0.15, storm: 0 },
  storm: { cloud: 1, rain: 1, snow: 0, fog: 0, storm: 1 },
  snow: { cloud: 0.93, rain: 0, snow: 0.85, fog: 0.12, storm: 0 },
};
/** Snow is only possible in the cold part of the year (no snow in summer). */
export function snowAllowed(doy) { return doy >= 305 || doy <= 105; }

// Sky keyframes in linear RGB, sampled from the photographs themselves (tools/dev-stats.mjs).
const SKY = [ // alt, zenith, far horizon, sun-side horizon, glow
  { alt: -18, zen: [0.0005, 0.003, 0.02], hor: [0.006, 0.016, 0.065], sun: [0.006, 0.016, 0.065], glow: 0 },
  { alt: -12, zen: [0.001, 0.008, 0.045], hor: [0.008, 0.03, 0.13], sun: [0.05, 0.05, 0.16], glow: 0.15 },
  { alt: -5, zen: [0.004, 0.11, 0.55], hor: [0.02, 0.16, 0.6], sun: [0.97, 0.37, 0.2], glow: 0.9 },
  { alt: 0, zen: [0.10, 0.22, 0.56], hor: [0.55, 0.38, 0.42], sun: [1.0, 0.62, 0.22], glow: 1 },
  { alt: 4, zen: [0.19, 0.32, 0.58], hor: [0.75, 0.52, 0.44], sun: [1.0, 0.82, 0.3], glow: 1 },
  { alt: 14, zen: [0.11, 0.30, 0.68], hor: [0.80, 0.78, 0.80], sun: [1.0, 0.93, 0.74], glow: 0.55 },
  { alt: 30, zen: [0.07, 0.27, 0.72], hor: [0.80, 0.84, 0.92], sun: [0.92, 0.92, 0.94], glow: 0.25 },
];
function key(table, alt, fields) {
  if (alt <= table[0].alt) return table[0];
  if (alt >= table[table.length - 1].alt) return table[table.length - 1];
  let i = 1; while (table[i].alt < alt) i++;
  const a = table[i - 1], b = table[i], t = sstep(a.alt, b.alt, alt), o = { alt };
  for (const f of fields) o[f] = Array.isArray(a[f]) ? mix3(a[f], b[f], t) : lerp(a[f], b[f], t);
  return o;
}
export const skyColors = alt => key(SKY, alt, ['zen', 'hor', 'sun', 'glow']);

// Light on the ground relative to the master photo, where sunlit = 1 (measured: shadow/sunlit = 0.084, 0.137, 0.223).
export const REF_LIGHT = { amb: [0.084, 0.137, 0.223], sun: [0.916, 0.863, 0.777] };
const LIGHT = [ // alt, direct sun colour*intensity, sky ambient. Dusk levels follow the exposure of the dawn photographs (blue hour ~45% of day).
  { alt: -18, sun: [0, 0, 0], amb: [0.030, 0.027, 0.030] },
  { alt: -10, sun: [0, 0, 0], amb: [0.075, 0.08, 0.12] },
  { alt: -5, sun: [0, 0, 0], amb: [0.36, 0.38, 0.52] },
  { alt: -1, sun: [0.03, 0.012, 0.005], amb: [0.44, 0.40, 0.46] },
  { alt: 1.5, sun: [0.45, 0.24, 0.10], amb: [0.30, 0.28, 0.34] },
  { alt: 5, sun: [0.80, 0.52, 0.27], amb: [0.17, 0.19, 0.27] },
  { alt: 14, sun: [0.93, 0.80, 0.60], amb: [0.095, 0.14, 0.223] },
  { alt: 30, sun: [0.916, 0.863, 0.777], amb: [0.084, 0.137, 0.223] },
];
export const lightColors = alt => key(LIGHT, alt, ['sun', 'amb']);

/**
 * Main blend. Inputs:
 *  sun: { elevation, azimuth }  (deg)        morning: boolean (sun east of the meridian)
 *  season: weights {spring, summer, autumn, winter}
 *  env: { cloud, rain, snow, fog, storm, wet, cover, fogLvl }
 *  has: which photos exist, e.g. { 'evening-golden': false, spring: false, ... }
 *  refSun: { azimuth, altitude } light baked into the master
 */
export function blendState({ sun, morning, season, env, has = {}, refSun = { azimuth: 105, altitude: 40 } }) {
  const alt = sun.elevation, az = sun.azimuth;
  const anchoredSide = morning ? !!has['dawn-golden'] && !!has['dawn-bluehour'] : !!has['evening-golden'] && !!has['evening-bluehour'];
  const overcast = clamp(Math.max(env.cloud * 1.05 - 0.05, env.storm, env.fog * 0.8));

  // --- time-of-day anchor weights (sum to 1) ---
  let wNight, wBlue = 0, wGold = 0, wDay;
  if (anchoredSide) {
    wNight = sstep(-5.5, -12, alt);
    const blueUp = sstep(-12, -5.5, alt), blueDown = sstep(1.5, -4, alt);
    wBlue = Math.min(blueUp, blueDown);
    const goldUp = sstep(-4, 1.5, alt), goldDown = sstep(16, 5, alt);
    wGold = Math.min(goldUp, goldDown);
    wDay = sstep(5, 16, alt);
    // clear-sky anchors make no sense under heavy cloud: fall back to the relit day image as the cloud thickens
    const k = sstep(0.55, 0.95, overcast);
    wDay += (wGold + wBlue * 0.65) * k; wBlue *= 1 - 0.65 * k; wGold *= 1 - k;
    const s = wNight + wBlue + wGold + wDay; wNight /= s; wBlue /= s; wGold /= s; wDay /= s;
  } else {
    // computed side: the relit day carries dusk; the night photo takes over once it is properly dark
    wNight = sstep(-7, -13, alt); wDay = 1 - wNight;
  }
  if (has.night === false) { const s = wDay + wGold + wBlue || 1; wDay = (wDay || 1e-6) / s; wGold /= s; wBlue /= s; wNight = 0; if (wDay + wGold + wBlue < 0.999) wDay = 1 - wGold - wBlue; } // night photo still streaming
  // --- season: the two neighbouring seasons and the mix between them ---
  const order = SEASONS, present = order.filter(s => season[s] > 1e-4);
  let sA = present[0] || 'summer', sB = present[1] || sA;
  if (present.length === 2 && sA === 'spring' && sB === 'winter') { sA = 'winter'; sB = 'spring'; } // keep chronological order
  const sT = sA === sB ? 0 : season[sB] / (season[sA] + season[sB]);
  const winter = season.winter, cover = clamp(Math.max(winter, env.cover));

  // --- relighting of the day image ---
  const L = lightColors(alt);
  const sunVis = (1 - sstep(0.25, 0.95, overcast)) * sstep(-1.2, 1.2, alt);
  const dAz = Math.abs(((az - refSun.azimuth + 540) % 360) - 180);
  // 0 = leave the photograph alone (sun where the photo has it), 1 = fully re-light (other side of the sky, dusk, overcast)
  const relight = clamp(Math.max(sstep(18, 75, dAz), sstep(22, 8, alt), overcast, cover * 0.0));
  const overAmb = mix3([0.46, 0.49, 0.58], [0.68, 0.71, 0.78], sstep(0, 24, alt)).map(v => v * sstep(-9, 5, alt) * (1 - 0.4 * env.storm));
  const sunCol = L.sun.map(v => v * sunVis);
  const amb = mix3(L.amb, overAmb.map((v, i) => Math.max(v, L.amb[i])), overcast);

  // --- artificial light ---
  const lightsOn = clamp(sstep(2, -5, alt) + overcast * 0.35 * sstep(10, 0, alt) + env.fog * 0.2 * sstep(8, 0, alt));

  // --- special photographs ---
  const dayness = sstep(-3, 6, alt);
  const wFogPhoto = has.fog ? clamp(season.autumn * env.fog * dayness * sstep(0.25, 0.6, env.fogLvl) * 0.85) : 0;
  const wRainNight = has['rain-night'] ? clamp(season.autumn * sstep(0.3, 0.8, env.wet) * wNight) : 0;
  const wWinterNight = has['winter-night'] ? cover : 0;

  // --- sky ---
  const sky = skyColors(alt);
  const cam = 180; // camera faces south
  const rel = ((az - cam + 540) % 360) - 180; // -90 = east (left), +90 = west (right)
  const sunX = 0.5 + rel / 72; // 72 deg horizontal field of view
  const stars = sstep(-7, -14, alt) * (1 - clamp(env.cloud * 1.2)) * (1 - env.fog);

  return {
    alt, az, morning, anchoredSide, overcast,
    wDay, wGold, wBlue, wNight,
    sA, sB, sT, cover, winter,
    relight, sunCol, amb, sunVis,
    lightsOn, dayness,
    wFogPhoto, wRainNight, wWinterNight,
    sky, sunX, sunSide: clamp(rel / 90, -1.5, 1.5), stars,
    golden: sstep(-2, 3, alt) * sstep(16, 5, alt) * (1 - overcast),
    alpenglow: sstep(-4, 0, alt) * sstep(8, 1, alt) * (1 - clamp(overcast * 1.2)),
  };
}
/** World-space sun direction: x = right (west), y = up, z = toward the camera (north). Camera faces south. */
export function sunDirection(az, alt) {
  const a = az * Math.PI / 180, e = alt * Math.PI / 180;
  return [-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}
