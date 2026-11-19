import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plateWeights } from '../../src/special/plates.js';
import { VISIBLE_SPECIAL_SCENES } from '../../src/special/registry.js';

const asset = { variants: { day: {}, dusk: {}, night: {}, overcast: {} } };
const scene = { id: 'planet', basePhase: 'dusk' };
const at = (elevation, plates = asset, failed) =>
  plateWeights(scene, plates, { elevation }, { condition: 'clear', intensity: 1 }, failed);

test('supplied plates take priority at full day, dusk and night', () => {
  for (const [elevation, key] of [[30, 'day'], [-3, 'dusk'], [-25, 'night']]) {
    assert.deepEqual([...at(elevation)], [[key, 1]]);
  }
});

test('solar plate weights remain normalized and continuous across twilight', () => {
  let previous = at(-15);
  for (let elevation = -14.99; elevation < 15; elevation += .01) {
    const next = at(elevation);
    assert(Math.abs([...next.values()].reduce((a, b) => a + b, 0) - 1) < 1e-9);
    for (const key of ['day', 'dusk', 'night']) {
      assert(Math.abs((next.get(key) ?? 0) - (previous.get(key) ?? 0)) < .01);
    }
    previous = next;
  }
});

test('missing or failed plates retain a valid photographic fallback', () => {
  assert.deepEqual([...at(-25, { variants: { day: {} } })], [['base', 1]]);
  assert.deepEqual([...at(-3, asset, new Set(['dusk']))], [['base', 1]]);
  assert.deepEqual([...at(-25, asset, new Set(['night', 'base']))], [['day', 1]]);
});

test('each world keeps the solar midpoint and reduces double exposure on either side', () => {
  const forScene = (definition, elevation) => plateWeights(definition, asset, { elevation }, { condition: 'clear' });
  const baseline = { ...scene, id: 'unprofiled' };
  for (const world of VISIBLE_SPECIAL_SCENES) {
    for (const [midpoint, key] of [[3, 'day'], [-7, 'night']]) {
      assert.equal(forScene(world, midpoint).get(key), .5, world.id);
      for (const offset of [-1, 1]) {
        const at = midpoint + offset;
        const distance = definition => Math.abs(forScene(definition, at).get(key) - .5);
        assert(distance(world) > distance(baseline), `${world.id}: elevation ${at}`);
      }
    }
  }
});

test('weather plates affect only their configured solar phase', () => {
  const atWeather = (id, elevation, condition, variants) => plateWeights(
    { id, basePhase: 'day' }, { variants }, { elevation }, { condition, intensity: 1 });
  assert.deepEqual([...atWeather('planet', 30, 'cloudy', asset.variants)], [['overcast', 1]]);
  assert.deepEqual([...atWeather('planet', -25, 'cloudy', asset.variants)], [['night', 1]]);
  const dust = { ...asset.variants, haze: {}, 'dusk-alt': {} };
  assert.deepEqual([...atWeather('sandstorm', 30, 'extreme', dust)], [['haze', 1]]);
  assert.deepEqual([...atWeather('sandstorm', -3, 'extreme', dust)], [['dusk-alt', 1]]);
  assert.deepEqual([...atWeather('sandstorm', -3, 'strong', dust)], [['dusk', 1]]);
  assert.deepEqual([...atWeather('ice-age', -25, 'storm', { ...asset.variants, 'night-alt': {} })], [['night-alt', 1]]);
});
