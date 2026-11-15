// Frame-time comparison of two production builds on the real GPU, with vsync and the frame-rate limit OFF, so the number is
// the real cost of a frame (a 60 fps cap would hide any regression under ~0%).
//   node tests/qa/frametime.mjs <label=port> [<label=port> ...] [--size 1920x1080] [--seconds 6] [--rounds 3]
// Rounds alternate between the builds; the median per state is reported. Writes tests/qa-out/frametime.json.
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const targets = args.filter(a => /^[\w-]+=\d+$/.test(a)).map(a => { const [label, port] = a.split('='); return { label, port: +port }; });
const [w, h] = arg('--size', '1920x1080').split('x').map(Number), seconds = +arg('--seconds', 6), rounds = +arg('--rounds', 3);
const STATES = { 'noon': 'date=2026-07-15&h=13', 'rush-hour': 'date=2026-07-15&h=17.8', 'night': 'date=2026-07-15&h=23.5', 'rain-night': 'date=2026-10-20&h=21&w=rain', 'winter-snow': 'date=2026-01-18&h=13&w=snow', 'storm': 'date=2026-10-20&h=16&w=storm&flash=0' };
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const samples = {};
let renderer = '';
for (let r = 0; r < rounds; r++) for (const t of (r % 2 ? [...targets].reverse() : targets)) for (const [name, q] of Object.entries(STATES)) {
  await page.goto(`http://127.0.0.1:${t.port}/?qa=1&ui=0&still=1&${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && window.__app.clock.frame > 10, null, { timeout: 60000 });
  await page.waitForFunction(() => Object.values(window.__app.scene.photos).every(p => p.state !== 'loading'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const ms = await page.evaluate(async secs => { const c = window.__app.clock, f0 = c.frame, t0 = performance.now(); await new Promise(res => setTimeout(res, secs * 1000)); return (performance.now() - t0) / (c.frame - f0); }, seconds);
  if (!renderer) renderer = await page.evaluate(() => { const gl = window.__app.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  ((samples[t.label] ||= {})[name] ||= []).push(ms);
}
await browser.close();
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const out = { renderer, size: [w, h], seconds, rounds, vsync: 'off', states: {} };
for (const name of Object.keys(STATES)) {
  const row = {}; for (const t of targets) row[t.label] = +med(samples[t.label][name]).toFixed(3);
  if (targets.length === 2) { const [a, b] = targets.map(t => row[t.label]); row.changePct = +((b - a) / a * 100).toFixed(1); }
  out.states[name] = row;
}
if (targets.length === 2) { const ch = Object.values(out.states).map(r => r.changePct); out.worstChangePct = Math.max(...ch); out.meanChangePct = +(ch.reduce((s, v) => s + v, 0) / ch.length).toFixed(1); }
fs.mkdirSync('tests/qa-out', { recursive: true }); fs.writeFileSync('tests/qa-out/frametime.json', JSON.stringify(out, null, 2));
console.log('renderer:', renderer); console.table(out.states);
if (targets.length === 2) console.log(`mean change ${out.meanChangePct}% | worst ${out.worstChangePct}% (${targets[1].label} vs ${targets[0].label})`);
