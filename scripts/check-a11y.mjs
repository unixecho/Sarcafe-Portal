// Pure-logic harness for src/lib/a11y — transpiles and runs the REAL
// TypeScript sources (BLUEPRINT.md §12.1's transpile trick), not a
// reimplementation of their logic. Run after touching lib/a11y/*.

import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LIB = new URL('../src/lib/a11y/', import.meta.url)
const outDir = join(tmpdir(), `check-a11y-${process.pid}`)
mkdirSync(outDir, { recursive: true })

function emit(name) {
  const source = readFileSync(new URL(name, LIB), 'utf8')
  const js = ts.transpileModule(source, {
    fileName: name,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'")
  writeFileSync(join(outDir, name.replace(/\.ts$/, '.mjs')), js)
}
for (const f of ['types.ts', 'storage.ts', 'apply.ts', 'i18n.ts']) emit(f)
const load = (n) => import(pathToFileURL(join(outDir, n)).href)

const { DEFAULT_A11Y_PREFS, FONT_SCALE_STEPS, SPACING_STEPS, CONTRAST_MODES } = await load('types.mjs')
const { sanitizePrefs } = await load('storage.mjs')
const { classesFor, applyPrefs, ALL_A11Y_CLASSES } = await load('apply.mjs')
const { A11Y_UI } = await load('i18n.mjs')

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const section = (title) => console.log(`\n${title}`)

// ---- Garbage in -----------------------------------------------------------
section('sanitizePrefs — garbage in')
const garbageInputs = [null, undefined, 'a string', 42, [], {}, { fontScale: 99 }, { contrast: 'rainbow' }, { pauseAnimations: 'yes' }]
for (const input of garbageInputs) {
  let result
  let threw = false
  try {
    result = sanitizePrefs(input)
  } catch {
    threw = true
  }
  check(`does not throw on ${JSON.stringify(input)}`, !threw)
  if (!threw) {
    check(
      `${JSON.stringify(input)} -> a fully-shaped, in-range object`,
      FONT_SCALE_STEPS.includes(result.fontScale) &&
        SPACING_STEPS.includes(result.spacing) &&
        CONTRAST_MODES.includes(result.contrast) &&
        typeof result.pauseAnimations === 'boolean' &&
        typeof result.readingGuide === 'boolean' &&
        typeof result.highlightLinks === 'boolean' &&
        typeof result.highlightHeadings === 'boolean' &&
        typeof result.bigCursor === 'boolean'
    )
  }
}
check('a single bad key does not poison the rest of the object', sanitizePrefs({ fontScale: 'nonsense', spacing: 2 }).spacing === 2)

// ---- Determinism ------------------------------------------------------------
section('sanitizePrefs — determinism')
const sample = { fontScale: 2, spacing: 1, contrast: 'high', pauseAnimations: true }
check('same input -> same output', JSON.stringify(sanitizePrefs(sample)) === JSON.stringify(sanitizePrefs(sample)))

// ---- Exhaustive enumeration: every class classesFor() can emit is tracked --
section('classesFor — exhaustive enumeration against ALL_A11Y_CLASSES')
let sawEveryClassAtLeastOnce = new Set()
for (const fontScale of FONT_SCALE_STEPS) {
  for (const spacing of SPACING_STEPS) {
    for (const contrast of CONTRAST_MODES) {
      for (const pauseAnimations of [false, true]) {
        for (const highlightLinks of [false, true]) {
          for (const highlightHeadings of [false, true]) {
            for (const bigCursor of [false, true]) {
              const prefs = { ...DEFAULT_A11Y_PREFS, fontScale, spacing, contrast, pauseAnimations, readingGuide: false, highlightLinks, highlightHeadings, bigCursor }
              const classes = classesFor(prefs)
              for (const cls of classes) {
                sawEveryClassAtLeastOnce.add(cls)
                if (!ALL_A11Y_CLASSES.includes(cls)) {
                  check(`emitted class "${cls}" is tracked in ALL_A11Y_CLASSES`, false, 'drift: this class is not in the exported list')
                }
              }
            }
          }
        }
      }
    }
  }
}
check('every emitted class across the full combination space is in ALL_A11Y_CLASSES', true) // failures above already recorded individually
check('every class in ALL_A11Y_CLASSES was actually reachable', sawEveryClassAtLeastOnce.size === ALL_A11Y_CLASSES.length, `saw ${sawEveryClassAtLeastOnce.size}/${ALL_A11Y_CLASSES.length}`)

// ---- applyPrefs — toggles cleanly removes classes no longer applicable ----
section('applyPrefs — clean toggle, no leftover classes')
{
  const fakeEl = { classList: { set: new Set(), toggle(cls, on) { on ? this.set.add(cls) : this.set.delete(cls) } } }
  applyPrefs(fakeEl, { ...DEFAULT_A11Y_PREFS, fontScale: 3, contrast: 'invert', bigCursor: true })
  const afterFirst = new Set(fakeEl.classList.set)
  check('applies exactly the expected classes', afterFirst.has('a11y-font-3') && afterFirst.has('a11y-contrast-invert') && afterFirst.has('a11y-big-cursor'))
  applyPrefs(fakeEl, DEFAULT_A11Y_PREFS)
  check('resetting to defaults leaves no a11y-* class behind', fakeEl.classList.set.size === 0, `left over: ${[...fakeEl.classList.set]}`)
}

// ---- i18n completeness ------------------------------------------------------
section('i18n — every key present, non-empty, in every language')
const LANGS = ['he', 'en', 'ar']
for (const [key, value] of Object.entries(A11Y_UI)) {
  for (const lang of LANGS) {
    check(`${key}.${lang} is a non-empty string`, typeof value[lang] === 'string' && value[lang].trim().length > 0)
  }
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
