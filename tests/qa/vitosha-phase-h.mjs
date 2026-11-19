import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';

const port = process.argv[2] || 8080;
const label = process.argv[3] || 'after';
const out = `tests/qa-out/phase-h/${label}`;
const date = '2026-11-19';
const worlds = ['abandoned', 'ice-age'];
const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || undefined, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];
await fs.mkdir(out, { recursive: true });

function monitor(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
}
const open = (page, id, hour = 12) => page.goto(`http://127.0.0.1:${port}/?qa=1&still=1&date=${date}&h=${hour}&special=${id}`);
const ready = (page, id) => page.waitForFunction(id => window.__app?.special.id === id && !!document.querySelector('.special-world-layer.is-visible .special-plates img'), id);
async function settled(page) {
  const frame = await page.evaluate(() => window.__app.clock.frame);
  await page.waitForFunction(frame => {
    const { clock, special } = window.__app;
    const plates = special.layers[0].plates;
    return clock.frame > frame + 2 && !plates.pending && plates.visible.size > 0;
  }, frame);
}
async function seek(page, hour) {
  await page.locator('#specialHour').fill(String(hour));
  await settled(page);
}
async function capture(page, name) {
  const raw = await page.screenshot({ style: '#app > :not(.special-world) { visibility: hidden !important; }' });
  await sharp(raw).jpeg({ quality: 87, mozjpeg: true }).toFile(`${out}/${name}.jpg`);
}
const solarHour = (page, elevation) => page.evaluate(elevation => {
  const { state } = window.__app;
  const original = state.S.hour;
  let low = 14, high = 21;
  // Find the two times of 50/50 blending from the same solar model as the renderer.
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    state.setHour(mid);
    if (state.computeSun().elevation > elevation) low = mid;
    else high = mid;
  }
  state.setHour(original);
  return (low + high) / 2;
}, elevation);

try {
  for (const id of worlds) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    monitor(page);
    await open(page, id);
    await ready(page, id);
    const sunset = await page.evaluate(() => window.__app.state.times.set);
    const times = [[12, '12'], [15, '15'], [sunset, 'sunset'], [await solarHour(page, 3), 'blend-day-dusk'],
      [await solarHour(page, -7), 'blend-dusk-night'], [21, '21'], [0, '00']];
    for (const [hour, tag] of times) {
      await seek(page, hour);
      if (tag.startsWith('blend')) {
        const weights = await page.evaluate(() => [...window.__app.special.layers[0].plates.visible.values()]);
        assert.equal(weights.length, 2);
        assert(weights.every(weight => weight > .4 && weight < .6), `Both exposures visible: ${weights}`);
      }
      await capture(page, `${id}-${tag}`);
    }
    await page.locator('[data-condition=cloudy]').click();
    await seek(page, 12);
    await page.waitForFunction(() => window.__app.special.layers[0].plates.visible.get('overcast') > .99);
    await capture(page, `${id}-overcast`);
    const extreme = id === 'ice-age' ? 'blizzard' : 'fog';
    await page.locator(`[data-condition=${extreme}]`).click();
    await seek(page, 21);
    await capture(page, `${id}-${extreme}`);
    for (const hour of [12, 21, 15, 0, 12]) await page.locator('#specialHour').fill(String(hour));
    await settled(page);
    await page.waitForFunction(() => [...window.__app.special.layers[0].plates.visible.values()].some(weight => weight > .99));
    assert(await page.evaluate(() => window.__app.state.S.hour === 12 && !window.__app.gl.isContextLost()));
    await seek(page, sunset - .03);
    await page.locator('#specialPlay').click();
    await page.waitForFunction(() => window.__app.state.S.hour > window.__app.state.times.set + .05);
    await page.locator('#specialPlay').click();
    await page.close();
    console.log(`PASS ${id}: daylight, dusk, two half blends, night, atmosphere and playback`);
  }

  if (label !== 'before') for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768], [360, 800], [390, 844], [412, 915], [844, 390]]) {
    const mobile = width <= 844;
    const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    monitor(page);
    await open(page, worlds[0]);
    await ready(page, worlds[0]);
    await page.evaluate(() => { window.qaTerrainGL = window.__app.gl; });
    for (const id of worlds) {
      await page.evaluate(id => window.__app.actions.selectSpecial(id), id);
      await ready(page, id);
      const crop = () => page.locator('.special-world-layer').last().locator('.special-plates').evaluate(node => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, scrollWidth: document.documentElement.scrollWidth };
      });
      const before = await crop();
      assert(before.x <= .02 && before.x + before.width >= width - .02 && before.scrollWidth === width);
      assert(Math.abs(before.width / before.height - 1672 / 941) < .012);
      await capture(page, `${id}-${width}x${height}`);
      if (width < height) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width * .7, y: height * .5 }] });
        for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width * (.7 - i * .03), y: height * .5 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
        await page.waitForFunction(x => Math.abs(document.querySelector('.special-world-layer:last-child .special-plates').getBoundingClientRect().x - x) > 20, before.x);
        const after = await crop();
        assert.equal(after.width, before.width);
        assert.equal(after.height, before.height);
        await page.evaluate(() => { const comp = window.__app.comp; comp.setPan(comp.centerPan()); });
      }
    }
    await page.evaluate(() => window.__app.actions.exitSpecial());
    await page.waitForFunction(() => !window.__app.special.id && window.__app.gl === window.qaTerrainGL && !window.__app.gl.isContextLost());
    await page.close();
    console.log(`PASS ${width}×${height}: whole-photo alignment, panning, switches and return`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
