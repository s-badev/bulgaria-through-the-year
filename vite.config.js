import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Version stamp shown in the footer. On Vercel the checkout may not contain .git, so its system variable comes first.
function gitHash() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'nogit'; }
}

// Content hash of every scene folder (public/scenes/<id>/**). Scene files keep their plain names, so the loader appends
// ?v=<hash>; any change of a photo, mask or geometry file changes the URL, which makes long immutable caching safe.
function sceneVersions() {
  const root = path.resolve('public/scenes'), out = {};
  if (!fs.existsSync(root)) return out;
  const walk = (d, acc = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, acc) : acc.push(p); } return acc; };
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const h = createHash('sha1');
    for (const f of walk(path.join(root, e.name))) { h.update(path.relative(root, f).replace(/\\/g, '/')); h.update(fs.readFileSync(f)); }
    out[e.name] = h.digest('hex').slice(0, 10);
  }
  return out;
}

// Absolute URL of the site, only for the Open Graph / Twitter tags (crawlers need absolute URLs).
// Optional: SITE_URL, or Vercel's own system variable VERCEL_PROJECT_PRODUCTION_URL. Nothing has to be configured:
// without either, the tags fall back to root-relative paths.
function siteUrl() {
  const v = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : '');
  return v.replace(/\/+$/, '');
}
const htmlSiteUrl = () => ({
  name: 'html-site-url',
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      const u = siteUrl();
      return html.replaceAll('__SITE_URL__', u).replace(/<meta property="og:url" content="">\s*/, u ? `<meta property="og:url" content="${u}/">\n` : '');
    },
  },
});

export default defineConfig({
  base: './',
  plugins: [htmlSiteUrl()],
  define: {
    __APP_COMMIT__: JSON.stringify(gitHash()),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __SCENE_VERSIONS__: JSON.stringify(sceneVersions()),
  },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
