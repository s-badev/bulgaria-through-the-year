import test from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition, sunTimes, sofiaOffset, sofiaToUtc, utcToSofia, dayOfYear } from '../../src/engine/sun.js';

const LAT = 42.6977, LON = 23.3219;

test('Europe/Sofia offset matches the platform time-zone database', () => {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' });
  for (let y = 2024; y <= 2030; y++) for (let doy = 0; doy < 366; doy += 3) for (const h of [0.5, 1.5, 12]) {
    const t = Date.UTC(y, 0, 1) + doy * 86400000 + h * 3600000;
    const off = +fmt.formatToParts(t).find(p => p.type === 'timeZoneName').value.replace('GMT', '') || 0;
    assert.equal(sofiaOffset(t), off, new Date(t).toISOString());
  }
});

test('DST switches on the last Sunday of March and October at 01:00 UTC', () => {
  // 2026: 29 March and 25 October
  assert.equal(sofiaOffset(Date.UTC(2026, 2, 29, 0, 59)), 2);
  assert.equal(sofiaOffset(Date.UTC(2026, 2, 29, 1, 0)), 3);
  assert.equal(sofiaOffset(Date.UTC(2026, 9, 25, 0, 59)), 3);
  assert.equal(sofiaOffset(Date.UTC(2026, 9, 25, 1, 0)), 2);
  // 2027: 28 March and 31 October
  assert.equal(sofiaOffset(Date.UTC(2027, 2, 28, 1, 0)), 3);
  assert.equal(sofiaOffset(Date.UTC(2027, 9, 31, 1, 0)), 2);
});

test('local <-> UTC round trip, including both switch days', () => {
  for (const [y, m, d] of [[2026, 0, 18], [2026, 2, 29], [2026, 6, 15], [2026, 9, 25], [2026, 11, 31]]) for (const h of [0.25, 5.5, 12, 18.75, 23.5]) {
    const back = utcToSofia(sofiaToUtc(y, m, d, h));
    assert.equal(back.d, d); assert.equal(back.m, m);
    assert.ok(Math.abs(back.hour - h) < 1e-6, `${y}-${m + 1}-${d} ${h} -> ${back.hour}`);
  }
  assert.equal(dayOfYear(2026, 0, 1), 1); assert.equal(dayOfYear(2026, 11, 31), 365); assert.equal(dayOfYear(2028, 11, 31), 366);
});

test('solar position: noon is due south, morning east, evening west', () => {
  const noon = sunTimes(2026, 5, 21, LAT, LON).noon;
  const p = sunPosition(sofiaToUtc(2026, 5, 21, noon), LAT, LON);
  assert.ok(Math.abs(p.azimuth - 180) < 1.5, 'azimuth at solar noon ' + p.azimuth);
  assert.ok(Math.abs(p.elevation - (90 - LAT + 23.44)) < 0.2, 'summer solstice elevation ' + p.elevation);
  assert.ok(sunPosition(sofiaToUtc(2026, 5, 21, 7), LAT, LON).azimuth < 120);
  assert.ok(sunPosition(sofiaToUtc(2026, 5, 21, 19), LAT, LON).azimuth > 240);
  const w = sunPosition(sofiaToUtc(2026, 11, 21, sunTimes(2026, 11, 21, LAT, LON).noon), LAT, LON);
  assert.ok(Math.abs(w.elevation - (90 - LAT - 23.44)) < 0.2, 'winter solstice elevation ' + w.elevation);
});

test('sunrise and sunset for Sofia (reference: published almanac values, tolerance 3 min)', () => {
  // Reference values computed independently with the USNO/NOAA method for 42.6977N 23.3219E, local time.
  const ref = [
    [2026, 5, 21, '05:49', '21:08'],
    [2026, 11, 21, '07:54', '16:56'],
    [2026, 2, 20, '06:31', '18:38'],
    [2026, 8, 23, '07:15', '19:23'],
  ];
  const mins = s => +s.slice(0, 2) * 60 + +s.slice(3);
  for (const [y, m, d, r, s] of ref) {
    const t = sunTimes(y, m, d, LAT, LON);
    assert.ok(Math.abs(t.rise * 60 - mins(r)) <= 3, `rise ${y}-${m + 1}-${d}: ${(t.rise * 60).toFixed(1)} vs ${mins(r)}`);
    assert.ok(Math.abs(t.set * 60 - mins(s)) <= 3, `set ${y}-${m + 1}-${d}: ${(t.set * 60).toFixed(1)} vs ${mins(s)}`);
  }
});

test('DST switch days keep sunrise/sunset continuous in UTC', () => {
  for (const [y, m, d] of [[2026, 2, 29], [2026, 9, 25]]) {
    const a = sunTimes(y, m, d - 1, LAT, LON), b = sunTimes(y, m, d, LAT, LON), c = sunTimes(y, m, d + 1, LAT, LON);
    const utc = (dd, h) => (sofiaToUtc(y, m, dd, h) % 86400000) / 60000;
    assert.ok(Math.abs(utc(d, b.rise) - utc(d - 1, a.rise)) < 3 && Math.abs(utc(d + 1, c.rise) - utc(d, b.rise)) < 3, 'sunrise drifts < 3 min/day in UTC');
    assert.ok(Math.abs(utc(d, b.set) - utc(d - 1, a.set)) < 3 && Math.abs(utc(d + 1, c.set) - utc(d, b.set)) < 3, 'sunset drifts < 3 min/day in UTC');
  }
});
