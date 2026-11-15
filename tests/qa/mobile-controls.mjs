import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = 'http://127.0.0.1:8080/';
const output = 'docs/screenshots/mobile-v2';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const sizes = [[360, 640], [390, 844], [412, 915], [360, 500], [844, 390], [390, 700]];
const panelSelectors = ['#play', '#hour', '#date', '#now', '#wind', '#fogLvl', '#vol', '#creditsBtn', ...['spring', 'summer', 'autumn', 'winter'].map(value => `[data-s="${value}"]`), ...['clear', 'cloudy', 'fog', 'rain', 'storm', 'snow'].map(value => `[data-w="${value}"]`)];
const menuSelectors = ['#soundBtn', '#shotBtn', '#demoBtn', '#flashBtn', '#panelBtn', '#menuCredits'];
const failures = [];

async function ready(page) {
  await page.waitForFunction(() => window.__app && window.__app.clock.frame > 3);
  await page.waitForTimeout(900);
}
async function shot(page, name) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: path.join(output, `${name}.jpg`), type: 'jpeg', quality: 48 });
}
async function visibleTarget(page, selector, container) {
  const element = page.locator(selector);
  await element.evaluate(node => node.scrollIntoView({ block: 'center' }));
  const rect = await element.boundingBox();
  assert(rect && rect.width >= 44 && rect.height >= 44, `${selector} touch target`);
  const ok = await element.evaluate((node, container) => {
    const box = node.getBoundingClientRect();
    const parent = document.querySelector(container).getBoundingClientRect();
    const bottom = (visualViewport?.offsetTop || 0) + (visualViewport?.height || innerHeight);
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.left >= 0 && box.right <= innerWidth && box.top >= parent.top && box.bottom <= Math.min(parent.bottom, bottom) && (hit === node || node.contains(hit));
  }, container);
  assert(ok, `${selector} visible and usable`);
}
async function open(page) {
  await page.locator('#mobileOpen').tap();
  assert(await page.locator('#panel').isVisible());
  assert.equal(await page.locator('#mobileOpen').getAttribute('aria-expanded'), 'true');
}
async function closed(page) {
  assert(!(await page.locator('#panel').isVisible()));
  assert.equal(await page.locator('#mobileOpen').getAttribute('aria-expanded'), 'false');
}

try {
  for (const [width, height] of sizes) {
    const chrome = width === 390 && height === 700;
    const name = `${width}x${height}${chrome ? '-chrome' : ''}`;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', locale: 'bg-BG' });
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(`${name}: ${error.message}`));
    await page.goto(base + '?qa=1&still=1&reduce=1&date=2026-04-22&h=12');
    await ready(page);
    if (chrome) await page.evaluate(() => {
      Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 64 });
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;inset:auto 0 0;height:64px;background:#202733;z-index:20';
      document.body.append(bar);
      visualViewport.dispatchEvent(new Event('resize'));
    });
    await closed(page);
    assert(!(await page.locator('#intro').isVisible()));
    assert(await page.locator('#mobileOpen').isVisible());
    const closedGeometry = await page.evaluate(() => {
      const button = document.querySelector('#mobileOpen').getBoundingClientRect();
      const title = document.querySelector('.title').getBoundingClientRect();
      const more = document.querySelector('#moreBtn').getBoundingClientRect();
      return { bottom: button.bottom, viewportBottom: (visualViewport?.offsetTop || 0) + (visualViewport?.height || innerHeight), overlap: title.left < more.right && title.right > more.left && title.top < more.bottom && title.bottom > more.top, overflow: document.documentElement.scrollWidth > innerWidth, buttonWidth: button.width, buttonHeight: button.height };
    });
    assert(!closedGeometry.overlap && !closedGeometry.overflow);
    assert(closedGeometry.bottom <= closedGeometry.viewportBottom && closedGeometry.buttonWidth < width / 2 && closedGeometry.buttonHeight <= 60);
    await shot(page, `${name}-closed`);

    await open(page);
    for (const selector of panelSelectors) await visibleTarget(page, selector, '#panel');
    await page.locator('#panel').evaluate(node => { node.scrollTop = 0; });
    assert(!(await page.locator('#mobileOpen').isVisible()));
    await shot(page, `${name}-open`);
    await page.locator('#creditsBtn').click();
    assert(await page.locator('#credits').evaluate(node => node.open));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.id === 'creditsBtn');
    assert(await page.locator('#creditsBtn').evaluate(node => node === document.activeElement));
    for (const selector of ['#hour', '#wind', '#fogLvl', '#vol']) {
      const before = await page.locator(selector).inputValue();
      await page.locator(selector).focus();
      await page.keyboard.press('ArrowRight');
      assert.notEqual(await page.locator(selector).inputValue(), before, `${selector} changes`);
      assert(await page.locator('#panel').isVisible(), `${selector} keeps sheet open`);
    }
    await page.locator('#play').tap();
    assert(await page.evaluate(() => window.__app.state.S.playing));
    await page.locator('#play').tap();
    assert(!(await page.evaluate(() => window.__app.state.S.playing)));
    await page.locator('#mobileDone').click();
    await closed(page);
    await open(page);
    await page.locator('#mobileClose').click();
    await closed(page);
    await open(page);
    await page.keyboard.press('Escape');
    await closed(page);

    for (const season of ['spring', 'summer', 'autumn', 'winter']) {
      await open(page);
      await page.locator(`[data-s="${season}"]`).tap();
      await closed(page);
      assert.equal(await page.evaluate(() => window.__app.state.seasonName), season);
    }
    await open(page);
    await page.locator('#date').fill('2026-01-18');
    await closed(page);
    assert.equal(await page.locator('#date').inputValue(), '2026-01-18');
    for (const weather of ['clear', 'cloudy', 'fog', 'storm', 'snow', 'rain']) {
      await open(page);
      await page.locator(`[data-w="${weather}"]`).tap();
      await closed(page);
      assert.equal(await page.evaluate(() => window.__app.state.S.weather), weather);
    }
    await shot(page, `${name}-weather`);
    await page.route('**/api.open-meteo.com/**', route => route.fulfill({ json: { current: { weather_code: 3, cloud_cover: 90, temperature_2m: 12, wind_speed_10m: 9 } } }));
    await open(page);
    await page.locator('#now').tap();
    await page.waitForFunction(() => !document.querySelector('#panel').classList.contains('is-open'));

    await page.locator('#moreBtn').tap();
    for (const selector of menuSelectors) await visibleTarget(page, selector, '#mobileMenu');
    await page.locator('#soundBtn').tap();
    assert(await page.evaluate(() => window.__app.state.S.sound));
    await page.locator('#moreBtn').tap();
    await page.locator('#flashBtn').tap();
    assert(!(await page.evaluate(() => window.__app.state.S.flashes)));
    await page.locator('#moreBtn').tap();
    await page.locator('#menuCredits').tap();
    assert(await page.locator('#credits').evaluate(node => node.open));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.id === 'moreBtn');
    assert(await page.locator('#moreBtn').evaluate(node => node === document.activeElement));
    await page.locator('#moreBtn').tap();
    const download = page.waitForEvent('download');
    await page.locator('#shotBtn').tap();
    assert.match((await download).suggestedFilename(), /^sofia-ndk-.*\.png$/);
    await page.evaluate(() => { window.__app.state.S.reducedMotion = false; });
    await page.locator('#moreBtn').tap();
    await page.locator('#demoBtn').tap();
    assert(await page.evaluate(() => window.__app.demo.on));
    await page.locator('#demoStop').tap();
    assert(!(await page.evaluate(() => window.__app.demo.on)));
    await page.locator('#moreBtn').tap();
    await page.locator('#panelBtn').tap();
    assert(await page.evaluate(() => document.body.classList.contains('photo')));
    await page.locator('#photoExit').tap();
    await closed(page);
    await page.reload();
    await ready(page);
    await closed(page);
    await page.goto(base + '?intro=1&reduce=1');
    await ready(page);
    assert(!(await page.locator('#intro').isVisible()), 'first visit intro does not cover mobile scene');
    await context.close();
    console.log(`PASS ${name}`);
  }
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
  assert(difference < 0.005, `desktop screenshot difference ${difference * 100}%`);
  console.log(`PASS desktop difference ${(difference * 100).toFixed(3)}%`);
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
