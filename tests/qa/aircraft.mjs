import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { Planes } from '../../src/life/air.js';

const output = 'docs/screenshots/aircraft';
fs.mkdirSync(output, { recursive: true });
const W = 1672;
const scenarios = [
  { name: 'left-to-right', ltr: true, y0: 180, y1: 180 },
  { name: 'right-to-left', ltr: false, y0: 180, y1: 180 },
  { name: 'left-to-right-diagonal', ltr: true, y0: -70, y1: 430 },
  { name: 'right-to-left-diagonal', ltr: false, y0: -70, y1: 430 },
];
const day = { env: { cloud: 0, rain: 0, fog: 0, storm: 0 }, dayLight: 1, blend: { golden: 0 }, time: 0, reduced: false };
const scene = { size: [W, 941], cfg: { geometry: { corridors: {} } } };

for (const scenario of scenarios) {
  const planes = new Planes(scene, () => .5);
  const vx = (scenario.ltr ? 1 : -1) * (W + 100), vy = scenario.y1 - scenario.y0;
  const length = Math.hypot(vx, vy), ux = vx / length, uy = vy / length;
  const trail = [60, 50, 40, 30, 20, 10].map((distance, index) => [W / 2 - ux * distance, 180 - uy * distance, 14 + index]);
  planes.plane = { t: 20, dur: 40, y0: scenario.y0, y1: scenario.y1, ltr: scenario.ltr, high: true, trail, tt: 0 };
  planes.update(0, day);
  const calls = [], lines = [];
  planes.draw({ add: (...args) => calls.push(args), line: (...args) => lines.push(args) }, day);
  const sprite = calls.find(args => args[5] === 5);
  assert(sprite, `${scenario.name}: daylight silhouette`);
  const [x, y, , , angle] = sprite;
  assert(Math.abs(Math.cos(angle) - ux) < 1e-6 && Math.abs(Math.sin(angle) - uy) < 1e-6, `${scenario.name}: nose follows velocity`);
  assert.equal(lines.length, trail.length - 1, `${scenario.name}: contrail segments preserved`);
  for (const point of trail) assert((point[0] - x) * ux + (point[1] - y) * uy < 0, `${scenario.name}: trail stays behind`);
  assert(lines.every(line => (line[0] - x) * ux + (line[1] - y) * uy < 0 && (line[2] - x) * ux + (line[3] - y) * uy < 0));

  planes.plane.high = false;
  const lights = [];
  planes.draw({ add: (...args) => lights.push(args), line() {} }, { ...day, dayLight: 0, time: .5 });
  assert.equal(lights.length, 2, `${scenario.name}: navigation and landing lights at night`);
  assert((lights[0][0] - x) * ux + (lights[0][1] - y - 6.2 * .2) * uy < 0, `${scenario.name}: navigation light behind`);
  assert((lights[1][0] - x) * ux + (lights[1][1] - y) * uy > 0, `${scenario.name}: landing light ahead`);
  const strobe = [];
  planes.draw({ add: (...args) => strobe.push(args), line() {} }, { ...day, dayLight: 0, time: .5, reduced: true });
  assert.equal(strobe.length, 3, `${scenario.name}: reduced-motion strobe remains visible`);
  assert(strobe[1][11] < 0 && Math.abs(strobe[1][11]) <= .5, `${scenario.name}: reduced strobe intensity`);
  console.log(`PASS ${scenario.name}: direction, silhouette, contrail and night lights`);
}

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function ready(hour) {
    await page.goto(`http://127.0.0.1:8080/?qa=1&still=1&reduce=1&date=2026-07-15&h=${hour}&w=clear&ui=0`);
    await page.waitForFunction(() => window.__app && window.__app.clock.frame > 5);
    await page.waitForTimeout(500);
  }
  async function frame(name, plane) {
    await page.evaluate(p => { window.__app.life.planes.plane = p; window.__app.life.planes.next = Infinity; }, plane);
    await page.waitForTimeout(180);
    const center = await page.evaluate(() => {
      const { comp, scene } = window.__app;
      const p = window.__app.life.planes.plane;
      const uv = [p.x / scene.size[0], p.y / scene.size[1]];
      return { x: ((.5 + (uv[0] - .5) * comp.view.zoom - comp.view.cov[0]) / comp.view.cov[2]) * innerWidth,
        y: ((.5 + (uv[1] - .5) * comp.view.zoom - comp.view.cov[1]) / comp.view.cov[3]) * innerHeight };
    });
    const clip = { x: Math.round(center.x - 80), y: Math.round(center.y - 65), width: 160, height: 130 };
    const after = await page.screenshot({ clip });
    await sharp(after).resize(640, 520, { kernel: 'nearest' }).jpeg({ quality: 76 }).toFile(path.join(output, `${name}.jpg`));
    await page.evaluate(() => { window.__app.life.planes.plane = null; });
    await page.waitForTimeout(180);
    const before = await page.screenshot({ clip });
    const a = await sharp(after).removeAlpha().raw().toBuffer(), b = await sharp(before).removeAlpha().raw().toBuffer();
    let changed = 0;
    for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) changed++;
    assert(changed > 20, `${name}: WebGL sprite must appear in rendered pixels (${changed})`);
    console.log(`PASS rendered ${name}: ${changed} changed pixels`);
  }
  await ready(12);
  for (const scenario of scenarios) {
    const vx = (scenario.ltr ? 1 : -1) * (W + 100), vy = scenario.y1 - scenario.y0, length = Math.hypot(vx, vy);
    const ux = vx / length, uy = vy / length;
    await frame(scenario.name, { t: 20, dur: 40, y0: scenario.y0, y1: scenario.y1, ltr: scenario.ltr, high: true,
      x: W / 2, y: 180, tt: 0, trail: [55, 40, 25, 10].map((distance, index) => [W / 2 - ux * distance, 180 - uy * distance, 16 + index]) });
  }
  await ready(23);
  await frame('night-lights', { t: 20, dur: 40, y0: 180, y1: 180, ltr: true, high: false, x: W / 2, y: 180, tt: 0, trail: [] });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
