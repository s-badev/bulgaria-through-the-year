// Extracts the embedded photo, masks (M1..M3) and points JSON from the approved motion mock, without ever printing it.
import fs from 'node:fs';
import path from 'node:path';
import { SRC, ensureDir } from './lib/img.mjs';

const full = fs.readFileSync(path.join(SRC, 'ndk-motion-mock.html'), 'utf8'), out = path.join(SRC, 'mock');
ensureDir(out);
const re = /([A-Za-z0-9_]+)\s*=\s*"data:image\/([a-z]+);base64,([A-Za-z0-9+/=]+)"/g;
let m;
while ((m = re.exec(full))) fs.writeFileSync(path.join(out, m[1] + '.' + (m[2] === 'jpeg' ? 'jpg' : m[2])), Buffer.from(m[3], 'base64'));
const i = full.indexOf('PTS = ');
let j = full.indexOf('{', i), d = 0, k = j;
for (; k < full.length; k++) { if (full[k] === '{') d++; else if (full[k] === '}') { d--; if (d === 0) break; } }
fs.writeFileSync(path.join(out, 'points.json'), full.slice(j, k + 1));
fs.writeFileSync(path.join(out, 'mock-stripped.html'), full.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, s => 'data:<B64 ' + s.length + '>'));
console.log('mock extracted to', out);
