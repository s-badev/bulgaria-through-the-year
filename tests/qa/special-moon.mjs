import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { formatClock } from '../../src/engine/sun.js';

const base = `http://127.0.0.1:${process.argv[2] || 8080}/`;
const date = '2026-11-19'; // Sunset at 17:01 and a genuinely dark sky at 18:58 in Sofia.
const url = (id, hour, lite = false) => `${base}?qa=1&still=1&date=${date}&h=${hour}&special=${id}${lite ? '&lite=1' : ''}`;
const output = 'tests/qa-out/phase-g';
await fs.mkdir(output, { recursive: true });
const worlds = ['abandoned', 'flood', 'ice-age'];
const times = [[12, '12-00'], [17, '17-00'], [18.97, '18-58'], [21, '21-00'], [0, '00-00'], [5, '05-00']];
const atmosphere = { abandoned: ['fog', 'cloudy'], flood: ['storm', 'rain'], 'ice-age': ['blizzard', 'cloudy'] };
const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || undefined, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];

function monitor(page, expectedError) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && (!expectedError || !message.text().includes(expectedError))) errors.push(message.text());
  });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.url()); });
}

const ready = (page, id) => page.waitForFunction(id => window.__app?.special.id === id && !!document.querySelector('.special-world-layer.is-visible .special-plates img'), id);
const disc = page => page.locator('.special-moon-sprite');
const capture = (page, name) => page.screenshot({ path: `${output}/${name}.jpg`, type: 'jpeg', quality: 86 });
const opacity = page => disc(page).evaluate(canvas => canvas.parentElement.hidden ? 0 : +canvas.style.opacity);
async function seek(page, hour) {
  await page.locator('#specialHour').fill(String(hour));
  const frame = await page.evaluate(() => window.__app.clock.frame);
  await page.waitForFunction(({ hour, frame }) => {
    const { special, state, clock } = window.__app;
    return clock.frame > frame + 1 && Math.abs(state.S.hour - hour) < .011 && !special.layers[0].plates.pending;
  }, { hour, frame });
  await page.waitForFunction(clock => document.querySelector('#readout b')?.textContent.endsWith(clock), formatClock(hour));
}

async function geometry(page) {
  return disc(page).evaluate(canvas => {
    const moon = canvas.getBoundingClientRect();
    const photo = canvas.closest('.special-world-layer').querySelector('.special-plates').getBoundingClientRect();
    const radius = moon.width * 80 / 256;
    const x = moon.x + moon.width / 2, y = moon.y + moon.height / 2;
    const intersects = selector => {
      const node = document.querySelector(selector);
      if (!node || node.checkVisibility() === false) return false;
      const ui = node.getBoundingClientRect();
      return x - radius < ui.right && x + radius > ui.left && y - radius < ui.bottom && y + radius > ui.top;
    };
    return { x, y, u: (x - photo.x) / photo.width, v: (y - photo.y) / photo.height,
      width: moon.width, height: moon.height, diameter: radius * 2 / photo.width,
      overlap: ['.title', '.tr', '#mobileClock', '#panel', '#mobileOpen'].some(intersects) };
  });
}

async function drag(page) {
  const cdp = await page.context().newCDPSession(page);
  const { width, height } = page.viewportSize(), y = height * .48;
  const send = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x == null ? [] : [{ x, y, id: 0 }] });
  await send('touchStart', width * .66);
  for (let step = 1; step <= 8; step++) await send('touchMove', width * .66 - step * 5);
  await send('touchEnd');
  await cdp.detach();
}

try {
  for (const id of worlds) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    monitor(page);
    await page.goto(url(id, 12));
    await ready(page, id);
    await page.locator('.loading').waitFor({ state: 'hidden' });
    for (const [hour, name] of times) {
      await seek(page, hour);
      if (hour === 12) assert(!await disc(page).isVisible(), `${id}: hidden at noon`);
      else {
        await disc(page).waitFor();
        assert.equal(await disc(page).count(), 1);
        assert(hour === 17 ? await opacity(page) < .07 : await opacity(page) > .44, `${id} ${name}: solar visibility`);
        const g = await geometry(page);
        assert(g.diameter >= .03 && g.diameter <= .05 && Math.abs(g.width - g.height) < .1 && !g.overlap, `${id}: round disc in the sky, clear of UI ${JSON.stringify(g)}`);
      }
      await capture(page, `${id}-${name}-1920x1080`);
    }

    await seek(page, 21);
    const visible = await opacity(page);
    const [dense, cloud] = atmosphere[id];
    // Analyze the actual raster: contrast across the maria remains visible, and
    // the alpha of the foreground wisps changes independently of global opacity.
    const sample = () => disc(page).evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(86, 86, 84, 84).data;
      const levels = [], alpha = [];
      for (let i = 0; i < pixels.length; i += 4) { levels.push(pixels[i]); alpha.push(pixels[i + 3]); }
      return { contrast: Math.max(...levels) - Math.min(...levels), alpha: alpha.reduce((a, b) => a + b, 0) / alpha.length };
    });
    const baseline = await sample();
    assert(baseline.contrast > 55, `${id}: actual lunar surface contrast ${baseline.contrast}`);
    await page.locator(`[data-condition="${dense}"]`).click();
    await page.waitForFunction(previous => +document.querySelector('.special-moon-sprite').style.opacity < previous * .68, visible);
    const obscured = await sample();
    if (dense !== 'fog') assert(obscured.alpha < baseline.alpha - 12, `${id}: foreground cloud mask changes alpha`);
    await capture(page, `${id}-${dense}-1920x1080`);
    await page.locator(`[data-condition="${cloud}"]`).click();
    await page.waitForFunction(previous => +document.querySelector('.special-moon-sprite').style.opacity > previous * .64, visible);
    await capture(page, `${id}-${cloud}-1920x1080`);

    // Compare where the real sunrise falls, even though it is later than 05:00.
    const sunrise = await page.evaluate(() => window.__app.state.times.rise);
    await seek(page, sunrise - .45);
    const beforeRise = await opacity(page);
    await seek(page, sunrise - .10);
    assert(await opacity(page) < beforeRise && beforeRise > .04);
    await seek(page, sunrise + .25);
    assert(!await disc(page).isVisible());
    await seek(page, 20.95);
    await page.locator('#specialPlay').click();
    await page.waitForFunction(() => window.__app.state.S.hour >= 21);
    await page.locator('#specialPlay').click();
    assert.equal(await page.locator('#specialPlay').textContent(), 'Пусни');
    const paused = await page.evaluate(() => window.__app.state.S.hour);
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => window.__app.state.S.hour), paused);

    // Export is drawn from the same sprite, including atmospheric alpha.
    const [withMoon, withoutMoon] = await page.evaluate(async () => {
      const app = window.__app;
      app.clock.stop();
      const { left, top, width } = app.special.moon.canvas.getBoundingClientRect();
      const scale = app.gl.canvas.width / app.gl.canvas.clientWidth;
      const x = (left + width / 2) * scale, y = (top + width / 2) * scale;
      const sample = async () => {
        const bitmap = await createImageBitmap(await app.special.capture());
        const context = new OffscreenCanvas(24, 24).getContext('2d');
        context.drawImage(bitmap, x - 12, y - 12, 24, 24, 0, 0, 24, 24);
        bitmap.close();
        return context.getImageData(0, 0, 24, 24).data.reduce((sum, value) => sum + value, 0);
      };
      const hasMoon = await sample();
      app.special.moon.root.hidden = true;
      return [hasMoon, await sample()];
    });
    assert(withMoon > withoutMoon + 5000, `${id}: saved PNG includes the Moon`);
    console.log(`PASS ${id}: six clock checkpoints, morning fade, photo detail, cloud masking and capture`);
    await page.close();
  }

  for (const [width, height] of [[1440, 900], [844, 390], [390, 844], [412, 915]]) {
    const mobile = width < 1000;
    const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    monitor(page);
    if (mobile) await page.addInitScript(() => sessionStorage.setItem('btty.panHintSeen', '1'));
    await page.goto(url('abandoned', 21));
    await ready(page, 'abandoned');
    await page.locator('.loading').waitFor({ state: 'hidden' });
    for (const id of worlds) {
      await page.evaluate(async id => { await window.__app.actions.selectSpecial(id); }, id);
      await ready(page, id);
      await disc(page).waitFor();
      const g = await geometry(page);
      assert(!g.overlap && g.x > 0 && g.x < width && g.y > 0 && g.y < height, `${id} ${width}x${height} ${JSON.stringify(g)}`);
      assert.equal(await disc(page).count(), 1, 'one overlay when switching between target worlds');
      await capture(page, `${id}-21-00-${width}x${height}`);
    }
    if (mobile && height > width) {
      const before = await geometry(page);
      await drag(page);
      await page.waitForFunction(x => Math.abs(x - document.querySelector('.special-moon-sprite').getBoundingClientRect().left - document.querySelector('.special-moon-sprite').getBoundingClientRect().width / 2) > 20, before.x);
      const after = await geometry(page);
      assert(Math.abs(before.u - after.u) < .001 && Math.abs(before.v - after.v) < .001, 'touch pan preserves anchor in photo coordinates');
      await capture(page, `ice-age-pan-${width}x${height}`);
      await page.setViewportSize({ width: 844, height: 390 });
      const resized = await geometry(page);
      assert(Math.abs(before.u - resized.u) < .001 && Math.abs(before.v - resized.v) < .001);
    }
    for (const id of ['planet', 'sandstorm', 'cyberpunk']) {
      await page.evaluate(id => window.__app.actions.selectSpecial(id), id);
      await ready(page, id);
      assert.equal(await disc(page).count(), 0, `no Moon overlay for ${id}`);
    }
    await page.evaluate(() => window.__app.actions.exitSpecial());
    await page.waitForFunction(() => !window.__app.special.id);
    assert(await page.evaluate(() => !window.__app.gl.isContextLost()));
    console.log(`PASS ${width}x${height}: scene anchor, crop, switching and unaffected worlds`);
    await page.close();
  }

  const motion = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  monitor(motion);
  await motion.goto(url('flood', 21));
  await ready(motion, 'flood');
  await disc(motion).waitFor();
  const fingerprint = () => disc(motion).evaluate(canvas => canvas.toDataURL());
  const initial = await fingerprint();
  const anchor = await geometry(motion);
  await motion.locator('#specialPlay').click();
  await motion.waitForFunction(() => window.__app.state.S.hour > 21.16);
  await motion.locator('#specialPlay').click();
  const pausedCloud = await fingerprint();
  assert.notEqual(pausedCloud, initial, 'foreground wisps move with simulation time');
  await motion.waitForTimeout(150);
  assert.equal(await fingerprint(), pausedCloud, 'paused weather raster is stable');
  const still = await geometry(motion);
  assert(Math.abs(still.u - anchor.u) < .001 && Math.abs(still.v - anchor.v) < .001, 'cloud motion never moves the disc');
  await motion.close();
  console.log('PASS running and paused clock: moving cloud cover, stationary lunar position');

  const lite = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  monitor(lite);
  await lite.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    window.webglAttempts = 0;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (kind === 'webgl2') window.webglAttempts++;
      return get.call(this, kind, ...args);
    };
  });
  for (const id of worlds) {
    await lite.goto(url(id, 21, true));
    await disc(lite).waitFor();
    assert(await opacity(lite) > .44);
    await lite.locator('.static-panel-toggle').tap();
    await capture(lite, `${id}-lite-390x844`);
    const offset = await disc(lite).evaluate(canvas => canvas.getBoundingClientRect().left);
    await drag(lite);
    assert(Math.abs(await disc(lite).evaluate(canvas => canvas.getBoundingClientRect().left) - offset) > 20);
    await lite.locator('.static-panel-toggle').tap();
    await lite.locator('#fallbackHour').fill('12');
    assert(!await disc(lite).isVisible(), 'lite follows manual solar time');
    assert.equal(await lite.evaluate(() => window.webglAttempts), 0);
    assert.equal(await lite.locator('#gl').count(), 0);
  }
  await lite.close();
  console.log('PASS lite: all three worlds, touch crop, and no WebGL initialization');

  const fallback = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  monitor(fallback, 'webgl-unavailable');
  await fallback.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind === 'webgl2' ? null : get.call(this, kind, ...args);
    };
  });
  await fallback.goto(url('ice-age', 21));
  await disc(fallback).waitFor();
  assert.equal(await fallback.locator('.static-view').getAttribute('data-reason'), 'webgl-unavailable');
  assert(await opacity(fallback) > .44);
  await fallback.close();
  console.log('PASS forced no-WebGL fallback: the Ice Age Moon remains visible');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
