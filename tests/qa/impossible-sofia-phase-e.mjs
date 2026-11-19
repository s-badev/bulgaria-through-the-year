import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = `http://127.0.0.1:${process.argv[2] || 8080}/`;
const out = 'tests/qa-out/impossible-sofia/phase-e';
const worlds = [
  ['planet', 'clear', 'cloudy', 'overcast'],
  ['abandoned', 'clear', 'cloudy', 'overcast'],
  ['sandstorm', 'light', 'strong', 'haze'],
  ['cyberpunk', 'clear', 'cloudy', 'overcast'],
  ['flood', 'rain', 'heavy-rain', 'overcast'],
  ['ice-age', 'light', 'cloudy', 'overcast'],
];
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const errors = [];
fs.mkdirSync(out, { recursive: true });

const open = (page, id, h = 12) => page.goto(`${base}?qa=1&still=1&special=${id}&date=2026-07-15&h=${h}`);
const selected = (page, id) => page.waitForFunction(id =>
  window.__app?.special.id === id && !!document.querySelector('.special-world-layer.is-visible'), id);
const setHour = (page, hour) => page.locator('#specialHour').fill(String(hour));
const condition = (page, name) => page.locator(`[data-condition="${name}"]`).click();
const settled = (page, key, ratio = .995) => page.waitForFunction(({ key, ratio }) => {
  const plates = window.__app?.special.layers[0]?.plates;
  return plates && !plates.pending && (plates.visible.get(key) ?? 0) >= ratio;
}, { key, ratio });
async function capture(page, name) {
  const screenshot = await page.screenshot({ style: '#app > :not(.special-world) { visibility: hidden !important; }' });
  const photo = sharp(screenshot).resize({ width: 860, withoutEnlargement: true });
  const { channels } = await photo.clone().stats();
  assert(channels.some(channel => channel.mean > 8 && channel.max > 35), `${name}: non-black photograph`);
  await photo.jpeg({ quality: 78, mozjpeg: true }).toFile(`${out}/${name}.jpg`);
}

try {
  const day = await browser.newPage({ viewport: { width: 1200, height: 675 }, reducedMotion: 'reduce' });
  day.on('pageerror', error => errors.push(error.message));
  day.on('response', response => { if (response.url().includes('/special/') && response.status() >= 400) errors.push(response.url()); });
  for (const [id, initial, weather, weatherPlate] of worlds) {
    const requests = new Set();
    const observe = request => {
      if (request.url().includes('/optimized/')) requests.add(new URL(request.url()).pathname);
    };
    day.on('request', observe);
    await open(day, id);
    await selected(day, id);
    await settled(day, { sandstorm: 'haze', flood: 'overcast' }[id] ?? 'day');
    assert.equal(requests.size, 1, `${id}: only one photograph loads initially`);
    day.off('request', observe);
    if (id === 'sandstorm' || id === 'flood') await condition(day, initial);
    const nightPlate = id === 'ice-age' ? 'night-alt' : 'night';
    for (const [hour, expected, ratio] of [[8, 'day'], [12, 'day'], [17, 'day'], [21, 'dusk', .55], [2, nightPlate]]) {
      await setHour(day, hour);
      await settled(day, expected, ratio);
      assert.equal(await day.locator('#specialWorldTime').textContent(), `${String(hour).padStart(2, '0')}:00`);
      await capture(day, `${id}-${String(hour).padStart(2, '0')}`);
    }
    // Capture the actual middle of each blend, where plate geometry differences
    // are the most apparent. Use the shared ephemeris to find those points.
    for (const [altitude, from, to] of [[3, 'day', 'dusk'], [-7, 'dusk', 'night']]) {
      const hour = await day.evaluate(elevation => {
        const { state } = window.__app;
        let low = 14, high = 23.9;
        for (let i = 0; i < 20; i++) {
          const mid = (low + high) / 2;
          state.setHour(mid);
          if (state.computeSun().elevation > elevation) low = mid;
          else high = mid;
        }
        return (low + high) / 2;
      }, altitude);
      await setHour(day, hour);
      await settled(day, from, .44);
      await settled(day, to === 'night' ? nightPlate : to, .44);
      await capture(day, `${id}-blend-${from}-${to}`);
    }
    await condition(day, weather);
    await setHour(day, 2);
    await settled(day, 'night');
    await setHour(day, 12);
    await settled(day, weatherPlate);
    await capture(day, `${id}-${weatherPlate}`);
    if (id === 'sandstorm') {
      await condition(day, 'extreme');
      await setHour(day, 21);
      await settled(day, 'dusk-alt', .55);
      await capture(day, 'sandstorm-dusk-alt');
    } else if (id === 'ice-age') {
      await condition(day, 'storm');
      await setHour(day, 2);
      await settled(day, 'night-alt');
      await capture(day, 'ice-age-night-alt');
    }
    assert(await day.evaluate(() => window.__app.special.layers[0].plates.cache.size <= 4), 'bounded decoded plate cache');
    console.log(`PASS ${id}: 08, 12, 17, 21, 02 and ${weatherPlate}`);
  }
  await day.evaluate(() => window.__app.state.setDate(2026, 11, 15));
  await condition(day, 'light');
  await setHour(day, 17);
  await settled(day, 'dusk', .35);
  await day.close();

  const seek = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  seek.on('pageerror', error => errors.push(error.message));
  await open(seek, 'planet');
  await selected(seek, 'planet');
  let pendingRequest;
  await seek.route(/planet-night\.(avif|webp)\?/, async route => {
    if (!pendingRequest) pendingRequest = route;
    else await route.continue();
  });
  await setHour(seek, 2);
  await seek.waitForFunction(() => window.__app.special.layers[0].plates.pending?.key === 'night');
  assert.equal(await seek.locator('.special-plates picture').getAttribute('data-plate'), 'day');
  await capture(seek, 'planet-loading-retains-day');
  for (const hour of [12, 18, 23, 12]) await setHour(seek, hour);
  await settled(seek, 'day');
  await pendingRequest.continue().catch(() => {}); // the browser may already have cancelled it
  await seek.waitForTimeout(350);
  assert.equal(await seek.locator('.special-plates picture').getAttribute('data-plate'), 'day');
  await seek.unrouteAll({ behavior: 'wait' });
  await setHour(seek, 23);
  await settled(seek, 'night');
  await seek.evaluate(() => {
    const { state } = window.__app;
    state.setHour(state.times.set - .04);
  });
  await seek.locator('#specialPlay').click();
  await seek.waitForFunction(() => window.__app.state.S.hour > window.__app.state.times.set + .06);
  await seek.locator('#specialPlay').click();
  await settled(seek, 'dusk', .55);
  await capture(seek, 'planet-sunset-transition');
  await setHour(seek, 23.85);
  await seek.locator('#specialPlay').click();
  await seek.waitForFunction(() => window.__app.state.S.d === 16);
  await seek.locator('#specialPlay').click();
  await settled(seek, 'night');
  await seek.close();
  console.log('PASS rapid seeks with delayed decode, sunset, midnight and retained photo');

  const missing = await browser.newPage({ reducedMotion: 'reduce' });
  missing.on('pageerror', error => errors.push(error.message));
  await missing.route(/planet-night\.(avif|webp|png)\?/, route => route.abort());
  await open(missing, 'planet', 2);
  await selected(missing, 'planet');
  await settled(missing, 'base');
  await capture(missing, 'planet-missing-night-fallback');
  await setHour(missing, 12);
  await settled(missing, 'day');
  await missing.close();
  console.log('PASS unavailable night photograph recovers through base and daylight');

  for (const [width, height] of [[320, 568], [390, 700], [844, 390]]) {
    const mobile = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
    mobile.on('pageerror', error => errors.push(error.message));
    await open(mobile, 'flood');
    await selected(mobile, 'flood');
    await mobile.locator('.loading').waitFor({ state: 'hidden' });
    await mobile.waitForFunction(() => getComputedStyle(window.__app.special.layers[0]).opacity === '1');
    assert(await mobile.locator('#mobileClock').isVisible());
    assert(!await mobile.locator('#panel').isVisible());
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await mobile.evaluate(() => {
      const bounds = selector => document.querySelector(selector).getBoundingClientRect();
      const nav = document.querySelector('.special-nav');
      return nav.closest('#specialControls .special-settings') !== null && !document.querySelector('#panel').getClientRects().length;
    }), 'scene navigation clear of the clock and controls');
    await mobile.screenshot({ path: `${out}/flood-${width}x${height}.jpg`, type: 'jpeg', quality: 75 });
    await mobile.locator('#mobileOpen').tap();
    assert.equal(await mobile.locator('#specialDate').count(), 0, 'calendar removed from special controls');
    for (const selector of ['#specialHour', '#specialChange', '#specialBack', '#specialPlay', '#specialIntensity', '#specialSound', '#specialVolume']) {
      const rect = await mobile.locator(selector).boundingBox();
      assert(rect.width >= 44 && rect.height >= 44, `${width}x${height} ${selector} touch target`);
    }
    assert.equal(await mobile.evaluate(() => window.__app.sound.ctx), null);
    await mobile.locator('#specialSound').tap();
    await mobile.waitForFunction(() => window.__app.sound.ctx.state === 'running' && window.__app.sound.rainLowG.gain.value > .02 && window.__app.sound.rainG.gain.value < .01);
    await condition(mobile, 'storm');
    await mobile.locator('#specialIntensity').fill('1');
    await mobile.waitForFunction(() => window.__app.sound.rainG.gain.value > .12);
    await mobile.evaluate(() => { window.__app.special.layers[0].effects.nextFlash = -1; });
    await mobile.waitForFunction(() => window.__app.sound.voices.size > 0);
    await mobile.locator('#specialSound').tap();
    await mobile.waitForFunction(() => !window.__app.sound.on && window.__app.sound.voices.size === 0 && window.__app.sound.master.gain.value < .02);
    await mobile.locator('#mobileDone').tap();
    await mobile.locator('#mobileOpen').tap();
    await mobile.locator('#specialChange').tap();
    assert.equal(await mobile.locator('[data-special]:enabled').count(), 6);
    await mobile.locator('[data-special="abandoned"]').tap();
    await selected(mobile, 'abandoned');
    await mobile.locator('#mobileOpen').tap();
    await mobile.locator('#specialBack').tap();
    await mobile.waitForFunction(() => !window.__app.special.id && !window.__app.sound.specialId);
    await mobile.waitForFunction(() => !document.querySelector('.special-world-layer'));
    await mobile.close();
    console.log(`PASS ${width}x${height}: flood controls, audio, switch and cleanup`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
