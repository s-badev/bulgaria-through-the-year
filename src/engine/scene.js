// Scene loading. A scene is a folder: scene.json + photos + masks + depth/normals + geometry.
// Adding a scene (Veliko Tarnovo, Koprivshtitsa, ...) means dropping a new folder into public/scenes/.
import { createTexture, solidTexture } from '../render/gl.js';

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
async function loadBitmap(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Не може да се зареди ${url} (${r.status})`);
  const blob = await r.blob();
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

export async function loadScene(gl, id, { onProgress } = {}) {
  const base = `${import.meta.env.BASE_URL}scenes/${id}/`;
  const cfg = await (await fetch(base + 'scene.json')).json();
  const fmt = await pickFormat(cfg.formats);
  const scene = { id, cfg, base, fmt, size: cfg.size, tex: {}, photos: {}, cpu: {}, traffic: null, black: solidTexture(gl, [0, 0, 0, 255], true), grey: solidTexture(gl, [128, 128, 128, 255]), clear: solidTexture(gl, [0, 0, 0, 0]) };
  let done = 0; const total = 6;
  const step = () => onProgress && onProgress(++done / total);

  // first paint needs: the master photo, the masks, the geometry texture
  const dataTex = async (key, file) => { const bmp = await loadBitmap(base + file); scene.tex[key] = createTexture(gl, bmp, 'data'); if (key === 'b' || key === 'c') scene.cpu[key] = bitmapPixels(bmp, 4); bmp.close(); step(); };
  for (const [idp, p] of Object.entries(cfg.photos)) scene.photos[idp] = { ...p, id: idp, tex: null, state: 'idle', lastUsed: 0 };
  await Promise.all([
    scene.loadPhoto = null,
    dataTex('a', cfg.masks.a), dataTex('b', cfg.masks.b), dataTex('c', cfg.masks.c), dataTex('d', cfg.masks.d), dataTex('geo', cfg.masks.geo),
    loadPhoto(gl, scene, 'master').then(step),
    // traffic: lanes + sprite metadata, the strict asphalt mask (also kept on the CPU for audits) and the atlas of real car sprites
    cfg.traffic ? Promise.all([fetch(base + cfg.traffic.data).then(r => r.json()), loadBitmap(base + cfg.traffic.road), loadBitmap(base + cfg.traffic.atlas)]).then(([data, road, atlas]) => {
      scene.traffic = data; scene.tex.road = createTexture(gl, road, 'data'); scene.cpu.road = bitmapPixels(road, 1); road.close(); scene.tex.cars = createTexture(gl, atlas, 'atlas'); atlas.close();
    }) : null,
  ]);
  // cloud textures are small; load in the background
  scene.tex.deck = scene.grey; scene.tex.cumulus = scene.grey;
  for (const k of ['deck', 'cumulus']) loadBitmap(base + cfg.clouds[k]).then(bmp => { scene.tex[k] = createTexture(gl, bmp, 'tile'); bmp.close(); scene.version++; }).catch(() => {});
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
  p.promise = loadBitmap(`${scene.base}${p.src}.${scene.fmt}`).then(bmp => {
    p.tex = createTexture(gl, bmp, 'photo'); bmp.close(); p.state = 'ready'; scene.version = (scene.version || 0) + 1; return p.tex;
  }).catch(err => { p.state = 'error'; p.error = err; console.error(err); return null; });
  return p.promise;
}
export function disposePhoto(gl, scene, id) {
  const p = scene.photos[id];
  if (p && p.state === 'ready' && id !== 'master') { gl.deleteTexture(p.tex); p.tex = null; p.state = 'idle'; scene.version++; }
}
export const photoReady = (scene, id) => scene.photos[id]?.state === 'ready';
