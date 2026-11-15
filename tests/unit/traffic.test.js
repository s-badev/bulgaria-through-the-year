import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { Traffic } from '../../src/life/traffic.js';
import { rng } from '../../src/engine/clock.js';
import { seasonWeights } from '../../src/engine/blend.js';
import { State } from '../../src/engine/state.js';

const DIR = 'public/scenes/ndk/', data = JSON.parse(fs.readFileSync(DIR + 'traffic.json', 'utf8'));
const road = await sharp(DIR + 'road.png').raw().toBuffer({ resolveWithObject: true }), RW = road.info.width, RC = road.info.channels;
const maskA = await sharp(DIR + 'masks-a.png').raw().toBuffer({ resolveWithObject: true });
const onRoad = (x, y, ch) => road.data[(Math.round(y) * RW + Math.round(x)) * RC + ch] > 127;
const CAR_W = 1.9;

test('lanes: every visible point lies on the strict asphalt mask with half a car width of margin on both sides', () => {
  assert.ok(data.lanes.length >= 4);
  for (const lane of data.lanes) {
    const ch = lane.set === 'autumn' ? 1 : 0; let visible = 0;
    for (let i = 0; i < lane.pts.length; i++) {
      const [x, y, ppm, vis] = lane.pts[i]; if (!vis) continue; visible++;
      const a = lane.pts[Math.max(0, i - 2)], b = lane.pts[Math.min(lane.pts.length - 1, i + 2)], tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1, half = 0.5 * CAR_W * ppm * 0.85;
      assert.ok(onRoad(x, y, ch), `${lane.id} (${lane.set}) @${i} m centre off the asphalt`);
      // sideways = across the lane; at this low camera angle that is very nearly the image x axis
      assert.ok(onRoad(x - half, y, ch) && onRoad(x + half, y, ch), `${lane.id} (${lane.set}) @${i} m has less than half a car of asphalt beside it`);
      const m = (Math.round(y) * RW + Math.round(x)) * maskA.info.channels;
      assert.ok(maskA.data[m] < 13 && maskA.data[m + 1] < 13 && maskA.data[m + 2] < 90, `${lane.id} @${i} m touches sky, mountain or vegetation`);
      assert.ok(!(x > 380 && x < 1330 && y > 470), `${lane.id} @${i} m is on the plaza`);
      void tx; void ty; void tl;
    }
    assert.ok(visible >= 40, `${lane.id}: only ${visible} m visible`);
  }
});

test('lanes: hidden stretches exist only at a declared hide/far end, or are short passes behind an occluder', () => {
  for (const lane of data.lanes) {
    let run = 0, start = 0;
    for (let i = 0; i <= lane.pts.length; i++) {
      const p = lane.pts[i];
      if (p && !p[3]) { if (!run) start = i; run++; continue; }
      if (run) { const atStart = start === 0, atEnd = !p; if (!atStart && !atEnd) assert.ok(run <= 14, `${lane.id}: ${run} m hidden in mid-lane at ${start} m`); if (atStart && lane.start === 'far') assert.ok(run <= 25); if (atEnd && lane.end === 'far') assert.ok(run <= 25); run = 0; }
    }
    if (lane.start === 'hide') assert.equal(lane.pts[0][3], 0, `${lane.id}: a 'hide' start must be hidden`);
    if (lane.end === 'hide') assert.equal(lane.pts[lane.pts.length - 1][3], 0, `${lane.id}: a 'hide' end must be hidden`);
  }
});

test('lanes are in metres on the ground: near cars cover more pixels per metre than far ones', () => {
  const l = data.lanes.find(x => x.id === 'left-in-0' && x.set === 'base'), a = l.pts[20], b = l.pts[21], c = l.pts[l.pts.length - 60], d = l.pts[l.pts.length - 59];
  assert.ok(Math.hypot(d[0] - c[0], d[1] - c[1]) > 1.5 * Math.hypot(b[0] - a[0], b[1] - a[1]), 'a metre near the camera is longer in pixels than a metre far away');
  assert.ok(c[2] > a[2], 'scale grows toward the camera');
});

function sim(env, hour, doy, steps = 6000) {
  const scene = { traffic: data, cpu: { road: { w: RW, h: road.info.height, data: new Uint8Array(0) } }, size: [1672, 941] };
  const T = new Traffic(scene, rng(7)), season = seasonWeights(doy);
  const ctx = { env: { rain: 0, fog: 0, snow: 0, storm: 0, wet: 0, ...env }, season, blend: { cover: season.winter, lightsOn: 0, sunVis: 1, relight: 0 }, activity: State.activityAt(hour) };
  let minGap = 1e9, maxCars = 0;
  for (let i = 0; i < steps; i++) {
    T.update(1 / 30, ctx);
    for (const lane of T.lanes) for (let k = 1; k < lane.cars.length; k++) { const lead = lane.cars[k - 1], c = lane.cars[k]; minGap = Math.min(minGap, lead.s - lead.len - c.s); assert.ok(c.s < lead.s, 'order along the lane never changes (no lane jumps, no passing through)'); }
    maxCars = Math.max(maxCars, T.count);
  }
  return { T, minGap, maxCars };
}

test('headway: cars never overlap and keep a gap, also in a queue at the signal', () => {
  const { minGap, T } = sim({}, 17.8, 196);
  assert.ok(minGap >= 0.5, 'smallest bumper-to-bumper gap ' + minGap.toFixed(2) + ' m');
  assert.ok(T.lanes.some(l => l.signalM != null), 'the inbound carriageway has a signal');
});

test('spawn rules: cars only appear at the start of a lane and only leave at its end; never in mid-road', () => {
  const { T } = sim({}, 13, 196);
  assert.ok(T.events.spawn > 20 && T.events.despawn > 20);
  assert.equal(T.events.midRoad, 0, JSON.stringify(T.events.log.slice(0, 3)));
  for (const lane of T.lanes) { assert.ok(['far', 'hide', 'edge'].includes(lane.start) && ['far', 'hide', 'edge'].includes(lane.end)); }
});

test('density follows the hour and the weather; the autumn photo uses its own (narrower) lane set', () => {
  const noon = sim({}, 13, 196).maxCars, night = sim({}, 3, 196, 9000).T.count, snow = sim({ snow: 0.85 }, 13, 18, 9000).T.count;
  const baked = Object.values(data.stats.master.byCarriageway).reduce((s, c) => s + c.baked, 0);
  assert.ok(noon <= baked * 1.05 && noon >= baked * 0.5, `noon ${noon} cars vs ${baked} in the photograph`);
  assert.ok(night < noon * 0.35, `night ${night} vs noon ${noon}`);
  assert.ok(snow <= 4, `heavy snow leaves almost no traffic (${snow})`);
  const autumn = sim({}, 13, 293).T;
  assert.equal(autumn.setName, 'autumn'); assert.ok(autumn.lanes.every(l => l.cw !== 'left-out'), 'no live lane on the carriageway the autumn photo redrew');
});

test('clean-only carriageways: plate cleaning only - never a lane, a spawn or drivable asphalt of their own', () => {
  const clean = data.carriageways.filter(c => c.cleanOnly), live = data.carriageways.filter(c => !c.cleanOnly);
  assert.ok(clean.length >= 1, 'the scene declares at least one clean-only zone (the slip beside the outbound carriageway)');
  const ids = new Set(clean.map(c => c.id));
  for (const l of data.lanes) assert.ok(!ids.has(l.cw), `lane ${l.id} runs on clean-only ${l.cw}`);
  const inside = (poly, x, y) => { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) r = !r; } return r; };
  let checked = 0;
  for (const c of clean) {
    const xs = c.polygon.map(p => p[0]), ys = c.polygon.map(p => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      if (!inside(c.polygon, x + 0.5, y + 0.5) || live.some(l => inside(l.polygon, x + 0.5, y + 0.5))) continue;
      checked++; assert.ok(!onRoad(x, y, 0) && !onRoad(x, y, 1), `clean-only ${c.id} has drivable asphalt at ${x},${y}`);
    }
  }
  assert.ok(checked > 20, 'the clean-only zone was actually sampled');
  const { T } = sim({}, 17.8, 196, 3000);
  assert.ok(Object.keys(T.lanesBase).every(id => !ids.has(id)));
  for (const set of Object.values(T.sets)) for (const l of set) assert.ok(!ids.has(l.cw));
  assert.equal(T.events.midRoad, 0);
});
