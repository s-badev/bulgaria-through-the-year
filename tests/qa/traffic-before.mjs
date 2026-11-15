// "Before" measurement of the old capsule traffic (run once, against the code at 396ac00, before it was deleted).
// 600 frames in the clear-day state: where do the drawn cars sit relative to the real asphalt?
//   node tests/qa/traffic-before.mjs [port]
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const port = +(process.argv[2] || 5199), W = 1672, H = 941;
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
await page.goto(`http://127.0.0.1:${port}/?qa=1&ui=0&date=2026-07-15&h=13`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__app && window.__app.clock.frame > 3, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tests/qa-out/traffic-before-frame.png' });
const pos = await page.evaluate(() => {
  const a = window.__app, T = a.life.traffic, out = []; a.clock.stop();
  const P = { x: 0, y: 0, sc: 1, vis: 1, ang: 0 };
  for (let f = 0; f < 600; f++) {
    a.clock.step(1 / 60);
    for (const c of T.cars) { if (!c.on) continue; const p = T.at(c.lane, c.s, P); if (p.vis < 0.05) continue; const nx = -Math.sin(p.ang), ny = Math.cos(p.ang); out.push([Math.round(p.x + nx * c.off * c.lane.width * 0.5 * p.sc), Math.round(p.y + ny * c.off * c.lane.width * 0.5 * p.sc), c.lane.id]); }
  }
  return out;
});
await browser.close();
// reference 1: the strict asphalt mask of the new pipeline (left avenue only); reference 2: asphalt-coloured pixel in the master (any road)
const road = (await sharp('public/scenes/ndk/road.png').raw().toBuffer({ resolveWithObject: true })), rch = road.info.channels;
const m = await sharp('assets/source/work/processed/master.png').blur(1).raw().toBuffer({ resolveWithObject: true });
const asphaltLike = (x, y) => { const i = (y * W + x) * 3, r = m.data[i] / 255, g = m.data[i + 1] / 255, b = m.data[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0; let h = 0; if (mx - mn > 1e-6) { h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; h *= 60; if (h < 0) h += 360; } return (s < 0.16 && mx > 0.42 && mx < 0.80) || (h > 195 && h < 255 && s > 0.2 && mx > 0.12 && mx < 0.45); };
let offStrictLeft = 0, left = 0, offColour = 0, n = 0; const byLane = {};
for (const [x, y, lane] of pos) {
  if (x < 0 || y < 0 || x >= W || y >= H) continue; n++;
  const okC = asphaltLike(x, y); if (!okC) offColour++;
  (byLane[lane] ||= { n: 0, offColour: 0 }).n++; if (!okC) byLane[lane].offColour++;
  if (lane.startsWith('left')) { left++; if (!road.data[(y * W + x) * rch]) offStrictLeft++; }
}
const res = { frames: 600, carPositions: n, offAsphaltColourShare: +(offColour / n).toFixed(3), leftAvenuePositions: left, leftAvenueOutsideStrictMaskShare: +(offStrictLeft / left).toFixed(3), byLane: Object.fromEntries(Object.entries(byLane).map(([k, v]) => [k, +(v.offColour / v.n).toFixed(3)])) };
fs.mkdirSync('tests/qa-out', { recursive: true }); fs.writeFileSync('tests/qa-out/traffic-before.json', JSON.stringify(res, null, 2));
console.log(res);
// 4x crops of both avenues for docs/TRAFFIC.md
fs.mkdirSync('docs/traffic', { recursive: true });
for (const [name, x, y, w, h] of [['left', 200, 395, 150, 170], ['right', 1350, 495, 170, 180]]) await sharp('tests/qa-out/traffic-before-frame.png').extract({ left: x, top: y, width: w, height: h }).resize(w * 4, h * 4, { kernel: 'cubic' }).png().toFile(`docs/traffic/before-${name}.png`);
