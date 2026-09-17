// Ported per BLUEPRINT.md §7.3 — all user conveniences, none a compliance
// mechanism (the code-level baseline in §7.2 is what actually carries
// compliance; this widget is the bonus layer on top of it).

export type FontScale = 0 | 1 | 2 | 3 | 4
export type Spacing = 0 | 1 | 2 | 3
export type Contrast = 'default' | 'high' | 'grayscale' | 'invert'

export interface A11yPrefs {
  fontScale: FontScale
  spacing: Spacing
  contrast: Contrast
  pauseAnimations: boolean
  readingGuide: boolean
  highlightLinks: boolean
  highlightHeadings: boolean
  bigCursor: boolean
}

export const DEFAULT_A11Y_PREFS: A11yPrefs = {
  fontScale: 0,
  spacing: 0,
  contrast: 'default',
  pauseAnimations: false,
  readingGuide: false,
  highlightLinks: false,
  highlightHeadings: false,
  bigCursor: false,
}

export const FONT_SCALE_STEPS: FontScale[] = [0, 1, 2, 3, 4]
export const SPACING_STEPS: Spacing[] = [0, 1, 2, 3]
export const CONTRAST_MODES: Contrast[] = ['default', 'high', 'grayscale', 'invert']
