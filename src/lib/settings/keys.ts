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

// The customer feedback box's own on/off switch (mirrors AyekaBar's
// customer_feedback_enabled) — re-read server-side on every POST
// /api/feedback, never trusted from the page. Default true, fails open:
// same reasoning as the cart above, this gates a convenience, not
// anything with a security cost when left on.
export const CUSTOMER_FEEDBACK_ENABLED_KEY = 'customer_feedback_enabled'
export const DEFAULT_CUSTOMER_FEEDBACK_ENABLED = true

// The portal's opening screen (src/components/intro, docs/SARCAFE_INTRO.md): the
// dark opening with the cream badge and the two lines of copy. The owner's
// on/off, at /owner/intro (mirrors AyekaBar's intro_enabled).
//
// Defaults to ON and FAILS OPEN, same posture as the cart and the feedback box,
// for the same reason: it is a decoration the owner asked for, with no data path
// behind it, so a settings-read blip must not silently remove it. Only an
// explicit `false` turns it off (normalizeIntroEnabled in lib/intro/config — a
// hand-edited row can't switch it off by accident). And the read itself is
// time-boxed (IntroGate): the intro is a layer on top of EVERY page, so its
// switch must never be the reason a page is slow.
//
// Public read (the signed-out portal's own HTML decides whether the overlay
// exists), so the row is written is_public = true. No migration: the owner API
// (/api/owner/intro) upserts it on the first flip, exactly as
// customer_feedback_enabled's does — until then the missing row simply reads as
// the default, ON.
export const INTRO_ENABLED_KEY = 'intro_enabled'
export const DEFAULT_INTRO_ENABLED = true
