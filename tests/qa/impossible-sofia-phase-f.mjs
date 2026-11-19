import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const port = process.argv[2] || 8080;
const output = 'tests/qa-out/impossible-sofia/phase-f';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const errors = [];

try {
  const sizes = [[320, 568], [360, 640], [360, 500], [390, 700], [412, 915], [844, 390], [1440, 900]];
  for (const [width, height] of sizes) {
    const mobile = width < 1440;
    const chrome = width === 390;
    const name = `${width}x${height}${chrome ? '-chrome' : ''}`;
    const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    if (mobile) await page.addInitScript(() => sessionStorage.setItem('btty.panHintSeen', '1'));
    await page.goto(`http://127.0.0.1:${port}/?qa=1&special=abandoned&date=2026-07-15&h=12`);
    await page.waitForFunction(() => window.__app?.special.id === 'abandoned');
    await page.locator('.loading').waitFor({ state: 'hidden' });
    if (chrome) await page.evaluate(() => {
      Object.defineProperty(visualViewport, 'height', { get: () => innerHeight - 64 });
      Object.defineProperty(visualViewport, 'offsetTop', { get: () => 18 });
      const chromeBars = document.createElement('div');
      chromeBars.setAttribute('aria-hidden', 'true');
      chromeBars.style.cssText = 'position:fixed;inset:0;z-index:20;pointer-events:none;border-block:solid #202733;border-width:18px 0 46px';
      document.body.append(chromeBars);
      visualViewport.dispatchEvent(new Event('resize'));
    });

    const panel = page.locator('#panel');
    const pinned = panel.locator('.special-controls-heading');
    const settings = panel.locator('.special-settings');
    const play = pinned.locator('#specialPlay');
    const save = suffix => page.screenshot({ path: `${output}/${name}-${suffix}.jpg`, type: 'jpeg', quality: 77 });
    if (mobile) {
      assert(!await panel.isVisible(), `${name}: closed initially`);
      assert(await page.locator('#mobileClock').isVisible(), `${name}: shared clock visible`);
      if (chrome || width === 844) await save('closed');
      await page.locator('#mobileOpen').tap();
    }
    const bounds = await panel.boundingBox();
    const before = await pinned.boundingBox();
    const visible = await page.evaluate(() => ({
      top: visualViewport.offsetTop, bottom: visualViewport.offsetTop + visualViewport.height,
      pageWidth: document.documentElement.scrollWidth,
    }));
    const title = mobile ? await page.locator('.top').boundingBox() : null;
    assert(bounds.y >= visible.top && bounds.y + bounds.height <= visible.bottom + 1, `${name}: panel inside visible viewport`);
    assert(!title || bounds.y >= title.y + title.height, `${name}: panel clears the title`);
    assert(visible.pageWidth <= width && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${name}: no overflow`);
    if (chrome || width === 844 || !mobile) {
      // Let Chromium's native touch highlight fade before capturing the panel.
      if (mobile) await page.waitForTimeout(500);
      await save('open');
    }

    const targets = ['#specialHour', '#specialDate', '#specialConditions button', '#specialIntensity', '#specialSound', '#specialVolume'];
    for (const selector of targets) for (const target of await settings.locator(selector).all()) {
      await target.scrollIntoViewIfNeeded();
      const rect = await target.boundingBox(), scroller = await settings.boundingBox();
      assert(rect.y >= scroller.y - 1 && rect.y + rect.height <= scroller.y + scroller.height + 1, `${name}: ${selector} fully reachable`);
      assert(rect.x >= scroller.x && rect.x + rect.width <= scroller.x + scroller.width + 1, `${name}: ${selector} fits settings`);
      assert(rect.width >= 44 && rect.height >= 44, `${name}: ${selector} touch target`);
    }
    if (mobile && width !== 412) assert(await settings.evaluate(node => node.scrollTop > 0), `${name}: settings scroll separately`);
    assert.deepEqual(await pinned.boundingBox(), before, `${name}: title, time and playback stay pinned`);
    assert.equal(await panel.evaluate(node => node.scrollTop), 0, `${name}: panel did not scroll`);
    await play.press('Enter');
    await page.waitForFunction(() => window.__app.state.S.playing && window.__app.state.S.hour > 12.03);
    assert.equal(await play.textContent(), 'Пауза');
    await play.press('Space');
    assert.equal(await play.textContent(), 'Пусни');
    if (mobile) {
      await page.keyboard.press('Escape');
      assert(!await panel.isVisible());
      assert.equal(await page.evaluate(() => document.activeElement.id), 'mobileOpen');
      await page.locator('#mobileOpen').tap();
      await page.locator('#mobileDone').tap();
      assert(await page.locator('#mobileClock').isVisible());
    }
    await page.close();
    console.log(`PASS ${name}: reachable settings, pinned header and shared playback`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
