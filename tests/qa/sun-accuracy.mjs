// Sun accuracy: computed sunrise/sunset for Sofia vs Open-Meteo daily values on 5 dates (incl. both DST switch days).
// Open-Meteo applies ONE utc offset (today's) to a whole response, so the comparison is done in UTC via utc_offset_seconds.
// Sends only the public coordinates of Sofia. Writes tests/qa-out/sun-accuracy.json; exits 1 if any difference is >= 3 min.
import fs from 'node:fs';
import { sunTimes, sofiaToUtc, sofiaOffset } from '../../src/engine/sun.js';
const LAT = 42.6977, LON = 23.3219, dates = ['2025-12-21', '2026-01-18', '2026-03-29', '2026-06-21', '2026-10-25'];
const rows = []; let worst = 0, missing = 0;
const hm = ms => new Date(ms).toISOString().slice(11, 19);
for (const date of dates) {
  const q = `latitude=${LAT}&longitude=${LON}&start_date=${date}&end_date=${date}&daily=sunrise,sunset&timezone=Europe%2FSofia`;
  let j = null;
  for (const u of [`https://archive-api.open-meteo.com/v1/archive?${q}`, `https://api.open-meteo.com/v1/forecast?${q}`]) { try { const r = await fetch(u); if (r.ok) { const t = await r.json(); if (t.daily?.sunrise?.[0]) { j = t; break; } } } catch { /* try next */ } }
  const [y, m, d] = date.split('-').map(Number), t = sunTimes(y, m - 1, d, LAT, LON);
  const riseUtc = sofiaToUtc(y, m - 1, d, t.rise), setUtc = sofiaToUtc(y, m - 1, d, t.set), off = sofiaOffset(riseUtc);
  if (!j) { missing++; rows.push({ date, sofiaOffset: off, computedRiseUTC: hm(riseUtc), computedSetUTC: hm(setUtc), note: 'reference unavailable' }); continue; }
  const toUtc = s => Date.parse(s + ':00Z') - j.utc_offset_seconds * 1000;
  const refRise = toUtc(j.daily.sunrise[0]), refSet = toUtc(j.daily.sunset[0]);
  const dr = (riseUtc - refRise) / 60000, ds = (setUtc - refSet) / 60000;
  worst = Math.max(worst, Math.abs(dr), Math.abs(ds));
  rows.push({ date, sofiaOffset: '+' + off, computedRiseLocal: hm(riseUtc + off * 3600000), refRiseLocal: hm(refRise + off * 3600000), diffRiseMin: +dr.toFixed(2), computedSetLocal: hm(setUtc + off * 3600000), refSetLocal: hm(refSet + off * 3600000), diffSetMin: +ds.toFixed(2) });
}
fs.mkdirSync('tests/qa-out', { recursive: true });
fs.writeFileSync('tests/qa-out/sun-accuracy.json', JSON.stringify({ worstMinutes: +worst.toFixed(2), note: 'Open-Meteo reports whole minutes; differences under 1 min are rounding.', rows }, null, 2));
console.table(rows); console.log('worst difference (min):', worst.toFixed(2));
process.exit(worst < 3 && !missing ? 0 : 1);
