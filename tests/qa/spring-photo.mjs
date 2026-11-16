import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:8080/';
const out = 'docs/screenshots/spring';
const states = [
  ['winter', '2026-01-18'], ['winter-spring', '2026-03-16'],
  ['spring', '2026-04-22'], ['spring-summer', '2026-06-04'],
  ['summer', '2026-07-15'], ['summer-autumn', '2026-09-27'],
  ['autumn', '2026-10-20'],
];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];
const context = await browser.newContext({ viewport: { width: 960, height: 540 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

async function ready(p) {
  await p.waitForFunction(() => window.__app && window.__app.clock.frame > 3);
  await p.waitForFunction(() => Object.values(window.__app.scene.photos).every(photo => photo.state !== 'loading'));
  await p.waitForTimeout(250);
}
async function state(p) {
  return p.evaluate(() => ({
    spring: window.__app.scene.photos.spring?.state,
    springSource: window.__app.scene.cfg.photos.spring?.src,
    season: window.__app.state.season,
    blend: [window.__app.comp.blend.sA, window.__app.comp.blend.sB, window.__app.comp.blend.sT],
    crop: window.__app.comp.view.cov,
  }));
}
async function imageDiff(a, b, area) {
  const x = await sharp(a).extract(area).removeAlpha().raw().toBuffer();
  const y = await sharp(b).extract(area).removeAlpha().raw().toBuffer();
  assert.equal(x.length, y.length);
  let sum = 0; for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

try {
  const cfg = JSON.parse(fs.readFileSync('public/scenes/ndk/scene.json', 'utf8'));
  assert.equal(cfg.photos.spring.src, 'photos/spring');
  assert.equal(cfg.photos.spring.season, 'spring');
  for (const format of ['avif', 'webp']) {
    const file = `public/scenes/ndk/photos/spring.${format}`;
    const meta = await sharp(file).metadata();
    assert.deepEqual([meta.width, meta.height], cfg.size, `${format} matches the scene geometry`);
    const response = await page.request.get(`${base}scenes/ndk/photos/spring.${format}`);
    assert.equal(response.status(), 200, `${format} is in the production build`);
  }
  const alignmentFile = 'assets/source/work/alignment.json';
  if (fs.existsSync(alignmentFile)) {
    const a = JSON.parse(fs.readFileSync(alignmentFile, 'utf8')).variants.spring;
    assert(Math.hypot(a.global.dx, a.global.dy) < 0.25 && a.p95Local < 0.5 && a.maxAnchor < 0.5, 'spring landmarks align with master');
    console.log(`PASS alignment: global ${a.global.dx.toFixed(3)},${a.global.dy.toFixed(3)} px; local p95 ${a.p95Local.toFixed(3)} px`);
  }

  let springPng, referenceCrop;
  for (const [name, date] of states) {
    await page.goto(`${base}?qa=1&ui=0&still=1&reduce=1&flash=0&date=${date}&h=12&w=clear`);
    await ready(page);
    const s = await state(page);
    assert.equal(s.springSource, 'photos/spring');
    if (s.season.spring > 0) assert.equal(s.spring, 'ready', `${name}: spring texture is ready`);
    if (referenceCrop) assert.deepEqual(s.crop, referenceCrop, `${name}: identical photograph framing`);
    else referenceCrop = s.crop;
    if (name === 'spring') assert.equal(s.season.spring, 1, 'spring uses pure spring weight');
    if (name === 'winter-spring') assert(s.season.winter > 0 && s.season.spring > 0, 'winter/spring blend');
    if (name === 'spring-summer') assert(s.season.spring > 0 && s.season.summer > 0, 'spring/summer blend');
    if (name === 'summer-autumn') assert(s.season.summer > 0 && s.season.autumn > 0, 'summer/autumn blend');
    const png = await page.screenshot({ type: 'png' });
    if (name === 'spring') springPng = png;
    await sharp(png).jpeg({ quality: 48 }).toFile(path.join(out, `${name}.jpg`));
    console.log(`PASS ${name}: ${s.blend[0]} → ${s.blend[1]} ${s.blend[2].toFixed(3)}`);
  }

  await page.goto(`${base}?qa=1&ui=0&still=1&reduce=1&flash=0&date=2026-04-22&h=12&w=clear`);
  await ready(page);
  assert.equal((await state(page)).spring, 'ready');
  const photo = await page.screenshot({ type: 'png' });
  await page.evaluate(() => {
    const comp = window.__app.comp, original = comp.requestPhotos.bind(comp);
    comp.requestPhotos = (...args) => ({ ...original(...args), spring: false });
    comp.prevKey = '';
  });
  await page.waitForTimeout(150);
  const fallback = await page.screenshot({ type: 'png' });
  await sharp(fallback).jpeg({ quality: 48 }).toFile(path.join(out, 'procedural-fallback-reference.jpg'));
  const treeArea = { left: 0, top: 300, width: 300, height: 230 };
  const trees = await imageDiff(photo, fallback, treeArea);
  assert(trees > 6, `spring image changes the tree region (${trees.toFixed(1)}/255)`);
  console.log(`PASS photographic spring versus procedural fallback: tree difference ${trees.toFixed(1)}/255`);
  assert(springPng, 'spring screenshot captured');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const mobilePage = await mobile.newPage();
  mobilePage.on('pageerror', error => errors.push(error.message));
  for (const [name, date] of [['spring', '2026-04-22'], ['summer', '2026-07-15']]) {
    await mobilePage.goto(`${base}?qa=1&still=1&reduce=1&date=${date}&h=12&w=clear`);
    await ready(mobilePage);
    const fps = await mobilePage.evaluate(async () => {
      const startFrame = window.__app.clock.frame, start = performance.now();
      await new Promise(resolve => setTimeout(resolve, 1500));
      return (window.__app.clock.frame - startFrame) * 1000 / (performance.now() - start);
    });
    assert(fps >= 45, `${name}: mobile frame rate ${fps.toFixed(1)} fps`);
    console.log(`PASS mobile ${name} 390x844: ${fps.toFixed(1)} fps`);
  }
  await mobile.close();
  assert.deepEqual(errors, [], 'no browser console or page errors');
} finally { await context.close(); await browser.close(); }
