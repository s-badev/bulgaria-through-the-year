import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = `http://127.0.0.1:${process.argv[2] || 8080}/`;
const pass = process.argv[3] || 'after';
const directory = `tests/qa-out/moon-detail/${pass}`;
const cases = [
  ['day', '2026-07-21', 14, 'clear'],
  ['twilight', '2026-07-21', 21.25, 'clear'],
  ['22-full', '2026-07-28', 22, 'clear'],
  ['02-full', '2026-07-29', 2, 'clear'],
  ['quarter', '2026-07-21', 23.75, 'clear'],
  ['waning', '2026-07-06', 2, 'clear'],
  ['cloud-edge', '2026-07-29', 2, 'cloudy'],
];
fs.mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const handheld = width < 500;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: handheld ? 2 : 1, isMobile: handheld, hasTouch: handheld, reducedMotion: 'reduce' });
    const errors = [];
    let clearDiscContrast = 0;
    page.on('pageerror', error => errors.push(error.message));
    for (const [name, date, hour, weather] of cases) {
      await page.goto(`${base}?qa=1&still=1&ui=0&date=${date}&h=${hour}&w=${weather}`);
      await page.waitForFunction(() => window.__app?.clock.frame > 3 && !!window.__app.scene.photos.night?.tex);
      if (name === 'cloud-edge') await page.evaluate(() => { window.__app.state.V.cloud = .74; });
      if (pass === 'after') await page.waitForFunction(() => !!window.__app.comp.moonTexture);
      const frame = await page.evaluate(({ width, height, weather }) => {
        const { clock, comp, gl, state } = window.__app;
        clock.stop();
        if (weather === 'cloudy') state.V.cloud = .74;
        clock.step(0);
        document.querySelector('.loading')?.remove();
        const [x, y, phase, visibility] = gl.getUniform(comp.pComp.program, comp.pComp.uniforms.uMoon.loc);
        const { cov, zoom } = comp.view;
        return {
          x: ((x - .5) * zoom + .5 - cov[0]) / cov[2] * width,
          y: ((y - .5) * zoom + .5 - cov[1]) / cov[3] * height,
          diameter: .048 * zoom / cov[3] * height,
          phase, visibility, elevation: state.sun.elevation,
        };
      }, { width, height, weather });
      const path = `${directory}/${width}-${name}`;
      const shot = await page.screenshot({ scale: 'css', path: `${path}.png` });
      const crop = Math.ceil(frame.diameter * 1.5);
      const rect = { left: Math.round(frame.x - crop / 2), top: Math.round(frame.y - crop / 2), width: crop, height: crop };
      await sharp(shot).extract(rect).png().toFile(`${path}-crop.png`);

      if (pass === 'after') {
        assert(frame.visibility > .1, `${name} draws the Moon`);
        await page.evaluate(() => {
          const { clock, comp } = window.__app;
          comp.moonTexture = null;
          clock.step(0);
        });
        const withoutMoon = await page.screenshot({ scale: 'css' });
        const samples = await sharp(shot).extract(rect).removeAlpha().raw().toBuffer();
        const sky = await sharp(withoutMoon).extract(rect).removeAlpha().raw().toBuffer();
        let changed = 0, clipped = 0, contrast = 0;
        for (let i = 0; i < samples.length; i += 3) {
          if (samples[i] > sky[i] + 8 && samples[i + 1] > sky[i + 1] + 5) changed++;
          if (samples[i] > 250 && sky[i] < 250) clipped++;
          contrast += Math.max(0, samples[i] - sky[i]);
        }
        assert(changed > 20, `${width} ${name}: Moon has visible pixel contrast over the sky`);
        assert(clipped === 0, `${width} ${name}: no clipped lunar highlights`);
        if (name === '02-full') {
          assert(changed > Math.PI * frame.diameter ** 2 * .20, 'full lunar disc is visible at normal scale');
          clearDiscContrast = contrast;
        }
        if (name === 'cloud-edge') assert(contrast < clearDiscContrast * .9, 'passing clouds attenuate the disc');
      }
      console.log(`${pass} ${width} ${name}: ${frame.diameter.toFixed(1)} CSS px, sun ${frame.elevation.toFixed(1)}°, phase ${frame.phase.toFixed(3)}, visibility ${frame.visibility.toFixed(2)}`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  if (pass === 'after') {
    const page = await browser.newPage();
    let requests = 0;
    await page.route('**/moon-nearside-*.webp', route => {
      requests++;
      return route.abort();
    });
    await page.goto(`${base}?qa=1&still=1&date=2026-07-29&h=2&w=clear`);
    await page.waitForFunction(() => window.__app?.clock.frame > 30);
    assert.equal(requests, 1, 'optional texture is requested only once');
    assert(await page.evaluate(() => !window.__app.comp.moonTexture && !document.querySelector('.static-view')), 'the scene renders if the optional Moon download fails');
    await page.goto(`${base}?lite=1`);
    await page.locator('.static-view img').waitFor();
    assert.equal(requests, 1, 'lite mode never requests the lunar texture');
    await page.close();
  }
} finally {
  await browser.close();
}
