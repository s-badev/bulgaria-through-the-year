// Scene loading. A scene is a folder: scene.json + photos + masks + depth/normals + geometry.
// Adding a scene (Veliko Tarnovo, Koprivshtitsa, ...) means dropping a new folder into public/scenes/.
import { createTexture, solidTexture } from '../render/gl.js';
import { SceneError, reportSceneError } from '../diagnostics.js';

let formatPromise = null;
/** Probe AVIF decoding once (tiny valid file); fall back to WebP. */
function pickFormat(formats) {
  if (!formats.includes('avif')) return Promise.resolve(formats[0]);
  if (!formatPromise) formatPromise = new Promise(res => {
    const img = new Image();
    img.onload = () => res(img.width > 0 ? 'avif' : 'webp'); img.onerror = () => res('webp');
    img.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';
  });
  return formatPromise;
}
async function loadResource(url, signal, read) {
  const path = new URL(url, location.href).pathname;
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await read(response);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new SceneError('scene-resource', 'scene', `${path}: ${error.message}`);
  }
}

export function loadBitmap(url, signal) {
  return loadResource(url, signal, async response => createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));
}

async function withBitmap(url, signal, use) {
  const bitmap = await loadBitmap(url, signal);
  try {
    if (!signal?.aborted) return use(bitmap);
  } finally { bitmap.close(); }
}

export async function loadScene(gl, id, { onProgress, signal } = {}) {
  const base = `${import.meta.env.BASE_URL}scenes/${id}/`;
  const ver = (typeof __SCENE_VERSIONS__ !== 'undefined' && __SCENE_VERSIONS__[id]) || '';   // content hash from the build: files may be cached for a year
  const url = f => base + f + (ver ? '?v=' + ver : '');
  const cfg = await loadResource(url('scene.json'), signal, response => response.json());
  const fmt = await pickFormat(cfg.formats);
  const scene = { id, cfg, base, url, fmt, signal, size: cfg.size, tex: {}, photos: {}, cpu: {}, traffic: null, black: solidTexture(gl, [0, 0, 0, 255], true), grey: solidTexture(gl, [128, 128, 128, 255]), clear: solidTexture(gl, [0, 0, 0, 0]) };
  let done = 0; const total = 6;
  const step = () => onProgress && onProgress(++done / total);

  // first paint needs: the master photo, the masks, the geometry texture
  const dataTex = (key, file) => withBitmap(url(file), signal, bitmap => {
    scene.tex[key] = createTexture(gl, bitmap, 'data');
    if (key === 'b' || key === 'c') scene.cpu[key] = bitmapPixels(bitmap, 4);
    step();
  });
  const traffic = cfg.traffic && Promise.allSettled([
    loadResource(url(cfg.traffic.data), signal, response => response.json()),
    withBitmap(url(cfg.traffic.road), signal, bitmap => {
      scene.tex.road = createTexture(gl, bitmap, 'data');
      scene.cpu.road = bitmapPixels(bitmap, 1);
    }),
    withBitmap(url(cfg.traffic.atlas), signal, bitmap => { scene.tex.cars = createTexture(gl, bitmap, 'atlas'); }),
  ]).then(results => {
    if (signal?.aborted) return;
    const failure = results.find(result => result.status === 'rejected');
    if (!failure) { scene.traffic = results[0].value; return; }
    for (const key of ['road', 'cars']) {
      if (scene.tex[key]) gl.deleteTexture(scene.tex[key]);
      delete scene.tex[key];
    }
    delete scene.cpu.road;
    reportSceneError(failure.reason, 'traffic', true, 'scene-resource');
  });
  for (const [idp, p] of Object.entries(cfg.photos)) scene.photos[idp] = { ...p, id: idp, tex: null, state: 'idle', lastUsed: 0 };
  await Promise.all([
    dataTex('a', cfg.masks.a), dataTex('b', cfg.masks.b), dataTex('c', cfg.masks.c), dataTex('d', cfg.masks.d), dataTex('geo', cfg.masks.geo),
    loadPhoto(gl, scene, 'master').then(step),
    traffic,
  ]);
  // cloud textures are small; load in the background
  scene.tex.deck = scene.grey; scene.tex.cumulus = scene.grey;
  for (const k of ['deck', 'cumulus']) withBitmap(url(cfg.clouds[k]), signal, bitmap => {
    scene.tex[k] = createTexture(gl, bitmap, 'tile'); scene.version++;
  }).catch(error => { if (!signal?.aborted) reportSceneError(error, 'clouds', true); });
  scene.version = 1;
  return scene;
}
/** Quarter-resolution CPU copy of a mask (for sprite visibility tests etc.). */
function bitmapPixels(bmp, div) {
  const w = Math.round(bmp.width / div), h = Math.round(bmp.height / div);
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, w, h);
  return { w, h, div, data: ctx.getImageData(0, 0, w, h).data };
}
export function sampleMask(cpu, x, y, channel) {
  if (!cpu) return 1;
  const ix = Math.min(cpu.w - 1, Math.max(0, Math.round(x / cpu.div))), iy = Math.min(cpu.h - 1, Math.max(0, Math.round(y / cpu.div)));
  return cpu.data[(iy * cpu.w + ix) * 4 + channel] / 255;
}

export function loadPhoto(gl, scene, id) {
  const p = scene.photos[id];
  if (!p) return Promise.resolve(null);
  if (p.state === 'ready') return Promise.resolve(p.tex);
  if (p.state === 'loading') return p.promise;
  p.state = 'loading';
  p.promise = withBitmap(scene.url(`${p.src}.${scene.fmt}`), scene.signal, bitmap => {
    p.tex = createTexture(gl, bitmap, 'photo'); p.state = 'ready'; scene.version = (scene.version || 0) + 1; return p.tex;
  }).catch(error => {
    p.state = 'error'; p.error = error;
    if (!scene.signal?.aborted && id !== 'master') reportSceneError(error, 'photo', true);
    return null;
  });
  return p.promise;
}
export function disposePhoto(gl, scene, id) {
  const p = scene.photos[id];
  if (p && p.state === 'ready' && id !== 'master') { gl.deleteTexture(p.tex); p.tex = null; p.state = 'idle'; scene.version++; }
}
export const photoReady = (scene, id) => scene.photos[id]?.state === 'ready';
