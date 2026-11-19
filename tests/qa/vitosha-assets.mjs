import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { VISIBLE_SPECIAL_SCENES, SPECIAL_VARIANTS } from '../../src/special/registry.js';
import { mountainPreparation, mountainProfile } from '../../tools/lib/special-mountain.mjs';
import { reference } from '../../tools/lib/special-reference.mjs';

const root = 'public/scenes/ndk/';
const dir = root + 'special/';
const { width, height } = reference;
const manifest = JSON.parse(await fs.readFile(dir + 'manifest.json', 'utf8'));
const refs = ['master', 'autumn', 'winter-snow', 'winter-night', 'dawn-golden'];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const preparation = mountainPreparation(sharp, root);
const mask = await sharp(root + reference.mask).extractChannel(1).raw().toBuffer();
const ridge = Array.from({ length: width }, (_, x) => {
  let y = 128;
  while (y < 376 && mask[y * width + x] < 153) y++;
  return y;
});
const westernCrest = { day: [520, 570], dusk: [520, 600, 655], overcast: [570, 600, 630], night: [630], 'night-alt': [600, 655] };
let plates = 0, corrected = 0;

function crestOffset({ data, info }, x) {
  let match = 0, strongest = -1;
  for (let offset = -8; offset <= 8; offset++) {
    const rgb = [0, 0, 0];
    for (let col = x - 3; col <= x + 3; col++) {
      const at = (ridge[col] + offset) * info.width + col;
      for (let c = 0; c < 3; c++) rgb[c] += data[(at + info.width) * info.channels + c] - data[(at - info.width) * info.channels + c];
    }
    const contrast = Math.hypot(...rgb);
    if (contrast > strongest) {
      match = offset;
      strongest = contrast;
    }
  }
  return match;
}

for (const name of refs) {
  const info = await sharp(`${root}photos/${name}.webp`).metadata();
  assert.deepEqual([info.width, info.height, info.orientation ?? 1], [width, height, 1]);
}

for (const world of VISIBLE_SPECIAL_SCENES) {
  const scene = manifest.scenes[world.id];
  const config = SPECIAL_VARIANTS[world.id];
  assert.equal(scene.source, world.source);
  assert.deepEqual(Object.keys(scene.variants), config.keys);
  for (const [phase, plate] of [['base', scene], ...Object.entries(scene.variants)]) {
    const name = phase === 'base' ? world.id : `${world.id}-${phase}`;
    if (phase !== 'base') assert.equal(plate.source, config.files?.[phase] ?? `${name}.png`);
    const bytes = await fs.readFile(dir + plate.source);
    const image = sharp(bytes);
    const info = await image.metadata();
    const profile = mountainProfile(world.id, phase);
    assert.equal(plate.hash, digest(bytes));
    assert.equal(plate.renderHash, await preparation.hash(plate.hash, profile));
    assert.deepEqual([info.format, info.width, info.height], ['png', plate.sourceWidth ?? width, height]);
    for (const format of ['webp', 'avif']) {
      assert.equal(plate[format], `optimized/${name}.${format}`);
      const output = await sharp(dir + plate[format]).metadata();
      assert.equal(format === 'avif' ? output.compression : output.format, format === 'avif' ? 'av1' : 'webp');
      assert.deepEqual([output.width, output.height, output.hasAlpha], [width, height, info.hasAlpha]);
    }
    plates++;
    if (!profile.terrain) continue;
    if (info.width < width) image.extend({ right: 1, extendWith: 'copy' });
    const original = await image.clone().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    const result = await (await preparation.apply(image, profile)).raw().toBuffer();
    const { channels } = original.info;
    const anchors = profile.terrain.ridge;
    let changes = 0, ridgeChanges = 0;
    for (let i = 0; i < width * height; i++) {
      const x = i % width, y = Math.floor(i / width), at = i * channels;
      if (channels === 4) assert.equal(result[at + 3], original.data[at + 3]);
      if (result[at] === original.data[at] && result[at + 1] === original.data[at + 1] && result[at + 2] === original.data[at + 2]) continue;
      const terrain = mask[i] > .55 * 255 && y > ridge[x] + 2 && y < 376;
      const alignment = anchors && x > anchors[0][0] && x < anchors.at(-1)[0] && y > ridge[x] - 16 && y < ridge[x] + 27;
      assert(terrain || alignment, `${name}: protected pixel at ${x},${y}`);
      changes++;
      if (!terrain) ridgeChanges++;
    }
    assert(changes > 40_000, `${name}: correction reaches the mountain`);
    assert.equal(ridgeChanges > 0, !!anchors, `${name}: only measured crests may move`);
    if (anchors) {
      const output = await sharp(dir + plate.webp).raw().toBuffer({ resolveWithObject: true });
      for (const x of westernCrest[phase]) {
        const before = crestOffset(original, x), after = crestOffset(output, x);
        assert(Math.abs(after) <= 1 && Math.abs(after) < Math.abs(before), `${name}: crest at x=${x}, ${before} → ${after} px`);
      }
    }
    console.log(`PASS ${name}: ${changes} terrain/ridge pixels, ${ridgeChanges} in the crest margin, zero outside`);
    corrected++;
  }
}
assert.equal(plates, 32);
assert.equal(corrected, 11);
console.log(`PASS ${plates} source plates and ${plates * 2} derivatives, five reference photographs, ${corrected} bounded edits`);
