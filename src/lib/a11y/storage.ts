import {
  DEFAULT_A11Y_PREFS,
  FONT_SCALE_STEPS,
  SPACING_STEPS,
  CONTRAST_MODES,
  type A11yPrefs,
  type Contrast,
  type FontScale,
  type Spacing,
} from './types'

const STORAGE_KEY = 'sarcafe:a11y-prefs'

function sanitizeFontScale(v: unknown): FontScale {
  return (FONT_SCALE_STEPS as unknown[]).includes(v) ? (v as FontScale) : DEFAULT_A11Y_PREFS.fontScale
}
function sanitizeSpacing(v: unknown): Spacing {
  return (SPACING_STEPS as unknown[]).includes(v) ? (v as Spacing) : DEFAULT_A11Y_PREFS.spacing
}
function sanitizeContrast(v: unknown): Contrast {
  return (CONTRAST_MODES as unknown[]).includes(v) ? (v as Contrast) : DEFAULT_A11Y_PREFS.contrast
}
function sanitizeBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** Falls back per-field, never throws, never poisons the whole object over
 *  one bad key — checked exhaustively by scripts/check-a11y.mjs against
 *  null/undefined/a string/an array/{}/out-of-range values/invented enum
 *  members, per BLUEPRINT.md §12.1's "garbage in" requirement. */
export function sanitizePrefs(raw: unknown): A11yPrefs {
  const r = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  return {
    fontScale: sanitizeFontScale(r.fontScale),
    spacing: sanitizeSpacing(r.spacing),
    contrast: sanitizeContrast(r.contrast),
    pauseAnimations: sanitizeBool(r.pauseAnimations, DEFAULT_A11Y_PREFS.pauseAnimations),
    readingGuide: sanitizeBool(r.readingGuide, DEFAULT_A11Y_PREFS.readingGuide),
    highlightLinks: sanitizeBool(r.highlightLinks, DEFAULT_A11Y_PREFS.highlightLinks),
    highlightHeadings: sanitizeBool(r.highlightHeadings, DEFAULT_A11Y_PREFS.highlightHeadings),
    bigCursor: sanitizeBool(r.bigCursor, DEFAULT_A11Y_PREFS.bigCursor),
  }
}

export function loadPrefs(): A11yPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_A11Y_PREFS
    return sanitizePrefs(JSON.parse(raw))
  } catch {
    return DEFAULT_A11Y_PREFS
  }
}

export function savePrefs(prefs: A11yPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Private browsing / quota — the session still works, just doesn't persist.
  }
}
