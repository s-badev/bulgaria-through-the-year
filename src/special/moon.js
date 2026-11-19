import { solarMix } from './lighting.js';
import './moon.css';

// The same licensed LRO near-side photograph used by the normal Sofia renderer.
const texture = new URL('../render/moon-nearside.webp', import.meta.url).href;
const SIZE = 256, DISC = 160, RADIUS = DISC / 2, CENTER = SIZE / 2;

// x/y and the local light footprints are registered to the photographs.
const SPECIAL_MOONS = {
  abandoned: {
    x: .550, y: .142, diameter: .035, tint: [177, 201, 225], brightness: 1.28,
    light: [{ x: .47, y: .51, w: .54, h: .40, strength: .085 }],
  },
  flood: {
    x: .554, y: .139, diameter: .036, tint: [238, 222, 193], brightness: 1.24,
    // Small exposed stretches from the existing floodwater effects.
    light: [
      { x: 444 / 836, y: 416 / 471, w: .067, h: .009, strength: .18 },
      { x: 494 / 836, y: 451 / 471, w: .071, h: .012, strength: .10 },
    ],
  },
  'ice-age': {
    x: .547, y: .149, diameter: .036, tint: [189, 214, 238], brightness: 1.30,
    light: [
      { x: .56, y: .256, w: .46, h: .112, strength: .10 },
      { x: .48, y: .48, w: .48, h: .27, strength: .065 },
    ],
  },
};

const WEATHER = {
  // [transmission, cloud masking, fog softness in sprite pixels]
  clear: [1, .06, 0], light: [.95, .20, .35], cloudy: [.78, .47, .5],
  fog: [.47, .16, 4], rain: [.58, .60, 1.1], 'heavy-rain': [.29, .77, 1.8],
  storm: [.16, .88, 2.4], blizzard: [.065, .92, 3.6],
};
const clamp = t => Math.max(0, Math.min(1, t));
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };

function moonAtmosphere(sun, { condition, intensity }) {
  const { night } = solarMix(sun);
  const twilight = .10 * smooth(-sun.elevation / 3);
  const [transmission, clouds, fog] = WEATHER[condition] ?? WEATHER.clear;
  const depth = .60 + .40 * clamp(intensity);
  return {
    opacity: (night + (1 - night) * twilight) * (1 - (1 - transmission) * depth),
    clouds: clouds * depth,
    softness: fog * depth,
  };
}

function wisp(ctx, x, y, width, height, opacity) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(width, height);
  const fade = ctx.createRadialGradient(0, 0, .12, 0, 0, 1);
  fade.addColorStop(0, `rgba(0,0,0,${opacity})`);
  fade.addColorStop(.48, `rgba(0,0,0,${opacity * .54})`);
  fade.addColorStop(1, 'transparent');
  ctx.fillStyle = fade;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

export class SpecialMoon {
  mount(parent, id, before = null) {
    const profile = SPECIAL_MOONS[id];
    if (id === this.id && (!profile || this.root?.parentNode === parent)) return false;
    this.profile = profile;
    this.id = id;
    this.pending = null;
    this.atmosphere = null;
    if (!profile) { this.root?.remove(); return false; }
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.className = 'special-moon-overlay';
      this.root.setAttribute('aria-hidden', 'true');
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'special-moon-sprite';
      this.canvas.width = this.canvas.height = SIZE;
      this.ctx = this.canvas.getContext('2d');
    }
    this.light = profile.light.map(spot => {
      const node = document.createElement('div');
      node.className = 'special-moon-light';
      Object.assign(node.style, {
        left: `${spot.x * 100}%`, top: `${spot.y * 100}%`,
        width: `${spot.w * 100}%`, height: `${spot.h * 100}%`,
        background: `radial-gradient(ellipse closest-side, rgb(${profile.tint.join(' ')}), transparent)`,
      });
      return node;
    });
    Object.assign(this.canvas.style, {
      left: `${profile.x * 100}%`, top: `${profile.y * 100}%`, width: `${profile.diameter * SIZE / DISC * 100}%`,
    });
    this.root.replaceChildren(...this.light, this.canvas);
    this.root.hidden = true;
    this.rasterKey = null;
    this.geometry = null;
    parent.insertBefore(this.root, before);
    return true;
  }

  layout(left, top, width, height) {
    if (!this.profile || !this.root.parentNode) return;
    const geometry = `${left} ${top} ${width} ${height}`;
    if (this.geometry === geometry) return;
    this.geometry = geometry;
    Object.assign(this.root.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }

  update(sun, setting, hour, reduced, plateVisibility = 1, dt = 0) {
    if (!this.profile || !this.ctx || !this.root.parentNode) return;
    const target = moonAtmosphere(sun, setting);
    if (target.opacity * plateVisibility < .004) { this.root.hidden = true; this.pending = null; this.atmosphere = null; return; }
    if (!this.image) {
      this.image = new Image();
      this.image.onload = () => { if (this.pending) this.update(...this.pending); };
      this.image.src = texture;
    }
    if (!this.image.complete || !this.image.naturalWidth) { this.pending = [sun, setting, hour, reduced, plateVisibility, dt]; return; }
    this.pending = null;
    const amount = dt && !reduced ? 1 - Math.exp(-dt / .18) : 1;
    const atmosphere = this.atmosphere ??= target;
    for (const key of ['opacity', 'clouds', 'softness']) atmosphere[key] += (target[key] - atmosphere[key]) * amount;
    const opacity = (atmosphere.opacity * plateVisibility).toFixed(3);
    // Drift the cloud cover with simulated time. The disk itself stays still.
    const drift = reduced ? 0 : Math.round(29 * Math.sin(hour * Math.PI / 3));
    const key = `${this.id}/${atmosphere.clouds.toFixed(2)}/${atmosphere.softness.toFixed(1)}/${drift}`;
    if (key !== this.rasterKey) {
      this.renderSprite(atmosphere, drift);
      this.rasterKey = key;
    }
    this.root.hidden = false;
    if (this.canvas.style.opacity !== opacity) this.canvas.style.opacity = opacity;
    for (const [index, spot] of this.profile.light.entries()) {
      const strength = (opacity * spot.strength).toFixed(3);
      if (this.light[index].style.opacity !== strength) this.light[index].style.opacity = strength;
    }
  }

  renderSprite({ clouds, softness }, drift) {
    const ctx = this.ctx, { brightness, tint } = this.profile;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.filter = `brightness(${brightness}) blur(${softness}px)`;
    ctx.drawImage(this.image, CENTER - RADIUS, CENTER - RADIUS, DISC, DISC);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(${tint.join(',')},.095)`;
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Attenuate the photographic limb gently so the bright rim stays natural.
    const limb = ctx.createRadialGradient(CENTER, CENTER, RADIUS * .77, CENTER, CENTER, RADIUS);
    limb.addColorStop(0, 'transparent');
    limb.addColorStop(1, 'rgba(21,29,42,.16)');
    ctx.fillStyle = limb;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalCompositeOperation = 'destination-over';
    const halo = ctx.createRadialGradient(CENTER, CENTER, RADIUS * .90, CENTER, CENTER, RADIUS * 1.52);
    halo.addColorStop(0, `rgba(${tint.join(',')},${.17 + softness * .035})`);
    halo.addColorStop(.38, `rgba(${tint.join(',')},.045)`);
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalCompositeOperation = 'destination-out';
    wisp(ctx, CENTER - 36 + drift, CENTER + 16, 138, 30, clouds);
    wisp(ctx, CENTER + 25 + drift * .7, CENTER - 15, 108, 24, clouds * .57);
    wisp(ctx, CENTER - 13 + drift * 1.2, CENTER + 39, 81, 18, clouds * .57);
    ctx.globalCompositeOperation = 'source-over';
  }

  paint(ctx, width, height) {
    if (!this.profile || !this.root?.isConnected || this.root.hidden) return;
    const { x, y, diameter, tint, light } = this.profile;
    ctx.save();
    for (const [index, spot] of light.entries()) {
      ctx.save();
      ctx.translate(spot.x * width, spot.y * height);
      ctx.scale(spot.w * width / 2, spot.h * height / 2);
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      glow.addColorStop(0, `rgb(${tint.join(',')})`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.globalAlpha = +this.light[index].style.opacity;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
    const size = diameter * width * SIZE / DISC;
    ctx.globalAlpha = +this.canvas.style.opacity;
    ctx.drawImage(this.canvas, x * width - size / 2, y * height - size / 2, size, size);
    ctx.restore();
  }
}
