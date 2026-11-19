import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { reference } from './special-reference.mjs';
import { registeredTerrain, terrainProfile } from './registered-terrain.mjs';

const REVISION = 1;
const mountainProfiles = {
  planet: { saturation: .94 },
  sandstorm: { saturation: .88 },
  cyberpunk: { saturation: .87, yOffset: -32 },
  flood: { saturation: .94 },
};

export const mountainProfile = (id, phase) => terrainProfile(id, phase) ?? mountainProfiles[id];

// Quantize only the final band. The original sky, skyline, and city outside
// the feathered mask pass through the normal WebP/AVIF encoder unchanged.
export function mountainPreparation(sharp, root) {
  const { width, height } = reference;
  const band = { left: 0, top: 128, width, height: 248 };
  const smooth = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const luma = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
  let maskPromise;
  const terrain = registeredTerrain(sharp, root, band);

  function mask() {
    return maskPromise ??= (async () => {
      const bytes = await fs.readFile(root + reference.mask);
      const data = await sharp(bytes).extract(band).extractChannel(1).raw().toBuffer();
      const ridge = new Uint16Array(width).fill(band.height);
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < band.height; y++) {
          if (data[y * width + x] < 153) continue;
          ridge[x] = y;
          break;
        }
      }
      return { data, ridge, hash: crypto.createHash('sha256').update(bytes).digest('hex') };
    })();
  }

  return {
    async hash(sourceHash, profile) {
      const data = await mask();
      const terrainHash = profile.terrain ? await terrain.hash(profile.terrain) : null;
      return crypto.createHash('sha256').update(JSON.stringify([REVISION, sourceHash, profile, data.hash, terrainHash])).digest('hex');
    },
    async apply(image, profile) {
      const { data, ridge } = await mask();
      // Resolve padding for 1671 px masters before extraction. Sharp performs
      // extract before extend in a single pipeline.
      if (profile.terrain) {
        const { data: pixels, info } = await image.clone().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
        await terrain.apply(pixels, info.channels, data, ridge, profile.terrain);
        return sharp(pixels, { raw: { width, height, channels: info.channels } });
      }
      const rgb = await image.clone().removeAlpha().toColourspace('srgb').raw().toBuffer();
      const padded = () => sharp(rgb, { raw: { width, height, channels: 3 } });
      const yOffset = profile.yOffset ?? 0;
      for (let y = 0; y < band.height; y++) for (let x = 0; x < width; x++) {
        const refY = y - yOffset;
        if (refY < 0 || refY >= band.height) continue;
        const ref = refY * width + x, at = y * width + x;
        const opacity = smooth(.22, .96, data[ref] / 255) * smooth(12, 35, refY - ridge[x]);
        if (opacity <= 0) continue;
        const pixel = (at + band.top * width) * 3;
        const light = luma(rgb[pixel], rgb[pixel + 1], rgb[pixel + 2]);
        for (let c = 0; c < 3; c++) {
          const original = rgb[pixel + c];
          const graded = light + (original - light) * profile.saturation;
          rgb[pixel + c] = Math.max(0, Math.min(255, Math.round(original + (graded - original) * opacity)));
        }
      }
      return padded();
    },
  };
}
