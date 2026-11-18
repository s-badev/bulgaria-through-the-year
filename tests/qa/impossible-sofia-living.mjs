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
  for (const id of ['abandoned', 'ice-age', 'sandstorm', 'supercell', 'cyberpunk', 'planet', 'aurora']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
    page.on('pageerror', error => errors.push(`${id}: ${error.message}`));
    await page.goto(`http://127.0.0.1:${port}/?qa=1&still=1&special=${id}&date=2026-07-15&h=12`);
    await page.waitForFunction(expected => window.__app?.special.id === expected && window.__app?.special.layers[0]?.lighting.values, id);
    const readings = [];
    const sceneTimes = ['abandoned', 'ice-age'].includes(id) ? times : [12, 2];
    for (const hour of sceneTimes) {
      await page.evaluate(value => window.__app.state.setHour(value), hour);
      await page.waitForFunction(value => Math.abs(window.__app.state.S.hour - value) < .01 && window.__app.special.layers[0].lighting.values, hour);
      await page.waitForFunction(value => document.querySelector('#specialWorldTime').textContent === `${String(value).padStart(2, '0')}:00`, hour);
      await page.waitForTimeout(200);
      const value = await page.evaluate(() => ({ sun: window.__app.state.sun.elevation, ...window.__app.special.layers[0].lighting.values }));
      readings.push(value);
      const shot = await page.screenshot();
      await sharp(shot).resize({ width: 960 }).jpeg({ quality: 62, mozjpeg: true }).toFile(`${out}/${id}-${String(hour).padStart(2, '0')}.jpg`);
    }
    const midday = readings[sceneTimes.indexOf(12)], night = readings[sceneTimes.indexOf(2)];
    assert(midday.day > .9 && night.night > .9, `${id}: shared solar day/night values ${JSON.stringify(readings.map(({sun,day,night}) => ({sun,day,night})))}`);
    assert(midday.sun > night.sun, `${id}: solar altitude follows time`);
    if (id === 'abandoned') {
      assert.equal(await page.evaluate(() => window.__app.special.layers[0].effects.type), 'abandoned');
      await page.locator('[data-condition="fog"]').click();
      await page.waitForFunction(() => window.__app.special.layers[0].lighting.values.haze > .1);
      await page.locator('[data-condition="rain"]').click();
      await page.waitForFunction(() => document.querySelector('.special-world-layer').dataset.condition === 'rain');
    } else if (id === 'ice-age') {
      await page.locator('[data-condition="blizzard"]').click();
      await page.locator('#specialIntensity').fill('1');
      await page.waitForFunction(() => window.__app.special.setting().condition === 'blizzard' && window.__app.special.setting().intensity === 1);
      assert(await page.locator('.special-particles').isVisible(), 'snow remains present in ice age');
      await page.waitForFunction(() => window.__app.special.layers[0].lighting.values.haze > .15);
    } else if (id === 'sandstorm') {
      await page.locator('[data-condition="extreme"]').click();
      await page.locator('#specialIntensity').fill('1');
      await page.waitForFunction(() => window.__app.special.layers[0].lighting.values.haze > .3);
      assert(await page.locator('.special-particles').isVisible(), 'sand particles remain available');
    } else if (id === 'supercell') {
      await page.locator('[data-condition="violent"]').click();
      await page.locator('#specialIntensity').fill('1');
      await page.evaluate(() => { const app = window.__app; app.sound.thunder = () => { window.__thunderEvents = (window.__thunderEvents || 0) + 1; }; app.special.layers[0].effects.nextFlash = -1; });
      await page.waitForFunction(() => window.__thunderEvents > 0);
      assert(await page.locator('.special-particles').isVisible(), 'rain remains available');
    } else if (id === 'cyberpunk') {
      await page.locator('[data-condition="rain"]').click();
      assert(await page.locator('.special-particles').isVisible(), 'cyberpunk rain remains available');
    } else if (id === 'aurora') {
      const opacity = await page.locator('.special-world-layer').evaluate(layer => +layer.style.getPropertyValue('--special-aurora'));
      assert(opacity > .5, 'aurora glow grows at night');
      await page.locator('[data-condition="partly"]').click();
      await page.waitForFunction(() => +document.querySelector('.special-world-layer').style.getPropertyValue('--special-aurora') < .4);
    } else if (id === 'planet') {
      await page.locator('[data-condition="cloudy"]').click();
      await page.waitForFunction(() => window.__app.special.layers[0].lighting.values.haze > .02);
    }
    console.log(`PASS ${id}: ${sceneTimes.map(hour => String(hour).padStart(2, '0')).join(', ')} shared solar lighting and atmosphere`);
    await page.close();
  }
  for (const [width, height] of [[390, 700], [844, 390]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
    page.on('pageerror', error => errors.push(`${width}x${height}: ${error.message}`));
    await page.goto(`http://127.0.0.1:${port}/?qa=1&special=supercell&date=2026-07-15&h=21`);
    await page.waitForFunction(() => window.__app?.special.id === 'supercell');
    await page.evaluate(() => { window.__app.special.setCondition('violent'); window.__app.special.setIntensity(1); });
    const initial = await page.evaluate(() => window.__app.clock.frame);
    await page.waitForTimeout(1200);
    const result = await page.evaluate(() => ({ frames: window.__app.clock.frame, particles: window.__app.special.layers[0].effects.points.length, canvas: [window.__app.special.layers[0].effects.canvas.width, window.__app.special.layers[0].effects.canvas.height], scroll: document.documentElement.scrollWidth }));
    assert(result.frames - initial >= 24, `${width}x${height}: simulated mobile animation remains responsive`);
    assert(result.particles <= 110 && result.canvas[0] === 836 && result.canvas[1] === 471 && result.scroll <= width, `${width}x${height}: bounded particle work and no overflow`);
    console.log(`PASS ${width}x${height}: ${result.frames - initial} frames in 1.2 s, bounded 2D effects`);
    await page.close();
  }
  const reduced = await browser.newPage({ viewport: { width: 390, height: 700 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await reduced.goto(`http://127.0.0.1:${port}/?qa=1&special=supercell&date=2026-07-15&h=21`);
  await reduced.waitForFunction(() => window.__app?.special.id === 'supercell');
  await reduced.evaluate(() => { window.__app.special.layers[0].effects.nextFlash = -1; window.__app.clock.step(1 / 60); });
  assert.equal(await reduced.locator('.special-flash').evaluate(node => +node.style.opacity), 0, 'reduced motion suppresses special flashes');
  assert.equal(await reduced.locator('.special-atmosphere').evaluate(node => getComputedStyle(node).animationName), 'none', 'reduced motion suppresses atmosphere animation');
  await reduced.close();
  console.log('PASS reduced motion: no special flashes or atmosphere animation');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
