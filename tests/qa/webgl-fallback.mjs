import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:8080/';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

async function staticPhoto(page, label) {
  const photo = page.locator('.static-view img');
  await photo.waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('.static-view img');
    return image?.complete && image.naturalWidth > 0;
  });
  assert.equal(await photo.getAttribute('src'), '/scenes/ndk/photos/master.webp', `${label}: original photograph`);
  assert.match(await page.locator('.static-view [role="status"]').textContent(), /Статична снимка|Показвам статична снимка/);
  assert.equal(await page.locator('canvas#gl').count(), 0, `${label}: no active canvas`);
  const rect = await photo.boundingBox();
  const size = page.viewportSize();
  assert(rect && rect.width >= size.width && rect.height >= size.height, `${label}: photograph fills viewport`);
  console.log(`PASS ${label}: photograph visible at ${size.width}x${size.height}`);
}

try {
  for (const [width, height] of [[360, 640], [390, 844], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const requests = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await page.addInitScript(() => {
      window.webglAttempts = 0;
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        if (kind === 'webgl2') { window.webglAttempts++; throw new Error('WebGL must not start in lite mode'); }
        return original.call(this, kind, ...args);
      };
    });
    await page.goto(base + '?lite=1');
    await staticPhoto(page, 'lite');
    assert.equal(await page.evaluate(() => window.webglAttempts), 0, 'lite never requests WebGL2');
    assert(!requests.some(path => /scene\.json|masks-|geo\.png|clouds-|\/main-[^/]+\.js/.test(path)), 'lite skips scene data and renderer bundle');
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return kind === 'webgl2' ? null : original.call(this, kind, ...args);
      };
    });
    await page.goto(base + '?qa=1');
    await staticPhoto(page, 'WebGL2 unavailable');
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        if (kind === 'webgl2') throw new Error('Deliberate QA initialization failure');
        return original.call(this, kind, ...args);
      };
    });
    await page.goto(base + '?qa=1');
    await staticPhoto(page, 'WebGL initialization failure');
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        const gl = original.call(this, kind, ...args);
        if (kind === 'webgl2' && gl) {
          const parameter = gl.getShaderParameter.bind(gl);
          gl.getShaderParameter = (shader, name) => name === gl.COMPILE_STATUS ? false : parameter(shader, name);
          gl.getShaderInfoLog = () => 'Deliberate QA shader failure';
        }
        return gl;
      };
    });
    await page.goto(base + '?qa=1');
    await staticPhoto(page, 'shader compilation failure');
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        const gl = original.call(this, kind, ...args);
        if (kind === 'webgl2' && gl) gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_UNSUPPORTED;
        return gl;
      };
    });
    await page.goto(base + '?qa=1');
    await staticPhoto(page, 'framebuffer initialization failure');
    await context.close();
  }

  for (const [width, height] of [[390, 844], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(base + '?qa=1&still=1&reduce=1&date=2026-04-22&h=12');
    await page.waitForFunction(() => window.__app?.clock.frame > 3);
    assert.equal(await page.locator('.static-view').count(), 0, 'interactive scene stays interactive');
    assert(await page.locator('#mobileOpen').isVisible(), 'mobile controls remain available');
    await page.locator('#mobileOpen').click();
    assert(await page.locator('#panel').isVisible(), 'mobile controls still open');
    await page.locator('#mobileDone').click();
    assert(!(await page.locator('#panel').isVisible()), 'mobile controls still close');
    console.log(`PASS interactive mobile ${width}x${height}`);
    if (width === 390) {
      await page.evaluate(() => {
        window.savedClock = window.__app.clock;
        const gl = window.__app.gl;
        const extension = gl.getExtension('WEBGL_lose_context');
        if (extension) extension.loseContext();
        else document.querySelector('#gl').dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      });
      await staticPhoto(page, 'WebGL context lost');
      assert.equal(await page.evaluate(() => window.savedClock.running), false, 'render loop stops after context loss');
    }
    await context.close();
  }
} finally {
  await browser.close();
}
