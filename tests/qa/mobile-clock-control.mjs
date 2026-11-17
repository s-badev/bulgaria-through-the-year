import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { formatClock, sunTimes } from '../../src/engine/sun.js';

const base = 'http://127.0.0.1:8080/';
const output = 'tests/qa-out/mobile-clock-control';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const sizes = [[320, 568], [320, 500], [360, 640], [360, 500], [390, 844], [390, 700], [412, 915], [844, 390]];

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function layout(page, name) {
  const boxes = await page.evaluate(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const children = ['#mobileClockSource', '#mobileClockDate', '#mobileClockTime', '#mobileClockPlay', '#mobileClockNext'].map(selector => {
      const el = document.querySelector(selector);
      return { selector, scroll: el.scrollWidth, client: el.clientWidth, ...rect(selector) };
    });
    return { title: rect('.title'), clock: rect('#mobileClock'), play: rect('#mobileClockPlay'), more: rect('#moreBtn'), controls: rect('#mobileOpen'), hint: rect('.mobile-pan-hint'), children,
      viewportBottom: (visualViewport?.offsetTop || 0) + (visualViewport?.height || innerHeight), pageWidth: document.documentElement.scrollWidth };
  });
  assert(Math.abs(boxes.title.width - boxes.clock.width) < 0.1, `${name}: card border widths match`);
  assert(Math.abs(boxes.title.left - boxes.clock.left) < 0.1, `${name}: left edges match`);
  assert(Math.abs(boxes.clock.top - boxes.title.bottom - 8) < 0.1, `${name}: 8px card gap`);
  assert(!overlaps(boxes.title, boxes.more) && !overlaps(boxes.clock, boxes.more), `${name}: no toolbar overlap`);
  assert(!overlaps(boxes.clock, boxes.controls) && !overlaps(boxes.clock, boxes.hint), `${name}: no overlay overlap`);
  assert(boxes.clock.bottom <= boxes.viewportBottom, `${name}: card fits the visible viewport`);
  assert(boxes.play.width >= 44 && boxes.play.height >= 44, `${name}: Play/Pause touch target`);
  for (const child of boxes.children) {
    assert(child.left >= boxes.clock.left && child.right <= boxes.clock.right && child.top >= boxes.clock.top && child.bottom <= boxes.clock.bottom, `${name}: ${child.selector} inside card`);
    assert(child.scroll <= child.client + 1, `${name}: ${child.selector} text not clipped`);
  }
  assert(boxes.pageWidth <= page.viewportSize().width, `${name}: no horizontal page overflow`);
  const hit = await page.evaluate(() => {
    const r = document.querySelector('#mobileClockPlay').getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el?.closest('#mobileClockPlay')?.id;
  });
  assert.equal(hit, 'mobileClockPlay', `${name}: button receives touch`);
  const passThrough = await page.evaluate(() => {
    const r = document.querySelector('#mobileClock').getBoundingClientRect();
    return document.elementFromPoint(r.left + 3, r.bottom - 3)?.id;
  });
  assert.equal(passThrough, 'gl', `${name}: card outside button does not block panning`);
}

try {
  for (const [width, height] of sizes) {
    const chrome = width === 390 && height === 700;
    const name = `${width}x${height}${chrome ? '-chrome' : ''}`;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', locale: 'bg-BG' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '?qa=1&still=1&reduce=1&date=2026-04-22&h=5');
    await page.waitForFunction(() => window.__app?.clock.frame > 3);
    if (chrome) await page.evaluate(() => {
      Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 64 });
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;inset:auto 0 0;height:64px;background:#202733;z-index:20';
      document.body.append(bar);
      visualViewport.dispatchEvent(new Event('resize'));
    });
    assert(await page.locator('#mobileClock').isVisible(), `${name}: clock visible with sheet closed`);
    assert(!(await page.locator('#panel').isVisible()), `${name}: sheet closed`);
    await layout(page, name);
    const start = await page.evaluate(() => ({ hour: window.__app.state.S.hour, rise: window.__app.state.times.rise }));
    assert.equal(await page.locator('#mobileClockTime').textContent(), formatClock(start.hour), `${name}: shared simulation time`);
    assert.match(await page.locator('#mobileClockDate').textContent(), /^22\.04\.2026$/);
    assert.equal(await page.locator('#mobileClockPlayLabel').textContent(), 'Пусни');
    assert.match(await page.locator('#mobileClockNext').textContent(), new RegExp(`Следва изгрев ${formatClock(start.rise)}`));
    await page.locator('#mobileClockPlay').tap();
    assert.equal(await page.evaluate(() => window.__app.state.S.playing), true, `${name}: clock starts shared playback`);
    assert.equal(await page.locator('#mobileClockPlayLabel').textContent(), 'Пауза');
    assert.equal(await page.locator('#play').getAttribute('aria-label'), 'Спри деня');
    await page.waitForFunction(previous => document.querySelector('#mobileClockTime').textContent !== previous, formatClock(start.hour));
    await page.locator('#mobileClockPlay').tap();
    assert.equal(await page.evaluate(() => window.__app.state.S.playing), false, `${name}: clock pauses playback`);
    assert.equal(await page.locator('#mobileClockPlayLabel').textContent(), 'Пусни');
    const paused = await page.evaluate(() => window.__app.state.S.hour);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.__app.state.S.hour), paused, `${name}: paused simulation stays paused`);
    await page.locator('#mobileOpen').tap();
    assert(!(await page.locator('#mobileClock').isVisible()), `${name}: clock not duplicated over sheet`);
    await page.locator('#play').tap();
    assert.equal(await page.evaluate(() => window.__app.state.S.playing), true, `${name}: panel starts same playback`);
    assert.equal(await page.locator('#mobileClockPlayLabel').textContent(), 'Пауза');
    await page.locator('#mobileDone').tap();
    assert(await page.locator('#mobileClock').isVisible(), `${name}: clock returns after sheet closes`);
    await page.locator('#mobileClockPlay').tap();
    const calendar = await page.evaluate(() => ({ ...window.__app.state.S, set: window.__app.state.times.set, loc: window.__app.state.loc }));
    await page.evaluate(() => window.__app.state.setHour(14));
    assert.equal(await page.locator('#mobileClockNext').textContent(), `Следва залез ${formatClock(calendar.set)}`);
    await page.evaluate(() => window.__app.state.setHour(22));
    const tomorrow = new Date(Date.UTC(calendar.y, calendar.m, calendar.d + 1));
    const rise = sunTimes(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), calendar.loc.lat, calendar.loc.lon).rise;
    assert.equal(await page.locator('#mobileClockNext').textContent(), `Следва изгрев утре ${formatClock(rise)}`);
    await page.locator('#titleHide').tap();
    assert(!(await page.locator('#mobileClock').isVisible()), `${name}: hiding title also hides clock`);
    await page.locator('#titleRestore').tap();
    assert(await page.locator('#mobileClock').isVisible(), `${name}: title and clock restore together`);
    await page.keyboard.press('Tab');
    let focused = await page.evaluate(() => document.activeElement?.id);
    for (let i = 0; i < 12 && focused !== 'mobileClockPlay'; i++) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => document.activeElement?.id);
    }
    assert.equal(focused, 'mobileClockPlay', `${name}: clock button in keyboard order`);
    const outline = await page.locator('#mobileClockPlay').evaluate(el => getComputedStyle(el).outlineWidth);
    assert(parseFloat(outline) >= 3, `${name}: visible keyboard focus`);
    await page.screenshot({ path: path.join(output, `${name}.jpg`), type: 'jpeg', quality: 45 });
    assert.deepEqual(errors, [], `${name}: no script errors`);
    await context.close();
    console.log(`PASS ${name}: equal widths, playback, solar event, focus and overflow`);
  }

  const liveContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const livePage = await liveContext.newPage();
  await livePage.route('**/api.open-meteo.com/**', route => route.fulfill({ json: { current: { weather_code: 3, cloud_cover: 91, temperature_2m: 11, wind_speed_10m: 9, visibility: 18000, precipitation: 0, rain: 0, showers: 0, snowfall: 0 } } }));
  await livePage.goto(base);
  await livePage.waitForFunction(() => window.__app?.state.S.live !== null);
  assert.equal(await livePage.locator('#mobileClockSource').textContent(), 'София сега');
  const liveHour = await livePage.evaluate(() => window.__app.state.S.hour);
  await livePage.locator('#mobileClockPlay').tap();
  assert.equal(await livePage.evaluate(() => window.__app.state.S.playing), true);
  assert.equal(await livePage.locator('#mobileClockSource').textContent(), 'Симулация');
  assert.equal(await livePage.locator('#play').getAttribute('aria-label'), 'Спри деня');
  await livePage.waitForFunction(hour => window.__app.state.S.hour - hour > 0.05, liveHour);
  await livePage.locator('#mobileClockPlay').tap();
  assert.equal(await livePage.evaluate(() => window.__app.state.S.playing), false);
  await livePage.locator('#mobileOpen').tap();
  await livePage.locator('#now').tap();
  await livePage.waitForFunction(() => document.querySelector('#mobileClockSource').textContent === 'София сега');
  assert.equal(await livePage.evaluate(() => window.__app.state.S.playing), false);
  await liveContext.close();
  console.log('PASS live София сега → shared simulated playback');

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(base + '?qa=1');
  await desktop.waitForFunction(() => window.__app?.clock.frame > 3);
  assert(!(await desktop.locator('#mobileClock').isVisible()), 'desktop clock card remains hidden');
  assert(await desktop.locator('#play').isVisible(), 'desktop panel Play remains available');
  await desktop.locator('#play').click();
  assert.equal(await desktop.evaluate(() => window.__app.state.S.playing), true);
  await desktop.locator('#play').click();
  assert.equal(await desktop.evaluate(() => window.__app.state.S.playing), false);
  await desktop.close();
  console.log('PASS desktop controls unchanged');
} finally {
  await browser.close();
}
