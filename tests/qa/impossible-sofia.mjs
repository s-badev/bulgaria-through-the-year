import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = 'http://127.0.0.1:8080/';
const out = 'tests/qa-out/impossible-sofia';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];

async function ready(page) { await page.waitForFunction(() => window.__app?.clock?.frame > 3); }
async function drag(cdp, from, to, y) {
  const send = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await send('touchStart', from);
  for (let step = 1; step <= 12; step++) { await send('touchMove', from + (to - from) * step / 12); await new Promise(resolve => setTimeout(resolve, 12)); }
  await send('touchEnd', to);
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  desktop.on('pageerror', error => errors.push(error.message));
  await desktop.goto(`${base}?qa=1&still=1&date=2026-07-15&h=18.75&w=clear`);
  await ready(desktop);
  await desktop.locator('#specialEntry').click();
  assert.equal(await desktop.locator('[data-special]').count(), 7);
  assert.equal(await desktop.locator('[data-special]:enabled').count(), 1, 'only supplied planet can be selected');
  assert.match(await desktop.locator('[data-special="aurora"]').textContent(), /Недостъпно/);
  await desktop.locator('[data-special="planet"]').click();
  await desktop.waitForFunction(() => window.__app.special.id === 'planet' && document.querySelector('.special-world-layer.is-visible'));
  assert(await desktop.locator('#specialBack').isVisible());
  assert.equal(await desktop.locator('.special-world img').count(), 1);
  assert.match(await desktop.locator('.special-world img').getAttribute('src'), /planet\.(webp|png)/);
  const before = await desktop.evaluate(() => ({ S: { ...window.__app.state.S }, renders: window.__app.comp.baseRenders }));
  await desktop.waitForTimeout(800);
  const after = await desktop.evaluate(() => ({ S: { ...window.__app.state.S }, renders: window.__app.comp.baseRenders }));
  assert.equal(after.renders, before.renders, 'normal compositor is suspended during special scene');
  assert.equal(after.S.weather, before.S.weather);
  assert.equal(after.S.hour, before.S.hour);
  assert.equal(await desktop.locator('.special-atmosphere').evaluate(node => getComputedStyle(node).animationName), 'none', 'reduced motion disables atmosphere');
  await desktop.evaluate(() => document.querySelector('#play').click());
  await desktop.waitForTimeout(500);
  const playingHour = await desktop.evaluate(() => window.__app.state.S.hour);
  assert(playingHour > before.S.hour && await desktop.locator('#play').getAttribute('aria-label') === 'Спри деня', 'existing clock and play control continue during special scene');
  await desktop.screenshot({ path: `${out}/planet-desktop.png` });
  const downloadPromise = desktop.waitForEvent('download');
  await desktop.locator('#shotBtn').click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^sofia-ndk-.*\.png$/);
  await download.saveAs(`${out}/planet-capture.png`);
  await desktop.locator('#specialBack').click();
  await desktop.waitForFunction(() => !window.__app.special.id);
  await desktop.waitForTimeout(600);
  assert.equal(await desktop.locator('.special-world-layer').count(), 0, 'old image released after exit');
  assert.equal(await desktop.evaluate(() => window.__app.state.S.weather), before.S.weather);
  assert(await desktop.evaluate(() => window.__app.state.S.hour) > playingHour, 'playback continues on return');
  assert.equal(await desktop.locator('#play').getAttribute('aria-label'), 'Спри деня');
  assert(await desktop.locator('#specialEntry').isVisible());
  await desktop.close();

  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [390, 700], [412, 915], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.on('pageerror', error => errors.push(`${width}x${height}: ${error.message}`));
    await page.goto(`${base}?qa=1&still=1&date=2026-07-15&h=18.75&w=clear`);
    await ready(page);
    await page.locator('#moreBtn').tap();
    await page.locator('#menuSpecial').tap();
    await page.locator('#specialDialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-special]:enabled').count(), 1);
    const target = await page.locator('[data-special="planet"]').boundingBox();
    assert(target.width >= 44 && target.height >= 44);
    await page.locator('[data-special="planet"]').tap();
    await page.waitForFunction(() => window.__app.special.id === 'planet' && document.querySelector('.special-world-layer.is-visible'));
    const geometry = await page.evaluate(() => {
      const image = document.querySelector('.special-world img'), r = image.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, scroll: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    assert(geometry.left <= 0 && geometry.right >= width && geometry.scroll <= width, `${width}x${height}: image covers view`);
    if (width === 390 && height === 844) {
      await page.locator('#specialBack').tap();
      await page.waitForFunction(() => !window.__app.special.id);
      await page.locator('#moreBtn').tap();
      await page.locator('#menuSpecial').tap();
      await page.locator('#specialDialog').waitFor({ state: 'visible' });
      await page.locator('[data-special="planet"]').tap();
      await page.waitForFunction(() => window.__app.special.id === 'planet');
    }
    if (width < height) {
      const beforePan = await page.evaluate(() => window.__app.comp.panX);
      if (width === 390) await page.screenshot({ path: `${out}/planet-mobile-center.png` });
      await drag(cdp, width * 0.75, width * 0.2, height * 0.5);
      const afterPan = await page.evaluate(() => window.__app.comp.panX);
      assert(afterPan > beforePan + 0.1, `${width}x${height}: touch pan changes crop`);
      for (let attempt = 0; attempt < 6 && (await page.evaluate(() => window.__app.comp.panX)) < 0.99; attempt++) await drag(cdp, width * 0.75, width * 0.2, height * 0.5);
      const right = await page.locator('.special-world img').boundingBox();
      const rightCrop = await page.evaluate(() => window.__app.comp.panX);
      assert(rightCrop <= 1 && rightCrop >= 0.9, `${width}x${height}: right edge clamped`);
      for (let attempt = 0; attempt < 8 && (await page.evaluate(() => window.__app.comp.panX)) > 0.01; attempt++) await drag(cdp, width * 0.2, width * 0.8, height * 0.5);
      const left = await page.locator('.special-world img').boundingBox();
      const leftCrop = await page.evaluate(() => window.__app.comp.panX);
      assert(leftCrop >= 0 && leftCrop <= 0.1 && Math.abs(right.x - left.x) > width / 2, `${width}x${height}: left edge and image travel ${JSON.stringify({ leftCrop, rightCrop, leftX: left.x, rightX: right.x })}`);
    }
    if (width === 390) await page.screenshot({ path: `${out}/planet-mobile-left.png` });
    await page.locator('#specialBack').click();
    await page.waitForFunction(() => !window.__app.special.id);
    assert(await page.locator('#mobileOpen').isVisible());
    await context.close();
    console.log(`PASS ${width}x${height}: selector, image, return and pan geometry`);
  }

  const lite = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await lite.addInitScript(() => {
    window.webglAttempts = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { if (kind === 'webgl2') { window.webglAttempts++; throw new Error('lite must not start WebGL'); } return getContext.call(this, kind, ...args); };
  });
  await lite.goto(`${base}?lite=1&special=planet`);
  await lite.waitForFunction(() => document.querySelector('.static-view img')?.src.includes('planet.webp'));
  assert.equal(await lite.locator('canvas').count(), 0);
  assert.equal(await lite.evaluate(() => window.webglAttempts), 0, 'lite never requests WebGL');
  assert(await lite.locator('.static-special-nav button').last().isVisible());
  const liteCdp = await lite.context().newCDPSession(lite);
  await drag(liteCdp, 300, 80, 400);
  assert.notEqual(await lite.locator('.static-view > img').evaluate(image => image.style.objectPosition), '50% center', 'lite touch pan works');
  await lite.screenshot({ path: `${out}/planet-lite.png` });
  await lite.locator('.static-special-nav button').last().click();
  assert.match(await lite.locator('.static-view img').getAttribute('src'), /master\.webp/);
  await lite.close();
  const fallback = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await fallback.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind === 'webgl2' ? null : getContext.call(this, kind, ...args); };
  });
  await fallback.goto(`${base}?special=planet`);
  await fallback.waitForFunction(() => document.querySelector('.static-view img')?.src.includes('planet.webp'));
  assert.equal(await fallback.locator('canvas').count(), 0, 'WebGL-independent special fallback');
  await fallback.close();
  const direct = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const photos = [];
  direct.on('request', request => { if (/\/photos\//.test(request.url())) photos.push(request.url()); });
  await direct.goto(`${base}?qa=1&special=planet`);
  await direct.waitForFunction(() => window.__app?.special.active);
  const requestsAtActivation = photos.length;
  await direct.waitForTimeout(700);
  assert.equal(photos.length, requestsAtActivation, 'background photographs pause while special scene is active');
  await direct.close();
  const regression = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await regression.goto(`${base}?qa=1&still=1&reduce=1&date=2026-04-22&h=12&w=clear`);
  await regression.waitForFunction(() => window.__app && Object.values(window.__app.scene.photos).every(photo => photo.state !== 'loading'));
  await regression.waitForTimeout(2000);
  await regression.evaluate(() => { window.__app.clock.stop(); document.querySelector('.loading')?.remove(); });
  const fixture = await sharp('tests/qa/fixtures/desktop-base.webp').removeAlpha().raw().toBuffer();
  const current = await sharp(await regression.screenshot({ path: `${out}/normal-desktop.png` })).removeAlpha().raw().toBuffer();
  let changed = 0;
  for (let i = 0; i < fixture.length; i += 3) if ([0, 1, 2].some(channel => Math.abs(fixture[i + channel] - current[i + channel]) > 8)) changed++;
  const difference = changed / (1440 * 900);
  assert(difference < 0.005, `normal desktop difference ${(difference * 100).toFixed(3)}%`);
  await regression.close();
  assert.deepEqual(errors, []);
  console.log(`PASS desktop, mobile and lite; normal desktop difference ${(difference * 100).toFixed(3)}%`);
} finally { await browser.close(); }
