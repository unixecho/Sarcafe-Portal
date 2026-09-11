// Every app_settings key, with its default value and an explicit fail-open
// vs. fail-closed posture — mirrors AyekaBar's settings/keys.ts convention
// of documenting that choice per key rather than leaving it implicit.

export type AccessibilityStatement = {
  browsersTested?: string
  entranceAccess?: string
  restroomAccess?: string
  generalNote?: string
  exemptionNote?: string
  contactName?: string
  contactPhone?: string
  contactEmail?: string
}

export const SETTINGS_TAG = 'app-settings'

export const DEFAULT_ACCESSIBILITY_STATEMENT: AccessibilityStatement = {}

// Default true, fails open: this gates a purely client-side, no-data-path
// convenience (a local tally cart on the public menu) — failing closed
// would just remove a nice-to-have for no security benefit.
export const DEFAULT_MENU_CART_ENABLED = true
