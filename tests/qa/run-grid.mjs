// QA grid: 4 seasons x (dawn, noon, golden evening, night) x (clear, cloudy, fog, rain, snow) at 1440, 1024, 768, 390.
// Needs the production build served on http://127.0.0.1:8080 (npm run build && npm run preview).
// Writes screenshots to tests/screenshots/grid/<width>/, contact sheets + report to tests/qa-out/.
//   node tests/qa/run-grid.mjs [--port 8080] [--widths 1440,390] [--headed]
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const port = +arg('--port', 8080), widths = arg('--widths', '1440,1024,768,390').split(',').map(Number), headed = process.argv.includes('--headed');
const SIZES = { 1440: [1440, 810], 1024: [1024, 768], 768: [768, 1024], 390: [390, 844] };
const SEASONS = { spring: '2026-04-22', summer: '2026-07-15', autumn: '2026-10-20', winter: '2026-01-18' };
const TODS = ['dawn', 'noon', 'golden', 'night'], WEATHERS = ['clear', 'cloudy', 'fog', 'rain', 'snow'];
const OUT = 'tests/qa-out', SHOTS = 'tests/screenshots/grid';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: !headed, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const report = { started: new Date().toISOString(), renderer: '', states: 0, problems: [], checks: {}, emblem: { min: 1, worst: '' }, perWidth: {} };
const fail = (name, where, detail) => { (report.checks[name] ||= []).push(where + (detail ? ': ' + detail : '')); };
const pass = name => { report.checks[name] ||= []; };
for (const n of ['no snow in summer', 'no birds in winter', 'no insects in winter', 'no leaves in winter', 'fountains off in winter', 'fountains on in warm seasons', 'lamps on at night', 'lamps off at noon', 'morning light from the left', 'evening light from the right', 'dawn photos never in the evening', 'time-of-day weights sum to 1', 'sprite buffer never overflows', 'NDK emblem intact']) pass(n);

let refEmblem = null;
async function emblemPatch(file, w, h) { // emblem (800,502) in image px -> screen px for a cover-fit 1672x941 image, zoom ~1.035
  const as = w / h, ai = 1672 / 941; let covX = 0, covY = 0, covW = 1, covH = 1;
  if (as > ai) { covH = ai / as; covY = 0.5 - covH / 2; } else { covW = as / ai; covX = Math.min(Math.max(0.48 - covW / 2, 0), 1 - covW); }
  const u = 0.5 + (800 / 1672 - 0.5) * 1.035, v = 0.5 + (502 / 941 - 0.5) * 1.035, x = (u - covX) / covW * w, y = (v - covY) / covH * h, r = Math.round(26 * w / (1672 * covW));
  const { data } = await sharp(file).extract({ left: Math.max(0, Math.round(x - r)), top: Math.max(0, Math.round(y - r)), width: 2 * r, height: 2 * r }).resize(48, 48, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return Float32Array.from(data);
}
const zncc = (a, b) => { let ma = 0, mb = 0; for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; } ma /= a.length; mb /= a.length; let c = 0, va = 0, vb = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; c += x * y; va += x * x; vb += y * y; } return c / Math.sqrt(va * vb + 1e-9); };

for (const width of widths) {
  const [w, h] = SIZES[width], dir = path.join(SHOTS, String(width)); fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: width < 800, isMobile: width < 800 });
  const page = await ctx.newPage(); const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(`[${width}] console: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`[${width}] pageerror: ${e.message}`));
  page.on('requestfailed', r => problems.push(`[${width}] requestfailed: ${r.url()}`));
  page.on('response', r => { if (r.status() >= 400) problems.push(`[${width}] HTTP ${r.status()}: ${r.url()}`); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/?qa=1&ui=${width === 1440 ? 0 : 1}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && window.__app.clock.frame > 2, null, { timeout: 60000 });
  report.renderer = await page.evaluate(() => { const gl = window.__app.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  const files = [];
  for (const [season, date] of Object.entries(SEASONS)) for (const tod of TODS) for (const weather of WEATHERS) {
    const name = `${season}-${tod}-${weather}`;
    const info = await page.evaluate(async ({ date, tod, weather }) => {
      const a = window.__app, s = a.state, [y, m, d] = date.split('-').map(Number);
      s.setDate(y, m - 1, d); const t = s.times;
      s.setHour(tod === 'dawn' ? t.rise + 0.2 : tod === 'noon' ? t.noon : tod === 'golden' ? t.set - 0.7 : 23.5);
      s.setWeather(weather); s.S.wind = 0.3; s.S.fogLvl = 0.55; s.settle(); a.ui.syncTime(); a.ui.syncDate();
      // let life settle for this state (birds leave, fountains stop...) and photos stream in
      const t1 = performance.now();
      while (performance.now() - t1 < 15000) { await new Promise(r => requestAnimationFrame(r)); if (Object.values(a.scene.photos).every(p => p.state !== 'loading') && performance.now() - t1 > 650) break; }
      const b = a.comp.blend, L = a.life;
      return { hour: s.S.hour, alt: b.alt, az: b.az, morning: b.morning, sum: b.wDay + b.wGold + b.wBlue + b.wNight, wGold: b.wGold, wBlue: b.wBlue, anchored: b.anchoredSide, lights: b.lightsOn, sunX: b.sunX, snow: s.V.snow, cover: s.V.cover, water: s.V.water,
        birds: L.birds.flocks.length, ff: L.insects.ff, mg: L.insects.mg, leaves: L.leaves.n || 0, sprites: L.sprites.n, dropped: L.sprites.dropped, seasonName: s.seasonName, weatherEff: s.effectiveWeather, dt: a.clock.dtAvg };
    }, { date, tod, weather });
    const file = path.join(dir, name + '.png'); await page.screenshot({ path: file }); files.push(file); report.states++;
    // ---- automatic checks ----
    if (season === 'summer' && (info.snow > 0.01 || info.cover > 0.01)) fail('no snow in summer', name, `snow ${info.snow} cover ${info.cover}`);
    if (season === 'winter') { if (info.birds) fail('no birds in winter', name, info.birds + ' flocks'); if (info.ff > 0.01 || info.mg > 0.01) fail('no insects in winter', name); if (info.leaves) fail('no leaves in winter', name); if (info.water > 0.05) fail('fountains off in winter', name, 'water ' + info.water); }
    else if (info.cover < 0.25 && info.water < 0.9) fail('fountains on in warm seasons', name, 'water ' + info.water);
    if (tod === 'night' && info.lights < 0.95) fail('lamps on at night', name, 'lightsOn ' + info.lights);
    if (tod === 'noon' && weather === 'clear' && info.lights > 0.02) fail('lamps off at noon', name, 'lightsOn ' + info.lights);
    if (tod === 'dawn' && !(info.sunX < 0.5 && info.morning)) fail('morning light from the left', name, 'sunX ' + info.sunX);
    if (tod === 'golden' && !(info.sunX > 0.5 && !info.morning)) fail('evening light from the right', name, 'sunX ' + info.sunX);
    if (tod === 'golden' && !info.anchored && (info.wGold !== 0 || info.wBlue !== 0)) fail('dawn photos never in the evening', name);
    if (Math.abs(info.sum - 1) > 1e-6) fail('time-of-day weights sum to 1', name, String(info.sum));
    if (info.dropped) fail('sprite buffer never overflows', name, info.dropped + ' dropped');
    if (width === 1440) { const p = await emblemPatch(file, w, h); if (!refEmblem && name === 'summer-noon-clear') refEmblem = p; (report.emblemPatches ||= {})[name] = p; }
  }
  if (width === 1440) { // structure of the sun-disc emblem must survive every state (thick fog legitimately hides it a little)
    const ref = report.emblemPatches['summer-noon-clear'];
    for (const [name, p] of Object.entries(report.emblemPatches)) { const z = zncc(ref, p); if (z < report.emblem.min) { report.emblem.min = +z.toFixed(3); report.emblem.worst = name; } if (z < 0.45) fail('NDK emblem intact', name, 'zncc ' + z.toFixed(2)); }
    delete report.emblemPatches;
  }
  // contact sheets: one per season (rows = time of day, columns = weather)
  const tw = width === 1440 ? 336 : width === 1024 ? 240 : width === 768 ? 168 : 112, th = Math.round(tw * h / w);
  for (const season of Object.keys(SEASONS)) {
    const comps = [];
    for (let r = 0; r < TODS.length; r++) for (let c = 0; c < WEATHERS.length; c++) comps.push({ input: await sharp(path.join(dir, `${season}-${TODS[r]}-${WEATHERS[c]}.png`)).resize(tw, th).png().toBuffer(), left: c * tw, top: r * th });
    await sharp({ create: { width: tw * WEATHERS.length, height: th * TODS.length, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(OUT, `sheet-${width}-${season}.png`));
  }
  const perf = await page.evaluate(() => ({ dtMs: +(window.__app.clock.dtAvg * 1000).toFixed(2), quality: window.__app.quality.name, base: window.__app.comp.baseRenders, shadow: window.__app.comp.shadowRenders }));
  report.perWidth[width] = { viewport: [w, h], seconds: +((Date.now() - t0) / 1000).toFixed(1), frameMs: perf.dtMs, baseRenders: perf.base, shadowRenders: perf.shadow, problems: problems.length };
  report.problems.push(...new Set(problems));
  await ctx.close();
  console.log(`width ${width}: ${files.length} screenshots, ${problems.length} problems, frame ${perf.dtMs} ms`);
}
await browser.close();
report.failedChecks = Object.entries(report.checks).filter(([, v]) => v.length).map(([k, v]) => `${k} (${v.length})`);
fs.writeFileSync(path.join(OUT, 'grid-report.json'), JSON.stringify(report, null, 2));
console.log('states:', report.states, '| renderer:', report.renderer);
console.log('emblem min zncc:', report.emblem.min, report.emblem.worst);
console.log(report.problems.length ? 'PROBLEMS:\n' + report.problems.join('\n') : 'no console errors, no failed requests');
console.log(report.failedChecks.length ? 'FAILED CHECKS:\n' + Object.entries(report.checks).filter(([, v]) => v.length).map(([k, v]) => ' - ' + k + ': ' + v.slice(0, 6).join(' | ')).join('\n') : 'all automatic checks passed');
process.exit(report.problems.length || report.failedChecks.length ? 1 : 0);
