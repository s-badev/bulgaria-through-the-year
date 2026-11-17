import { SPECIAL_BASE, specialScene } from './registry.js';
import './scenes.css';

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
    const old = this.layers;
    this.layers = [layer];
    this.id = id;
    this.exiting = false;
    this.root.classList.add('is-active');
    this.layout();
    requestAnimationFrame(() => { layer.classList.add('is-visible'); old.forEach(node => node.classList.remove('is-visible')); });
    setTimeout(() => old.forEach(node => { node.querySelector('img')?.removeAttribute('src'); node.remove(); }), FADE_MS + 80);
    this.onChange(id);
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
      old.forEach(node => { node.querySelector('img')?.removeAttribute('src'); node.remove(); });
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
      for (const element of [layer.querySelector('picture'), layer.querySelector('.special-atmosphere')]) {
        Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${imageWidth}px`, height: `${imageHeight}px` });
      }
    }
  }

  capture() {
    const image = this.layers[0]?.querySelector('img');
    if (!image) return Promise.resolve(null);
    const output = document.createElement('canvas'), glCanvas = this.comp.gl.canvas;
    output.width = glCanvas.width; output.height = glCanvas.height;
    const rect = image.getBoundingClientRect(), scaleX = output.width / glCanvas.clientWidth, scaleY = output.height / glCanvas.clientHeight;
    output.getContext('2d').drawImage(image, rect.left * scaleX, rect.top * scaleY, rect.width * scaleX, rect.height * scaleY);
    return new Promise(resolve => output.toBlob(resolve, 'image/png'));
  }
}
