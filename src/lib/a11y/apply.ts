import type { A11yPrefs } from './types'

const FONT_SCALE_CLASSES = ['a11y-font-1', 'a11y-font-2', 'a11y-font-3', 'a11y-font-4'] as const
const SPACING_CLASSES = ['a11y-spacing-1', 'a11y-spacing-2', 'a11y-spacing-3'] as const
const CONTRAST_CLASSES = ['a11y-contrast-high', 'a11y-contrast-grayscale', 'a11y-contrast-invert'] as const
const OTHER_CLASSES = ['a11y-pause-animations', 'a11y-highlight-links', 'a11y-highlight-headings', 'a11y-big-cursor'] as const

/** Every class classesFor() can ever emit, in one place — the provider
 *  diffs the scope element against this exact list to know what to
 *  remove, so a drift here is a class that gets added and never cleaned
 *  up. scripts/check-a11y.mjs loops every combination of the boolean
 *  flags and asserts nothing outside this list is ever produced
 *  (BLUEPRINT.md §12.1's "exhaustive enumeration where the space is
 *  small"). */
export const ALL_A11Y_CLASSES: readonly string[] = [...FONT_SCALE_CLASSES, ...SPACING_CLASSES, ...CONTRAST_CLASSES, ...OTHER_CLASSES]

export function classesFor(prefs: A11yPrefs): string[] {
  const classes: string[] = []
  if (prefs.fontScale > 0) classes.push(FONT_SCALE_CLASSES[prefs.fontScale - 1]!)
  if (prefs.spacing > 0) classes.push(SPACING_CLASSES[prefs.spacing - 1]!)
  if (prefs.contrast !== 'default') classes.push(`a11y-contrast-${prefs.contrast}` as (typeof CONTRAST_CLASSES)[number])
  if (prefs.pauseAnimations) classes.push('a11y-pause-animations')
  if (prefs.highlightLinks) classes.push('a11y-highlight-links')
  if (prefs.highlightHeadings) classes.push('a11y-highlight-headings')
  if (prefs.bigCursor) classes.push('a11y-big-cursor')
  return classes
}

/** Applies (and un-applies) the computed classes on the given element —
 *  #a11y-scope, and ONLY #a11y-scope. Never <html>/<body>: `filter`
 *  triggers the identical containing-block behavior `transform` does
 *  (BLUEPRINT.md §4.14a) — putting it on the root would silently
 *  relocate every position:fixed control on the site, this widget's own
 *  launcher/panel included, which is exactly why those are mounted
 *  outside the scope entirely. */
export function applyPrefs(el: HTMLElement, prefs: A11yPrefs): void {
  const next = new Set(classesFor(prefs))
  for (const cls of ALL_A11Y_CLASSES) {
    el.classList.toggle(cls, next.has(cls))
  }
}
