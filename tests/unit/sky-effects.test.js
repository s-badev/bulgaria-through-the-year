import test from 'node:test';
import assert from 'node:assert/strict';
import { moonPhase, moonParameters } from '../../src/render/sky-effects.js';
import { State } from '../../src/engine/state.js';

test('lunar phase changes with the date and wraps after a synodic month', () => {
  const newMoon = moonPhase(2000, 0, 6, 18.23);
  assert(newMoon < 0.01 || newMoon > 0.99);
  const quarter = moonPhase(2000, 0, 14, 0);
  assert(quarter > 0.2 && quarter < 0.3);
  const later = moonPhase(2000, 1, 5, 6);
  assert(later < 0.03 || later > 0.97);
});

test('moon visibility follows night weight and weather without a second clock', () => {
  const date = { y: 2026, m: 6, d: 15, hour: 23 };
  const clear = { cloud: 0.04, fog: 0, storm: 0 };
  const full = moonParameters(date, 1, clear);
  assert.equal(moonParameters(date, 0, clear)[3], 0);
  assert(full[3] > 0.9);
  assert(moonParameters(date, 1, { cloud: 0.35, fog: 0, storm: 0 })[3] > 0.7);
  assert(moonParameters(date, 1, { cloud: 0.85, fog: 0, storm: 0 })[3] < full[3]);
  assert(moonParameters(date, 1, { cloud: 0.22, fog: 1, storm: 0 })[3] < 0.01);
  assert(moonParameters(date, 1, { cloud: 1, fog: 0, storm: 1 })[3] < 0.01);
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
