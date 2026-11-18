import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = `http://127.0.0.1:${process.argv[2] || 8080}/`;
const out = 'tests/qa-out/moon-phases';
const phases = [
  ['new', 15, 0], ['waxing-crescent', 18, .11], ['first-quarter', 22, .49],
  ['waxing-gibbous', 26, .87], ['full', 29, 1], ['waning-gibbous', 4, .83],
  ['last-quarter', 7, .53], ['waning-crescent', 11, .15],
];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

async function capture(page, name, day, hour = 2, cloud = .04) {
  const position = await page.evaluate(({ day, hour, cloud }) => {
    const { state, comp, gl } = window.__app;
    state.setDate(2026, 6, day);
    state.setHour(hour);
    state.settle();
    state.V.cloud = cloud;
    comp.render(state.snapshot(), 0, { reducedMotion: true });
    const [x, y, phase, visibility] = gl.getUniform(comp.pComp.program, comp.pComp.uniforms.uMoon.loc);
    const { cov, zoom } = comp.view;
    const radius = .024 / cov[3] * zoom * innerHeight;
    return {
      x: ((x - .5) * zoom + .5 - cov[0]) / cov[2] * innerWidth,
      y: ((y - .5) * zoom + .5 - cov[1]) / cov[3] * innerHeight,
      phase, visibility, radius,
    };
  }, { day, hour, cloud });
  const width = page.viewportSize().width;
  const shot = await page.screenshot({ scale: 'css', path: `${out}/${width}-${name}.png` });
  const size = Math.ceil(position.radius * 2.7);
  const rect = { left: Math.round(position.x - size / 2), top: Math.round(position.y - size / 2), width: size, height: size };
  await sharp(shot).extract(rect).png().toFile(`${out}/${width}-${name}-crop.png`);
  const sameScene = await page.evaluate(checkWholeFrame => {
    const { comp, state, gl } = window.__app;
    const texture = comp.moonTexture;
    const render = () => comp.render(state.snapshot(), 0, { reducedMotion: true });
    const pixels = () => {
      const { drawingBufferWidth: w, drawingBufferHeight: h } = gl;
      const rgba = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return rgba;
    };
    // Compare both frames in the same task so background photo uploads
    // cannot change the main simulation between reads.
    if (checkWholeFrame) render();
    const withMoon = checkWholeFrame ? pixels() : null;
    comp.moonTexture = null;
    render();
    comp.moonTexture = texture;
    return withMoon ? pixels().every((value, index) => value === withMoon[index]) : false;
  }, position.visibility === 0 || cloud === 1);
  const skyShot = await page.screenshot({ scale: 'css' });
  const pixels = buffer => sharp(buffer).extract(rect).removeAlpha().raw().toBuffer();
  const [image, sky] = await Promise.all([pixels(shot), pixels(skyShot)]);
  let disc = 0, direct = 0, horizontal = 0, contrast = 0, shadowTotal = 0, shadowCount = 0;
  const textures = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + rect.left + .5 - position.x) / position.radius;
    const dy = (y + rect.top + .5 - position.y) / position.radius;
    const r = Math.hypot(dx, dy);
    const i = (y * size + x) * 3;
    const redDelta = image[i] - sky[i];
    assert(image[i] < 250 || sky[i] >= 250, `${name}: no new clipped highlights`);
    if (r > 1.12) assert(redDelta <= 2, `${name}: no broad glow outside the limb`);
    if (r > 1) continue;
    disc++;
    contrast += Math.max(0, redDelta);
    if (redDelta > 45) { direct++; horizontal += dx; }
    if (.35 < r && r < .7) textures.push(image[i]);
    const shadowX = position.phase > .5 ? dx : -dx;
    if (shadowX > .25 && shadowX < .62 && Math.abs(dy) < .42) {
      shadowCount++;
      shadowTotal += redDelta;
    }
  }
  textures.sort((a, b) => a - b);
  const spread = textures[Math.floor(textures.length * .9)] - textures[Math.floor(textures.length * .1)];
  return {
    ...position, direct: direct / disc, side: horizontal / Math.max(1, direct),
    earthshine: shadowTotal / shadowCount, contrast: contrast / disc, spread,
    sameScene,
  };
}

try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const mobile = width < 500;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}?qa=1&still=1&ui=0&date=2026-07-29&h=2&w=clear`);
    await page.waitForFunction(() => !!window.__app?.comp?.moonTexture && !!window.__app.scene.photos.night?.tex);
    await page.evaluate(() => { window.__app.clock.stop(); document.querySelector('.loading')?.remove(); });
    let full, crescent, quarter;
    for (const [name, day, fraction] of phases) {
      const result = await capture(page, name, day);
      if (name === 'new') assert(result.visibility === 0 && result.sameScene, `new Moon leaves the normal frame pixel identical: ${JSON.stringify(result)}`);
      else assert(Math.abs(result.direct - fraction) < (fraction < .2 ? .065 : .14), `${name}: expected illuminated fraction near ${fraction}, got ${result.direct}`);
      if (fraction > 0 && fraction < .9) {
        assert(result.side * (result.phase < .5 ? 1 : -1) > .05, `${name}: illumination is on the correct side`);
      }
      if (name === 'full') {
        full = result;
        assert(result.spread > 35, 'real maria and highlands retain tone variation at native size');
      }
      if (name === 'waxing-crescent') crescent = result;
      if (name === 'first-quarter') quarter = result;
      const shadow = fraction > 0 && fraction < .6 ? `, shadow contrast ${result.earthshine.toFixed(1)}` : '';
      console.log(`${width} ${name}: lit ${(result.direct * 100).toFixed(1)}%${shadow}`);
    }
    assert(crescent.earthshine > 7 && crescent.earthshine < 35, 'crescent Earthshine is visible and subdued');
    assert(quarter.earthshine < crescent.earthshine * .6, 'quarter Earthshine falls away');
    const day = await capture(page, 'day', 21, 14);
    const twilight = await capture(page, 'twilight', 21, 21.25);
    assert(day.contrast > 2 && day.contrast < twilight.contrast && Math.abs(day.earthshine) < 2, 'daylight Moon is subdued and has no visible Earthshine');
    const partly = await capture(page, 'partly-cloudy', 29, 2, .74);
    const dense = await capture(page, 'dense-cloud', 29, 2, 1);
    assert(partly.contrast > 5 && partly.contrast < full.contrast * .8, 'partial cloud reduces Moon contrast');
    assert(dense.sameScene, 'dense clouds hide the Moon completely');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${width}x${height}: eight phases, texture, Earthshine, lighting and clouds`);
  }
} finally { await browser.close(); }
