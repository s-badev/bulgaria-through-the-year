import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { reference } from './special-reference.mjs';

const REVISION = 1; // Bump when the generated pixels change without a profile or input change.
const autumn = 'photos/autumn.webp';
const winterNight = 'photos/winter-night.webp';

const forest = {
  base: { strength: .57, saturation: .95, secondary: .15, obscured: true },
  day: { strength: .95, saturation: .88, secondary: .28 },
  dusk: { strength: .93, saturation: .84, secondary: .28 },
  night: { strength: .84, saturation: .94, secondary: .15 },
  overcast: { strength: .71, saturation: .92, secondary: .24, obscured: true },
};

// These offsets describe the identifiable western slope, in source pixels.
// The central crest, summit antenna, city and indistinct snow squalls stay fixed.
const snow = {
  base: { strength: .78, saturation: .82, obscured: true },
  day: { strength: .96, saturation: .8, ridge: [[490, 0], [520, -3], [570, -3], [600, 0]] },
  dusk: { strength: .96, saturation: .82, ridge: [[490, 0], [520, -3], [600, -4], [655, -2], [680, -3], [697, 0]] },
  night: { strength: .93, saturation: .89, secondary: .24, ridge: [[585, 0], [630, 3], [680, 1], [700, 0]] },
  overcast: { strength: .93, saturation: .84, ridge: [[535, 0], [570, -7], [600, -5], [630, -1], [655, 0]] },
  'night-alt': { strength: .94, saturation: .89, secondary: .24, ridge: [[585, 0], [600, -2], [655, -2], [695, 0]] },
};

export function terrainProfile(id, phase) {
  if (id === 'abandoned' && forest[phase]) return { terrain: { primary: reference.photo, alternate: autumn, ...forest[phase] } };
  if (id === 'ice-age' && snow[phase]) return { terrain: { primary: reference.winter, alternate: winterNight, ...snow[phase] } };
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = (start, end, value) => {
  const t = clamp((value - start) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
};
const luminance = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
const mix = (a, b, t) => a + (b - a) * t;

export function registeredTerrain(sharp, root, band) {
  const { width, height, top } = band;
  const area = width * height;
  const donors = new Map();

  function pass(data, radius, horizontal) {
    const result = new Float32Array(area);
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    const stride = horizontal ? 1 : width;
    const prefix = new Float64Array(length + 1);
    for (let line = 0; line < lines; line++) {
      const first = horizontal ? line * width : line;
      for (let pos = 0; pos < length; pos++) prefix[pos + 1] = prefix[pos] + data[first + pos * stride];
      for (let pos = 0; pos < length; pos++) {
        const lo = Math.max(0, pos - radius), hi = Math.min(length, pos + radius + 1);
        result[first + pos * stride] = (prefix[hi] - prefix[lo]) / (hi - lo);
      }
    }
    return result;
  }

  // Approximates a Gaussian with three box passes per axis. Normalizing by the
  // filtered mask prevents bright sky and foreground from entering either band.
  const blur = (data, radius) => {
    for (let round = 0; round < 3; round++) data = pass(pass(data, radius, true), radius, false);
    return data;
  };
  let weights;
  function signal(pixels, channels, offset, mask) {
    weights ??= Float32Array.from(mask, value => smooth(.55, .96, value / 255));
    const light = new Float32Array(area), weighted = new Float32Array(area);
    for (let i = 0; i < area; i++) {
      const at = (offset + i) * channels;
      light[i] = luminance(pixels[at], pixels[at + 1], pixels[at + 2]);
      weighted[i] = light[i] * weights[i];
    }
    return { light, weighted };
  }

  const coverage = new Map();
  function broad(weighted, radius) {
    if (!coverage.has(radius)) coverage.set(radius, blur(weights, radius));
    const normalization = coverage.get(radius);
    return blur(weighted, radius).map((value, i) => value / Math.max(.001, normalization[i]));
  }

  function donor(path) {
    if (!donors.has(path)) donors.set(path, { bytes: fs.readFile(root + path), detail: null });
    return donors.get(path);
  }

  async function donorDetail(path, mask) {
    const item = donor(path);
    return item.detail ??= (async () => {
      const pixels = await sharp(await item.bytes).extract(band).removeAlpha().toColourspace('srgb').raw().toBuffer();
      const { light, weighted } = signal(pixels, 3, 0, mask);
      const base = broad(weighted, 24);
      return { base, relief: light.map((value, i) => value - base[i]) };
    })();
  }

  function register(pixels, channels, ridge, anchors) {
    if (!anchors) return;
    const source = Buffer.from(pixels.subarray(top * width * channels, (top * width + area) * channels));
    for (let segment = 1; segment < anchors.length; segment++) {
      const [start, from] = anchors[segment - 1], [end, to] = anchors[segment];
      for (let x = start; x < end; x++) {
        const offset = mix(from, to, smooth(start, end, x));
        for (let y = ridge[x] - 16; y < ridge[x] + 27; y++) {
          const dy = y - ridge[x];
          const fy = y + offset * smooth(-16, -3, dy) * (1 - smooth(5, 27, dy));
          if (fy === y) continue;
          const lo = Math.floor(fy), t = fy - lo;
          const at = (lo * width + x) * channels;
          const dst = ((top + y) * width + x) * channels;
          for (let c = 0; c < 3; c++) pixels[dst + c] = Math.round(mix(source[at + c], source[at + width * channels + c], t));
        }
      }
    }
  }

  return {
    async hash(profile) {
      const bytes = [donor(profile.primary).bytes];
      if (profile.secondary) bytes.push(donor(profile.alternate).bytes);
      const hash = crypto.createHash('sha256').update(String(REVISION));
      for (const value of await Promise.all(bytes)) hash.update(value);
      return hash.digest('hex');
    },
    async apply(pixels, channels, mask, ridge, profile) {
      register(pixels, channels, ridge, profile.ridge);
      const primary = await donorDetail(profile.primary, mask);
      const secondary = profile.secondary ? await donorDetail(profile.alternate, mask) : primary;
      const { light, weighted } = signal(pixels, channels, top * width, mask);
      // Keep finer illumination in baked mist and blowing snow. For clear plates,
      // preserve directional light but replace medium and fine terrain contrast.
      const base = broad(weighted, profile.obscured ? 16 : 24);
      const secondaryWeight = profile.secondary ?? 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const feather = smooth(.55, .98, mask[i] / 255) * smooth(2, profile.obscured ? 20 : 12, y - ridge[x]);
        if (feather <= 0) continue;
        const relight = (plate) => clamp((base[i] + 8) / (plate.base[i] + 8), .12, 1.2) * plate.relief[i];
        const relief = mix(relight(primary), relight(secondary), secondaryWeight);
        // Don't restore high local contrast through bright wisps or snow streaks.
        const transmission = profile.obscured ? 1 - .6 * smooth(8, 29, light[i] - base[i]) : 1;
        const at = top * width + i;
        const tone = mix(light[i], base[i] + relief, profile.strength * feather * transmission);
        const chroma = mix(1, profile.saturation, feather * transmission);
        for (let c = 0; c < 3; c++) {
          const index = at * channels + c;
          pixels[index] = clamp(Math.round(tone + (pixels[index] - light[i]) * chroma), 0, 255);
        }
      }
    },
  };
}
