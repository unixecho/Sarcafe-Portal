// The staff app's five looks, chosen by each person when their account is made and changeable from their profile (owner,
// 2026-10-17). PURE: no React, no Supabase. scripts/check-staff-themes.mjs runs this file.
//
// A look is a set of design tokens (src/components/app/staff-themes.css, selected by `data-staff-theme`) plus a few structural
// touches on the home screen; it never changes what a screen says or does. The default is `neon` (the one the app already had,
// polished), used until the person chooses.

export const STAFF_THEMES = ['neon', 'glass', 'pass', 'crema', 'latte'] as const
export type StaffTheme = (typeof STAFF_THEMES)[number]
export const DEFAULT_THEME: StaffTheme = 'neon'

/** Plain cookie (not secret, readable by the wizard): the device's copy of the choice, used when the database has none. */
export const THEME_COOKIE = 'sarcafe_staff_theme'
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** The device remembers that this person has read the "choose your look" notice (it is shown until they do, owner 2026-10-17). */
export const NUDGE_COOKIE = 'sarcafe_theme_ack'
/** The home screen's "מראה האפליקציה" row: where the notice's "take me there" scrolls to and points at. */
export const THEME_ROW_ID = 'theme-row'

/** `swatch` is only for the small colour dots in the notice and the picker: the ground and the accent of each look. */
export type ThemeInfo = { id: StaffTheme; name: string; blurb: string; mode: 'dark' | 'light'; swatch: { ground: string; accent: string } }

export const THEMES: readonly ThemeInfo[] = [
  { id: 'neon', name: 'ניאון קלאסי', blurb: 'כהה וחם עם זוהר כתום. כרטיס המשמרת מאיר.', mode: 'dark', swatch: { ground: '#110b08', accent: '#ff7a45' } },
  { id: 'glass', name: 'זכוכית', blurb: 'כרטיסי זכוכית מעומעמת על רקע של עגלה בלילה.', mode: 'dark', swatch: { ground: '#2b1a12', accent: '#ff9566' } },
  { id: 'pass', name: 'כרטיס משמרת', blurb: 'המשמרת כמו כרטיס טיסה: מספרים, קווים וצ׳קליסטים ממוספרים.', mode: 'dark', swatch: { ground: '#0c0907', accent: '#ff7a45' } },
  { id: 'crema', name: 'קרמה ליום', blurb: 'בהיר וחד, נקרא מצוין בשמש. מסגרות עבות וכתום.', mode: 'light', swatch: { ground: '#f4ead9', accent: '#f4601f' } },
  { id: 'latte', name: 'לאטה בלוסם', blurb: 'ורוד של לאטה, עגול ורך, עם לב קטן של קפה.', mode: 'light', swatch: { ground: '#fbece6', accent: '#e45f87' } },
]

export function isStaffTheme(value: unknown): value is StaffTheme {
  return typeof value === 'string' && (STAFF_THEMES as readonly string[]).includes(value)
}

/** Whatever was stored (a database value, a cookie, a request body) as a valid look, or null. */
export function parseTheme(value: unknown): StaffTheme | null {
  return isStaffTheme(value) ? value : null
}

/** The look to draw: the person's choice, the device's copy, or the default. */
export function resolveTheme(db: unknown, cookie: unknown): { theme: StaffTheme; chosen: boolean } {
  const picked = parseTheme(db) ?? parseTheme(cookie)
  return { theme: picked ?? DEFAULT_THEME, chosen: picked !== null }
}

/** On a light look the status bar of an installed iPhone app (white text) sits on a dark band so the clock stays readable. */
export function isLightTheme(theme: StaffTheme): boolean {
  return THEMES.find((item) => item.id === theme)?.mode === 'light'
}
