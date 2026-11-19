import test from 'node:test';
import assert from 'node:assert/strict';
import { moonLighting, moonPhase, moonParameters } from '../../src/render/sky-effects.js';
import { State } from '../../src/engine/state.js';

test('lunar phase changes with the date and wraps after a synodic month', () => {
  const newMoon = moonPhase(2000, 0, 6, 18.23);
  assert(newMoon < 0.01 || newMoon > 0.99);
  const quarter = moonPhase(2000, 0, 14, 0);
  assert(quarter > 0.2 && quarter < 0.3);
  const later = moonPhase(2000, 1, 5, 6);
  assert(later < 0.03 || later > 0.97);
});

test('moon visibility follows sky darkness and weather without moving the Moon', () => {
  const date = { y: 2026, m: 6, d: 15, hour: 23 };
  const clear = { cloud: 0.04, fog: 0, storm: 0 };
  const full = moonParameters(date, 1, clear);
  assert.equal(moonParameters(date, 0, clear)[3], 0);
  assert(full[3] > 0.9);
  assert(moonParameters(date, 1, { cloud: 0.35, fog: 0, storm: 0 })[3] > 0.7);
  assert(moonParameters(date, 1, { cloud: 0.85, fog: 0, storm: 0 })[3] < full[3]);
  assert(moonParameters(date, 1, { cloud: 0.22, fog: 1, storm: 0 })[3] < 0.01);
  assert(moonParameters(date, 1, { cloud: 1, fog: 0, storm: 1 })[3] < 0.01);
  const quarter = { ...date, d: 21, hour: 14 };
  const day = moonParameters(quarter, 0, clear);
  const twilight = moonParameters(quarter, .5, clear);
  const night = moonParameters(quarter, 1, clear);
  assert(day[3] > .3 && day[3] < twilight[3] && twilight[3] < night[3]);
  assert.deepEqual(day.slice(0, 3), night.slice(0, 3));
  assert.equal(moonParameters({ ...quarter, d: 29 }, 0, clear)[3], 0);
  assert.equal(moonParameters({ ...quarter, d: 15, hour: 2 }, 1, clear)[3], 0);
});

test('lunar light preserves phase coverage and reverses direction after full Moon', () => {
  for (const [phase, expectedFraction] of [[0, 0], [.125, .146447], [.25, .5], [.375, .853553], [.5, 1], [.625, .853553], [.75, .5], [.875, .146447]]) {
    const [x, z] = moonLighting(phase, 1);
    assert(Math.abs(Math.hypot(x, z) - 1) < 1e-9);
    assert(Math.abs((1 + z) / 2 - expectedFraction) < .000001);
    if (phase % .5 !== 0) assert.equal(Math.sign(x), phase < .5 ? 1 : -1);
  }
});

test('reflected Earth light peaks during a crescent and fades in bright skies', () => {
  const earth = (phase, darkness = 1) => moonLighting(phase, darkness)[2];
  assert.equal(earth(.11, 0), 0);
  assert.equal(earth(0), 0);
  assert(earth(.5) < 1e-9);
  assert(earth(.11) > 0.6 && earth(.11) <= 1);
  assert(earth(.11, .5) > 0 && earth(.11, .5) < earth(.11));
  assert(earth(.25) < earth(.11) / 3 && earth(.375) < earth(.25) / 5);
  assert(Math.abs(earth(.11) - earth(.89)) < 1e-9);
});

test('volcano fades smoothly and survives ordinary weather changes', () => {
  const state = new State({ lat: 42.6977, lon: 23.3219 });
  state.settle();
  state.set('volcano', true);
  state.update(0.2);
  assert(state.V.volcano > 0 && state.V.volcano < 1);
  const first = state.V.volcano;
  state.setWeather('cloudy');
  state.update(0.2);
  assert(state.V.volcano > first);
  const second = state.V.volcano;
  state.set('volcano', false);
  state.update(0.2);
  assert(state.V.volcano < second && state.V.volcano > 0);
});
