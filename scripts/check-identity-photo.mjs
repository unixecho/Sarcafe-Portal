// The photo checker of employee registration (FABLE-003, src/lib/identity/server/photo.ts), run for real on crafted images: the
// real sharp (pinned in package.json), the real file, transpiled. Every image is made here from nothing (no real person, no real
// photo). Covers: the formats that pass and what comes out (a fresh JPEG, upright, at most 1024 px, NO metadata: no EXIF, no GPS,
// no ICC, no XMP), and every refusal: not an image, SVG / HTML / PDF / GIF, a lying signature, animation, truncation, too small,
// a decompression bomb, too many bytes.
//
//   node scripts/check-identity-photo.mjs

import ts from 'typescript'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
let pass = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) } }
const section = (t) => console.log(`\n${t}`)

// the two real files, transpiled; 'server-only' becomes an empty module, '@/lib/identity/registration' the transpiled pure file
const dir = mkdtempSync(join(tmpdir(), 'check-identity-photo-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp */ } })
const transpile = (rel, out, replace = (s) => s) => writeFileSync(join(dir, out), replace(ts.transpileModule(readFileSync(join(ROOT, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText))
writeFileSync(join(dir, 'server-only.mjs'), 'export {}\n')
transpile('src/lib/identity/registration.ts', 'registration.mjs')
transpile('src/lib/identity/server/photo.ts', 'photo.mjs', (s) => s
  .replace(/from ['"]server-only['"]/, `from '${pathToFileURL(join(dir, 'server-only.mjs')).href}'`).replace(/^import ['"]server-only['"];?$/m, `import '${pathToFileURL(join(dir, 'server-only.mjs')).href}'`)
  .replace(/['"]@\/lib\/identity\/registration['"]/, `'${pathToFileURL(join(dir, 'registration.mjs')).href}'`)
  .replace(/from ['"]sharp['"]/, `from '${pathToFileURL(createRequire(import.meta.url).resolve('sharp')).href}'`))
const { processPortrait, sniffImage, PORTRAIT_TEXT } = await import(pathToFileURL(join(dir, 'photo.mjs')).href)

const solid = (w, h, extra = {}) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 180, g: 120, b: 90 } }, ...extra })
// a small "face": a disc on a plain background, so orientation and colour can be checked after re-encoding
const face = (w, h) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#3a6ea5"/><circle cx="${w / 2}" cy="${h / 3}" r="${Math.min(w, h) / 5}" fill="#f2c9a0"/></svg>`))
const refusal = async (name, bytes, reason) => { const r = await processPortrait(bytes); check(`${name} → refused (${reason})`, r.ok === false && r.reason === reason, JSON.stringify(r.ok ? { ok: true } : r)) }

section('what passes, and what comes out')
// A JPEG carrying EXIF with GPS, a camera, a comment and orientation 6 (turned 90°): the result is upright and carries none of it.
const exifJpeg = await face(1600, 1200).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Make: 'SyntheticCam', Model: 'QA-1', ImageDescription: 'secret-description' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '32/1 26/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '35/1 0/1 0/1' } } }).toBuffer()
const inMeta = await sharp(exifJpeg).metadata()
check('the crafted input really carries EXIF, GPS and orientation 6', !!inMeta.exif && inMeta.orientation === 6 && /SyntheticCam/.test(inMeta.exif.toString('latin1')))
const a = await processPortrait(exifJpeg)
const aMeta = a.ok ? await sharp(a.portrait.jpeg).metadata() : {}
check('a JPEG passes', a.ok)
check('…turned upright by its orientation (1600x1200 sideways → portrait), at most 1024 px on the long side', a.ok && a.portrait.height === 1024 && a.portrait.width === 768 && aMeta.width === 768 && aMeta.height === 1024)
check('…re-encoded as a fresh JPEG with NO metadata (no EXIF, GPS, orientation, ICC, XMP, IPTC)', a.ok && aMeta.format === 'jpeg' && !aMeta.exif && !aMeta.icc && !aMeta.xmp && !aMeta.iptc && (aMeta.orientation ?? 1) === 1)
check('…and none of the original text survives in the bytes', a.ok && !/SyntheticCam|secret-description|QA-1/.test(a.portrait.jpeg.toString('latin1')))
check('…the sha256 is of the stored bytes', a.ok && a.portrait.sha256 === createHash('sha256').update(a.portrait.jpeg).digest('hex'))
const withIcc = await face(800, 1000).jpeg().withIccProfile('p3').toBuffer()
const b = await processPortrait(withIcc)
check('a JPEG with an embedded colour profile comes out sRGB with no profile', b.ok && !(await sharp(b.portrait.jpeg).metadata()).icc && (await sharp(withIcc).metadata()).icc)
const png = await sharp({ create: { width: 600, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
const c = await processPortrait(png)
const cPixel = c.ok ? (await sharp(c.portrait.jpeg).raw().toBuffer({ resolveWithObject: true })).data : null
check('a transparent PNG passes and gets a white background, never black', c.ok && cPixel && cPixel[0] > 240 && cPixel[1] > 240 && cPixel[2] > 240)
const webp = await face(500, 700).webp().toBuffer()
check('a WebP passes, kept at its size (never enlarged)', await processPortrait(webp).then((r) => r.ok && r.portrait.width === 500 && r.portrait.height === 700))
const big = await processPortrait(await solid(6000, 4000).jpeg({ quality: 95 }).toBuffer())
check('a 24-megapixel photo passes, scaled to 1024 px, under 2 MB', big.ok && big.portrait.width === 1024 && big.portrait.jpeg.length < 2 * 1024 * 1024)
const cmyk = await solid(400, 500).toColourspace('cmyk').jpeg().toBuffer()
check('a CMYK JPEG comes out as an ordinary sRGB JPEG', await processPortrait(cmyk).then(async (r) => r.ok && (await sharp(r.portrait.jpeg).metadata()).space === 'srgb'))

section('what is refused, before anything is stored')
check('the signature decides, not the name: JPEG, PNG and WebP only', sniffImage(exifJpeg) === 'jpeg' && sniffImage(png) === 'png' && sniffImage(webp) === 'webp' && sniffImage(Buffer.from('GIF89a')) === null)
await refusal('an empty body', Buffer.alloc(0), 'not_an_image')
await refusal('an SVG (active content)', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'), 'not_an_image')
await refusal('an HTML page', Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>'), 'not_an_image')
await refusal('a PDF', Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n'), 'not_an_image')
await refusal('a GIF', await solid(300, 300).gif().toBuffer(), 'not_an_image')
await refusal('an SVG behind a PNG signature (a lying file)', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"/>')]), 'unreadable')
await refusal('a JPEG signature on a PNG body (the decoder disagrees)', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), png.subarray(3)]), 'unreadable')
// A genuinely animated WebP, assembled by hand (VP8X with the animation flag, ANIM, two ANMF frames): sharp itself writes only the
// first page here, so a joined image would not be animated and would prove nothing.
const u24 = (n) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255])
const chunk = (id, data) => { const h = Buffer.alloc(8); h.write(id, 0, 'ascii'); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]) }
const frameOf = async (colour) => {
  const b = await sharp({ create: { width: 300, height: 300, channels: 3, background: colour } }).webp({ lossless: true }).toBuffer()
  for (let i = 12; i < b.length;) { const id = b.toString('ascii', i, i + 4), n = b.readUInt32LE(i + 4); if (id === 'VP8L' || id === 'VP8 ') return chunk(id, b.subarray(i + 8, i + 8 + n)); i += 8 + n + (n % 2) }
  throw new Error('no frame')
}
const anmf = async (colour) => chunk('ANMF', Buffer.concat([u24(0), u24(0), u24(299), u24(299), u24(100), Buffer.from([0]), await frameOf(colour)]))
const animBody = Buffer.concat([Buffer.from('WEBP'), chunk('VP8X', Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(299), u24(299)])), chunk('ANIM', Buffer.alloc(6)), await anmf('#ff0000'), await anmf('#0000ff')])
const size = Buffer.alloc(4); size.writeUInt32LE(animBody.length)
const animated = Buffer.concat([Buffer.from('RIFF'), size, animBody])
check('the crafted WebP really has two frames', (await sharp(animated).metadata()).pages === 2)
await refusal('an animated WebP', animated, 'animated')
await refusal('a truncated JPEG', exifJpeg.subarray(0, Math.floor(exifJpeg.length / 3)), 'unreadable')
await refusal('a picture smaller than 200 px on a side', await solid(150, 400).jpeg().toBuffer(), 'too_small')
await refusal('a sideways picture that is too small once upright', await solid(400, 150).jpeg().withMetadata({ orientation: 6 }).toBuffer(), 'too_small')
await refusal('a decompression bomb (a tiny PNG that declares 60 megapixels)', await sharp({ create: { width: 10000, height: 6000, channels: 3, background: '#000' } }).png({ compressionLevel: 9, palette: true }).toBuffer(), 'too_many_pixels')
await refusal('more than 8 MB of bytes', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(8 * 1024 * 1024)]), 'too_large')
check('every refusal has a Hebrew sentence and none of them echoes a file name or content', Object.values(PORTRAIT_TEXT).every((t) => /[֐-׿]/.test(t) && !/\{|\$/.test(t)) && Object.keys(PORTRAIT_TEXT).length === 7)

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
