// Optimize only supplied photographic masters. Never synthesize missing scenes or rewrite PNGs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SPECIAL_SCENES, SPECIAL_VARIANTS } from '../src/special/registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'scenes', 'ndk', 'special');
const optimized = path.join(dir, 'optimized');
const manifestPath = path.join(dir, 'manifest.json');
const size = [1672, 941];
fs.mkdirSync(optimized, { recursive: true });
let previous = {};
try { previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).scenes || {}; } catch { /* First run. */ }
const scenes = {};
let sharp;
async function prepare(input, name, old) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex');
  const webp = `optimized/${name}.webp`, avif = `optimized/${name}.avif`;
  let sourceWidth = old?.sourceWidth ?? size[0];
  if (old?.hash !== hash || !fs.existsSync(path.join(dir, webp)) || !fs.existsSync(path.join(dir, avif))) {
    sharp ||= (await import('sharp')).default;
    const info = await sharp(input).metadata();
    if (info.format !== 'png' || info.height !== size[1] || ![size[0], size[0] - 1].includes(info.width)) {
      console.warn(`[special] skipped ${path.basename(input)}: expected PNG ${size.join('x')}, got ${info.format} ${info.width}x${info.height}`);
      return null;
    }
    sourceWidth = info.width;
    const image = sharp(input);
    if (sourceWidth < size[0]) image.extend({ right: 1, extendWith: 'copy' });
    await image.clone().webp({ quality: 88, effort: 6 }).toFile(path.join(dir, webp));
    await image.clone().avif({ quality: 60, effort: 4 }).toFile(path.join(dir, avif));
    console.log(`[special] optimized ${name} from ${info.width}x${info.height}`);
  }
  return { source: path.basename(input), webp, avif, width: size[0], height: size[1], ...(sourceWidth < size[0] ? { sourceWidth } : {}), hash };
}
const definitions = [...SPECIAL_SCENES];
if (!definitions.some(scene => scene.id === 'flood')) definitions.push({ id: 'flood', source: 'flood.png' });
for (const scene of definitions) {
  const input = path.join(dir, scene.source);
  if (!fs.existsSync(input)) continue;
  const base = await prepare(input, scene.id, previous[scene.id]);
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
    const plate = await prepare(variant, `${scene.id}-${phase}`, previous[scene.id]?.variants?.[phase]);
    if (plate) variants[phase] = plate;
  }
  scenes[scene.id] = Object.keys(variants).length ? { ...base, variants } : base;
}
const manifest = JSON.stringify({ version: 3, scenes }, null, 2) + '\n';
if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== manifest) fs.writeFileSync(manifestPath, manifest);
console.log(`[special] ${Object.keys(scenes).length}/${definitions.length} worlds, ${Object.values(scenes).reduce((count, scene) => count + Object.keys(scene.variants ?? {}).length, 0)} variants available`);
