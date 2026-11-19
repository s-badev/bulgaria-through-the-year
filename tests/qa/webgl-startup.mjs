import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = `http://127.0.0.1:${process.argv[2] || 8080}/`;
const sceneURL = `${base}?qa=1&still=1&date=2026-07-15&h=12&w=clear`;
const out = 'tests/qa-out/critical-webgl';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.QA_BROWSER_CHANNEL || undefined,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const evidence = [];

function monitor(page, name) {
  const evidenceForPage = { name, console: [], errors: [], requests: [] };
  evidence.push(evidenceForPage);
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) evidenceForPage.console.push(message.text());
  });
  page.on('pageerror', error => evidenceForPage.errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) evidenceForPage.requests.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on('requestfailed', request => evidenceForPage.requests.push(`${request.failure().errorText} ${new URL(request.url()).pathname}`));
  return evidenceForPage;
}

async function coverage(page, selector, name) {
  const { width, height } = page.viewportSize();
  assert.deepEqual(await page.locator(selector).boundingBox(), { x: 0, y: 0, width, height }, `${name}: covers the viewport`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `${name}: no horizontal overflow`);
  const frame = await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 82 });
  for (const left of [0, width - 10]) {
    const strip = await sharp(frame).extract({ left, top: Math.round(height * .28), width: 10, height: Math.round(height * .25) }).toBuffer();
    const { channels } = await sharp(strip).stats();
    assert(channels.some(channel => channel.mean > 30 && channel.stdev > 8), `${name}: edge contains photograph pixels`);
  }
}

try {
  const sizes = [[1920, 1080], [1440, 900], [1366, 768], [360, 800], [390, 844], [412, 915], [844, 390]];
  for (const [width, height] of sizes) {
    const mobile = width <= 820 || height <= 500;
    const label = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    const run = monitor(page, `normal-${label}`);
    await page.goto(sceneURL);
    await page.waitForFunction(() => window.__app?.clock.frame > 3);
    await page.locator('.loading').waitFor({ state: 'hidden' });
    const renderer = await page.evaluate(() => {
      const { gl, comp } = window.__app;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return { name: info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL), active: gl instanceof WebGL2RenderingContext && !gl.isContextLost(), viewport: Array.from(gl.getParameter(gl.VIEWPORT)), buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], renders: comp.baseRenders };
    });
    run.renderer = renderer;
    assert(renderer.active && renderer.renders > 0);
    assert.deepEqual(renderer.viewport, [0, 0, ...renderer.buffer]);
    assert.equal(await page.locator('#gl').count(), 1);
    assert.equal(await page.locator('.static-view, #panel input[type=date], dialog[open]').count(), 0);
    await coverage(page, '#gl', `normal-${label}`);

    const open = async () => { if (mobile) await page.locator('#mobileOpen').click(); };
    const panel = page.locator('#panel');
    if (mobile) assert(!await panel.isVisible());
    await open();
    assert(await panel.isVisible());
    const entry = panel.locator('#specialEntry');
    assert.equal(await entry.evaluate(button => button.previousElementSibling.id), 'seasons');
    assert.equal(await page.getByRole('button', { name: 'Другата София', exact: true }).count(), 1);
    await panel.locator('#play').click();
    await page.waitForFunction(() => window.__app.state.S.hour > 12.03);
    await panel.locator('#play').click();
    await panel.locator('[data-s=winter]').click();
    await open();
    await panel.locator('[data-w=rain]').click();
    assert.deepEqual(await page.evaluate(() => [window.__app.state.seasonName, window.__app.state.S.weather]), ['winter', 'rain']);

    if (width === 1920 || width === 390) {
      await open();
      await entry.click();
      const picker = panel.locator('#specialPicker');
      assert(await picker.isVisible());
      assert.equal(await page.locator('dialog[open]').count(), 0);
      const worlds = picker.locator('[data-special]:enabled');
      assert.equal(await worlds.count(), 6);
      await page.evaluate(() => { window.startGL = window.__app.gl; window.startClock = window.__app.clock; });
      for (let i = 0; i < 6; i++) {
        if (mobile && i > 0) {
          await open();
          await panel.locator('#specialChange').click();
        }
        const button = worlds.nth(i), id = await button.getAttribute('data-special');
        await button.click();
        await page.waitForFunction(id => window.__app.special.id === id && !!document.querySelector('.special-world-layer.is-visible img'), id);
        if (i === 0) await page.screenshot({ path: `${out}/world-${label}.jpg`, type: 'jpeg', quality: 80 });
      }
      await open();
      await panel.locator('#specialBack').click();
      await page.waitForFunction(() => !window.__app.special.id);
      assert(await page.evaluate(() => window.__app.gl === window.startGL && window.__app.clock === window.startClock));
      assert.deepEqual(await page.evaluate(() => [window.__app.state.seasonName, window.__app.state.S.weather, window.__app.state.S.playing]), ['winter', 'rain', false]);
    }
    if (mobile) assert(!await panel.isVisible());
    await page.waitForLoadState('networkidle');
    assert.deepEqual([run.console, run.errors, run.requests], [[], [], []], run.name);
    await page.close();

    const unsupported = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    const fallback = monitor(unsupported, `fallback-${label}`);
    await unsupported.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind === 'webgl2' ? null : get.call(this, kind, ...args); };
    });
    await unsupported.goto(sceneURL);
    const staticPhoto = unsupported.locator('.static-view > img');
    await staticPhoto.evaluate(img => img.decode());
    assert.equal(await unsupported.locator('.static-view').getAttribute('data-reason'), 'webgl-unavailable');
    assert.equal(await unsupported.locator('#gl, #panel').count(), 0);
    assert.equal(await staticPhoto.evaluate(img => getComputedStyle(img).objectFit), 'cover');
    await coverage(unsupported, '.static-view > img', `fallback-${label}`);
    assert(fallback.console.some(line => line.includes('webgl-unavailable')));
    assert.deepEqual([fallback.errors, fallback.requests], [[], []]);
    await unsupported.close();
    console.log(`PASS ${label}: interactive and deliberate fallback, ${renderer.name}`);
  }
} finally {
  await fs.writeFile(`${out}/browser-diagnostics.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
}
