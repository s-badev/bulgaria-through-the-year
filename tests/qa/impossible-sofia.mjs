import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = `http://127.0.0.1:${process.argv[2] || process.env.QA_PORT || 8080}/`;
const out = 'tests/qa-out/impossible-sofia';
const scenes = ['planet', 'abandoned', 'sandstorm', 'cyberpunk', 'flood', 'ice-age'];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];

async function ready(page) { await page.waitForFunction(() => window.__app?.clock?.frame > 3); }
const entryButtons = page => page.getByRole('button', { name: /^(Другата София|Невъзможна София|Вулкан)$/ });
async function openFromControls(page, mobile = false) {
  if (mobile) {
    assert.equal(await entryButtons(page).count(), 0, 'no floating entry with controls closed');
    await page.locator('#mobileOpen').tap();
  }
  assert.equal(await entryButtons(page).count(), 1, 'exactly one visible scene entry');
  const entry = page.locator('#panel .season-group > #specialEntry');
  assert.equal(await entry.textContent(), 'Другата София');
  if (mobile) {
    const target = await entry.boundingBox();
    assert(target.width >= 44 && target.height >= 44, 'mobile entry has a full touch target');
    await entry.tap();
  } else {
    await entry.click();
  }
  assert(await page.locator('#specialPicker').isVisible());
  assert.equal(await page.getByRole('dialog').count(), 0, 'scene selection does not require a modal dialog');
}

async function drag(cdp, from, to, y) {
  const send = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await send('touchStart', from);
  for (let step = 1; step <= 12; step++) { await send('touchMove', from + (to - from) * step / 12); await new Promise(resolve => setTimeout(resolve, 12)); }
  await send('touchEnd', to);
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  desktop.on('pageerror', error => errors.push(error.message));
  desktop.on('response', response => { if (response.url().includes('/special/') && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await desktop.goto(`${base}?qa=1&still=1&date=2026-07-15&h=18.75&w=clear`);
  await ready(desktop);
  await openFromControls(desktop);
  await desktop.keyboard.press('Escape');
  await desktop.waitForFunction(() => document.activeElement?.id === 'specialEntry');
  await openFromControls(desktop);
  assert.deepEqual(await desktop.locator('[data-special]').evaluateAll(buttons => buttons.map(button => button.dataset.special)), scenes);
  assert.equal(await desktop.locator('[data-special]:enabled').count(), 6, 'all six selected worlds can be opened');
  await desktop.locator('[data-special="planet"]').click();
  await desktop.waitForFunction(() => window.__app.special.id === 'planet' && document.querySelector('.special-world-layer.is-visible'));
  assert(await desktop.locator('#specialBack').isVisible());
  assert.equal(await desktop.locator('#specialDate').count(), 0, 'special calendar removed');
  assert.equal(await desktop.locator('#specialBack').evaluate(node => !!node.closest('.special-picker-head')), true, 'back action aligned at right of world selector header');
  assert.equal(await desktop.locator('#specialIntensity, #specialSound, #specialVolume').count(), 0, 'unneeded controls absent');
  assert.equal(await desktop.locator('#specialChange').evaluate(node => !!node.closest('#specialControls .special-settings')), true, 'scene change remains in special settings');
  assert.equal(await desktop.locator('.special-world img').count(), 1);
  assert.match(await desktop.locator('.special-world img').getAttribute('src'), /planet-day\.(webp|png)/);
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
  for (const id of scenes) {
    if (id === 'planet') continue;
    await desktop.locator('#specialEntry').click();
    assert.equal(await desktop.locator('[data-special]:enabled').count(), 6);
    await desktop.locator(`[data-special="${id}"]`).click();
    await desktop.waitForFunction(expected => window.__app.special.id === expected, id);
    const loaded = await desktop.locator('.special-world-layer.is-visible img').last().evaluate(image => ({ src: image.currentSrc, ok: image.complete && image.naturalWidth === 1672 }));
    assert(loaded.ok && loaded.src.includes(`${id}-`), `${id}: correct photographic source loaded`);
    assert.equal(await desktop.locator('.special-world-layer.is-visible .special-atmosphere').last().evaluate(node => getComputedStyle(node).animationName), 'none', `${id}: reduced motion disables atmosphere`);
    assert.equal(await desktop.locator(`[data-special="${id}"]`).getAttribute('aria-pressed'), 'true');
    await desktop.waitForTimeout(650);
    assert.equal(await desktop.locator('.special-world-layer').count(), 1, `${id}: old image released after crossfade`);
    await desktop.screenshot({ path: `${out}/${id}-desktop.png` });
  }
  await desktop.locator('#specialBack').click();
  await desktop.waitForFunction(() => !window.__app.special.id);
  assert.equal(await desktop.evaluate(() => window.__app.state.S.weather), before.S.weather);
  assert.equal(await desktop.evaluate(() => window.__app.state.S.playing), true);
  await desktop.close();

  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [390, 700], [412, 915], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.on('pageerror', error => errors.push(`${width}x${height}: ${error.message}`));
    await page.goto(`${base}?qa=1&still=1&date=2026-07-15&h=18.75&w=clear`);
    await ready(page);
    if (width === 390 && height === 700) {
      await page.locator('#moreBtn').tap();
      assert.equal(await entryButtons(page).count(), 0, 'no alternate entry in the More menu');
      await page.locator('#moreBtn').tap();
      await openFromControls(page, true);
      await page.locator('#specialPickerClose').tap();
      await page.waitForFunction(() => document.activeElement?.id === 'specialEntry');
      await page.locator('#mobileClose').tap();
    }
    await openFromControls(page, true);
    assert.equal(await page.locator('[data-special]:enabled').count(), 6);
    const target = await page.locator('[data-special="planet"]').boundingBox();
    assert(target.width >= 44 && target.height >= 44);
    await page.locator('[data-special="planet"]').tap();
    await page.waitForFunction(() => window.__app.special.id === 'planet' && document.querySelector('.special-world-layer.is-visible'));
    assert.equal(await page.locator('#mobileOpen').getAttribute('aria-expanded'), 'false', 'the panel closes after scene selection');
    const geometry = await page.evaluate(() => {
      const image = document.querySelector('.special-world img'), r = image.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, scroll: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    assert(geometry.left <= 0 && geometry.right >= width && geometry.scroll <= width, `${width}x${height}: image covers view`);
    const chrome = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      const nav = document.querySelector('.special-nav');
      return { embedded: !!nav.closest('#specialControls .special-settings'), panelClosed: !document.querySelector('#panel').getClientRects().length, duplicate: document.querySelectorAll('#specialChange, #specialBack').length };
    });
    assert(chrome.embedded && chrome.panelClosed && chrome.duplicate === 2, `${width}x${height}: navigation belongs only to the closed panel`);
    if (width === 390 && height === 844) {
      await page.locator('#mobileOpen').tap();
      await page.locator('#specialBack').tap();
      await page.waitForFunction(() => !window.__app.special.id);
      await openFromControls(page, true);
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
    if (width === 390 && height === 844) {
      const savedPan = await page.evaluate(() => window.__app.comp.panX);
      for (const id of scenes.slice(1)) {
        await page.locator('#mobileOpen').tap();
        const change = page.locator('#specialChange');
        await change.scrollIntoViewIfNeeded();
        const bounds = await change.boundingBox();
        assert(bounds.width >= 44 && bounds.height >= 44, 'change scene is touch accessible');
        await change.tap();
        await page.locator(`[data-special="${id}"]`).tap();
        await page.waitForFunction(expected => window.__app.special.id === expected, id);
        assert.equal(await page.evaluate(() => window.__app.comp.panX), savedPan, `${id}: mobile pan preserved`);
        await page.evaluate(() => { window.__app.comp.panX = .5; window.__app.comp.applyPan(); });
        await page.waitForTimeout(650);
        const frame = await page.locator('.special-world-layer img').boundingBox();
        assert(frame.x <= 0 && frame.x + frame.width >= width, `${id}: full viewport covered`);
        await page.screenshot({ path: `${out}/${id}-mobile.png` });
        if (id !== scenes.at(-1)) await page.evaluate(pan => { window.__app.comp.panX = pan; window.__app.comp.applyPan(); }, savedPan);
      }
    }
    await page.locator('#mobileOpen').tap();
    await page.locator('#specialBack').click();
    await page.waitForFunction(() => !window.__app.special.id);
    assert(await page.locator('#mobileOpen').isVisible());
    await context.close();
    console.log(`PASS ${width}x${height}: selector, image, return and pan geometry`);
  }

  const motion = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' });
  motion.on('pageerror', error => errors.push(`motion: ${error.message}`));
  await motion.goto(`${base}?qa=1&still=1&special=ice-age`);
  await motion.waitForFunction(() => window.__app?.special.id === 'ice-age');
  for (const id of ['ice-age', 'sandstorm', 'abandoned', 'supercell']) {
    if (id === 'supercell') {
      await motion.evaluate(() => window.__app.actions.selectSpecial('supercell'));
    } else if (id !== 'ice-age') {
      await motion.locator('#mobileOpen').click();
      await motion.locator('#specialChange').click();
      await motion.locator(`[data-special="${id}"]`).click();
      await motion.waitForFunction(expected => window.__app.special.id === expected, id);
    }
    await motion.waitForTimeout(220);
    const effect = await motion.evaluate(() => {
      const item = window.__app.special.layers[0].effects;
      const pixels = item.ctx.getImageData(0, 0, item.canvas.width, item.canvas.height).data;
      let active = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) active++;
      return { elapsed: item.elapsed, active, count: item.points.length };
    });
    assert(effect.elapsed > 0 && effect.active > 0, `${id}: lightweight particles move and draw`);
    await motion.screenshot({ path: `${out}/${id}-motion.png` });
    if (id === 'supercell') {
      const flash = await motion.evaluate(() => {
        const app = window.__app, item = app.special.layers[0].effects;
        item.nextFlash = item.elapsed;
        app.clock.step(1 / 60);
        return item.flash;
      });
      assert(flash > 0, 'supercell has a brief calculated flash');
      await motion.evaluate(() => { const app = window.__app; app.state.S.flashes = false; app.clock.step(1 / 60); });
      assert.equal(await motion.locator('.special-flash').last().evaluate(node => +node.style.opacity), 0, 'no-flashes preference suppresses lightning');
    }
  }
  await motion.close();

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
  await lite.locator('.static-special-nav button').first().click();
  assert.equal(await lite.locator('.static-special-dialog [data-special]:enabled').count(), 6);
  await lite.locator('.static-special-dialog [data-special="flood"]').click();
  await lite.waitForFunction(() => document.querySelector('.static-view > img')?.src.includes('flood.webp'));
  await lite.screenshot({ path: `${out}/flood-lite.png` });
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
