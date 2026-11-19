import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { reference } from './special-reference.mjs';

const REVISION = 1;
export const mountainProfiles = {
  'ice-age': { saturation: .72, winterDetail: .86 },
};

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
  let maskPromise, winterPromise;
  const luminance = async image => image.clone().extract(band).greyscale().raw().toBuffer();
  const lowPass = data => sharp(data, { raw: { width, height: band.height, channels: 1 } })
    .blur(15).greyscale().raw().toBuffer();

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

  function winter() {
    return winterPromise ??= (async () => {
      const bytes = await fs.readFile(root + reference.winter);
      const detail = await luminance(sharp(bytes));
      return { detail, low: await lowPass(detail), hash: crypto.createHash('sha256').update(bytes).digest('hex') };
    })();
  }

  return {
    async hash(sourceHash, profile) {
      const data = await mask();
      const winterHash = profile.winterDetail ? (await winter()).hash : null;
      return crypto.createHash('sha256').update(JSON.stringify([REVISION, sourceHash, profile, data.hash, winterHash])).digest('hex');
    },
    async apply(image, profile) {
      const { data, ridge } = await mask();
      const winterData = profile.winterDetail ? await winter() : null;
      // Resolve padding for 1671 px masters before extraction. Sharp performs
      // extract before extend in a single pipeline.
      const rgb = await image.clone().removeAlpha().toColourspace('srgb').raw().toBuffer();
      const padded = () => sharp(rgb, { raw: { width, height, channels: 3 } });
      const target = winterData ? await luminance(padded()) : null;
      const targetLow = target ? await lowPass(target) : null;
      const yOffset = profile.yOffset ?? 0;
      for (let y = 0; y < band.height; y++) for (let x = 0; x < width; x++) {
        const refY = y - yOffset;
        if (refY < 0 || refY >= band.height) continue;
        const ref = refY * width + x, at = y * width + x;
        const opacity = smooth(.22, .96, data[ref] / 255) * smooth(12, 35, refY - ridge[x]);
        if (opacity <= 0) continue;
        const pixel = (at + band.top * width) * 3;
        const light = luma(rgb[pixel], rgb[pixel + 1], rgb[pixel + 2]);
        let tone = light;
        if (winterData) {
          // Preserve the plate's broad lighting and haze. Replace only local
          // luminance variation with terrain detail from the aligned winter
          // reference, scaled to the plate's own exposure.
          const gain = Math.max(.18, Math.min(.9, targetLow[at] / Math.max(10, winterData.low[ref])));
          const registered = targetLow[at] + (winterData.detail[ref] - winterData.low[ref]) * gain;
          tone += (registered - target[at]) * profile.winterDetail;
        }
        for (let c = 0; c < 3; c++) {
          const original = rgb[pixel + c];
          const graded = tone + (original - light) * profile.saturation;
          rgb[pixel + c] = Math.max(0, Math.min(255, Math.round(original + (graded - original) * opacity)));
        }
      }
      return padded();
    },
  };
}
