import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = `http://127.0.0.1:${process.argv[2] || process.env.QA_PORT || 8080}/`;
const output = 'docs/screenshots/mobile-pan';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const sizes = [[360, 640], [390, 844], [412, 915], [360, 500], [390, 700], [844, 390]];
const failures = [];

async function ready(page) {
  await page.waitForFunction(() => window.__app && window.__app.clock.frame > 3);
  await page.waitForTimeout(700);
}
async function touch(cdp, type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
}
async function drag(cdp, from, to, y) {
  await touch(cdp, 'touchStart', from, y);
  for (let step = 1; step <= 12; step++) {
    await touch(cdp, 'touchMove', from + (to - from) * step / 12, y);
    await new Promise(resolve => setTimeout(resolve, 12));
  }
  await touch(cdp, 'touchEnd');
  await new Promise(resolve => setTimeout(resolve, 50));
}
async function tap(cdp, x, y) {
  await touch(cdp, 'touchStart', x, y);
  await new Promise(resolve => setTimeout(resolve, 60));
  await touch(cdp, 'touchEnd');
}
async function crop(page) {
  return page.evaluate(() => {
    const { comp } = window.__app, [x, , width] = comp.view.cov, z = comp.view.zoom;
    return { pan: comp.panX, x, width, left: .5 + (x - .5) / z, right: .5 + (x + width - .5) / z, center: comp.focusX };
  });
}
function bounded(c) {
  assert(c.left >= -0.00001 && c.right <= 1.00001, `crop inside image: ${JSON.stringify(c)}`);
  assert(c.pan >= 0 && c.pan <= 1);
}
async function shot(page, name) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: path.join(output, `${name}.jpg`), type: 'jpeg', quality: 45 });
}
async function headerGap(page) {
  const result = await page.evaluate(() => {
    const more = document.querySelector('#moreBtn').getBoundingClientRect();
    const title = document.querySelector(document.body.classList.contains('title-hidden') ? '#titleRestore' : '.title').getBoundingClientRect();
    return { left: title.right, right: more.left, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert(result.right - result.left >= 8 && !result.overflow, JSON.stringify(result));
}

try {
  for (const [width, height] of sizes) {
    const chrome = width === 390 && height === 700;
    const name = `${width}x${height}${chrome ? '-chrome' : ''}`;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, locale: 'bg-BG' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.on('pageerror', error => failures.push(`${name}: ${error.message}`));
    await page.goto(base + '?intro=1&still=1');
    await ready(page);
    assert(!(await page.evaluate(() => window.__app.demo.on)), `${name}: no automatic demo`);
    assert(!(await page.locator('#demoBar').isVisible()) && !(await page.locator('#caption').isVisible()));
    assert(!(await page.locator('#intro').isVisible()));
    if (width === 360 && height === 640) {
      await page.locator('#moreBtn').tap();
      await page.locator('#demoBtn').tap();
      assert(await page.evaluate(() => window.__app.demo.on), 'manual demo remains available');
      await page.locator('#demoStop').tap();
      const before = await crop(page);
      await drag(cdp, Math.round(width * .85), Math.round(width * .15), Math.round(height * .48));
      const moved = await crop(page);
      assert(moved.pan > before.pan + .05, 'pan works with normal animated zoom');
      await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { gamma: 16, beta: 45 })));
      await page.waitForTimeout(350);
      const withGyro = await crop(page);
      bounded(withGyro);
      assert(Math.abs(withGyro.pan - moved.pan) < .00001, 'gyro does not override finger position');
      assert.equal(await page.evaluate(() => window.__app.comp.view.par[0]), 0, 'mobile horizontal gyro parallax is disabled');
    }
    await page.goto(base + '?qa=1&still=1&reduce=1&date=2026-04-22&h=12&w=clear');
    await ready(page);
    if (chrome) await page.evaluate(() => {
      Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 64 });
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;inset:auto 0 0;height:64px;background:#202733;z-index:20';
      document.body.append(bar);
      visualViewport.dispatchEvent(new Event('resize'));
    });
    assert(!(await page.locator('#panel').isVisible()));
    await headerGap(page);
    await page.locator('#titleHide').tap();
    await headerGap(page);
    await page.locator('#titleRestore').tap();
    await headerGap(page);

    const y = Math.round(height * .48), start = Math.round(width * .15), end = Math.round(width * .85);
    const initial = await crop(page);
    bounded(initial);
    assert(Math.abs(initial.x + initial.width / 2 - initial.center) < .005 || initial.width === 1, `${name}: NDK centred`);
    await shot(page, `${name}-center`);
    for (let i = 0; i < 3; i++) await drag(cdp, start, end, y);
    const left = await crop(page);
    bounded(left);
    assert(left.pan < .001 || left.width === 1, `${name}: left edge reached`);
    await shot(page, `${name}-left`);
    for (let i = 0; i < 6; i++) await drag(cdp, end, start, y);
    const right = await crop(page);
    bounded(right);
    assert(right.pan > .999 || right.width === 1, `${name}: right edge reached`);
    await shot(page, `${name}-right`);
    assert(!(await page.locator('#panel').isVisible()), 'drag does not open controls');
    assert.equal(await page.locator('#mobileOpen').getAttribute('aria-expanded'), 'false');

    if (right.width < 1) {
      const saved = right.pan;
      await page.locator('#mobileOpen').click();
      assert(await page.locator('#panel').isVisible(), 'controls reopen after dragging');
      await page.locator('[data-s="winter"]').click();
      assert(!(await page.locator('#panel').isVisible()));
      assert(Math.abs((await crop(page)).pan - saved) < .00001, 'season preserves pan');
      await page.locator('#mobileOpen').click();
      await page.locator('[data-w="fog"]').click();
      assert(!(await page.locator('#panel').isVisible()));
      assert(Math.abs((await crop(page)).pan - saved) < .00001, 'weather preserves pan');
      await page.locator('#mobileOpen').click();
      for (const selector of ['#hour', '#wind', '#fogLvl']) await page.locator(selector).fill(selector === '#hour' ? '16' : '.6');
      await page.locator('#mobileDone').click();
      assert(Math.abs((await crop(page)).pan - saved) < .00001, 'sliders preserve pan');
      await page.evaluate(() => { window.__app.quality.scale = .75; window.__app.quality.onChange(); });
      assert(Math.abs((await crop(page)).pan - saved) < .00001, 'quality preserves pan');
      if (width === 390 && height === 844) {
        await page.setViewportSize({ width: 844, height: 390 });
        bounded(await crop(page));
        assert(Math.abs((await crop(page)).pan - saved) < .00001, 'landscape preserves pan state');
        await page.setViewportSize({ width, height });
        assert(Math.abs((await crop(page)).pan - saved) < .00001, 'portrait restores pan state');
      }
    }
    if (width === 360 && height === 640) await page.evaluate(() => { window.__app.state.S.reducedMotion = false; });
    await tap(cdp, Math.round(width / 2), y);
    await tap(cdp, Math.round(width / 2), y);
    if (width === 360 && height === 640) {
      await page.waitForTimeout(80);
      const mid = await crop(page);
      assert(mid.pan < right.pan - .01 && mid.pan > initial.pan + .01, 'double tap animates towards centre');
    }
    await page.waitForTimeout(300);
    const reset = await crop(page);
    assert(Math.abs(reset.pan - initial.pan) < .002, `${name}: double tap resets framing`);
    bounded(reset);
    await page.reload();
    await ready(page);
    assert(Math.abs((await crop(page)).pan - initial.pan) < .002, `${name}: pan is not stored across reloads`);
    await context.close();
    console.log(`PASS ${name}: centre, both edges, reset, preserved state, buttons and demo`);
  }
  const narrow = await browser.newPage({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  await narrow.goto(base + '?qa=1&reduce=1');
  await ready(narrow);
  await headerGap(narrow);
  await narrow.locator('#titleHide').tap();
  await headerGap(narrow);
  console.log('PASS 320x568 header and restore button separation');
  await narrow.close();
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await desktop.goto(base + '?qa=1&still=1&reduce=1&date=2026-04-22&h=12&w=clear');
  await desktop.waitForFunction(() => window.__app && Object.values(window.__app.scene.photos).every(photo => photo.state !== 'loading'));
  await desktop.waitForTimeout(2000);
  await desktop.evaluate(() => { window.__app.clock.stop(); document.querySelector('#version').textContent = 'версия QA'; document.querySelector('.loading')?.remove(); });
  const before = await sharp('tests/qa/fixtures/desktop-base.webp').removeAlpha().raw().toBuffer();
  const after = await sharp(await desktop.screenshot()).removeAlpha().raw().toBuffer();
  let changed = 0;
  for (let i = 0; i < before.length; i += 3) if ([0, 1, 2].some(channel => Math.abs(before[i + channel] - after[i + channel]) > 8)) changed++;
  const difference = changed / (1440 * 900);
  assert(difference < .005, `desktop screenshot difference ${difference * 100}%`);
  console.log(`PASS desktop difference ${(difference * 100).toFixed(3)}%`);
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
