import test from 'node:test';
import assert from 'node:assert/strict';
import { blendState, seasonWeights, snowAllowed, sunDirection, skyColors, lightColors, WEATHER } from '../../src/engine/blend.js';

const ALL = { 'dawn-golden': true, 'dawn-bluehour': true, night: true, 'winter-night': true, 'rain-night': true, fog: true };
const env = (o = {}) => ({ cloud: 0.04, rain: 0, snow: 0, fog: 0, storm: 0, wet: 0, cover: 0, fogLvl: 0.55, ...o });
const summer = seasonWeights(196), autumn = seasonWeights(293), winter = seasonWeights(18), spring = seasonWeights(112);

test('season weights are continuous, normalised and pure on the season dates', () => {
  let prev = seasonWeights(365);
  for (let d = 1; d <= 366; d++) {
    const w = seasonWeights(d), sum = w.spring + w.summer + w.autumn + w.winter;
    assert.ok(Math.abs(sum - 1) < 1e-9, 'sum at ' + d);
    for (const k of Object.keys(w)) assert.ok(Math.abs(w[k] - prev[k]) < 0.06, `jump in ${k} at day ${d}`);
    prev = w;
  }
  assert.equal(summer.summer, 1); assert.equal(autumn.autumn, 1); assert.equal(winter.winter, 1); assert.equal(spring.spring, 1);
});

test('time-of-day weights always sum to 1 and are continuous in sun elevation', () => {
  for (const morning of [true, false]) {
    let prev = null;
    for (let alt = -30; alt <= 70; alt += 0.25) {
      const b = blendState({ sun: { elevation: alt, azimuth: morning ? 90 : 270 }, morning, season: summer, env: env(), has: ALL });
      assert.ok(Math.abs(b.wDay + b.wGold + b.wBlue + b.wNight - 1) < 1e-9);
      if (prev) for (const k of ['wDay', 'wGold', 'wBlue', 'wNight', 'lightsOn', 'relight']) assert.ok(Math.abs(b[k] - prev[k]) < 0.08, `${k} jumps at alt ${alt} (${morning ? 'morning' : 'evening'})`);
      prev = b;
    }
  }
});

test('dawn photographs are never used in the evening (4.2)', () => {
  for (let alt = -20; alt <= 30; alt += 0.5) {
    const b = blendState({ sun: { elevation: alt, azimuth: 285 }, morning: false, season: summer, env: env(), has: ALL });
    assert.equal(b.wGold, 0); assert.equal(b.wBlue, 0); assert.equal(b.anchoredSide, false);
  }
  const m = blendState({ sun: { elevation: 3, azimuth: 70 }, morning: true, season: summer, env: env(), has: ALL });
  assert.ok(m.wGold > 0.9, 'golden dawn photo carries the sunrise');
  const e = blendState({ sun: { elevation: 3, azimuth: 290 }, morning: false, season: summer, env: env(), has: { ...ALL, 'evening-golden': true, 'evening-bluehour': true } });
  assert.ok(e.anchoredSide && e.wGold > 0.9, 'evening photos are picked up automatically when present');
});

test('light comes from the left in the morning and from the right in the evening (camera faces south)', () => {
  assert.ok(sunDirection(90, 10)[0] < -0.9, 'east = left');
  assert.ok(sunDirection(270, 10)[0] > 0.9, 'west = right');
  assert.ok(sunDirection(180, 45)[2] < 0, 'south = away from the camera');
  const m = blendState({ sun: { elevation: 5, azimuth: 80 }, morning: true, season: summer, env: env(), has: ALL });
  const e = blendState({ sun: { elevation: 5, azimuth: 280 }, morning: false, season: summer, env: env(), has: ALL });
  assert.ok(m.sunX < 0.5 && m.sunSide < 0); assert.ok(e.sunX > 0.5 && e.sunSide > 0);
  assert.ok(e.relight > 0.95, 'evening is fully relit from the day state');
});

test('the photograph is left untouched when the sun stands where the photo has it', () => {
  const b = blendState({ sun: { elevation: 40, azimuth: 105 }, morning: true, season: summer, env: env(), has: ALL });
  assert.ok(b.relight < 0.05 && b.wDay > 0.99);
});

test('night: lamps on, night photo in charge; winter night uses the winter-night photo', () => {
  const n = blendState({ sun: { elevation: -25, azimuth: 0 }, morning: false, season: summer, env: env(), has: ALL });
  assert.ok(n.wNight > 0.999 && n.lightsOn > 0.999 && n.wWinterNight === 0);
  const w = blendState({ sun: { elevation: -25, azimuth: 0 }, morning: false, season: winter, env: env(), has: ALL });
  assert.equal(w.wWinterNight, 1); assert.equal(w.cover, 1);
  const d = blendState({ sun: { elevation: 45, azimuth: 180 }, morning: false, season: summer, env: env(), has: ALL });
  assert.equal(d.lightsOn, 0);
});

test('no snow in summer; special photos only in their own state', () => {
  assert.equal(snowAllowed(196), false); assert.equal(snowAllowed(18), true); assert.equal(snowAllowed(330), true);
  const s = blendState({ sun: { elevation: 30, azimuth: 150 }, morning: true, season: summer, env: env({ fog: 1 }), has: ALL });
  assert.equal(s.wFogPhoto, 0, 'the autumn fog photo is not used in summer'); assert.equal(s.cover, 0);
  const a = blendState({ sun: { elevation: 12, azimuth: 120 }, morning: true, season: autumn, env: env({ fog: 1, fogLvl: 0.8 }), has: ALL });
  assert.ok(a.wFogPhoto > 0.5);
  const r = blendState({ sun: { elevation: -25, azimuth: 0 }, morning: false, season: autumn, env: env({ wet: 1, rain: 0.8, cloud: 0.95 }), has: ALL });
  assert.ok(r.wRainNight > 0.9);
  const r2 = blendState({ sun: { elevation: 30, azimuth: 180 }, morning: false, season: autumn, env: env({ wet: 1 }), has: ALL });
  assert.equal(r2.wRainNight, 0);
});

test('overcast removes direct sun and the clear-sky dawn photos', () => {
  const c = blendState({ sun: { elevation: 3, azimuth: 70 }, morning: true, season: summer, env: env(WEATHER.storm), has: ALL });
  assert.ok(c.sunVis < 0.01 && c.wGold < 0.05 && c.relight > 0.95);
});

test('dry cloudy daylight is diffuse, bright enough, and distinct from wet or stormy weather', () => {
  assert.ok(WEATHER.cloudy.cloud > 0.92 && WEATHER.cloudy.cloud < WEATHER.rain.cloud);
  const sun = { elevation: 35, azimuth: 105 };
  const blend = preset => blendState({ sun, morning: true, season: summer, env: env(WEATHER[preset]), has: ALL });
  const clear = blend('clear'), cloudy = blend('cloudy');
  assert.ok(cloudy.dryCloud > 0.95 && cloudy.sunVis < 0.01 && cloudy.relight > 0.97);
  assert.ok(cloudy.amb[0] > 0.60 && cloudy.amb[1] >= cloudy.amb[0] && cloudy.amb[2] >= cloudy.amb[1]);
  assert.ok(cloudy.amb[0] < clear.amb[0] + clear.sunCol[0], 'cloudy stays dimmer than direct sunlight');
  for (const preset of ['rain', 'fog', 'storm', 'snow']) assert.ok(blend(preset).dryCloud < 0.05, `${preset} keeps its own lighting`);
  const night = blendState({ sun: { elevation: -20, azimuth: 0 }, morning: false, season: summer, env: env(WEATHER.cloudy), has: ALL });
  assert.equal(night.dryCloud, 0, 'night lighting remains separate');
  let last = 0;
  for (let cloud = 0; cloud <= 1.001; cloud += 0.01) {
    const current = blendState({ sun, morning: true, season: summer, env: env({ cloud }), has: ALL }).dryCloud;
    assert.ok(Math.abs(current - last) < 0.08, 'cloud transition stays smooth');
    last = current;
  }
  last = cloudy.dryCloud;
  for (let rain = 0.01; rain <= WEATHER.rain.rain + 0.001; rain += 0.01) {
    const current = blendState({ sun, morning: true, season: summer, env: env({ cloud: WEATHER.cloudy.cloud, rain }), has: ALL }).dryCloud;
    assert.ok(Math.abs(current - last) < 0.04, 'cloudy-to-rain transition stays smooth');
    last = current;
  }
});

test('sky and light tables are monotone enough: day brighter than dusk brighter than night', () => {
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(lum(skyColors(40).zen) > lum(skyColors(-5).zen) && lum(skyColors(-5).zen) > lum(skyColors(-18).zen));
  const day = lightColors(40), dusk = lightColors(-5), night = lightColors(-18);
  assert.ok(lum(day.sun) > 0.8 && lum(dusk.sun) === 0 && lum(night.amb) < lum(dusk.amb));
});
