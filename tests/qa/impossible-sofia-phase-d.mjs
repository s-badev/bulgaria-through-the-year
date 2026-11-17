import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = `http://127.0.0.1:${process.argv[2] || 8080}/`;
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}?qa=1&still=1&special=abandoned&date=2026-07-15&h=12`);
  await page.waitForFunction(() => window.__app?.special.id === 'abandoned');
  assert(await page.locator('#specialControls').isVisible());
  assert.equal(await page.locator('#specialWorldName').textContent(), 'София след 100 години без хора');
  assert.equal(await page.evaluate(() => window.__app.sound.ctx), null, 'no audio context before a gesture');
  await page.locator('#specialHour').fill('2');
  await page.waitForFunction(() => window.__app.special.layers[0].lighting.values.night > .99);
  assert.equal(await page.locator('#specialWorldTime').textContent(), '02:00');
  assert.equal(await page.evaluate(() => window.__app.state.S.hour), 2);
  assert.equal(await page.evaluate(() => window.__app.special.layers[0].effects.type), 'abandoned');
  assert.equal(await page.evaluate(() => window.__app.special.layers[0].lighting.values.day), 0);
  await page.locator('[data-condition="fog"]').click();
  await page.waitForFunction(() => window.__app.special.layers[0].lighting.values.haze > .1);
  await page.locator('[data-condition="rain"]').click();
  await page.waitForFunction(() => document.querySelector('.special-world-layer').dataset.condition === 'rain');
  await page.locator('[data-condition="clear"]').click();
  await page.locator('#specialSound').click();
  await page.waitForTimeout(500);
  const audio = await page.evaluate(() => ({ on: window.__app.sound.on, id: window.__app.sound.specialId, context: !!window.__app.sound.ctx, city: window.__app.sound.cityG.gain.value, fountain: window.__app.sound.fountG.gain.value }));
  assert(audio.on && audio.context && audio.id === 'abandoned' && audio.city < .01 && audio.fountain < .01, 'abandoned audio has no city or fountain');
  await page.locator('#specialSound').click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__app.sound.on), false);
  assert(await page.evaluate(() => window.__app.sound.master.gain.value) < .02, 'sound fades promptly after off');
  await page.locator('#specialPlay').click();
  const before = await page.evaluate(() => window.__app.state.S.hour);
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => window.__app.state.S.hour) > before);
  assert.equal(await page.locator('#play').getAttribute('aria-label'), 'Спри деня');
  await page.locator('#specialPlay').click();
  await page.locator('#specialPlay').click();
  await page.evaluate(() => { const app = window.__app; app.state.setHour(23.99); app.clock.step(.1); });
  assert.deepEqual(await page.evaluate(() => [window.__app.state.S.d, window.__app.state.S.hour < 1]), [16, true], 'playback crosses midnight on the same state');
  await page.locator('#specialChange').click();
  await page.locator('[data-special="ice-age"]').click();
  await page.waitForFunction(() => window.__app.special.id === 'ice-age');
  assert.equal(await page.evaluate(() => window.__app.sound.specialId), 'ice-age');
  await page.locator('#specialBack').click();
  await page.waitForFunction(() => !window.__app.special.id);
  assert.equal(await page.evaluate(() => window.__app.sound.specialId), null);
  await page.close();

  for (const [width, height] of [[320, 568], [390, 700], [844, 390]]) {
    const mobile = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
    mobile.on('pageerror', error => errors.push(`${width}x${height}: ${error.message}`));
    await mobile.goto(`${base}?qa=1&special=abandoned&date=2026-07-15&h=12`);
    await mobile.waitForFunction(() => window.__app?.special.active);
    assert(await mobile.locator('#mobileClock').isVisible());
    assert(await mobile.locator('#mobileOpen').isVisible());
    assert.equal(await mobile.locator('#panel').isVisible(), false);
    await mobile.locator('#mobileOpen').tap();
    assert(await mobile.locator('#specialControls').isVisible());
    for (const selector of ['#specialHour', '#specialPlay', '#specialDate', '#specialIntensity', '#specialSound', '#specialVolume']) {
      const box = await mobile.locator(selector).boundingBox();
      assert(box.width >= 44 && box.height >= 44, `${width}x${height}: ${selector} touch target`);
    }
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
    await mobile.locator('#specialHour').fill('21');
    assert.equal(await mobile.locator('#mobileClockTime').textContent(), '21:00');
    await mobile.locator('#mobileDone').tap();
    assert(await mobile.locator('#mobileClock').isVisible());
    await mobile.close();
    console.log(`PASS ${width}x${height}: special controls and shared mobile clock`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS shared solar time, audio routing, playback, midnight and controls');
} finally { await browser.close(); }
