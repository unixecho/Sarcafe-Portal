// Builds the single-file design preview of the Sarcafe intro.
//
//   node docs/intro-preview/build.mjs
//
// Reads preview.template.html, inlines the logo and the two public-page
// backdrops from /public as data URIs, and writes sarcafe-intro-preview.html
// next to it: one self-contained file you can open, send to a phone, or drop in
// a chat. Nothing here touches the app; /public is only read.
//
// `sharp` comes from the project's own node_modules (Next ships it).

import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const sharp = createRequire(path.join(root, 'package.json'))('sharp')

/** The logo is a transparent cutout, but the pixels UNDER its transparency
 *  still carry the white/grey checkerboard it was exported with (alpha 0, RGB
 *  not). Browsers ignore them; a resizer that does not premultiply, or an icon
 *  generator, would not. Paint them the badge's cream so nothing can fringe.
 *  720px is 3x the largest the intro draws it on a phone (224px). */
async function logoDataUri() {
  const src = path.join(root, 'public', 'sarcafe-logo.png')
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) { data[i] = 253; data[i + 1] = 246; data[i + 2] = 236 }
  }
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(720, 720)
    .webp({ quality: 88, alphaQuality: 100 })
    .toBuffer()
  return 'data:image/webp;base64,' + out.toString('base64')
}

async function jpegDataUri(name, quality) {
  const out = await sharp(path.join(root, 'public', name)).jpeg({ quality, mozjpeg: true }).toBuffer()
  return 'data:image/jpeg;base64,' + out.toString('base64')
}

const [template, logo, bg, bgWide] = await Promise.all([
  readFile(path.join(here, 'preview.template.html'), 'utf8'),
  logoDataUri(),
  jpegDataUri('background.jpg', 62),
  jpegDataUri('background-wide.jpg', 62),
])

const subs = { __LOGO__: logo, __BG__: bg, __BGWIDE__: bgWide }
let out = template
for (const [token, value] of Object.entries(subs)) {
  if (!out.includes(token)) throw new Error(`placeholder ${token} not found in the template`)
  out = out.split(token).join(value)
}
for (const token of Object.keys(subs)) {
  if (out.includes(token)) throw new Error(`placeholder ${token} is still present after substitution`)
}

const target = path.join(here, 'sarcafe-intro-preview.html')
await writeFile(target, out)
const kb = (s) => `${Math.round(s.length / 1024)} KB`
console.log(`wrote ${path.relative(root, target)} (${kb(out)}); logo ${kb(logo)}, backdrop ${kb(bg)}, wide ${kb(bgWide)}`)
