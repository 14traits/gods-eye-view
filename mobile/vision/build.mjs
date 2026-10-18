// Builds mobile/vision/index.html — one self-contained file (no runtime network).
//
//   node mobile/vision/build.mjs            # build once
//   node mobile/vision/build.mjs --watch    # rebuild on change
//
// Inputs (all offline, commit-friendly):
//   src/app.html   page template; markers <!--@CSS--> <!--@JS--> <!--@TEX--> are replaced
//   src/app.css    styles
//   src/js/*.js    concatenated in filename order inside one IIFE
//   assets/*.webp  NASA public-domain textures (made by prep-textures.mjs), inlined as data: URIs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rd = (p) => fs.readFileSync(path.join(here, p), 'utf8');

function build() {
  const t0 = Date.now();
  const tpl = rd('src/app.html');
  const css = rd('src/app.css');
  const jsDir = path.join(here, 'src/js');
  const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
  const js = files.map((f) => `// ---- ${f}\n` + fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
  const tex = {};
  for (const f of fs.readdirSync(path.join(here, 'assets')).sort()) {
    if (!/\.(webp|png|jpg)$/.test(f)) continue;
    const ext = f.split('.').pop();
    const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    tex[f.replace(/\.\w+$/, '')] = `data:${mime};base64,` + fs.readFileSync(path.join(here, 'assets', f)).toString('base64');
  }
  const texScript = `<script>window.__GE_TEX=${JSON.stringify(tex)};</script>`;
  const appScript = `<script>\n(() => {\n'use strict';\n${js}\n})();\n</script>`;
  let out = tpl
    .replace('<!--@CSS-->', () => `<style>\n${css}\n</style>`)
    .replace('<!--@TEX-->', () => texScript)
    .replace('<!--@JS-->', () => appScript);
  fs.writeFileSync(path.join(here, 'index.html'), out);
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`built index.html  ${kb} KB  (${files.length} js files, ${Object.keys(tex).length} textures, ${Date.now() - t0} ms)`);
}

build();
if (process.argv.includes('--watch')) {
  let timer;
  for (const d of ['src', 'src/js', 'assets'])
    fs.watch(path.join(here, d), () => { clearTimeout(timer); timer = setTimeout(() => { try { build(); } catch (e) { console.error(e); } }, 80); });
  console.log('watching…');
}
