// Match small edge patches without assuming the whole image can be registered.
// Run from the repository root. Weak or boundary matches remain unverified.
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { reference } from './lib/special-reference.mjs';
import { VISIBLE_SPECIAL_SCENES } from '../src/special/registry.js';

const root = 'public/scenes/ndk/';
const out = process.argv[2] || 'tests/qa-out/phase-f-audit';
const { width, height, landmarks } = reference;
const manifest = JSON.parse(await fs.readFile(root + 'special/manifest.json', 'utf8'));
const grey = file => sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
const master = await grey(root + reference.photo);
const corners = Object.values(landmarks);

function gradients({ data, info }, x, y) {
  const i = y * info.width + x;
  return [data[i + 2] - data[i - 2], data[i + info.width * 2] - data[i - info.width * 2]];
}

function match(image, [x, y]) {
  const samples = [];
  let referenceEnergy = 0;
  for (let j = -16; j <= 16; j += 2) for (let i = -16; i <= 16; i += 2) {
    const [gx, gy] = gradients(master, x + i, y + j);
    samples.push([x + i, y + j, gx, gy]);
    referenceEnergy += gx * gx + gy * gy;
  }
  function score(dx, dy) {
    let dot = 0, energy = 0;
    for (const [a, b, gx, gy] of samples) {
      const [u, v] = gradients(image, a + dx, b + dy);
      dot += gx * u + gy * v;
      energy += u * u + v * v;
    }
    return dot / Math.sqrt(referenceEnergy * energy) || 0;
  }
  const range = 44;
  let best = { dx: 0, dy: 0, score: -1 };
  const candidates = [];
  for (let dy = -range; dy <= range; dy += 2) for (let dx = -range; dx <= range; dx += 2) {
    const result = { dx, dy, score: score(dx, dy) };
    if (result.score > best.score) best = result;
    candidates.push(result);
  }
  const centre = best;
  for (let dy = centre.dy - 1; dy <= centre.dy + 1; dy++) for (let dx = centre.dx - 1; dx <= centre.dx + 1; dx++) {
    const value = score(dx, dy);
    if (value > best.score) best = { dx, dy, score: value };
  }
  const alternate = Math.max(-1, ...candidates.filter(p => Math.hypot(p.dx - best.dx, p.dy - best.dy) > 5).map(p => p.score));
  const confidence = best.score >= .42 && best.score - alternate >= .055 && Math.max(Math.abs(best.dx), Math.abs(best.dy)) < range - 1;
  return { ...best, score: +best.score.toFixed(2), confidence };
}

function markers(matches) {
  return corners.map(([x, y], i) => {
    const m = matches?.[Object.keys(landmarks)[i]];
    const dot = m?.confidence ? `<circle cx="${x + m.dx}" cy="${y + m.dy}" r="7" fill="#59e9f2" />` : '';
    return `<circle cx="${x}" cy="${y}" r="12" fill="none" stroke="#ffe09b" stroke-width="4" />${dot}`;
  }).join('');
}

await fs.mkdir(out, { recursive: true });
const results = {};
for (const { id } of VISIBLE_SPECIAL_SCENES) {
  const asset = manifest.scenes[id];
  const entries = [['reference', { source: reference.photo }], ['base', asset], ...Object.entries(asset.variants)];
  const tiles = [];
  results[id] = {};
  for (const [index, [phase, plate]] of entries.entries()) {
    const file = root + (phase === 'reference' ? plate.source : 'special/' + plate.source);
    const matches = phase === 'reference' ? null : Object.fromEntries(
      await grey(file).then(image => Object.entries(landmarks).map(([name, xy]) => [name, match(image, xy)])));
    if (matches) results[id][phase] = { source: plate.source, matches };
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${markers(matches)}<rect width="520" height="65" fill="#121822" /><text x="20" y="46" font-size="39" fill="white" font-family="sans-serif">${id} · ${phase}</text></svg>`);
    const annotated = await sharp(file).resize(width, height, { fit: 'fill' }).composite([{ input: svg }]).png().toBuffer();
    tiles.push({ input: await sharp(annotated).resize(418).jpeg().toBuffer(), left: index % 3 * 418, top: Math.floor(index / 3) * 235 });
  }
  await sharp({ create: { width: 1254, height: Math.ceil(tiles.length / 3) * 235, channels: 3, background: '#101821' } })
    .composite(tiles).jpeg({ quality: 88 }).toFile(`${out}/${id}.jpg`);
}
await fs.writeFile(`${out}/alignment.json`, JSON.stringify({ landmarks, worlds: results }, null, 2) + '\n');
console.log(`Audited ${Object.values(results).reduce((n, world) => n + Object.keys(world).length, 0)} source plates`);
