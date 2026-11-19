import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = `http://127.0.0.1:${process.argv[2] || process.env.QA_PORT || 8080}/`;
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

async function staticPhoto(page, label) {
  const photo = page.locator('.static-view img');
  await photo.waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('.static-view img');
    return image?.complete && image.naturalWidth > 0;
  });
  assert.match(await photo.getAttribute('src'), /^\/scenes\/ndk\/(photos\/|special\/)/, `${label}: scene photograph`);
  assert(await page.locator('.static-view #fallbackHour').count() === 1, `${label}: usable photographic time controls`);
  assert(await page.locator('.static-view #fallbackOther').count() === 1, `${label}: six-world entry available`);
  assert(await page.locator('.static-view .static-world-grid [data-special]').count() === 6, `${label}: all worlds registered`);
  assert(await page.locator('.static-view #fallbackHelp').count() === 1, `${label}: WebGL error information accessible`);
  assert.equal(await page.locator('canvas#gl').count(), 0, `${label}: no active canvas`);
  const rect = await photo.boundingBox();
  const size = page.viewportSize();
  assert.deepEqual(rect, { x: 0, y: 0, width: size.width, height: size.height }, `${label}: photograph fills viewport`);
  console.log(`PASS ${label}: photograph visible at ${size.width}x${size.height}`);
}

try {

  {
    // Explicit no-GPU path must preserve scene switching, clock and atmospheric buttons.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(base + '?lite=1&date=2026-11-19&h=14');
    await staticPhoto(page, 'desktop photographic fallback');
    await page.locator('#fallbackHour').fill('21');
    assert.equal(await page.locator('#fallbackTime').textContent(), '21:00', 'shared photographic clock follows slider');
    await page.locator('#fallbackOther').click();
    await page.locator('[data-special="planet"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('[data-special="planet"]').disabled);
    await page.locator('[data-special="planet"]').click();
    assert.equal(await page.locator('#fallbackSceneName').textContent(), 'Планета над София', 'world selector changes scene');
    await page.locator('#fallbackConditions [data-condition="storm"]').click();
    assert.equal(await page.locator('#fallbackConditions [data-condition="storm"]').getAttribute('aria-pressed'), 'true', 'planet storm available');
    await page.locator('#fallbackBack').click();
    assert.equal(await page.locator('#fallbackSceneName').textContent(), 'София · НДК и Витоша', 'return to original scene');
    await context.close();
  }

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
    assert.equal(await page.locator('.static-view').getAttribute('data-reason'), 'lite');
    assert.equal(await page.locator('#fallbackOther').count(), 1);
    await page.locator('.static-panel-toggle').tap();
    assert(await page.locator('.static-panel').isVisible(), 'lite mobile controls open');
    await page.locator('.static-panel-toggle').tap();
    assert(!(await page.locator('.static-panel').isVisible()), 'lite mobile controls close');
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
        return kind === 'webgl2' && !sessionStorage.getItem('qa-context-restored') ? null : original.call(this, kind, ...args);
      };
    });
    await page.goto(base + '?qa=1');
    await staticPhoto(page, 'WebGL2 unavailable');
    assert.equal(await page.locator('.static-view').getAttribute('data-reason'), 'webgl-unavailable');
    await page.evaluate(() => sessionStorage.setItem('qa-context-restored', '1'));
    await page.locator('#fallbackHelp').tap();
    await page.getByRole('button', { name: 'Опитай интерактивния режим' }).tap();
    await page.waitForFunction(() => window.__app?.clock.frame > 3);
    assert.equal(await page.locator('.static-view').count(), 0, 'explicit retry returns to WebGL when the context becomes available');
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
    assert.equal(await page.locator('.static-view').getAttribute('data-reason'), 'context-create');
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const logs = [];
    page.on('console', message => { if (message.type() === 'error') logs.push(message.text()); });
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        const gl = original.call(this, kind, ...args);
        if (kind === 'webgl2' && gl) {
          const shaderSource = gl.shaderSource.bind(gl);
          gl.shaderSource = (shader, text) => shaderSource(shader, gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER
            ? '#version 300 es\nprecision highp float;\nQA_SHADER_SYNTAX_ERROR' : text);
        }
        return gl;
      };
    });
    await page.goto(base + '?qa=1');
    await staticPhoto(page, 'shader compilation failure');
    assert.equal(await page.locator('.static-view').getAttribute('data-reason'), 'shader-compile');
    assert(logs.some(line => line.includes('shader-compile') && line.includes('QA_SHADER_SYNTAX_ERROR')), JSON.stringify(logs));
    await page.locator('#fallbackHelp').click();
    assert.match(await page.locator('.static-detail').textContent(), /шейдър/);
    assert.doesNotMatch(await page.locator('.static-detail').textContent(), /QA_SHADER_SYNTAX_ERROR/);
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
    assert.equal(await page.locator('.static-view').getAttribute('data-reason'), 'framebuffer');
    await context.close();
  }

  {
    const page = await browser.newPage();
    const logs = [];
    page.on('console', message => { if (message.type() === 'warning') logs.push(message.text()); });
    await page.route('**/traffic.json*', route => route.fulfill({ status: 503, body: 'QA traffic unavailable' }));
    await page.goto(base + '?qa=1&date=2026-07-15&h=12');
    await page.waitForFunction(() => window.__app?.clock.frame > 3);
    assert(logs.some(line => line.includes('recoverable: true') && line.includes('/traffic.json: HTTP 503')), JSON.stringify(logs));
    assert.equal(await page.evaluate(() => window.__app.life.traffic), null);
    await page.evaluate(() => { window.__app.life.draw = () => { throw new Error('QA optional life effect'); }; });
    await page.waitForFunction(() => window.__app?.clock.frame > 12 || document.querySelector('.static-view'));
    assert.equal(await page.locator('.static-view').count(), 0);
    assert.equal(logs.filter(line => line.includes('QA optional life effect')).length, 1, 'the failing effect does not retry');
    await page.close();
    console.log('PASS missing traffic data and throwing optional effect preserve WebGL');
  }

  for (const [pattern, reason] of [['**/masks-a.png*', 'scene-resource'], ['**/assets/main-*.js', 'module-load']]) {
    const page = await browser.newPage();
    await page.route(pattern, route => route.fulfill({ status: 503, body: 'QA resource unavailable' }));
    await page.goto(base + '?qa=1');
    await staticPhoto(page, reason);
    assert.equal(await page.locator('.static-view').getAttribute('data-reason'), reason);
    await page.close();
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
        window.__app.state.setHour(14.25);
        const gl = window.__app.gl;
        const extension = gl.getExtension('WEBGL_lose_context');
        if (extension) extension.loseContext();
        else document.querySelector('#gl').dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      });
      await staticPhoto(page, 'WebGL context lost');
      assert.equal(await page.locator('.static-view').getAttribute('data-reason'), 'context-lost');
      assert.equal(await page.locator('#fallbackTime').textContent(), '14:15');
      assert.equal(await page.evaluate(() => window.savedClock.running), false, 'render loop stops after context loss');
    }
    await context.close();
  }
} finally {
  await browser.close();
}
