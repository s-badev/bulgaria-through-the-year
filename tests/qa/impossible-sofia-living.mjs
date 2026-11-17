import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';

const port = process.argv[2] || 8080;
const out = 'docs/screenshots/impossible-sofia/phase-d';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];
const times = [8, 12, 17, 21, 2];

try {
  for (const id of ['abandoned', 'ice-age']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
    page.on('pageerror', error => errors.push(`${id}: ${error.message}`));
    await page.goto(`http://127.0.0.1:${port}/?qa=1&still=1&special=${id}&date=2026-07-15&h=12`);
    await page.waitForFunction(expected => window.__app?.special.id === expected && window.__app?.special.layers[0]?.lighting.values, id);
    const readings = [];
    for (const hour of times) {
      await page.evaluate(value => window.__app.state.setHour(value), hour);
      await page.waitForFunction(value => Math.abs(window.__app.state.S.hour - value) < .01 && window.__app.special.layers[0].lighting.values, hour);
      await page.waitForFunction(value => document.querySelector('#specialWorldTime').textContent === `${String(value).padStart(2, '0')}:00`, hour);
      await page.waitForTimeout(200);
      const value = await page.evaluate(() => ({ sun: window.__app.state.sun.elevation, ...window.__app.special.layers[0].lighting.values }));
      readings.push(value);
      const shot = await page.screenshot();
      await sharp(shot).resize({ width: 960 }).jpeg({ quality: 62, mozjpeg: true }).toFile(`${out}/${id}-${String(hour).padStart(2, '0')}.jpg`);
    }
    assert(readings[1].day > .9 && readings[4].night > .9 && readings[3].day < readings[1].day, `${id}: shared solar day/night values ${JSON.stringify(readings.map(({sun,day,night}) => ({sun,day,night})))}`);
    assert(readings[0].sun > readings[4].sun, `${id}: solar altitude follows time`);
    if (id === 'abandoned') {
      assert.equal(await page.evaluate(() => window.__app.special.layers[0].effects.type), 'abandoned');
      await page.locator('[data-condition="fog"]').click();
      await page.waitForFunction(() => window.__app.special.layers[0].lighting.values.haze > .1);
      await page.locator('[data-condition="rain"]').click();
      await page.waitForFunction(() => document.querySelector('.special-world-layer').dataset.condition === 'rain');
    } else {
      await page.locator('[data-condition="blizzard"]').click();
      await page.locator('#specialIntensity').fill('1');
      await page.waitForFunction(() => window.__app.special.setting().condition === 'blizzard' && window.__app.special.setting().intensity === 1);
      assert(await page.locator('.special-particles').isVisible(), 'snow remains present in ice age');
      await page.waitForFunction(() => window.__app.special.layers[0].lighting.values.haze > .15);
    }
    console.log(`PASS ${id}: 08, 12, 17, 21, 02 shared solar lighting`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
