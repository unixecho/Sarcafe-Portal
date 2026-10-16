// The employee onboarding wizard's steps, the words for sharing the link, and how the invite link SURVIVES — PURE (no React, no
// Supabase). scripts/check-onboarding-wizard.mjs runs this file.
//
// Aligned with the Ayeka Bar wizard (2026-10-16), with the owner's first rule on top: before anything else the device must be able
// to be told things. So the walk is: SETUP (put the app on the Home Screen, turn notifications on) -> welcome -> choose a code ->
// connect Google (skippable) -> my details -> my style (one of five looks) -> a short tour (the "demo") -> the employee home. The security chain underneath is
// unchanged: a one-time link sets a code, and a Google account is linked only with that code as proof.

export type WizardStep = 'dead' | 'recover' | 'setup' | 'welcome' | 'code' | 'google' | 'details' | 'style' | 'tour'

export const WIZARD_STEPS: readonly { id: Exclude<WizardStep, 'dead' | 'recover'>; label: string }[] = [
  { id: 'setup', label: 'אפליקציה והתראות' },
  { id: 'welcome', label: 'ברוכים הבאים' },
  { id: 'code', label: 'קוד אישי' },
  { id: 'google', label: 'חשבון Google' },
  { id: 'details', label: 'הפרטים שלי' },
  { id: 'style', label: 'סגנון' },
  { id: 'tour', label: 'סיור קצר' },
]

export type WizardState = {
  /** the link/session gave us a person */
  person: boolean
  /** there is no link in the address, none remembered on this device, and nobody is signed in */
  noLink: boolean
  /** this device is on the Home Screen (phones) with notifications on: the gate passed */
  gateDone: boolean
  /** the personal code is set (this browser is signed in as the employee) */
  coded: boolean
  welcomed: boolean
  hasGoogle: boolean
  googleSkipped: boolean
  /** the person returned from Google (or resumed) and is continuing */
  continuing: boolean
  detailsDone: boolean
  /** the look was chosen (or skipped, or already chosen on this device). Optional: a caller that does not know about the step skips it. */
  styleDone?: boolean
}

/** Which screen the wizard shows. */
export function wizardStep(s: WizardState): WizardStep {
  if (!s.person) return s.noLink ? 'recover' : 'dead'
  // Always first, every time the walk is entered (also when resuming after the app was closed): it passes at once when the device is ready.
  if (!s.gateDone) return 'setup'
  if (!s.coded) return s.welcomed ? 'code' : 'welcome'
  if (!s.hasGoogle && !s.googleSkipped && !s.continuing) return 'google'
  if (!s.detailsDone) return 'details'
  // 2026-10-17: after the details and before the tour, each person picks the look of the app (src/lib/staff/theme.ts).
  if (s.styleDone === false) return 'style'
  return 'tour'
}

/** 0-based position for the progress dots. */
export function progressIndex(step: WizardStep): number {
  const at = WIZARD_STEPS.findIndex((x) => x.id === step)
  return at < 0 ? 0 : at
}

/** Where the tour ends: the employee home, signed in. */
export const WIZARD_END_HREF = '/staff'

// ---- the invite link survives -------------------------------------------------------------------------------------
//
// An installed Home Screen app has its OWN storage (an iPhone does not share cookies or localStorage between Safari and the app),
// so the link a person opened in the browser is not there when they open the icon. Three things bring it back, in this order:
//   1. the address the icon was saved from (the link stays in the address bar through the setup step, fragment included),
//   2. the link remembered on THIS device (localStorage, written when it was first seen, forgotten the moment the code is set),
//   3. the person pastes it (they still have the message): `parseInvite` accepts the whole link or just its code.

export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
export const INVITE_STORE_KEY = 'sarcafe:invite:v1'
/** A link lives seven days (the server's rule); a remembered copy is never kept longer. */
export const INVITE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** The invite code out of whatever a person pastes: the whole link (fragment or query), or the bare 43-character code. */
export function parseInvite(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const text = input.trim()
  if (!text) return null
  const fromFragment = /(?:^|[#?&])invite=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(text)
  if (fromFragment) return fromFragment[1]!
  return INVITE_TOKEN_RE.test(text) ? text : null
}

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export function saveInvite(store: Store | null | undefined, token: string, nowMs: number): void {
  try { if (store && INVITE_TOKEN_RE.test(token)) store.setItem(INVITE_STORE_KEY, JSON.stringify({ token, at: nowMs })) } catch { /* private browsing: the link in the address bar still works */ }
}

/** The remembered link, or null (and forgotten) when it is missing, damaged or older than a link can live. */
export function loadInvite(store: Store | null | undefined, nowMs: number): string | null {
  try {
    if (!store) return null
    const raw = store.getItem(INVITE_STORE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as { token?: unknown; at?: unknown }
    const ok = typeof saved.token === 'string' && INVITE_TOKEN_RE.test(saved.token) && typeof saved.at === 'number' && nowMs - saved.at >= 0 && nowMs - saved.at <= INVITE_MAX_AGE_MS
    if (!ok) { store.removeItem(INVITE_STORE_KEY); return null }
    return saved.token as string
  } catch {
    return null
  }
}

export function clearInvite(store: Store | null | undefined): void {
  try { store?.removeItem(INVITE_STORE_KEY) } catch { /* nothing to forget */ }
}

// ---- sharing the link ---------------------------------------------------------------------------------------------

/** The message the owner sends. `text` ENDS WITH THE LINK, so the phone's share sheet must be given `text` only: giving it the link
 *  as well made some apps (WhatsApp) print it twice. */
export function shareText(firstName: string | null, url: string): string {
  const who = firstName?.trim() ? `היי ${firstName.trim()}, ` : 'היי, '
  return `${who}הוספנו אותך לצוות של Sarcafe. בלחיצה על הקישור מוסיפים את האפליקציה למסך הבית, מפעילים התראות, בוחרים קוד אישי ורואים את המשמרות שלך:\n${url}`
}

/** `sms:` opens the messages app with the text filled in; no phone number is put in the link (the owner picks the person). */
export function shareLinks(text: string): { sms: string } {
  return { sms: `sms:?&body=${encodeURIComponent(text)}` }
}

/** "עד 23/10" — until when a link works. */
export function expiryLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'שבוע'
  return d.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' })
}
