// Optimize only supplied photographic masters. Never synthesize missing scenes or rewrite PNGs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SPECIAL_SCENES, SPECIAL_VARIANTS } from '../src/special/registry.js';
import { mountainPreparation, mountainProfiles } from './lib/special-mountain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'scenes', 'ndk', 'special');
const optimized = path.join(dir, 'optimized');
const manifestPath = path.join(dir, 'manifest.json');
const size = [1672, 941];
fs.mkdirSync(optimized, { recursive: true });
let previous = {};
try { previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).scenes || {}; } catch { /* First run. */ }
const scenes = {};
let sharp, mountain;
async function prepare(input, name, old, profile) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex');
  const webp = `optimized/${name}.webp`, avif = `optimized/${name}.avif`;
  let renderHash;
  if (profile) {
    sharp ||= (await import('sharp')).default;
    mountain ||= mountainPreparation(sharp, path.join(dir, '..') + path.sep);
    renderHash = await mountain.hash(hash, profile);
  }
  let sourceWidth = old?.sourceWidth ?? size[0];
  if (old?.hash !== hash || old?.renderHash !== renderHash || !fs.existsSync(path.join(dir, webp)) || !fs.existsSync(path.join(dir, avif))) {
    sharp ||= (await import('sharp')).default;
    let info;
    try { info = await sharp(input).metadata(); }
    catch (error) {
      console.warn(`[special] skipped unreadable ${path.basename(input)}: ${error.message}`);
      return null;
    }
    if (info.format !== 'png' || info.height !== size[1] || ![size[0], size[0] - 1].includes(info.width)) {
      console.warn(`[special] skipped ${path.basename(input)}: expected PNG ${size.join('x')}, got ${info.format} ${info.width}x${info.height}`);
      return null;
    }
    sourceWidth = info.width;
    let image = sharp(input);
    if (sourceWidth < size[0]) image.extend({ right: 1, extendWith: 'copy' });
    if (profile) image = await mountain.apply(image, profile);
    await image.clone().webp({ quality: 88, effort: 6 }).toFile(path.join(dir, webp));
    await image.clone().avif({ quality: 60, effort: 4 }).toFile(path.join(dir, avif));
    console.log(`[special] optimized ${name} from ${info.width}x${info.height}`);
  }
  return { source: path.basename(input), webp, avif, width: size[0], height: size[1], ...(sourceWidth < size[0] ? { sourceWidth } : {}), hash, ...(renderHash ? { renderHash } : {}) };
}
for (const scene of SPECIAL_SCENES) {
  const input = path.join(dir, scene.source);
  if (!fs.existsSync(input)) continue;
  const profile = mountainProfiles[scene.id];
  const base = await prepare(input, scene.id, previous[scene.id], profile);
  if (!base) continue;
  const variants = {};
  const config = SPECIAL_VARIANTS[scene.id];
  for (const phase of config?.keys ?? []) {
    const name = config.files?.[phase] ?? `${scene.id}-${phase}.png`;
    const variant = path.join(dir, name);
    if (!fs.existsSync(variant)) {
      console.warn(`[special] missing ${name}`);
      continue;
    }
    const plate = await prepare(variant, `${scene.id}-${phase}`, previous[scene.id]?.variants?.[phase], profile);
    if (plate) variants[phase] = plate;
  }
  scenes[scene.id] = Object.keys(variants).length ? { ...base, variants } : base;
}
const manifest = JSON.stringify({ version: 3, scenes }, null, 2) + '\n';
if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== manifest) fs.writeFileSync(manifestPath, manifest);
console.log(`[special] ${Object.keys(scenes).length}/${SPECIAL_SCENES.length} worlds, ${Object.values(scenes).reduce((count, scene) => count + Object.keys(scene.variants ?? {}).length, 0)} variants available`);
