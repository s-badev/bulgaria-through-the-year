import test from 'node:test';
import assert from 'node:assert/strict';
import { solarMix } from '../../src/special/lighting.js';

test('special lighting follows the shared solar altitude continuously', () => {
  const sample = altitude => solarMix({ elevation: altitude, hourAngle: 15 });
  assert.equal(sample(30).day, 1);
  assert.equal(sample(-20).night, 1);
  for (let altitude = -20; altitude <= 30; altitude += .1) {
    const current = sample(altitude), next = sample(altitude + .1);
    assert(Math.abs(current.day + current.night + current.twilight - 1) < 1e-9);
    assert(next.day >= current.day && next.night <= current.night);
    assert(Math.abs(next.day - current.day) < .03 && Math.abs(next.night - current.night) < .07);
  }
  assert(sample(4).warm > sample(30).warm);
});
