import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const output = 'docs/screenshots/mobile-pan-hint';
fs.mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:8080/?qa=1&still=1&reduce=1&date=2026-04-22&h=12&w=clear';
const sizes = [[360, 640], [390, 844], [412, 915], [360, 500], [390, 700], [844, 390]];
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const failures = [];

async function ready(page) { await page.waitForFunction(() => window.__app && window.__app.clock.frame > 3); await page.waitForTimeout(350); }
async function shot(page, name) { await page.screenshot({ path: path.join(output, `${name}.jpg`), type: 'jpeg', quality: 44 }); }
async function touch(cdp, type, x, y) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] }); }
async function drag(cdp, from, to, y) {
  await touch(cdp, 'touchStart', from, y);
  for (let i = 1; i <= 12; i++) { await touch(cdp, 'touchMove', from + (to - from) * i / 12, y); await new Promise(resolve => setTimeout(resolve, 12)); }
  await touch(cdp, 'touchEnd');
  await new Promise(resolve => setTimeout(resolve, 50));
}
async function tap(cdp, x, y) { await touch(cdp, 'touchStart', x, y); await new Promise(resolve => setTimeout(resolve, 60)); await touch(cdp, 'touchEnd'); }
async function state(page) {
  return page.evaluate(() => ({
    hint: document.querySelector('.mobile-pan-hint').classList.contains('is-visible'),
    left: document.querySelector('.mobile-pan-edge-left').classList.contains('is-visible'),
    right: document.querySelector('.mobile-pan-edge-right').classList.contains('is-visible'),
    pan: window.__app.comp.panX, available: window.__app.comp.coverWidth < .999,
  }));
}
function overlap(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }

try {
  for (const [width, height] of sizes) {
    const chrome = width === 390 && height === 700, name = `${width}x${height}${chrome ? '-chrome' : ''}`;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', locale: 'bg-BG' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.on('pageerror', error => failures.push(`${name}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') failures.push(`${name}: ${message.text()}`); });
    await page.goto(base);
    await ready(page);
    if (chrome) await page.evaluate(() => {
      Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 64 });
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;inset:auto 0 0;height:64px;background:#202733;z-index:20';
      document.body.append(bar);
      visualViewport.dispatchEvent(new Event('resize'));
    });
    const first = await state(page);
    if (!first.available) {
      assert(!first.hint && !first.left && !first.right, `${name}: no indicators without horizontal crop`);
      await shot(page, `${name}-center`);
      await context.close();
      console.log(`PASS ${name}: no horizontal pan indicators`);
      continue;
    }
    assert(first.hint && first.left && first.right, `${name}: hint and both directions on first visit`);
    const hint = page.locator('.mobile-pan-hint');
    assert.equal((await hint.textContent()).replace(/\s+/g, ' ').trim(), '←→Плъзни наляво или надясно, за да разгледаш София');
    assert.equal(await hint.locator('svg').count(), 1, 'hand icon');
    const geometry = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      const h = document.querySelector('.mobile-pan-hint');
      const r = h.getBoundingClientRect();
      return { hint: r.toJSON(), title: rect('.title'), more: rect('#moreBtn'), controls: rect('#mobileOpen'), hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id, pointer: getComputedStyle(h).pointerEvents, transition: getComputedStyle(h).transitionDuration };
    });
    assert(!overlap(geometry.hint, geometry.title) && !overlap(geometry.hint, geometry.more) && !overlap(geometry.hint, geometry.controls), `${name}: unobstructed controls`);
    assert.equal(geometry.hit, 'gl', `${name}: hint does not intercept touch`);
    assert.equal(geometry.pointer, 'none');
    assert.equal(geometry.transition, '0s', 'reduced motion has no hint animation');
    await shot(page, `${name}-first-visit`);

    const y = Math.round(height * .48), start = Math.round(width * .15), end = Math.round(width * .85);
    await drag(cdp, end, start, y);
    const afterDrag = await state(page);
    assert(!afterDrag.hint && afterDrag.pan > first.pan + .05, `${name}: touch drag dismisses hint and pans`);
    await shot(page, `${name}-hint-dismissed`);
    for (let i = 0; i < 3; i++) await drag(cdp, end, start, y);
    const atRight = await state(page);
    assert(atRight.pan > .999 && atRight.left && !atRight.right, `${name}: right image edge`);
    await shot(page, `${name}-right`);
    for (let i = 0; i < 6; i++) await drag(cdp, start, end, y);
    const atLeft = await state(page);
    assert(atLeft.pan < .001 && !atLeft.left && atLeft.right, `${name}: left image edge`);
    await shot(page, `${name}-left`);
    await tap(cdp, Math.round(width / 2), y);
    await tap(cdp, Math.round(width / 2), y);
    await page.waitForTimeout(120);
    const centred = await state(page);
    assert(Math.abs(centred.pan - first.pan) < .002 && centred.left && centred.right, `${name}: double tap recentres`);
    await shot(page, `${name}-center`);

    await page.locator('#mobileOpen').click();
    await page.waitForFunction(() => !document.querySelector('.mobile-pan-edge-left').classList.contains('is-visible'));
    assert(!(await state(page)).left && !(await state(page)).right, `${name}: panel hides indicators`);
    await page.locator('#mobileDone').click();
    await page.locator('#moreBtn').click();
    await page.waitForFunction(() => !document.querySelector('.mobile-pan-edge-left').classList.contains('is-visible'));
    assert(!(await state(page)).left && !(await state(page)).right, `${name}: menu hides indicators`);
    await page.locator('#menuCredits').click();
    assert(await page.locator('#credits').evaluate(dialog => dialog.open));
    await page.waitForFunction(() => !document.querySelector('.mobile-pan-edge-left').classList.contains('is-visible'));
    assert(!(await state(page)).left && !(await state(page)).right, `${name}: dialog hides indicators`);
    await page.keyboard.press('Escape');
    await page.reload();
    await ready(page);
    assert(!(await state(page)).hint, `${name}: hint only once per session`);
    await context.close();
    console.log(`PASS ${name}: hint, touch dismissal, edges, overlays and session`);
  }
  const timeoutContext = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  const timeoutPage = await timeoutContext.newPage();
  await timeoutPage.goto(base);
  await timeoutPage.waitForFunction(() => document.querySelector('.mobile-pan-hint.is-visible'));
  await timeoutPage.waitForTimeout(1800);
  assert((await state(timeoutPage)).hint, 'hint remains briefly readable');
  await timeoutPage.waitForTimeout(2600);
  assert(!(await state(timeoutPage)).hint, 'hint automatically disappears after about four seconds');
  await timeoutPage.locator('#mobileOpen').click();
  await timeoutPage.locator('#mobileDone').click();
  await timeoutPage.waitForTimeout(150);
  assert(!(await state(timeoutPage)).hint, 'closing controls does not repeat the hint');
  await timeoutContext.close();
  console.log('PASS hint timeout about four seconds');

  const blocked = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  await blocked.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
  const blockedPage = await blocked.newPage();
  blockedPage.on('pageerror', error => failures.push(`storage blocked: ${error.message}`));
  await blockedPage.goto(base);
  await ready(blockedPage);
  assert((await state(blockedPage)).hint, 'storage-disabled fallback shows hint');
  await blocked.close();
  console.log('PASS blocked sessionStorage fallback');
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
