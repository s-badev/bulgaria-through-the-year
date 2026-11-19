import { SPECIAL_BASE, specialScene } from './registry.js';
import { SpecialEffects } from './effects.js';
import { SpecialLighting, paintSpecialLighting } from './lighting.js';
import { SpecialPlates } from './plates.js';
import { reportSceneError } from '../diagnostics.js';
import './scenes.css';
import './lighting.css';

const FADE_MS = 480;

/** A photographic layer in the compositor's image coordinates, without another GPU texture. */
export class SpecialScenes {
  constructor(app, comp, state, onChange, signal) {
    this.comp = comp;
    this.state = state;
    this.onChange = onChange;
    this.signal = signal;
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
    if (!this.manifestPromise) this.manifestPromise = fetch(`${SPECIAL_BASE}manifest.json`, { signal: this.signal }).then(response => {
      if (!response.ok) throw new Error(`special manifest ${response.status}`);
      return response.json();
    }).catch(error => {
      if (!this.signal.aborted) reportSceneError(error, 'special-manifest', true, 'scene-resource');
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
    if (this.signal.aborted) return false;
    const asset = manifest.scenes[id];
    if (!definition || !asset) throw new Error('Сцената все още няма предоставена снимка.');
    if (this.id === id && !this.exiting) return true;
    const request = ++this.sequence;
    this.pendingPlates?.destroy();
    const layer = document.createElement('div');
    layer.className = `special-world-layer special-${definition.animation}`;
    const plates = new SpecialPlates(definition, asset, layer);
    this.pendingPlates = plates;
    const ready = await plates.initialize(this.state.sun, this.setting(id));
    if (request !== this.sequence) { plates.destroy(); return false; }
    this.pendingPlates = null;
    if (!ready) { plates.destroy(); throw new Error('Снимката на сцената не можа да се зареди.'); }
    layer.plates = plates;
    const atmosphere = document.createElement('div');
    atmosphere.className = 'special-atmosphere';
    layer.append(atmosphere);
    this.root.append(layer);
    layer.effects = new SpecialEffects(id, layer);
    layer.lighting = new SpecialLighting(id, layer);
    if (this.fadingLayer) this.removeLayer(this.fadingLayer);
    const old = this.layers;
    this.layers = [layer];
    this.id = id;
    this.exiting = false;
    this.root.classList.add('is-active');
    this.layout();
    this.fadingLayer = old[0];
    requestAnimationFrame(() => layer.classList.add('is-visible'));
    if (old[0]) setTimeout(() => this.removeLayer(old[0]), FADE_MS + 80);
    this.onChange(id);
    this.onSetting?.(this.setting());
    return true;
  }

  exit() {
    this.sequence++;
    this.pendingPlates?.destroy();
    this.pendingPlates = null;
    if (!this.id) return false;
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
    if (this.fadingLayer) this.removeLayer(this.fadingLayer);
    this.layers = [];
    old.forEach(node => node.classList.remove('is-visible'));
    setTimeout(() => {
      old.forEach(node => this.removeLayer(node));
      if (!this.id) this.root.classList.remove('is-active');
    }, FADE_MS + 80);
  }

  removeLayer(layer) {
    if (this.fadingLayer === layer) this.fadingLayer = null;
    if (!layer.isConnected) return;
    layer.effects.destroy();
    layer.plates.destroy();
    layer.remove();
  }

  destroy() {
    this.sequence++;
    this.pendingPlates?.destroy();
    this.pendingPlates = null;
    for (const layer of [...this.root.children]) this.removeLayer(layer);
    this.layers = [];
    this.inactiveWaiters.splice(0).forEach(resolve => resolve());
    this.root.remove();
  }

  layout() {
    if (!this.layers.length) return;
    const cov = this.comp.view.cov, zoom = this.comp.view.zoom;
    const { clientWidth: width, clientHeight: height } = this.comp.gl.canvas;
    const imageWidth = width * zoom / cov[2], imageHeight = height * zoom / cov[3];
    const left = -(0.5 + (cov[0] - 0.5) / zoom) * imageWidth;
    const top = -(0.5 + (cov[1] - 0.5) / zoom) * imageHeight;
    const geometry = `${left} ${top} ${imageWidth} ${imageHeight}`;
    for (const layer of [...this.layers, this.fadingLayer].filter(Boolean)) {
      if (layer.geometry === geometry) continue;
      layer.geometry = geometry;
      for (const element of [layer.plates.root, layer.querySelector('.special-atmosphere'), layer.lighting.root, layer.effects.canvas, layer.effects.lightning]) {
        if (!element) continue;
        Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${imageWidth}px`, height: `${imageHeight}px` });
      }
    }
  }

  update(dt, state, detail) {
    this.root.classList.toggle('is-reduced', state.S.reducedMotion);
    if (!this.active) return;
    const layer = this.layers[0], setting = this.setting();
    layer.plates.update(dt, state.sun, setting, state.S.reducedMotion);
    const photographicWeight = layer.plates.photographicWeight;
    const light = layer.lighting.update(state, setting, photographicWeight);
    light.nightPlate = layer.plates.nightWeight;
    if (layer.dataset.condition !== setting.condition) layer.dataset.condition = setting.condition;
    if (this.id === 'aurora') {
      const opacity = setting.condition === 'partly' ? .02 + light.night * .28 : .04 + light.night * .58;
      layer.style.setProperty('--special-aurora', opacity.toFixed(3));
    } else if (this.id === 'cyberpunk') {
      const opacity = (.08 + light.night * .52) * (1 - .84 * photographicWeight);
      layer.style.setProperty('--special-neon', opacity.toFixed(3));
    }
    light.flash = layer.effects.update(dt, detail, state.S.reducedMotion, state.S.flashes, setting, light) === true;
    return light;
  }

  capture() {
    const layer = this.layers[0];
    if (!layer) return Promise.resolve(null);
    const output = document.createElement('canvas'), glCanvas = this.comp.gl.canvas;
    output.width = glCanvas.width; output.height = glCanvas.height;
    const rect = layer.plates.root.getBoundingClientRect(), scaleX = output.width / glCanvas.clientWidth, scaleY = output.height / glCanvas.clientHeight;
    const context = output.getContext('2d');
    layer.plates.capture(context, rect.left * scaleX, rect.top * scaleY, rect.width * scaleX, rect.height * scaleY);
    context.save();
    context.translate(rect.left * scaleX, rect.top * scaleY);
    context.scale(rect.width * scaleX / 1672, rect.height * scaleY / 941);
    paintSpecialLighting(context, 1672, 941, layer.lighting.values);
    context.restore();
    const overlay = layer.effects?.canvas;
    if (overlay) context.drawImage(overlay, rect.left * scaleX, rect.top * scaleY, rect.width * scaleX, rect.height * scaleY);
    return new Promise(resolve => output.toBlob(resolve, 'image/png'));
  }
}
