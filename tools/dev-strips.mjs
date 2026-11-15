// Dev view: every carriageway straightened along its guide (s to the right = direction of travel, t down = driver's right), 4x, with a grid.
import sharp from 'sharp';
import path from 'node:path';
import { WORK, loadRGB, rgbToBuffer } from './lib/img.mjs';
import { resample, strip } from './lib/roads.mjs';
import { CARRIAGEWAYS } from './roads-config.mjs';
const src = process.argv[2] || path.join(WORK, 'processed', 'master.png'), out = process.argv[3] || path.join(WORK, 't-strips.png'), Z = 4;
const rgb = await loadRGB(src), comps = []; let y = 0, maxW = 0;
for (const c of CARRIAGEWAYS) {
  const p = resample(c.guide, 1), s = strip(rgb, p, c.half, 1);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s.w * Z}" height="${s.h * Z}">`;
  for (let i = 0; i < s.w; i += 20) svg += `<line x1="${i * Z}" y1="0" x2="${i * Z}" y2="${s.h * Z}" stroke="rgba(255,255,0,.35)"/><text x="${i * Z + 2}" y="10" font-size="10" fill="#ff0" stroke="#000" stroke-width="2" paint-order="stroke" font-family="Arial">${i}</text>`;
  for (let t = -c.half; t <= c.half; t += 10) svg += `<line x1="0" y1="${(t + c.half) * Z}" x2="${s.w * Z}" y2="${(t + c.half) * Z}" stroke="rgba(0,255,255,${t === 0 ? .8 : .3})"/><text x="2" y="${(t + c.half) * Z - 2}" font-size="10" fill="#0ff" stroke="#000" stroke-width="2" paint-order="stroke" font-family="Arial">${t}</text>`;
  svg += `<text x="60" y="24" font-size="15" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" font-family="Arial">${c.id} (${c.seen})</text></svg>`;
  const img = await sharp(rgbToBuffer(s.data, s.w, s.h), { raw: { width: s.w, height: s.h, channels: 3 } }).resize(s.w * Z, s.h * Z, { kernel: 'cubic' }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  comps.push({ input: img, left: 0, top: y }); y += s.h * Z + 6; maxW = Math.max(maxW, s.w * Z);
}
await sharp({ create: { width: maxW, height: y, channels: 3, background: '#000' } }).composite(comps).png().toFile(out);
console.log('strips', maxW, y);
