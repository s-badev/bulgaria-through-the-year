import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:8080/?qa=1&still=1&reduce=1&date=2026-04-22&h=12&w=clear';
const output = 'docs/screenshots/mobile-clock';
const sizes = [[360, 640], [390, 844], [412, 915], [360, 500], [390, 700], [844, 390]];
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];

function minutes(text) { const [, h, m] = text.match(/(\d\d):(\d\d)/) || []; return Number(h) * 60 + Number(m); }
function overlap(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
async function ready(page) { await page.waitForFunction(() => window.__app && window.__app.clock.frame > 3); }
async function shot(page, name) { await page.screenshot({ path: path.join(output, `${name}.jpg`), type: 'jpeg', quality: 42 }); }
async function geometry(page) {
  return page.evaluate(() => {
    const card = document.querySelector('#mobileClock');
    const rect = node => node.getBoundingClientRect().toJSON();
    const r = card.getBoundingClientRect();
    const hint = document.querySelector('.mobile-pan-hint');
    return { clock: rect(card), controls: rect(document.querySelector('#mobileOpen')),
      header: rect(document.querySelector('.title')), more: rect(document.querySelector('#moreBtn')),
      hint: hint.classList.contains('is-visible') ? rect(hint) : null,
      hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.id,
      pointer: getComputedStyle(card).pointerEvents, visibleTop: visualViewport?.offsetTop || 0,
      visibleBottom: (visualViewport?.offsetTop || 0) + (visualViewport?.height || innerHeight),
      scrollWidth: document.documentElement.scrollWidth };
  });
}

try {
  for (const [width, height] of sizes) {
    const chrome = width === 390 && height === 700;
    const name = `${width}x${height}${chrome ? '-chrome' : ''}`;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', locale: 'bg-BG' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    await page.goto(base); await ready(page);
    if (chrome) await page.evaluate(() => {
      Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 64 });
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;inset:auto 0 0;height:64px;background:#202733;z-index:20';
      document.body.append(bar);
      visualViewport.dispatchEvent(new Event('resize'));
    });
    const card = page.locator('#mobileClock');
    assert(await card.isVisible(), `${name}: clock visible with closed panel`);
    assert(!(await page.locator('#panel').isVisible()), `${name}: panel closed`);
    assert.match(await card.textContent(), /Симулация.*Пауза.*12:00/s);
    assert(!(await page.locator('#mobileClockNext').isVisible()), `${name}: no next solar event while paused`);
    const g = await geometry(page);
    assert(g.clock.y >= g.visibleTop + 8 && g.clock.y + g.clock.height <= g.visibleBottom - 8, `${name}: clock within visible viewport`);
    assert(g.clock.y - (g.header.y + g.header.height) >= 6 && g.clock.y - (g.header.y + g.header.height) <= 12, `${name}: consistent gap below title`);
    assert(Math.abs(g.clock.x - g.header.x) <= 2, `${name}: clock aligned below title`);
    assert(!overlap(g.clock, g.more) && !overlap(g.clock, g.controls), `${name}: no overlap with More or Controls`);
    if (g.hint) assert(!overlap(g.clock, g.hint), `${name}: no overlap with pan hint`);
    assert.equal(g.hit, 'gl', `${name}: touch passes through clock to photo`);
    assert.equal(g.pointer, 'none');
    assert(g.scrollWidth <= width, `${name}: no horizontal overflow`);
    await shot(page, `${name}-paused`);
    await page.locator('#titleHide').click();
    assert(!(await page.locator('.title').isVisible()) && !(await card.isVisible()), `${name}: hiding title also hides clock`);
    assert(await page.locator('#titleRestore').isVisible(), `${name}: restore control remains available`);
    if (name === '360x640') await shot(page, `${name}-title-hidden`);
    await page.locator('#titleRestore').click();
    assert(await page.locator('.title').isVisible() && await card.isVisible(), `${name}: title and clock restore together`);

    await page.locator('#mobileOpen').click();
    assert(!(await card.isVisible()), `${name}: no duplicate clock with panel open`);
    await page.locator('#play').click();
    await page.locator('#mobileDone').click();
    assert(await card.isVisible(), `${name}: clock returns after closing panel`);
    assert.match(await card.textContent(), /Симулация.*Пуснато.*Следва залез/s);
    const before = minutes(await page.locator('#mobileClockTime').textContent());
    await page.waitForTimeout(1100);
    const after = minutes(await page.locator('#mobileClockTime').textContent());
    assert(after > before, `${name}: displayed simulation time advances during Play`);
    const solar = await page.evaluate(() => window.__app.state.times.set);
    const solarLabel = await page.locator('#mobileClockNext').textContent();
    assert.equal(minutes(solarLabel), Math.round(solar * 60) % 1440, `${name}: sunset comes from solar calculation`);
    await shot(page, `${name}-playing`);

    await page.locator('#mobileOpen').click();
    await page.locator('#play').click();
    await page.locator('#mobileClose').click();
    assert.match(await card.textContent(), /Пауза/);
    const paused = await page.locator('#mobileClockTime').textContent();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#mobileClockTime').textContent(), paused, `${name}: paused time persists`);
    await page.locator('#mobileOpen').click();
    await page.locator('[data-s="winter"]').click();
    assert(await card.isVisible(), `${name}: season closes panel, clock remains`);
    assert.match(await card.textContent(), /Симулация/);
    await context.close();
    console.log(`PASS ${name}: closed, Play, solar event, pause, layout`);
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.route('**/api.open-meteo.com/**', route => route.fulfill({ status: 503, body: '{}' }));
  await page.goto(base); await ready(page);
  await page.locator('#mobileOpen').click(); await page.locator('#now').click();
  const now = await page.locator('#mobileClock').textContent();
  assert.match(now, /София сега.*Пауза/s, 'Now identifies real Sofia time');
  const actual = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  assert(Math.abs(minutes(now) - minutes(actual)) <= 1, 'Now matches current Europe/Sofia time');
  assert(await page.locator('#mobileClock').isVisible(), 'Now returns to persistent clock');
  const currentHour = await page.evaluate(() => window.__app.state.S.hour);
  await page.evaluate(() => {
    const original = Date.now;
    Date.now = () => original() + 61000;
    window.__app.ui.refreshRealNow();
    Date.now = original;
  });
  assert((await page.evaluate(() => window.__app.state.S.hour)) > currentHour, 'real Sofia mode refreshes the shared state at the next minute');
  await page.locator('#mobileOpen').click(); await page.locator('#hour').fill('8');
  await page.locator('#mobileDone').click();
  assert.match(await page.locator('#mobileClock').textContent(), /Симулация/, 'manual hour clears real-time provenance');
  await page.evaluate(() => { window.__app.state.setHour(23); window.__app.state.set('playing', true); });
  assert.match(await page.locator('#mobileClockNext').textContent(), /изгрев утре/, 'after sunset uses tomorrow sunrise');
  await context.close();
  console.log('PASS Now: Europe/Sofia time and simulation provenance');

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(base); await ready(desktopPage);
  assert(!(await desktopPage.locator('#mobileClock').isVisible()), 'desktop clock remains hidden');
  await desktop.close();
  console.log('PASS desktop 1440x900: mobile overlay hidden');
  assert.deepEqual(errors, [], 'no page errors');
} finally { await browser.close(); }
