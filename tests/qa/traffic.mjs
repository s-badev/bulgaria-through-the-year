// Traffic QA.
//   node tests/qa/traffic.mjs [--port 8080] [--states noon,night] [--frames-only] [--audit-only]
// Per state:
//   visual  — 10 consecutive frames 0.5 s apart, the live avenue cropped at 4x -> tests/qa-out/traffic/<state>.png
//   audit   — 5 minutes of simulated time: rendered car pixels outside the asphalt mask (read back from the GPU), overlaps,
//             mid-road spawns/despawns, car footprints off the mask -> tests/qa-out/traffic-audit.json
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const port = +arg('--port', 8080), only = arg('--states', ''), framesOnly = process.argv.includes('--frames-only'), auditOnly = process.argv.includes('--audit-only');
export const STATES = {
  'noon': 'date=2026-07-15&h=13', 'rush-hour': 'date=2026-07-15&h=17.8', 'golden-evening': 'date=2026-07-15&h=20.3', 'blue-hour': 'date=2026-07-15&h=21.35',
  'night': 'date=2026-07-15&h=23.5', 'rain-night': 'date=2026-10-20&h=21&w=rain', 'fog-morning': 'date=2026-10-20&h=8.6&w=fog', 'winter-day': 'date=2026-01-18&h=13', 'winter-night': 'date=2026-01-18&h=20',
};
const CROP = [212, 438, 136, 124], Z = 4, W = 1672, H = 941, OUT = 'tests/qa-out/traffic';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
const problems = [];
page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('response', r => { if (r.status() >= 400) problems.push(r.status() + ': ' + r.url()); });
const audit = {};
for (const [name, q] of Object.entries(STATES)) {
  if (only && !only.split(',').includes(name)) continue;
  await page.goto(`http://127.0.0.1:${port}/?qa=1&ui=0&still=1&${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && window.__app.clock.frame > 3, null, { timeout: 60000 });
  await page.waitForFunction(() => Object.values(window.__app.scene.photos).every(p => p.state !== 'loading'), null, { timeout: 60000 });
  await page.waitForTimeout(1100);   // loading veil gone
  await page.evaluate(() => { const a = window.__app; a.clock.stop(); for (let i = 0; i < 90; i++) a.clock.step(1 / 30); });
  if (!auditOnly) {
    const tiles = [];
    for (let f = 0; f < 10; f++) {
      await page.evaluate(() => { const a = window.__app; for (let i = 0; i < 15; i++) a.clock.step(1 / 30); return new Promise(r => requestAnimationFrame(() => r())); });
      const shot = await page.screenshot();
      tiles.push({ input: await sharp(shot).extract({ left: CROP[0], top: CROP[1], width: CROP[2], height: CROP[3] }).resize(CROP[2] * Z, CROP[3] * Z, { kernel: 'cubic' }).png().toBuffer(), left: (f % 5) * (CROP[2] * Z + 4), top: Math.floor(f / 5) * (CROP[3] * Z + 4) });
      if (f === 0) await sharp(shot).png().toFile(`${OUT}/${name}-full.png`);
    }
    await sharp({ create: { width: 5 * (CROP[2] * Z + 4), height: 2 * (CROP[3] * Z + 4), channels: 3, background: '#000' } }).composite(tiles).png().toFile(`${OUT}/${name}.png`);
  }
  if (!framesOnly) {
    // 5 minutes at 30 steps/s = 9000 steps; the GPU layer is read back every 15th step (600 read-backs)
    audit[name] = await page.evaluate(() => {
      const a = window.__app, T = a.life.traffic, L = a.life.trafficLayer, m = a.scene.cpu.road, res = { steps: 0, readbacks: 0, carPixels: 0, carPixelsOffRoad: 0, overlaps: 0, footprintsOffRoad: 0, maxCars: 0, visibleCarFrames: 0 };
      const e0 = { ...T.events, log: undefined };
      for (let i = 0; i < 9000; i++) {
        a.clock.step(1 / 30); res.steps++;
        const au = T.audit(); res.overlaps += au.overlaps; res.footprintsOffRoad += au.offRoad; res.maxCars = Math.max(res.maxCars, au.cars); res.visibleCarFrames += au.visible;
        if (i % 15 === 0) { const px = L.read(), ch = T.setName === 'autumn' ? 1 : 0; res.readbacks++; for (let p = 0; p < px.length; p += 4) if (px[p + 3] > 8) { res.carPixels++; if (!m.data[p + ch]) res.carPixelsOffRoad++; } }
      }
      res.spawns = T.events.spawn - e0.spawn; res.despawns = T.events.despawn - e0.despawn; res.midRoadSpawnOrDespawn = T.events.midRoad - e0.midRoad; res.midRoadLog = T.events.log.slice(0, 5);
      res.set = T.setName; res.lib = T.lib; res.lanes = T.lanes.map(l => l.id); res.carsNow = T.count;
      return res;
    });
    const r = audit[name]; console.log(name.padEnd(15), `cars max ${r.maxCars} | car px ${r.carPixels} off-road ${r.carPixelsOffRoad} | overlaps ${r.overlaps} | footprints off ${r.footprintsOffRoad} | spawns ${r.spawns} despawns ${r.despawns} mid-road ${r.midRoadSpawnOrDespawn} | lanes ${r.lanes.length} (${r.set}/${r.lib})`);
  } else console.log(name, 'frames written');
}
await browser.close();
if (!framesOnly) {
  const prev = fs.existsSync('tests/qa-out/traffic-audit.json') ? JSON.parse(fs.readFileSync('tests/qa-out/traffic-audit.json', 'utf8')) : {};
  fs.writeFileSync('tests/qa-out/traffic-audit.json', JSON.stringify({ ...prev, ...audit }, null, 2));
  const bad = Object.entries(audit).filter(([, r]) => r.carPixelsOffRoad || r.overlaps || r.midRoadSpawnOrDespawn || r.footprintsOffRoad);
  console.log(bad.length ? 'AUDIT FAILED: ' + bad.map(b => b[0]).join(', ') : 'audit passed for ' + Object.keys(audit).length + ' state(s)');
  console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'no console errors, no failed requests');
  process.exit(bad.length || problems.length ? 1 : 0);
}
