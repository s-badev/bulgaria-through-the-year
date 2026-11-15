// Run against npm run build + npm run preview (port 8080).
// Before editing main: node tests/qa/mobile-controls.mjs --capture-baseline
// After editing: node tests/qa/mobile-controls.mjs --compare-desktop tests/qa-out/mobile-desktop-before.png
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = 'http://127.0.0.1:8080/';
const query = '?qa=1&still=1&reduce=1&date=2026-04-22&h=12&w=clear';
const output = 'docs/screenshots/mobile';
const temporary = 'tests/qa-out';
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(temporary, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const report = { viewports: [], errors: [], desktop: null };
const panelControls = [
  '#play', '#hour', '#now', '#date',
  ...['spring', 'summer', 'autumn', 'winter'].map(season => `[data-s="${season}"]`),
  ...['clear', 'cloudy', 'fog', 'rain', 'storm', 'snow'].map(weather => `[data-w="${weather}"]`),
  '#wind', '#fogLvl', '#vol', '#creditsBtn',
];
const toolbarControls = ['#panelBtn', '#shotBtn', '#demoBtn', '#flashBtn', '#soundBtn'];

async function ready(page) {
  await page.waitForFunction(() => window.__app && window.__app.clock.frame > 3 && Object.values(window.__app.scene.photos).every(photo => photo.state !== 'loading'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.__app.clock.stop();
    // Build date and commit are intentionally different between builds.
    document.querySelector('#version').textContent = 'версия QA';
    document.querySelector('.loading')?.remove();
  });
}

async function screenshot(page, name) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: path.join(output, `${name}.jpg`), type: 'jpeg', quality: 48 });
}

async function state(page, key, expected) {
  await page.locator('#sheetHandle').focus();
  await page.keyboard.press(key);
  assert.equal(await page.locator('#panel').getAttribute('data-sheet'), expected);
  assert.equal(await page.locator('#sheetHandle').getAttribute('aria-expanded'), String(expected !== 'collapsed'));
}

async function expectSheet(page, expected) {
  await page.waitForFunction(expected => document.querySelector('#panel').dataset.sheet === expected, expected);
}

async function reachable(page, selector) {
  const control = page.locator(selector);
  assert(await control.isVisible(), `${selector} is visible`);
  await control.evaluate(element => {
    if (!document.querySelector('.sheet-pinned').contains(element)) element.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
  const geometry = await control.evaluate(element => {
    const panel = document.querySelector('#panel');
    const pinned = document.querySelector('.sheet-pinned');
    // Account for the sticky time row while scrolling the sheet itself.
    if (panel.contains(element) && !pinned.contains(element)) {
      const elementTop = element.getBoundingClientRect().top;
      const pinnedBottom = pinned.getBoundingClientRect().bottom;
      if (elementTop < pinnedBottom + 4) panel.scrollTop -= pinnedBottom + 4 - elementTop;
    }
    const rect = element.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const insidePanel = panel.contains(element);
    const top = insidePanel && !pinned.contains(element) ? pinned.getBoundingClientRect().bottom : 0;
    const visibleBottom = (visualViewport?.offsetTop || 0) + (visualViewport?.height || innerHeight);
    const bottom = insidePanel ? Math.min(bounds.bottom, visibleBottom) : visibleBottom;
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      contained: rect.left >= 0 && rect.right <= innerWidth + 0.5 && rect.top >= top - 0.5 && rect.bottom <= bottom + 0.5,
      hit: hit === element || element.contains(hit),
      name: element.getAttribute('aria-label') || element.textContent || element.labels?.[0]?.textContent,
    };
  });
  assert(geometry.width >= 44 && geometry.height >= 44, `${selector} has a 44px touch target ${JSON.stringify(geometry)}`);
  assert(geometry.contained && geometry.hit, `${selector} is fully within the visible area and unobscured ${JSON.stringify(geometry)}`);
  assert(geometry.name?.trim(), `${selector} has an accessible name`);
  return { selector, ...geometry };
}

async function layoutChecks(page) {
  const geometry = await page.evaluate(() => {
    const title = document.querySelector('.title').getBoundingClientRect();
    const intersects = [...document.querySelectorAll('.tr button')].some(button => {
      const rect = button.getBoundingClientRect();
      return title.left < rect.right && title.right > rect.left && title.top < rect.bottom && title.bottom > rect.top;
    });
    const panel = document.querySelector('#panel');
    const rect = panel.getBoundingClientRect();
    return {
      overlap: intersects,
      horizontalScroll: document.documentElement.scrollWidth > innerWidth || panel.scrollWidth > panel.clientWidth,
      inside: rect.top >= (visualViewport?.offsetTop || 0) && rect.bottom <= (visualViewport?.offsetTop || 0) + (visualViewport?.height || innerHeight) + 0.5,
      touchScroll: getComputedStyle(panel).overflowY === 'auto' && getComputedStyle(panel).overscrollBehaviorY === 'contain',
      padding: parseFloat(getComputedStyle(panel).paddingBottom),
    };
  });
  assert(!geometry.overlap, 'title never overlaps the toolbar');
  assert(!geometry.horizontalScroll, 'no document or panel horizontal scroll');
  assert(geometry.inside && geometry.touchScroll && geometry.padding >= 16, JSON.stringify(geometry));
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(base + query);
  await ready(desktop);
  const desktopFile = path.join(temporary, process.argv.includes('--capture-baseline') ? 'mobile-desktop-before.png' : 'mobile-desktop-after.png');
  await desktop.screenshot({ path: desktopFile });
  if (process.argv.includes('--capture-baseline')) {
    console.log(`Desktop baseline saved to ${desktopFile}`);
  } else {
    const comparisonIndex = process.argv.indexOf('--compare-desktop');
    if (comparisonIndex >= 0) {
      const beforeFile = process.argv[comparisonIndex + 1];
      const before = await sharp(beforeFile).removeAlpha().raw().toBuffer();
      const after = await sharp(desktopFile).removeAlpha().raw().toBuffer();
      assert.equal(before.length, after.length);
      let changed = 0;
      for (let pixel = 0; pixel < before.length; pixel += 3) {
        if ([0, 1, 2].some(channel => before[pixel + channel] !== after[pixel + channel])) changed++;
      }
      const differencePercent = changed / (1440 * 900) * 100;
      report.desktop = { differencePercent, thresholdPercent: 0.5, channelTolerance: 0, normalised: 'version stamp, fixed scene date, reduced motion, still camera' };
      assert(differencePercent < 0.5, JSON.stringify(report.desktop));
      await sharp(beforeFile).jpeg({ quality: 48 }).toFile(path.join(output, 'desktop-before.jpg'));
      await sharp(desktopFile).jpeg({ quality: 48 }).toFile(path.join(output, 'desktop-after.jpg'));
    }
    await desktop.close();

    const sizes = [[360, 640], [390, 844], [412, 915], [844, 390], [360, 500], [390, 700]];
    for (const [width, height] of sizes) {
      const bar = width === 390 && height === 700;
      const name = `${width}x${height}${bar ? '-in-app' : ''}`;
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'bg-BG', reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(`${name} ${error.message}`));
      page.on('console', message => { if (message.type() === 'error') report.errors.push(`${name} ${message.text()}`); });
      await page.goto(base + query);
      await ready(page);
      assert.equal(await page.locator('#panel').getAttribute('data-sheet'), height <= 500 ? 'collapsed' : 'medium');
      if (bar) {
        await page.evaluate(() => {
          // Keep the layout viewport at 390x700 and reduce only the visual viewport.
          Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 64 });
          const bar = document.createElement('div');
          bar.id = 'qa-browser-bar';
          bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:64px;background:#202733;z-index:100';
          document.body.append(bar);
          visualViewport.dispatchEvent(new Event('resize'));
        });
        assert.equal(await page.locator('#panel').evaluate(panel => panel.getBoundingClientRect().bottom), 636);
      }
      const result = { viewport: name, states: [], controls: [] };
      for (const [key, sheet] of [['Home', 'collapsed'], ['ArrowUp', 'medium'], ['End', 'full']]) {
        await state(page, key, sheet);
        await layoutChecks(page);
        for (const selector of ['#sheetHandle', '#play', '#hour', '#now', ...toolbarControls]) await reachable(page, selector);
        if (sheet === 'collapsed') {
          assert(!(await page.locator('#date').isVisible()));
          assert(!(await page.locator('#weather').isVisible()));
        }
        if (sheet === 'medium') {
          for (const selector of panelControls.filter(selector => !['#wind', '#fogLvl', '#vol', '#creditsBtn'].includes(selector))) await reachable(page, selector);
          assert(!(await page.locator('#wind').isVisible()));
        }
        if (sheet === 'full') {
          for (const selector of [...panelControls, ...toolbarControls]) result.controls.push(await reachable(page, selector));
          // The fixed time row remains usable when the footer is reached.
          await reachable(page, '#creditsBtn');
          await reachable(page, '#now');
          await reachable(page, '#play');
          await screenshot(page, `${name}-full-bottom`);
        }
        await page.locator('#panel').evaluate(panel => { panel.scrollTop = 0; });
        await screenshot(page, `${name}-${sheet}`);
        result.states.push(sheet);
      }

      // Real keyboard traversal must scroll controls into view and retain visible focus.
      await state(page, 'End', 'full');
      const order = ['#sheetHandle', '#play', '#hour', '#now', ...panelControls.filter(selector => !['#play', '#hour', '#now'].includes(selector))];
      // DOM order is season buttons, date, weather, sliders, credits.
      order.splice(order.indexOf('#date'), 1);
      order.splice(8, 0, '#date');
      await page.locator('#sheetHandle').focus();
      for (const [index, selector] of order.entries()) {
        if (index > 0) {
          // Native date inputs expose day, month and year as separate Tab stops.
          for (let step = 0; step < 8; step++) {
            await page.keyboard.press('Tab');
            if (!(await page.locator(order[index - 1]).evaluate(element => element === document.activeElement))) break;
          }
        }
        assert(await page.locator(selector).evaluate(element => element === document.activeElement), `Tab order ${name} ${selector}`);
        assert(await page.locator(selector).evaluate(element => parseFloat(getComputedStyle(element).outlineWidth) >= 2), `visible focus ${selector}`);
        await reachable(page, selector);
      }

      await page.locator('#creditsBtn').click();
      assert(await page.locator('#credits').evaluate(dialog => dialog.open));
      await page.keyboard.press('Escape');
      assert(await page.locator('#creditsBtn').evaluate(button => button === document.activeElement));
      if (await page.locator('.title-toggle').isVisible()) {
        await reachable(page, '.title-toggle');
        await page.locator('.title-toggle').tap();
        assert(await page.locator('.readout-details').isVisible());
        await layoutChecks(page);
        await page.locator('.title-toggle').tap();
        assert(!(await page.locator('.readout-details').isVisible()));
      }
      if (bar) {
        await page.evaluate(() => {
          Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 88 });
          Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, get: () => 24 });
          visualViewport.dispatchEvent(new Event('scroll'));
        });
        await layoutChecks(page);
        assert.equal(await page.locator('.top').evaluate(element => element.getBoundingClientRect().top), 34);
        await reachable(page, '#creditsBtn');
        await page.evaluate(() => {
          Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 64 });
          Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, get: () => 0 });
          visualViewport.dispatchEvent(new Event('resize'));
        });
      }

      // Exercise the controls through their normal UI events on each phone size.
      for (const season of ['spring', 'summer', 'autumn', 'winter']) {
        await reachable(page, `[data-s="${season}"]`);
        await page.locator(`[data-s="${season}"]`).tap();
        assert.equal(await page.evaluate(() => window.__app.state.seasonName), season);
      }
      await reachable(page, '#date');
      await page.locator('#date').fill('2026-01-18');
      assert.equal(await page.evaluate(() => window.__app.state.S.d), 18);
      for (const weather of ['clear', 'cloudy', 'fog', 'rain', 'storm', 'snow']) {
        await reachable(page, `[data-w="${weather}"]`);
        await page.locator(`[data-w="${weather}"]`).tap();
        assert.equal(await page.evaluate(() => window.__app.state.S.weather), weather);
      }
      for (const [selector, field] of [['#hour', 'hour'], ['#wind', 'wind'], ['#fogLvl', 'fogLvl'], ['#vol', 'vol']]) {
        await reachable(page, selector);
        await page.locator(selector).focus();
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowRight');
        assert(Math.abs((await page.evaluate(field => window.__app.state.S[field], field)) - 0.01) < 1e-9);
      }
      await reachable(page, '#play');
      await page.locator('#play').tap();
      assert(await page.evaluate(() => window.__app.state.S.playing));
      await page.locator('#play').tap();
      assert(!(await page.evaluate(() => window.__app.state.S.playing)));
      await page.route('**/api.open-meteo.com/**', route => route.fulfill({ json: { current: { weather_code: 3, temperature_2m: 12, cloud_cover: 90, wind_speed_10m: 9 } } }));
      await page.locator('#now').tap();
      await page.waitForFunction(() => !document.querySelector('#now').disabled);
      assert.equal(await page.evaluate(() => window.__app.state.S.weather), 'cloudy');
      assert.equal(await page.evaluate(() => window.__app.state.S.live.cloud), 0.9);
      await page.locator('#flashBtn').tap();
      assert(!(await page.evaluate(() => window.__app.state.S.flashes)));
      await page.locator('#soundBtn').tap();
      assert(await page.evaluate(() => window.__app.state.S.sound));
      await page.locator('#soundBtn').tap();
      assert(!(await page.evaluate(() => window.__app.state.S.sound)));
      await page.evaluate(() => { window.__app.state.S.reducedMotion = false; window.__app.clock.start(); });
      const download = page.waitForEvent('download');
      await page.locator('#shotBtn').tap();
      assert.match((await download).suggestedFilename(), /^sofia-ndk-.*\.png$/);
      await page.locator('#demoBtn').tap();
      assert(await page.evaluate(() => window.__app.demo.on));
      await page.locator('#demoStop').tap();
      assert(!(await page.evaluate(() => window.__app.demo.on)));
      await page.locator('#panelBtn').tap();
      assert(await page.evaluate(() => document.body.classList.contains('photo')));
      await reachable(page, '#photoExit');
      assert.equal(await page.locator('#photoExit').evaluate(button => getComputedStyle(button).opacity), '1');
      await page.locator('#photoExit').tap();
      assert(!(await page.evaluate(() => document.body.classList.contains('photo'))));

      await page.locator('#panel').evaluate(panel => { panel.scrollTop = 0; });
      await page.locator('#sheetHandle').tap();
      await expectSheet(page, 'collapsed');
      assert.equal(await page.locator('#panel').getAttribute('data-sheet'), 'collapsed');
      await page.locator('#sheetHandle').tap();
      await expectSheet(page, 'medium');
      assert.equal(await page.locator('#panel').getAttribute('data-sheet'), 'medium');
      await page.reload();
      await ready(page);
      assert.equal(await page.locator('#panel').getAttribute('data-sheet'), 'medium', 'sheet state survives reload in the session');
      assert.equal(await page.locator('#panel').evaluate(panel => getComputedStyle(panel).transitionDuration), '0s', 'reduced motion disables sheet transitions');
      report.viewports.push(result);
      await context.close();
      console.log(`PASS ${name}: three states, ${result.controls.length} controls, touch targets, scroll, keyboard, session, overlap`);
    }

    // Touch drag uses the actual pointer event sequence, including pointer capture.
    const context = await browser.newContext({ viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(base + query);
    await ready(page);
    const cdp = await context.newCDPSession(page);
    await state(page, 'End', 'full');
    const panelRect = await page.locator('#panel').boundingBox();
    const scrollX = panelRect.x + panelRect.width - 6;
    const scrollY = panelRect.y + panelRect.height - 55;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: scrollX, y: scrollY }] });
    for (let step = 1; step <= 6; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: scrollX, y: scrollY - step * 30 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('#panel').scrollTop > 0);
    await reachable(page, '#now');
    await reachable(page, '#play');
    await state(page, 'Home', 'collapsed');
    await state(page, 'ArrowUp', 'medium');
    async function drag(distance) {
      const rect = await page.locator('#sheetHandle').boundingBox();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await drag(-70);
    assert.equal(await page.locator('#panel').getAttribute('data-sheet'), 'full');
    await drag(70);
    assert.equal(await page.locator('#panel').getAttribute('data-sheet'), 'medium');
    await drag(70);
    assert.equal(await page.locator('#panel').getAttribute('data-sheet'), 'collapsed');
    await page.locator('#sheetHandle').focus();
    await page.keyboard.press('Enter');
    await expectSheet(page, 'medium');
    await page.keyboard.press('Space');
    await expectSheet(page, 'full');
    await page.keyboard.press('ArrowDown');
    await expectSheet(page, 'medium');
    await page.keyboard.press('ArrowUp');
    await expectSheet(page, 'full');
    await page.locator('#sheetHandle').tap();
    await expectSheet(page, 'collapsed');
    await page.locator('#sheetHandle').tap();
    await expectSheet(page, 'medium');
    assert.equal(await page.locator('#panel').getAttribute('data-sheet'), 'medium');
    await page.setViewportSize({ width: 844, height: 390 });
    await layoutChecks(page);
    assert.equal(await page.locator('#panel').getAttribute('data-sheet'), 'medium', 'rotation retains the chosen state');
    await page.setViewportSize({ width: 1440, height: 900 });
    assert(await page.locator('#now').evaluate(element => element.parentElement.parentElement.classList.contains('row-weather')));
    assert(await page.locator('.time').evaluate(element => element.parentElement.classList.contains('row-time')));
    await context.close();

    // An in-app browser may disable storage and the VisualViewport API entirely.
    const fallback = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
    await fallback.addInitScript(() => {
      Object.defineProperty(window, 'visualViewport', { value: undefined });
      Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Storage disabled', 'SecurityError'); } });
    });
    const fallbackPage = await fallback.newPage();
    await fallbackPage.goto(base + query);
    await ready(fallbackPage);
    await state(fallbackPage, 'End', 'full');
    // Application fallback is checked without referencing the unavailable API in the helper.
    assert.equal(await fallbackPage.evaluate(() => document.documentElement.style.getPropertyValue('--visible-height')), '640px');
    await fallback.close();

    assert.deepEqual(report.errors, []);
    const bytes = fs.readdirSync(output).filter(file => file.endsWith('.jpg')).reduce((sum, file) => sum + fs.statSync(path.join(output, file)).size, 0);
    assert(bytes < 1_500_000, `screenshots total ${bytes} bytes`);
    report.screenshotBytes = bytes;
    console.log(`PASS drag, rotation, desktop restoration, unavailable storage/VisualViewport, screenshots ${bytes} bytes`);
  }
} catch (error) {
  report.errors.push(error.stack);
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser.close();
  fs.writeFileSync(path.join(temporary, 'mobile-controls.json'), JSON.stringify(report, null, 2));
}
