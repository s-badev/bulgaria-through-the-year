import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:8080/';
const output = 'docs/screenshots/cloudy';
const cases = [
  ['summer-day', '2026-07-15', 12],
  ['summer-sunrise', '2026-07-15', 6.5],
  ['summer-sunset', '2026-07-15', 20],
  ['summer-night', '2026-07-15', 23],
  ['autumn-day', '2026-10-20', 12],
  ['winter-day', '2026-01-18', 12],
];
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];
const context = await browser.newContext({ viewport: { width: 960, height: 540 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));

async function capture(date, hour, weather, name, mobilePage = page) {
  await mobilePage.goto(`${url}?qa=1&ui=0&still=1&reduce=1&flash=0&date=${date}&h=${hour}&w=${weather}`);
  await mobilePage.waitForFunction(() => window.__app && window.__app.clock.frame > 3);
  await mobilePage.waitForFunction(() => Object.values(window.__app.scene.photos).every(photo => photo.state !== 'loading'));
  await mobilePage.waitForTimeout(250);
  const state = await mobilePage.evaluate(() => ({
    date: [window.__app.state.S.y, window.__app.state.S.m, window.__app.state.S.d],
    hour: window.__app.state.S.hour, cov: window.__app.comp.view.cov,
    sunVis: window.__app.comp.blend.sunVis, dryCloud: window.__app.comp.blend.dryCloud,
    wGold: window.__app.comp.blend.wGold, quality: window.__app.quality.scale,
  }));
  const png = await mobilePage.screenshot({ type: 'png' });
  await sharp(png).jpeg({ quality: 48 }).toFile(path.join(output, `${name}.jpg`));
  return { state, png };
}
async function stats(png, area) {
  const { data, info } = await sharp(png).extract(area).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let lum = 0, lum2 = 0, chroma = 0;
  const n = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum += y; lum2 += y * y; chroma += Math.max(r, g, b) - Math.min(r, g, b);
  }
  return { mean: lum / n, contrast: Math.sqrt(Math.max(0, lum2 / n - (lum / n) ** 2)), chroma: chroma / n };
}
async function difference(a, b) {
  const x = await sharp(a).removeAlpha().raw().toBuffer(), y = await sharp(b).removeAlpha().raw().toBuffer();
  assert.equal(x.length, y.length);
  let sum = 0; for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

try {
  const pairs = {};
  for (const [name, date, hour] of cases) {
    const clear = await capture(date, hour, 'clear', `${name}-clear`);
    const cloudy = await capture(date, hour, 'cloudy', `${name}-cloudy`);
    assert.deepEqual(cloudy.state.date, clear.state.date, `${name}: same date`);
    assert.equal(cloudy.state.hour, clear.state.hour, `${name}: same hour`);
    assert.deepEqual(cloudy.state.cov, clear.state.cov, `${name}: identical camera crop`);
    assert(cloudy.state.sunVis <= clear.state.sunVis + 0.001, `${name}: direct sun suppressed`);
    if (name.endsWith('day')) assert(cloudy.state.dryCloud > 0.95, `${name}: dry diffuse light active`);
    pairs[name] = { clear, cloudy };
    console.log(`PASS ${name}: matched clear/cloudy pair, sun visibility ${clear.state.sunVis.toFixed(3)} → ${cloudy.state.sunVis.toFixed(3)}`);
  }
  const areas = {
    building: { left: 315, top: 235, width: 235, height: 115 },
    vegetation: { left: 700, top: 355, width: 225, height: 165 },
    ground: { left: 345, top: 355, width: 315, height: 165 },
  };
  for (const [name, area] of Object.entries(areas)) {
    const a = await stats(pairs['summer-day'].clear.png, area), b = await stats(pairs['summer-day'].cloudy.png, area);
    assert(b.chroma < a.chroma, `${name}: cloudy has softer colour`);
    assert(b.contrast < a.contrast, `${name}: cloudy has softer contrast`);
    assert(b.mean > a.mean * 0.55, `${name}: cloudy remains naturally bright`);
    assert(b.contrast > a.contrast * 0.6 && b.chroma > a.chroma * 0.25, `${name}: photographic detail and colour remain`);
    console.log(`${name}: luminance ${a.mean.toFixed(1)} → ${b.mean.toFixed(1)}, contrast ${a.contrast.toFixed(1)} → ${b.contrast.toFixed(1)}, chroma ${a.chroma.toFixed(1)} → ${b.chroma.toFixed(1)}`);
  }
  const skyArea = { left: 0, top: 0, width: 960, height: 95 };
  const skyClear = await stats(pairs['summer-day'].clear.png, skyArea);
  const skyCloudy = await stats(pairs['summer-day'].cloudy.png, skyArea);
  assert(skyCloudy.chroma < skyClear.chroma * 0.8, 'cloudy sky loses the clear blue field');
  console.log(`sky chroma ${skyClear.chroma.toFixed(1)} → ${skyCloudy.chroma.toFixed(1)}`);
  const nightClear = await stats(pairs['summer-night'].clear.png, areas.building);
  const nightCloudy = await stats(pairs['summer-night'].cloudy.png, areas.building);
  assert(nightCloudy.mean > nightClear.mean * 0.75, 'cloudy night retains visible city detail');
  for (const weather of ['rain', 'fog', 'storm']) {
    const other = await capture('2026-07-15', 12, weather, `summer-day-${weather}`);
    const delta = await difference(pairs['summer-day'].cloudy.png, other.png);
    assert(delta > 6, `cloudy remains visually distinct from ${weather}`);
    assert(other.state.dryCloud < 0.05, `${weather} retains separate lighting`);
    console.log(`PASS cloudy versus ${weather}: mean channel difference ${delta.toFixed(1)}/255`);
  }
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const mobilePage = await mobile.newPage();
  mobilePage.on('pageerror', error => errors.push(error.message));
  await capture('2026-07-15', 12, 'cloudy', 'mobile-day-cloudy', mobilePage);
  const fps = await mobilePage.evaluate(async () => {
    const first = window.__app.clock.frame, start = performance.now();
    await new Promise(resolve => setTimeout(resolve, 1500));
    return (window.__app.clock.frame - first) * 1000 / (performance.now() - start);
  });
  assert(fps >= 45, `mobile cloudy frame rate ${fps.toFixed(1)} fps`);
  await mobile.close();
  console.log(`PASS mobile 390x844: ${fps.toFixed(1)} fps`);
  assert.deepEqual(errors, [], 'no browser errors');
} finally { await context.close(); await browser.close(); }
