// Live entry regression: starts at Sofia's actual time with Open-Meteo, without overriding user choices.
// Run against a production preview on localhost:8080 (npm run build && npm run preview).
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const base = `http://127.0.0.1:${process.argv[2] || 8080}/`;
const mocked = { current: { weather_code: 3, cloud_cover: 91, temperature_2m: 11, wind_speed_10m: 9, visibility: 18000, precipitation: 0, rain: 0, showers: 0, snowfall: 0 } };
const sofiaNow = () => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month - 1, d: +p.day, minute: +p.hour * 60 + +p.minute };
};
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const requests = [];
  await page.route('**/api.open-meteo.com/**', route => {
    requests.push(route.request().url());
    return route.fulfill({ json: mocked });
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__app?.clock.frame > 3 && window.__app.state.S.live !== null);
  const initial = await page.evaluate(() => {
    const s = window.__app.state.S;
    return { y: s.y, m: s.m, d: s.d, minute: Math.floor(s.hour * 60 + 0.00001), weather: s.weather, demo: window.__app.demo.on, playing: s.playing };
  });
  const sofia = sofiaNow();
  assert.deepEqual([initial.y, initial.m, initial.d], [sofia.y, sofia.m, sofia.d], 'live Sofia date');
  assert(Math.abs(initial.minute - sofia.minute) <= 1, 'live Sofia minute');
  assert.equal(initial.weather, 'cloudy', 'automatic live weather');
  assert.equal(initial.demo, false, 'no automatic demo');
  assert.equal(initial.playing, false, 'no accelerated clock');
  assert.equal(requests.length, 1, 'one automatic Open-Meteo request');

  // Clock advances to real time while live mode is active.
  await page.evaluate(() => window.__app.state.setHour(0));
  await page.waitForTimeout(1500);
  const corrected = await page.evaluate(() => Math.floor(window.__app.state.S.hour * 60 + 0.00001));
  assert(Math.abs(corrected - sofiaNow().minute) <= 1, 'clock resynchronises from real wall time');

  // A manual season choice opts out of live auto-updates.
  await page.locator('#mobileOpen').tap();
  await page.locator('[data-s="summer"]').tap();
  const chosen = await page.evaluate(() => [window.__app.state.S.y, window.__app.state.S.m, window.__app.state.S.d]);
  await page.waitForTimeout(1500);
  assert.deepEqual(await page.evaluate(() => [window.__app.state.S.y, window.__app.state.S.m, window.__app.state.S.d]), chosen, 'manual choice stays selected');
  await page.locator('#mobileOpen').tap();
  await page.locator('#now').tap();
  await page.waitForFunction(() => !document.querySelector('#now').disabled);
  const restored = await page.evaluate(() => ({ s: window.__app.state.S, hour: window.__app.state.S.hour }));
  assert.deepEqual([restored.s.y, restored.s.m, restored.s.d], [sofiaNow().y, sofiaNow().m, sofiaNow().d], 'Сега restores live time');
  await page.close();

  // Deterministic query URLs do not fetch or overwrite a chosen scene.
  const fixed = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let extraRequests = 0;
  await fixed.route('**/api.open-meteo.com/**', route => { extraRequests++; return route.fulfill({ json: mocked }); });
  await fixed.goto(base + '?qa=1&date=2026-01-18&h=12&w=snow');
  await fixed.waitForFunction(() => window.__app?.clock.frame > 3);
  assert.deepEqual(await fixed.evaluate(() => {
    const s = window.__app.state.S; return [s.y, s.m, s.d, s.hour, s.weather];
  }), [2026, 0, 18, 12, 'snow']);
  assert.equal(extraRequests, 0, 'QA query does not make live requests');
  await fixed.close();

  console.log('PASS live Sofia entry, live weather, clock sync, manual override, explicit QA URL');
} finally {
  await browser.close();
}
