import type { A11yPrefs } from './types'

const FONT_SCALE_CLASSES = ['a11y-font-1', 'a11y-font-2', 'a11y-font-3', 'a11y-font-4'] as const
const SPACING_CLASSES = ['a11y-spacing-1', 'a11y-spacing-2', 'a11y-spacing-3'] as const
const CONTRAST_CLASSES = ['a11y-contrast-high', 'a11y-contrast-grayscale', 'a11y-contrast-invert'] as const
const OTHER_CLASSES = ['a11y-pause-animations', 'a11y-highlight-links', 'a11y-highlight-headings', 'a11y-big-cursor'] as const

/** Every class classesFor() can ever emit, in one place — the provider
 *  diffs the target elements against this exact list to know what to
 *  remove, so a drift here is a class that gets added and never cleaned
 *  up. scripts/check-a11y.mjs loops every combination of the boolean
 *  flags and asserts nothing outside this list is ever produced
 *  (BLUEPRINT.md §12.1's "exhaustive enumeration where the space is
 *  small"). */
export const ALL_A11Y_CLASSES: readonly string[] = [...FONT_SCALE_CLASSES, ...SPACING_CLASSES, ...CONTRAST_CLASSES, ...OTHER_CLASSES]

/** Font scale specifically goes on <html>, everything else on #a11y-scope
 *  — the one deliberate exception to "never <html>/<body>." This
 *  codebase's type scale is rem-based throughout (verified: MenuView,
 *  CategoryAccordion, the cart, all of it), and `rem` is ALWAYS relative
 *  to the root element's font-size, full stop — no intermediate ancestor,
 *  however it's scoped, can change what rem resolves against. Setting it
 *  on #a11y-scope compiled and shipped but visibly did nothing (confirmed
 *  live on a real phone). `font-size` isn't in the small set of
 *  properties that create a containing block for position:fixed
 *  (transform/filter/perspective/…), so unlike the filter-based contrast
 *  modes, putting it on <html> carries none of §4.14a's risk. */
export function htmlClassesFor(prefs: A11yPrefs): string[] {
  return prefs.fontScale > 0 ? [FONT_SCALE_CLASSES[prefs.fontScale - 1]!] : []
}

export function scopeClassesFor(prefs: A11yPrefs): string[] {
  const classes: string[] = []
  if (prefs.spacing > 0) classes.push(SPACING_CLASSES[prefs.spacing - 1]!)
  if (prefs.contrast !== 'default') classes.push(`a11y-contrast-${prefs.contrast}` as (typeof CONTRAST_CLASSES)[number])
  if (prefs.pauseAnimations) classes.push('a11y-pause-animations')
  if (prefs.highlightLinks) classes.push('a11y-highlight-links')
  if (prefs.highlightHeadings) classes.push('a11y-highlight-headings')
  if (prefs.bigCursor) classes.push('a11y-big-cursor')
  return classes
}

/** Kept for the harness's exhaustive-enumeration pass — the union of both
 *  targets' output, since ALL_A11Y_CLASSES tracks everything either one
 *  can ever emit regardless of which element it lands on. */
export function classesFor(prefs: A11yPrefs): string[] {
  return [...htmlClassesFor(prefs), ...scopeClassesFor(prefs)]
}

function setClasses(el: HTMLElement, wanted: string[], universe: readonly string[]): void {
  const next = new Set(wanted)
  for (const cls of universe) {
    el.classList.toggle(cls, next.has(cls))
  }
}

/** Applies (and un-applies) the computed classes across both targets —
 *  font scale on documentElement (<html>), everything else on
 *  #a11y-scope. See htmlClassesFor()'s comment for why the split exists. */
export function applyPrefs(scopeEl: HTMLElement, htmlEl: HTMLElement, prefs: A11yPrefs): void {
  setClasses(htmlEl, htmlClassesFor(prefs), FONT_SCALE_CLASSES)
  setClasses(scopeEl, scopeClassesFor(prefs), ALL_A11Y_CLASSES.filter((c) => !(FONT_SCALE_CLASSES as readonly string[]).includes(c)))
}
