// node tests/qa/eval.mjs <port> "<query>" "<js expression evaluated in page>"
import { chromium } from 'playwright';
const [port, q, expr] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text().slice(0, 800)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/?${q}&qa=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__app && window.__app.clock.frame > 5, null, { timeout: 60000 });
await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
await browser.close();
