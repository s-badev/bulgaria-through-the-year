// Optimize only supplied photographic masters. Never synthesize missing scenes or rewrite PNGs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SPECIAL_SCENES } from '../src/special/registry.js';

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
  if (old?.hash !== hash || !fs.existsSync(path.join(dir, webp)) || !fs.existsSync(path.join(dir, avif))) {
    sharp ||= (await import('sharp')).default;
    const info = await sharp(input).metadata();
    if (Math.abs(info.width - size[0]) > 1 || Math.abs(info.height - size[1]) > 1) throw new Error(`${path.basename(input)}: expected ${size.join('x')}, got ${info.width}x${info.height}`);
    const image = sharp(input).resize(...size, { fit: 'fill' });
    await image.clone().webp({ quality: 88, effort: 6 }).toFile(path.join(dir, webp));
    await image.clone().avif({ quality: 60, effort: 4 }).toFile(path.join(dir, avif));
    console.log(`[special] optimized ${name} from ${info.width}x${info.height}`);
  }
  return { source: path.basename(input), webp, avif, width: size[0], height: size[1], hash };
}
for (const scene of SPECIAL_SCENES) {
  const input = path.join(dir, scene.source);
  if (!fs.existsSync(input)) continue;
  const base = await prepare(input, scene.id, previous[scene.id]);
  const variants = {};
  for (const phase of ['day', 'dusk', 'night']) {
    const variant = path.join(dir, `${scene.id}-${phase}.png`);
    if (fs.existsSync(variant)) variants[phase] = await prepare(variant, `${scene.id}-${phase}`, previous[scene.id]?.variants?.[phase]);
  }
  scenes[scene.id] = Object.keys(variants).length ? { ...base, variants } : base;
}
const manifest = JSON.stringify({ version: 2, scenes }, null, 2) + '\n';
if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== manifest) fs.writeFileSync(manifestPath, manifest);
console.log(`[special] ${Object.keys(scenes).length}/${SPECIAL_SCENES.length} photographs available`);
