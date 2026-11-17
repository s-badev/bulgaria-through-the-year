import { SPECIAL_BASE, specialScene } from './registry.js';
import { SpecialEffects } from './effects.js';
import { SpecialLighting } from './lighting.js';
import './scenes.css';
import './lighting.css';

const FADE_MS = 480;

/** A photographic layer in the compositor's image coordinates, without another GPU texture. */
export class SpecialScenes {
  constructor(app, comp, onChange = () => {}) {
    this.app = app;
    this.comp = comp;
    this.onChange = onChange;
    this.id = null;
    this.exiting = false;
    this.sequence = 0;
    this.layers = [];
    this.inactiveWaiters = [];
    this.manifest = null;
    this.settings = new Map();
    this.root = document.createElement('div');
    this.root.className = 'special-world';
    this.root.setAttribute('aria-hidden', 'true');
    app.append(this.root);
  }

  async loadManifest() {
    if (this.manifest) return this.manifest;
    if (!this.manifestPromise) this.manifestPromise = fetch(`${SPECIAL_BASE}manifest.json`).then(response => {
      if (!response.ok) throw new Error(`special manifest ${response.status}`);
      return response.json();
    }).catch(error => {
      console.error(error);
      return { version: 1, scenes: {} };
    });
    this.manifest = await this.manifestPromise;
    return this.manifest;
  }

  get active() { return !!this.id && !this.exiting; }
  get renderNormal() { return !this.id || this.exiting; }
  whenInactive() { return this.id ? new Promise(resolve => this.inactiveWaiters.push(resolve)) : Promise.resolve(); }
  setting(id = this.id) {
    if (!id) return null;
    if (!this.settings.has(id)) this.settings.set(id, { condition: specialScene(id).defaultCondition, intensity: .55 });
    return this.settings.get(id);
  }
  setCondition(condition) {
    const scene = specialScene(this.id);
    if (!scene?.conditions.some(([value]) => value === condition)) return false;
    this.setting().condition = condition;
    this.onSetting?.(this.setting());
    return true;
  }
  setIntensity(value) {
    if (!this.id) return false;
    this.setting().intensity = Math.max(0, Math.min(1, +value || 0));
    this.onSetting?.(this.setting());
    return true;
  }

  async select(id) {
    const definition = specialScene(id);
    const manifest = await this.loadManifest();
    const asset = manifest.scenes[id];
    if (!definition || !asset) throw new Error('Сцената все още няма предоставена снимка.');
    if (this.id === id && !this.exiting) return true;
    const request = ++this.sequence;
    const layer = document.createElement('div');
    layer.className = `special-world-layer special-${definition.animation}`;
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.type = 'image/avif';
    source.srcset = `${SPECIAL_BASE}${asset.avif}?v=${asset.hash.slice(0, 12)}`;
    const image = document.createElement('img');
    image.src = `${SPECIAL_BASE}${asset.webp}?v=${asset.hash.slice(0, 12)}`;
    image.alt = definition.name;
    image.decoding = 'async';
    picture.append(source, image);
    layer.append(picture);
    const atmosphere = document.createElement('div');
    atmosphere.className = 'special-atmosphere';
    layer.append(atmosphere);
    this.root.append(layer);
    try {
      await image.decode();
    } catch {
      source.remove();
      image.src = `${SPECIAL_BASE}${asset.source}?v=${asset.hash.slice(0, 12)}`;
      try { await image.decode(); } catch { layer.remove(); throw new Error('Снимката на сцената не можа да се зареди.'); }
    }
    if (request !== this.sequence) { layer.remove(); return false; }
    layer.effects = new SpecialEffects(id, layer);
    layer.lighting = new SpecialLighting(id, layer);
    layer.asset = asset;
    const old = this.layers;
    this.layers = [layer];
    this.id = id;
    this.exiting = false;
    this.root.classList.add('is-active');
    this.layout();
    requestAnimationFrame(() => { layer.classList.add('is-visible'); old.forEach(node => node.classList.remove('is-visible')); });
    setTimeout(() => old.forEach(node => { node.effects?.destroy(); node.querySelector('img')?.removeAttribute('src'); node.remove(); }), FADE_MS + 80);
    this.onChange(id);
    this.onSetting?.(this.setting());
    return true;
  }

  exit() {
    if (!this.id) return false;
    this.sequence++;
    this.exiting = true;
    this.onChange(null);
    return true;
  }

  /** Called after the normal compositor has drawn a fresh frame behind the image. */
  normalFrameReady() {
    if (!this.exiting) return;
    this.exiting = false;
    this.id = null;
    this.inactiveWaiters.splice(0).forEach(resolve => resolve());
    const old = this.layers;
    this.layers = [];
    old.forEach(node => node.classList.remove('is-visible'));
    setTimeout(() => {
      old.forEach(node => { node.effects?.destroy(); node.querySelector('img')?.removeAttribute('src'); node.remove(); });
      if (!this.id) this.root.classList.remove('is-active');
    }, FADE_MS + 80);
  }

  layout() {
    if (!this.layers.length) return;
    const cov = this.comp.view.cov, zoom = this.comp.view.zoom;
    const width = this.app.clientWidth || innerWidth, height = this.app.clientHeight || innerHeight;
    const imageWidth = width * zoom / cov[2], imageHeight = height * zoom / cov[3];
    const left = -(0.5 + (cov[0] - 0.5) / zoom) * imageWidth;
    const top = -(0.5 + (cov[1] - 0.5) / zoom) * imageHeight;
    for (const layer of this.layers) {
      for (const element of [...layer.querySelectorAll('picture'), layer.querySelector('.special-atmosphere'), layer.lighting?.root, layer.effects?.canvas, layer.effects?.lightning]) {
        if (!element) continue;
        Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${imageWidth}px`, height: `${imageHeight}px` });
      }
    }
  }

  update(dt, state, detail) {
    this.root.classList.toggle('is-reduced', state.S.reducedMotion);
    if (!this.active) return;
    const layer = this.layers[0], setting = this.setting();
    const photographicNight = !!layer.asset.variants?.night && !!layer.variant && layer.variant.phase === 'night' && layer.variant.opacity > .5;
    const light = layer.lighting.update(state, setting, photographicNight);
    this.updateVariant(layer, light);
    layer.dataset.condition = setting.condition;
    layer.style.setProperty('--special-intensity', setting.intensity.toFixed(3));
    layer.effects.update(dt, detail, state.S.reducedMotion, state.S.flashes, setting, light);
    return light;
  }

  updateVariant(layer, light) {
    const definition = specialScene(this.id), variants = layer.asset.variants;
    if (!variants) return;
    const phase = light.night > .02 ? 'night' : light.day > .02 ? 'day' : 'dusk';
    const opacity = phase === 'night' ? light.night : phase === 'day' ? light.day : light.twilight;
    if (!variants[phase] || definition.basePhase === phase || opacity < .02) {
      if (layer.variant) layer.variant.picture.style.opacity = '0';
      return;
    }
    if (layer.variant?.phase === phase) { layer.variant.opacity = opacity; layer.variant.picture.style.opacity = opacity.toFixed(3); return; }
    if (layer.variantPending === phase) return;
    layer.variantPending = phase;
    const asset = variants[phase], picture = document.createElement('picture'), source = document.createElement('source'), image = document.createElement('img');
    source.type = 'image/avif'; source.srcset = `${SPECIAL_BASE}${asset.avif}?v=${asset.hash.slice(0, 12)}`;
    image.src = `${SPECIAL_BASE}${asset.webp}?v=${asset.hash.slice(0, 12)}`; image.alt = ''; image.decoding = 'async';
    picture.className = 'special-variant'; picture.append(source, image);
    image.decode().catch(async () => { source.remove(); image.src = `${SPECIAL_BASE}${asset.source}?v=${asset.hash.slice(0, 12)}`; await image.decode(); }).then(() => {
      if (!this.layers.includes(layer) || layer.variantPending !== phase) return;
      const old = layer.variant?.picture;
      layer.querySelector('picture').after(picture);
      layer.variant = { phase, picture, opacity };
      layer.variantPending = null;
      this.layout();
      requestAnimationFrame(() => { picture.style.opacity = opacity.toFixed(3); if (old) old.style.opacity = '0'; });
      if (old) setTimeout(() => old.remove(), FADE_MS + 80);
    }).catch(() => { layer.variantPending = null; });
  }

  capture() {
    const image = this.layers[0]?.querySelector('img');
    if (!image) return Promise.resolve(null);
    const output = document.createElement('canvas'), glCanvas = this.comp.gl.canvas;
    output.width = glCanvas.width; output.height = glCanvas.height;
    const rect = image.getBoundingClientRect(), scaleX = output.width / glCanvas.clientWidth, scaleY = output.height / glCanvas.clientHeight;
    const context = output.getContext('2d');
    context.drawImage(image, rect.left * scaleX, rect.top * scaleY, rect.width * scaleX, rect.height * scaleY);
    const overlay = this.layers[0]?.effects?.canvas;
    if (overlay) context.drawImage(overlay, rect.left * scaleX, rect.top * scaleY, rect.width * scaleX, rect.height * scaleY);
    return new Promise(resolve => output.toBlob(resolve, 'image/png'));
  }
}
