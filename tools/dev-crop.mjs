// Dev helper: crop a region of an image, upscale, overlay a labelled coordinate grid. Usage:
// node tools/dev-crop.mjs <in> <out> x y w h [scale] [gridStep]
import sharp from 'sharp';
const [, , inp, out, X, Y, Wd, Hd, S = '2', G = '50'] = process.argv;
const x = +X, y = +Y, w = +Wd, h = +Hd, s = +S, g = +G;
const meta = await sharp(inp).metadata();
const sx = meta.width / 1672, sy = meta.height / 941;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * s}" height="${h * s}">`;
for (let gx = Math.ceil(x / g) * g; gx < x + w; gx += g) svg += `<line x1="${(gx - x) * s}" y1="0" x2="${(gx - x) * s}" y2="${h * s}" stroke="rgba(255,255,0,.45)" stroke-width="1"/><text x="${(gx - x) * s + 2}" y="11" font-size="11" fill="#ff0" stroke="#000" stroke-width="2.5" paint-order="stroke" font-family="Arial">${gx}</text>`;
for (let gy = Math.ceil(y / g) * g; gy < y + h; gy += g) svg += `<line x1="0" y1="${(gy - y) * s}" x2="${w * s}" y2="${(gy - y) * s}" stroke="rgba(0,255,255,.45)" stroke-width="1"/><text x="2" y="${(gy - y) * s - 2}" font-size="11" fill="#0ff" stroke="#000" stroke-width="2.5" paint-order="stroke" font-family="Arial">${gy}</text>`;
svg += '</svg>';
await sharp(inp).extract({ left: Math.round(x * sx), top: Math.round(y * sy), width: Math.round(w * sx), height: Math.round(h * sy) }).resize(Math.round(w * s), Math.round(h * s), { kernel: 'lanczos3', fit: 'fill' }).composite([{ input: Buffer.from(svg) }]).png().toFile(out);
