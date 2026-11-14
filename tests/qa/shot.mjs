// Dev/QA helper: screenshots of chosen states. Usage:
//   node tests/qa/shot.mjs [--port 8080] [--size 1440x810] [--out dir] name=query ...
//   e.g. node tests/qa/shot.mjs noon="date=2026-07-15&h=12" night="date=2026-07-15&h=23"
// Uses a real GPU when available (headed-less new Chromium with ANGLE), prints console errors and failed requests.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2); let port = 8080, size = [1440, 810], out = 'tests/screenshots', wait = 1500, sheet = null;
const shots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = +args[++i];
  else if (args[i] === '--size') size = args[++i].split('x').map(Number);
  else if (args[i] === '--out') out = args[++i];
  else if (args[i] === '--wait') wait = +args[++i];
  else if (args[i] === '--sheet') sheet = args[++i];
  else { const k = args[i].indexOf('='); shots.push([args[i].slice(0, k), args[i].slice(k + 1)]); }
}
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const problems = [];
page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('requestfailed', r => problems.push('requestfailed: ' + r.url()));
page.on('response', r => { if (r.status() >= 400) problems.push(r.status() + ': ' + r.url()); });
const files = [];
for (const [name, q] of shots) {
  await page.goto(`http://127.0.0.1:${port}/?${q}${q.includes('ui=') ? '' : '&ui=0'}&qa=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && window.__app.clock.frame > 2, null, { timeout: 60000 });
  // wait until every photograph the state asked for has streamed in, then let the frame settle
  await page.waitForFunction(() => Object.values(window.__app.scene.photos).every(p => p.state !== 'loading'), null, { timeout: 60000 });
  await page.waitForTimeout(wait);
  const f = path.join(out, name + '.png'); await page.screenshot({ path: f }); files.push(f);
}
if (sheet) {
  const sharp = (await import('sharp')).default, cols = Math.ceil(Math.sqrt(files.length)), rows = Math.ceil(files.length / cols), tw = Math.floor(1680 / cols), th = Math.round(tw * size[1] / size[0]);
  const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(tw, th).png().toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th })));
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#000' } }).composite(comps).png().toFile(sheet);
}
const info = await page.evaluate(() => { const gl = window.__app.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
console.log('renderer:', info);
console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'no console errors, no failed requests');
await browser.close();
