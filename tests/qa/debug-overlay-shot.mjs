// Dev build only: screenshot of the traffic debug overlay (key D) over the photograph -> docs/traffic/debug-overlay.png
import { chromium } from 'playwright';
import sharp from 'sharp';
const port = +(process.argv[2] || 5199);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1672, height: 941 }, deviceScaleFactor: 1 })).newPage();
await page.goto(`http://127.0.0.1:${port}/?qa=1&ui=0&still=1&date=2026-07-15&h=13`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__app && window.__app.debug && window.__app.clock.frame > 30, null, { timeout: 60000 });
await page.waitForTimeout(1200); await page.keyboard.press('d'); await page.waitForTimeout(400);
const shot = await page.screenshot(); await browser.close();
await sharp(shot).extract({ left: 196, top: 400, width: 180, height: 180 }).resize(720, 720, { kernel: 'cubic' }).png().toFile('docs/traffic/debug-overlay.png');
console.log('written docs/traffic/debug-overlay.png');
