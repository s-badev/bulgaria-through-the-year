// Generates the public-facing images from the RUNNING site (production build served on a port):
//   docs/screenshots/*.jpg      README screenshots (each < 400 KB)
//   public/og-image.jpg         1200x630 social card (< 300 KB)
//   public/favicon.svg, favicon-32.png, apple-touch-icon.png
//   node tools/make-social-assets.mjs [--port 8080] [--icons-only]
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';

const i = process.argv.indexOf('--port'), port = i > 0 ? +process.argv[i + 1] : 8080, base = `http://127.0.0.1:${port}/`;
fs.mkdirSync('docs/screenshots', { recursive: true });

// ---------- icons ----------
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#27437f"/><stop offset=".62" stop-color="#d9826a"/><stop offset="1" stop-color="#f3b06a"/></linearGradient></defs>
<rect width="64" height="64" rx="14" fill="url(#g)"/>
<circle cx="43" cy="26" r="8" fill="#ffe3b0"/>
<path d="M0 49 17 31l9 9 12-17 26 27v5H0z" fill="#0b1220"/>
<path d="M9 50h46v3H9z" fill="#ffd9a0" opacity=".55"/>
</svg>
`;
fs.writeFileSync('public/favicon.svg', svg);
await sharp(Buffer.from(svg), { density: 600 }).resize(32, 32).png({ compressionLevel: 9 }).toFile('public/favicon-32.png');
await sharp(Buffer.from(svg), { density: 600 }).resize(180, 180).png({ compressionLevel: 9 }).toFile('public/apple-touch-icon.png');

if (process.argv.includes('--icons-only')) process.exit(0);

// ---------- screenshots ----------
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
async function shoot(file, { w, h, q, ui = 0, wait = 2600, overlay = false, maxKB = 380 }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 }), page = await ctx.newPage(), problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', e => problems.push(e.message));
  page.on('requestfailed', r => problems.push('failed ' + r.url()));
  await page.goto(`${base}?qa=1&still=1&ui=${ui}&${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && window.__app.clock.frame > 5, null, { timeout: 60000 });
  await page.waitForFunction(() => Object.values(window.__app.scene.photos).every(p => p.state !== 'loading'), null, { timeout: 60000 });
  await page.waitForTimeout(wait);
  if (overlay) await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:70px 48px 38px;background:linear-gradient(to top,rgba(5,7,13,.82),rgba(5,7,13,.45) 55%,rgba(5,7,13,0));color:#fff;z-index:40;font-family:"Manrope Variable",Manrope,system-ui,sans-serif';
    d.innerHTML = '<div style="font:400 54px/1.05 \'Iowan Old Style\',\'Palatino Linotype\',Palatino,Georgia,serif;text-shadow:0 2px 18px rgba(0,0,0,.6)">София · НДК и Витоша</div><div style="margin-top:10px;font-size:23px;font-weight:600;letter-spacing:.01em;color:#f1d9b4;text-shadow:0 1px 10px rgba(0,0,0,.7)">Жива снимка: час, сезони, време, трафик и звук</div>';
    document.body.append(d);
  });
  const png = await page.screenshot(); await ctx.close();
  let quality = q0(file), buf;
  do { buf = await sharp(png).jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer(); quality -= 6; } while (buf.length > maxKB * 1024 && quality > 40);
  fs.writeFileSync(file, buf);
  console.log(file.padEnd(40), (buf.length / 1024).toFixed(0).padStart(4), 'KB', problems.length ? 'PROBLEMS: ' + problems.join(' | ') : '');
}
const q0 = () => 82;
const S = 'date=2026-07-15';
await shoot('docs/screenshots/01-summer-noon.jpg', { w: 1440, h: 810, q: `${S}&h=13.3` });
await shoot('docs/screenshots/02-golden-evening.jpg', { w: 1440, h: 810, q: `${S}&h=20.45` });
await shoot('docs/screenshots/03-summer-night-traffic.jpg', { w: 1440, h: 810, q: `${S}&h=22.6` });
await shoot('docs/screenshots/04-autumn-fog.jpg', { w: 1440, h: 810, q: 'date=2026-10-20&h=9.2&w=fog&fog=0.75' });
await shoot('docs/screenshots/05-winter-snow.jpg', { w: 1440, h: 810, q: 'date=2026-01-18&h=14&w=snow' });
await shoot('docs/screenshots/06-controls.jpg', { w: 1440, h: 810, q: `${S}&h=21.3`, ui: 1, wait: 3200 });
await shoot('public/og-image.jpg', { w: 1200, h: 630, q: `${S}&h=20.35`, overlay: true, maxKB: 280 });
await browser.close();
for (const f of ['public/og-image.jpg']) { const m = await sharp(f).metadata(); console.log(f, m.width + 'x' + m.height); }
