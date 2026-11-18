import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plateWeights } from '../../src/special/plates.js';

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
