// Behaviour and accessibility checks against the production build on http://127.0.0.1:8080.
// keyboard path, visible focus, reduced motion, "Без проблясвания", flash rate, sound default, "Сега", contrast, payload.
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const port = +(process.argv[2] || 8080), base = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const out = { when: new Date().toISOString(), results: {}, failures: [] };
const check = (name, ok, detail) => { out.results[name] = { ok: !!ok, detail }; if (!ok) out.failures.push(name); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };
const ready = page => page.waitForFunction(() => window.__app && window.__app.clock.frame > 3, null, { timeout: 60000 });
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ---------- 1. first visit: payload, first frame, autoplay demo, sound off ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } }), page = await ctx.newPage(), reqs = [];
  page.on('response', async r => { try { const h = await r.allHeaders(); reqs.push({ url: r.url().replace(base, ''), bytes: +(h['content-length'] || 0), status: r.status() }); } catch { /* ignore */ } });
  const t0 = Date.now(); await page.goto(base, { waitUntil: 'commit' }); await ready(page);
  const firstFrameMs = Date.now() - t0, firstBytes = reqs.reduce((s, r) => s + r.bytes, 0), firstList = reqs.map(r => r.url);
  check('first frame under 3 s (localhost, real GPU)', firstFrameMs < 3000, { firstFrameMs });
  check('first-paint payload under 4 MB', firstBytes < 4e6, { MB: +(firstBytes / 1048576).toFixed(2), requests: firstList.length });
  await page.waitForFunction(() => Object.values(window.__app.scene.photos).every(p => p.state === 'ready'), null, { timeout: 60000 });
  const total = reqs.reduce((s, r) => s + r.bytes, 0);
  check('total transfer under 25 MB', total < 25e6, { MB: +(total / 1048576).toFixed(2), requests: reqs.length });
  check('no failed requests', reqs.every(r => r.status < 400), reqs.filter(r => r.status >= 400));
  const first = await page.evaluate(() => ({ demo: window.__app.demo.on, intro: !document.querySelector('#intro').classList.contains('gone'), sound: window.__app.state.S.sound, audioCtx: !!window.__app.sound.ctx, stamp: document.querySelector('#version').textContent }));
  check('first visit: demo autoplays behind the welcome card', first.demo && first.intro, first);
  check('sound is off by default (no AudioContext before the button)', !first.sound && !first.audioCtx);
  check('footer shows a version stamp', /версия [0-9a-f]{7}/.test(first.stamp), first.stamp);
  await page.keyboard.press('Escape');
  const stopped = await page.evaluate(() => ({ demo: window.__app.demo.on, intro: !document.querySelector('#intro').classList.contains('gone') }));
  check('demo is stoppable (Esc)', !stopped.demo && !stopped.intro, stopped);
  await page.click('#soundBtn'); await page.waitForTimeout(600);
  const snd = await page.evaluate(() => ({ on: window.__app.state.S.sound, state: window.__app.sound.ctx?.state, pressed: document.querySelector('#soundBtn').getAttribute('aria-pressed') }));
  check('sound starts only from the explicit button', snd.on && snd.state === 'running' && snd.pressed === 'true', snd);
  await page.click('#soundBtn'); const muted = await page.evaluate(() => window.__app.state.S.sound); check('sound button mutes again', muted === false);
  await ctx.close();
}
// ---------- 2. keyboard path + visible focus ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } }), page = await ctx.newPage();
  await page.goto(base + '?qa=1', { waitUntil: 'load' }); await ready(page);
  const expected = await page.evaluate(() => [...document.querySelectorAll('#app button, #app input')].filter(e => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.gone') && e.id !== 'photoExit').map(e => e.id || e.dataset.s || e.dataset.w));
  const seen = [], noOutline = [];
  for (let i = 0; i < expected.length + 6; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { id: e.id || e.dataset.s || e.dataset.w, outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }; });
    if (f) { if (!seen.includes(f.id)) seen.push(f.id); if (!f.outline) noOutline.push(f.id); }
  }
  const missing = expected.filter(id => !seen.includes(id));
  check('every control is reachable with Tab', missing.length === 0, { controls: expected.length, missing });
  check('focus is visible on every control', noOutline.length === 0, noOutline);
  await page.focus('#hour'); const h0 = await page.evaluate(() => window.__app.state.S.hour); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  check('hour slider works from the keyboard', (await page.evaluate(() => window.__app.state.S.hour)) > h0);
  await page.focus('#weather button[data-w="rain"]'); await page.keyboard.press('Enter');
  check('weather buttons work from the keyboard', (await page.evaluate(() => window.__app.state.S.weather)) === 'rain');
  await page.focus('#seasons button[data-s="winter"]'); await page.keyboard.press('Space');
  check('season buttons work from the keyboard', (await page.evaluate(() => window.__app.state.seasonName)) === 'winter');
  await page.keyboard.press('h'); const ph = await page.evaluate(() => document.body.classList.contains('photo')); await page.keyboard.press('h');
  check('H toggles photo mode and back', ph && !(await page.evaluate(() => document.body.classList.contains('photo'))));
  // summer + snow => rain, with an explanation
  await page.evaluate(() => { const a = window.__app; a.state.setSeason('summer'); a.ui.syncDate(); }); await page.click('#weather button[data-w="snow"]'); await page.waitForTimeout(300);
  const ss = await page.evaluate(() => ({ eff: window.__app.state.effectiveWeather, toast: document.querySelector('#toast').textContent })); check('snow in summer becomes rain and says so', ss.eff === 'rain' && /сняг/i.test(ss.toast), ss);
  // "Сега": real Sofia time and live weather
  await page.click('#now'); await page.waitForFunction(() => !document.querySelector('#now').disabled, null, { timeout: 15000 }); await page.waitForTimeout(300);
  const now = await page.evaluate(() => { const s = window.__app.state.S; return { date: `${s.y}-${s.m + 1}-${s.d}`, hour: +s.hour.toFixed(2), weather: s.weather, live: s.live, wind: s.wind, toast: document.querySelector('#toast').textContent }; });
  const sofia = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).reduce((o, p) => (o[p.type] = +p.value, o), {});
  check('"Сега" sets the real Sofia date and time', now.date === `${sofia.year}-${sofia.month}-${sofia.day}` && Math.abs(now.hour - (sofia.hour + sofia.minute / 60)) < 0.05, { app: now.date + ' ' + now.hour, sofia: `${sofia.year}-${sofia.month}-${sofia.day} ${(sofia.hour + sofia.minute / 60).toFixed(2)}` });
  check('"Сега" brings live weather from Open-Meteo', !!now.live && /Open-Meteo/.test(now.toast), { weather: now.weather, live: now.live, toast: now.toast });
  // frame export
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('#shotBtn')]);
  check('"Запази кадър" downloads a PNG of the current frame', !!dl && /^sofia-ndk-.*.png$/.test(dl.suggestedFilename()), dl && dl.suggestedFilename());
  // optional evening photographs are picked up as soon as the scene lists them (simulated here by aliasing the dawn photos)
  const opt = await page.evaluate(async () => { const a = window.__app, s = a.scene, st = a.state; const before = (st.setSeason('summer'), st.setWeather('clear'), st.setHour(st.times.set - 0.25), st.settle(), await new Promise(r => setTimeout(r, 400)), a.comp.blend.anchoredSide);
    for (const [e, d] of [['evening-golden', 'dawn-golden'], ['evening-bluehour', 'dawn-bluehour']]) s.photos[e] = { ...s.photos[d], id: e, tex: null, state: 'idle', promise: null };
    const t0 = performance.now(); while (performance.now() - t0 < 8000 && !a.comp.blend.anchoredSide) await new Promise(r => requestAnimationFrame(r));
    const after = { anchored: a.comp.blend.anchoredSide, wGold: +a.comp.blend.wGold.toFixed(2), morning: a.comp.blend.morning }; delete s.photos['evening-golden']; delete s.photos['evening-bluehour']; return { before, after }; });
  check('evening photos are used automatically once present; without them the evening is computed', opt.before === false && opt.after.anchored === true && opt.after.wGold > 0.5 && opt.after.morning === false, opt);
  // offline fallback
  await ctx.route('**/api.open-meteo.com/**', r => r.abort()); await page.click('#now'); await page.waitForFunction(() => !document.querySelector('#now').disabled, null, { timeout: 15000 }); await page.waitForTimeout(200);
  const off = await page.evaluate(() => document.querySelector('#toast').textContent); check('"Сега" offline fallback keeps time and explains', /не е достъпно/.test(off), off);
  await ctx.close();
}
// ---------- 3. lightning: flash rate, "Без проблясвания" ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } }), page = await ctx.newPage();
  await page.goto(base + '?qa=1&date=2026-07-15&h=16&w=storm', { waitUntil: 'load' }); await ready(page);
  const run = () => page.evaluate(async () => { const L = window.__app.life.lightning, c = window.__app.clock, times = []; let prev = 0, peak = 0; const t0 = performance.now(), n0 = L.count; let last = L.last;
    while (performance.now() - t0 < 14000) { await new Promise(r => requestAnimationFrame(r)); if (L.last !== last) { last = L.last; times.push(c.time); } peak = Math.max(peak, L.flash); }
    const gaps = times.slice(1).map((t, i) => t - times[i]); return { bolts: L.count - n0, minGap: gaps.length ? Math.min(...gaps) : null, peakFlash: peak, peakLevel: L.level }; });
  const a = await run();
  check('lightning: at most one flash per second (WCAG 2.3.1 allows three)', a.bolts >= 1 && (a.minGap === null || a.minGap >= 1.39) && a.peakFlash > 0.5, a);
  await page.keyboard.press('h'); await page.keyboard.press('h'); await page.click('#flashBtn');
  const b = await run();
  check('"Без проблясвания": bolts still come but nothing flashes', b.bolts >= 1 && b.peakFlash === 0 && (await page.evaluate(() => document.querySelector('#flashBtn').getAttribute('aria-pressed'))) === 'true', b);
  await ctx.close();
}
// ---------- 4. prefers-reduced-motion ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 }, reducedMotion: 'reduce' }), page = await ctx.newPage();
  await page.goto(base + '?intro=1&date=2026-10-20&h=16&w=storm', { waitUntil: 'load' }); await ready(page); await page.waitForTimeout(800);
  const r = await page.evaluate(async () => { const a = window.__app, d0 = a.life.rain.drops[0].y, carPos = () => JSON.stringify(a.life.traffic.lanes.map(l => l.cars.map(c => +c.s.toFixed(4)))), carN = a.life.traffic.count, c0 = carPos(), z0 = a.comp.view.zoom; await new Promise(r => setTimeout(r, 2500)); return { reduced: a.state.S.reducedMotion, demo: a.demo.on, rainFrozen: a.life.rain.drops[0].y === d0, carsFrozen: carN > 0 && carPos() === c0, cars: carN, zoomFixed: a.comp.view.zoom === z0 && z0 === 1.03, par: a.comp.view.par, flash: a.life.lightning.flash, intro: document.querySelector('#introText').textContent.includes('намалено движение') }; });
  check('reduced motion: no autoplay, no particles moving, no parallax or zoom, no flashes', r.reduced && !r.demo && r.rainFrozen && r.carsFrozen && r.zoomFixed && r.par[0] === 0 && r.flash === 0 && r.intro, r);
  await ctx.close();
}
// ---------- 5. contrast of interface text over the brightest and darkest states ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } }), page = await ctx.newPage(); const res = {};
  for (const [name, q] of [['brightest (winter noon fog)', 'date=2026-01-18&h=12.3&w=fog&fog=1'], ['darkest (winter night storm)', 'date=2026-01-18&h=2&w=storm']]) {
    await page.goto(base + '?qa=1&' + q, { waitUntil: 'load' }); await ready(page); await page.waitForFunction(() => Object.values(window.__app.scene.photos).every(p => p.state !== 'loading')); await page.waitForTimeout(900);
    const boxes = await page.evaluate(() => Object.fromEntries([['title', '.title'], ['panel', '#panel'], ['chip', '#demoBtn']].map(([k, s]) => { const r = document.querySelector(s).getBoundingClientRect(); return [k, [r.left, r.top, r.width, r.height]]; })));
    const shot = await page.screenshot(); const px = async (x, y) => { const { data } = await sharp(shot).extract({ left: Math.round(x), top: Math.round(y), width: 6, height: 6 }).resize(1, 1).raw().toBuffer({ resolveWithObject: true }); return [data[0], data[1], data[2]]; };
    // background sampled in text-free corners of each surface
    const bg = { title: await px(boxes.title[0] + boxes.title[2] - 12, boxes.title[1] + 8), panel: await px(boxes.panel[0] + boxes.panel[2] - 14, boxes.panel[1] + 8), chip: await px(boxes.chip[0] + boxes.chip[2] - 9, boxes.chip[1] + boxes.chip[3] / 2) };
    res[name] = { titleText: +contrast([241, 244, 248], bg.title).toFixed(2), titleMuted: +contrast([195, 202, 214], bg.title).toFixed(2), panelText: +contrast([241, 244, 248], bg.panel).toFixed(2), panelLabel: +contrast([195, 202, 214], bg.panel).toFixed(2), chipText: +contrast([241, 244, 248], bg.chip).toFixed(2), bg };
  }
  const worst = Math.min(...Object.values(res).flatMap(r => [r.titleText, r.titleMuted, r.panelText, r.panelLabel, r.chipText]));
  check('interface text contrast is AA (>= 4.5:1) over the brightest and darkest states', worst >= 4.5, { worst, ...res });
  await ctx.close();
}
// ---------- 6. frame cost on the real GPU ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } }), page = await ctx.newPage(); const perf = {};
  for (const [name, q] of [['summer noon clear', 'date=2026-07-15&h=13'], ['autumn storm (rain, leaves, clouds)', 'date=2026-10-20&h=16&w=storm'], ['winter night snow', 'date=2026-01-18&h=21&w=snow'], ['time playing (base pass every frame)', 'date=2026-07-15&h=19']]) {
    await page.goto(base + '?qa=1&ui=0&' + q, { waitUntil: 'load' }); await ready(page); await page.waitForFunction(() => Object.values(window.__app.scene.photos).every(p => p.state !== 'loading'));
    perf[name] = await page.evaluate(async playing => { const a = window.__app, gl = a.gl; if (playing) a.state.set('playing', true); const n0 = a.clock.frame, b0 = a.comp.baseRenders, t0 = performance.now(); let cpu = 0, frames = 0;
      await new Promise(res => { const tick = () => { if (performance.now() - t0 > 4000) return res(); requestAnimationFrame(tick); }; tick(); });
      // CPU+submit cost of one full frame (state, 3 passes, sprites), GPU flushed
      for (let i = 0; i < 60; i++) { const s = performance.now(); a.clock.step(1 / 60); gl.finish(); cpu += performance.now() - s; frames++; }
      return { fps: +((a.clock.frame - n0 - 60) / 4).toFixed(1), frameCostMs: +(cpu / frames).toFixed(2), sprites: a.life.sprites.n, baseRendersPerSec: +((a.comp.baseRenders - b0) / 5).toFixed(1), canvas: [a.gl.drawingBufferWidth, a.gl.drawingBufferHeight], quality: a.quality.name }; }, name.startsWith('time playing'));
  }
  // frameCostMs is the CPU/submit side only (ANGLE does not block in gl.finish); the fps figure is the real measurement, taken on a real GPU.
  const worstFps = Math.min(...Object.values(perf).map(p => p.fps));
  check('holds 60 fps at 1080p on the real GPU, in the heaviest states', worstFps >= 57, perf);
  out.renderer = await page.evaluate(() => { const gl = window.__app.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  await ctx.close();
}
await browser.close();
fs.mkdirSync('tests/qa-out', { recursive: true }); fs.writeFileSync('tests/qa-out/behaviour.json', JSON.stringify(out, null, 2));
console.log(out.failures.length ? `\n${out.failures.length} FAILED: ${out.failures.join('; ')}` : '\nall behaviour checks passed');
process.exit(out.failures.length ? 1 : 0);
