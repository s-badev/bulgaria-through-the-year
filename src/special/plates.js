import { solarMix } from './lighting.js';
import { SPECIAL_BASE } from './registry.js';

const PHASES = ['day', 'dusk', 'night'];
const MIN_WEIGHT = .002;
const MAX_CACHED = 4;

// Normalize the solar weights and shorten the part of twilight in which
// two independently photographed skylines are both strongly visible.
export function plateWeights(scene, asset, sun, setting, failed = new Set()) {
  const variants = asset.variants ?? {};
  const available = key => !failed.has(key) && !!variants[key];
  const base = failed.has('base') ? null : 'base';
  const phaseKey = phase => available(phase) ? phase : scene.basePhase === phase ? base : null;
  const keys = Object.fromEntries(PHASES.map(phase => [phase, phaseKey(phase)]));
  const solar = solarMix(sun);
  const weights = { day: solar.day, dusk: solar.twilight, night: solar.night };

  if (!keys.dusk && keys.day && keys.night) {
    const day = Math.max(0, Math.min(1, (sun.elevation + 9) / 12));
    weights.day += weights.dusk * day;
    weights.night += weights.dusk * (1 - day);
    weights.dusk = 0;
  }

  const result = new Map();
  const add = (key, weight) => {
    if (key && weight > 0) result.set(key, (result.get(key) ?? 0) + weight);
  };
  for (const phase of PHASES) {
    const key = keys[phase] ?? base ?? keys.day ?? keys.night ?? keys.dusk;
    const weight = weights[phase] ** 1.45;
    add(key, weight);
  }
  const sum = [...result.values()].reduce((a, b) => a + b, 0);
  for (const [key, weight] of result) result.set(key, weight / sum);
  return result;
}

function photoURL(asset, key) {
  return `${SPECIAL_BASE}${encodeURI(asset[key])}?v=${asset.hash.slice(0, 12)}`;
}

export class SpecialPlates {
  constructor(scene, asset, layer) {
    this.scene = scene;
    this.asset = asset;
    this.root = document.createElement('div');
    this.root.className = 'special-plates';
    layer.append(this.root);
    this.cache = new Map();
    this.visible = new Map();
    this.failed = new Set();
  }

  load(key) {
    const asset = key === 'base' ? this.asset : this.asset.variants[key];
    const picture = document.createElement('picture');
    picture.dataset.plate = key;
    const image = document.createElement('img');
    image.alt = '';
    image.decoding = 'async';
    picture.append(image);
    const source = document.createElement('source');
    if (asset.avif) {
      source.type = 'image/avif';
      source.srcset = photoURL(asset, 'avif');
      picture.prepend(source);
    }
    image.src = photoURL(asset, 'webp');
    const request = { key, picture, image };
    this.pending = request;
    request.ready = (async () => {
      try {
        try { await image.decode(); } catch {
          if (this.pending !== request) return false;
          source.remove();
          try { await image.decode(); } catch {
            if (this.pending !== request) return false;
            image.src = photoURL(asset, 'source');
            await image.decode();
          }
        }
        if (this.pending !== request) return false;
        this.cache.set(key, request);
        return true;
      } catch {
        if (this.pending === request) this.failed.add(key);
        return false;
      } finally {
        if (this.pending === request) this.pending = null;
      }
    })();
    return request.ready;
  }

  cancel() {
    const request = this.pending;
    this.pending = null;
    request?.picture.querySelector('source')?.remove();
    request?.image.removeAttribute('src');
  }

  async initialize(sun, setting) {
    while (!this.destroyed) {
      const target = plateWeights(this.scene, this.asset, sun, setting, this.failed);
      const [first] = [...target.keys()].sort((a, b) => target.get(b) - target.get(a));
      if (!first) return false;
      if (await this.load(first)) {
        this.visible.set(first, 1);
        this.draw();
        return true;
      }
      if (!this.failed.has(first)) return false;
    }
    return false;
  }

  update(dt, sun, setting, reduced) {
    const target = plateWeights(this.scene, this.asset, sun, setting, this.failed);
    for (const [key, weight] of target) if (weight < MIN_WEIGHT) target.delete(key);
    if (this.pending && !target.has(this.pending.key)) this.cancel();
    const missing = [...target.keys()].find(key => !this.cache.has(key));
    if (missing) {
      if (!this.pending) void this.load(missing);
      return;
    }
    if (!target.size) return;
    const factor = reduced ? 1 : 1 - Math.exp(-dt / .1);
    for (const key of target.keys()) if (!this.visible.has(key)) this.visible.set(key, 0);
    for (const [key, current] of this.visible) {
      const next = target.get(key) ?? 0;
      const weight = Math.abs(next - current) < MIN_WEIGHT ? next : current + (next - current) * factor;
      if (weight || next) this.visible.set(key, weight);
      else this.visible.delete(key);
    }
    this.draw();
    // Keep only recent decoded images, plus those still visible in the fade.
    for (const key of this.visible.keys()) {
      const entry = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, entry);
    }
    for (const [key, entry] of this.cache) {
      if (this.cache.size <= MAX_CACHED) break;
      if (this.visible.has(key) || target.has(key)) continue;
      entry.image.removeAttribute('src');
      this.cache.delete(key);
    }
  }

  draw() {
    for (const picture of this.root.children) {
      if (!this.visible.has(picture.dataset.plate)) picture.style.display = 'none';
    }
    let cumulative = 0;
    for (const [key, weight] of this.visible) {
      const { picture } = this.cache.get(key);
      if (picture.parentNode !== this.root) this.root.append(picture);
      picture.style.display = '';
      cumulative += weight;
      picture.style.opacity = cumulative ? (weight / cumulative).toFixed(5) : '0';
    }
    // The opacity formula assumes the same order in the DOM and in the map.
    for (const picture of Array.from(this.root.children)) {
      if (!this.visible.has(picture.dataset.plate)) picture.remove();
    }
  }

  get photographicWeight() {
    let total = 0, variant = 0;
    for (const [key, weight] of this.visible) {
      total += weight;
      if (key !== 'base') variant += weight;
    }
    return total ? variant / total : 0;
  }

  capture(ctx, x, y, width, height) {
    for (const picture of this.root.children) {
      ctx.globalAlpha = +picture.style.opacity;
      ctx.drawImage(picture.querySelector('img'), x, y, width, height);
    }
    ctx.globalAlpha = 1;
  }

  destroy() {
    this.destroyed = true;
    this.cancel();
    for (const { image } of this.cache.values()) image.removeAttribute('src');
    this.cache.clear();
    this.root.remove();
  }
}
