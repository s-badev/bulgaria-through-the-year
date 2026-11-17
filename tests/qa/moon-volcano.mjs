import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const base = `http://127.0.0.1:${process.argv[2] || 8080}/`;
const out = 'tests/qa-out/moon-volcano';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const failures = [];

async function scene(width, height, query, name) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: name.startsWith('volcano') ? 'no-preference' : 'reduce' });
  page.on('pageerror', error => failures.push(`${name}: ${error.message}`));
  const params = new URLSearchParams('qa=1&still=1&ui=0&date=2026-07-15&h=23');
  for (const [key, value] of new URLSearchParams(query)) params.set(key, value);
  await page.goto(`${base}?${params}`);
  await page.waitForFunction(() => !!window.__app?.comp?.blend, { timeout: 30000 });
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => {
    const { gl, comp, state, quality } = window.__app;
    const get = name => Array.from(gl.getUniform(comp.pComp.program, comp.pComp.uniforms[name].loc));
    return { moon: get('uMoon'), volcano: get('uVolcano'), weather: state.S.weather, quality: quality.name,
      fallback: !!document.querySelector('.static-view'), scrollWidth: document.documentElement.scrollWidth };
  });
  assert(!state.fallback, `${name}: interactive renderer remains active`);
  assert(state.scrollWidth <= width, `${name}: no horizontal overflow`);
  await page.screenshot({ path: `${out}/${name}.png` });
  return { page, state };
}

try {
  const clear = await scene(1440, 900, 'w=clear', 'night-clear-desktop');
  assert(clear.state.moon[3] > 0.8, 'clear night moon visible');
  assert.equal(clear.state.volcano[0], 0, 'volcano off by default');
  await clear.page.close();
  const landscapeMoon = await scene(844, 390, 'w=clear', 'night-clear-landscape');
  const landscapeCrop = await landscapeMoon.page.evaluate(() => window.__app.comp.view.cov);
  assert(landscapeMoon.state.moon[1] - 0.024 > landscapeCrop[1], 'landscape moon fully within vertical crop');
  await landscapeMoon.page.close();

  for (const [name, query, max] of [
    ['day-clear', 'h=12&w=clear', 0.01],
    ['night-cloudy', 'w=cloudy', 0.5],
    ['night-fog', 'w=fog', 0.01],
    ['night-storm', 'w=storm', 0.01],
  ]) {
    const s = await scene(1440, 900, query, name);
    assert(s.state.moon[3] < max, `${name}: moon attenuation`);
    await s.page.close();
  }

  for (const [width, height] of [[360, 640], [390, 844], [844, 390], [1440, 900]]) {
    const name = `volcano-${width}x${height}`;
    const s = await scene(width, height, 'w=clear&volcano=1', name);
    assert.equal(s.state.volcano[0], 1, `${name}: eruption enabled`);
    assert(s.state.volcano[1] <= 1, `${name}: quality bounded`);
    assert.equal(s.state.volcano[3], 0, `${name}: animated rocks enabled`);
    await s.page.close();
  }
  const dayVolcano = await scene(1440, 900, 'h=13&w=clear&volcano=1', 'volcano-day');
  await dayVolcano.page.close();

  const lite = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await lite.goto(`${base}?lite=1&volcano=1`);
  assert.equal(await lite.locator('.static-volcano-art svg').count(), 1, 'lite eruption art exists');
  assert.equal(await lite.locator('canvas').count(), 0, 'lite bypasses WebGL');
  await lite.screenshot({ path: `${out}/volcano-lite-390x844.png` });
  await lite.close();
  const failedWebGL = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await failedWebGL.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) { return kind === 'webgl2' ? null : original.call(this, kind, ...args); };
  });
  await failedWebGL.goto(`${base}?volcano=1`);
  await failedWebGL.locator('.static-view').waitFor();
  assert.equal(await failedWebGL.locator('.static-volcano-art svg').count(), 1, 'WebGL fallback keeps simplified eruption');
  await failedWebGL.close();
  const failedShader = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await failedShader.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      const gl = original.call(this, kind, ...args);
      if (kind === 'webgl2' && gl) gl.getShaderParameter = () => false;
      return gl;
    };
  });
  await failedShader.goto(`${base}?volcano=1`);
  await failedShader.locator('.static-view').waitFor();
  assert.equal(await failedShader.locator('.static-volcano-art svg').count(), 1, 'shader failure keeps simplified eruption');
  await failedShader.close();

  const low = await scene(390, 844, 'w=clear&volcano=1', 'volcano-low-quality');
  await low.page.evaluate(() => window.__app.quality.set(3));
  await low.page.waitForTimeout(150);
  assert.equal(await low.page.evaluate(() => {
    const { gl, comp } = window.__app;
    return gl.getUniform(comp.pComp.program, comp.pComp.uniforms.uVolcano.loc)[1];
  }), 0.25, 'minimum quality lowers eruption detail');
  await low.page.close();

  const frameRate = async page => page.evaluate(async () => {
    const clock = window.__app.clock, first = clock.frame, start = performance.now();
    await new Promise(resolve => setTimeout(resolve, 2000));
    return Math.round((clock.frame - first) * 10000 / (performance.now() - start)) / 10;
  });
  const plainPerf = await scene(390, 844, 'w=clear', 'mobile-performance-clear');
  const plainFps = await frameRate(plainPerf.page);
  await plainPerf.page.close();
  const volcanoPerf = await scene(390, 844, 'w=clear&volcano=1', 'volcano-mobile-performance');
  const volcanoFps = await frameRate(volcanoPerf.page);
  await volcanoPerf.page.close();
  console.log(`Mobile Chromium emulation: clear ${plainFps} fps, volcano ${volcanoFps} fps (not a physical-device benchmark)`);

  const ui = await browser.newPage({ viewport: { width: 390, height: 700 } });
  await ui.goto(`${base}?qa=1&date=2026-07-15&h=23&w=clear`);
  await ui.waitForFunction(() => !!window.__app?.comp?.blend);
  await ui.locator('#moreBtn').click();
  const menuTarget = await ui.locator('#menuVolcano').boundingBox();
  assert(menuTarget.width >= 44 && menuTarget.height >= 44, 'mobile special-mode touch target');
  await ui.locator('#menuVolcano').click();
  assert.equal(await ui.locator('#menuVolcano').getAttribute('aria-pressed'), 'true');
  assert.equal(await ui.locator('#volcanoBtn').getAttribute('aria-pressed'), 'true');
  assert.equal(await ui.evaluate(() => window.__app.state.S.volcano), true);
  await ui.locator('#mobileOpen').click();
  await ui.locator('#volcanoBtn').scrollIntoViewIfNeeded();
  const panelTarget = await ui.locator('#volcanoBtn').boundingBox();
  assert(panelTarget.width >= 44 && panelTarget.height >= 44, 'mobile panel special-mode touch target');
  assert.equal(await ui.locator('#weather button').count(), 6, 'existing weather modes remain');
  await ui.locator('#weather button[data-w="rain"]').click();
  assert.equal(await ui.evaluate(() => window.__app.state.S.volcano), true, 'weather change preserves volcano');
  await ui.locator('#moreBtn').click();
  await ui.locator('#menuVolcano').click();
  assert.equal(await ui.evaluate(() => window.__app.state.S.volcano), false);
  await ui.close();
  assert.deepEqual(failures, [], 'no page errors');
  console.log('PASS moon day/night, cloudy/fog/storm, volcano mobile/desktop, UI and weather independence');
} finally {
  await browser.close();
}
