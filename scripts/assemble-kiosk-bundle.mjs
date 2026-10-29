#!/usr/bin/env node
/*
 * Assembles the page that ships inside the Sarcafe kiosk app (and that the over-the-air update publishes):
 *   node scripts/assemble-kiosk-bundle.mjs <outDir>
 *
 * Copies the prototype (prototypes/sarcafe-kiosk: *.html, *.css, *.js), the logo and the Givat Haviva backdrops,
 * the kiosk layers (prototypes/sarcafe-kiosk-app/overrides) and the bundled Rubik font into ONE flat folder
 * (aapt2 on Windows stores sub-folder assets with backslashes, which Android cannot open), points the pages at
 * the flat files, removes the Google Fonts links, and injects the kiosk layers into index.html in the order below.
 * Deterministic: the same input gives the same bytes (no timestamps, files in sorted order). Every path is relative
 * to index.html. build.ps1 calls this; scripts/check-kiosk-session.mjs uses it too.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(repo, 'prototypes', 'sarcafe-kiosk');
const APP = join(repo, 'prototypes', 'sarcafe-kiosk-app');
const PUBLIC = join(repo, 'public');

// The kiosk-only layers, in load order.
//  head:      the speed check first (picks the light version before anything is painted), the bundled font, styles
//  afterMenu: the last menu the dashboard pushed replaces the one shipped in the app, before app.js renders it
//  body:      full-screen layout + keypad, business facts, the session controller (privacy reset; everything after
//             it registers with it), legal texts, the welcome screen's announcements, the sign-up, menu updates,
//             and last the "page booted" signal to the app
export const LAYERS = {
  head: ['kiosk-perf.js', 'rubik.css', 'kiosk-app.css', 'kiosk-attract.css'],
  afterMenu: ['kiosk-menu-cache.js'],
  body: ['kiosk-app.js', 'kiosk-business.js', 'kiosk-session.js', 'kiosk-legal.js', 'kiosk-attract.js', 'kiosk-signup.js', 'kiosk-sync.js', 'kiosk-ready.js'],
};

const tag = (file) => (file.endsWith('.css')
  ? `    <link rel="stylesheet" href="./${file}" />`
  : `    <script src="./${file}"></script>`);

function replaceOnce(text, anchor, replacement, file) {
  const at = text.indexOf(anchor);
  if (at < 0) throw new Error(`${file}: anchor not found: ${anchor}`);
  return text.slice(0, at) + replacement + text.slice(at + anchor.length);
}

export function transformHtml(name, html) {
  let t = html.split('../../public/backdrops/').join('./').split('../../public/').join('./');
  t = t.replace(/<link[^>]*fonts\.g(oogleapis|static)\.com[^>]*>\s*/g, ''); // the fonts are bundled
  if (name === 'index.html') {
    t = replaceOnce(t, '</head>', `${LAYERS.head.map(tag).join('\n')}\n  </head>`, name);
    t = replaceOnce(t, '<script src="./menu-data.js"></script>',
      `<script src="./menu-data.js"></script>\n${LAYERS.afterMenu.map(tag).join('\n')}`, name);
    t = replaceOnce(t, '</body>', `${LAYERS.body.map(tag).join('\n')}\n  </body>`, name);
  }
  return t;
}

const sorted = (dir, keep) => readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isFile() && keep(d.name)).map((d) => d.name).sort();

export function assemble(outDir) {
  const out = resolve(outDir);
  mkdirSync(out, { recursive: true });
  const written = [];
  const copy = (from, name) => { copyFileSync(from, join(out, name)); written.push(name); };

  for (const name of sorted(PAGE, (n) => /\.(html|css|js)$/.test(n))) {
    if (name.endsWith('.html')) {
      writeFileSync(join(out, name), transformHtml(name, readFileSync(join(PAGE, name), 'utf8')), 'utf8');
      written.push(name);
    } else copy(join(PAGE, name), name);
  }
  copy(join(PUBLIC, 'sarcafe-logo.png'), 'sarcafe-logo.png');
  for (const name of sorted(join(PUBLIC, 'backdrops'), (n) => /^givat-haviva-.*\.webp$/.test(n))) copy(join(PUBLIC, 'backdrops', name), name);
  for (const name of sorted(join(APP, 'overrides'), () => true)) copy(join(APP, 'overrides', name), name);
  for (const name of sorted(join(APP, 'fonts'), () => true)) copy(join(APP, 'fonts', name), name);

  // every injected layer must exist in the bundle
  const missing = [...LAYERS.head, ...LAYERS.afterMenu, ...LAYERS.body].filter((f) => !written.includes(f));
  if (missing.length) throw new Error(`kiosk layers missing from the bundle: ${missing.join(', ')}`);
  return written.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2];
  if (!outDir) { console.error('usage: node scripts/assemble-kiosk-bundle.mjs <outDir>'); process.exit(2); }
  try {
    const files = assemble(outDir);
    console.log(`kiosk bundle: ${files.length} files -> ${resolve(outDir)}`);
  } catch (error) {
    console.error(String(error && error.message || error));
    process.exit(1);
  }
}
