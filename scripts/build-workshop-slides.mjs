// Rebuilds the coffee workshop pictures from the PowerPoint deck, so the deck stays the one source:
//
//   node scripts/build-workshop-slides.mjs [path/to/deck.pptx]
//
// 1. scripts/workshop/render_deck.py draws every slide as HTML (the deck is plain shapes, text, pictures and tables);
// 2. headless Edge (or TEST_BROWSER) photographs each one at 1920x1080;
// 3. sharp writes public/workshop/slide-NN.webp (1600 px) and cover.webp, and src/lib/workshop/slides.ts is rewritten
//    with each slide's title and text (read from the deck, for screen readers).
// It needs python on the PATH and a Chromium-family browser, and runs only on the developer's machine, never at deploy.
// The deck is read as data: nothing in it is executed. See docs/WORKSHOP.md.

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DECK = resolve(process.argv[2] ?? join(ROOT, 'public/workshop/sarcafe-coffee-workshop.pptx'))
const DEST = join(ROOT, 'public/workshop')
const BROWSER = process.env.TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
// A title typed with its brackets in logical order (")בלנדים(") only reads right inside the slide; the label here is plain.
const TITLE_OVERRIDES = { 6: 'תערובות (בלנדים)' }
if (!existsSync(DECK)) throw new Error(`deck not found: ${DECK}`)

const work = mkdtempSync(join(tmpdir(), 'workshop-'))
process.on('exit', () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* temp dir */ } })

const py = spawnSync('python', ['-I', join(ROOT, 'scripts/workshop/render_deck.py'), DECK, join(work, 'html')], { encoding: 'utf8' })
if (py.status !== 0) throw new Error(`render_deck.py failed:\n${py.stderr || py.stdout}`)
console.log(py.stdout.trim())

const { chromium } = require('playwright')
const sharp = require('sharp')
mkdirSync(DEST, { recursive: true })
const browser = await chromium.launch({ executablePath: BROWSER, headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const files = readdirSync(join(work, 'html')).filter((f) => /^slide-\d+\.html$/.test(f)).sort()
let kb = 0
for (const file of files) {
  await page.goto(pathToFileURL(join(work, 'html', file)).href)
  await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => (img.complete ? null : img.decode().catch(() => null)))))
  await page.evaluate(() => document.fonts.ready)
  const png = await page.locator('#slide').screenshot()
  const out = join(DEST, file.replace('.html', '.webp'))
  await sharp(png).resize(1600, 900).webp({ quality: 82, effort: 5 }).toFile(out)
  kb += readFileSync(out).length / 1024
  if (file === 'slide-01.html') await sharp(png).resize(640, 360).webp({ quality: 80 }).toFile(join(DEST, 'cover.webp'))
}
await browser.close()
console.log(`${files.length} slides, ${Math.round(kb)} KB`)

// The text of each slide, for screen readers.
const manifest = JSON.parse(readFileSync(join(work, 'html', 'manifest.json'), 'utf8'))
const slides = manifest.map((slide, index) => ({ n: index + 1, src: `/workshop/slide-${String(index + 1).padStart(2, '0')}.webp`, title: TITLE_OVERRIDES[index + 1] ?? slide.title, text: slide.text }))
const target = join(ROOT, 'src/lib/workshop/slides.ts')
const current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
const next = current.replace(/export const WORKSHOP_SLIDES: WorkshopSlide\[\] = [\s\S]*$/, `export const WORKSHOP_SLIDES: WorkshopSlide[] = ${JSON.stringify(slides, null, 2)}\n`)
if (next !== current) writeFileSync(target, next)
console.log(next === current ? 'slides.ts unchanged' : 'slides.ts updated')
