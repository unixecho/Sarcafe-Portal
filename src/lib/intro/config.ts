// The intro's timeline and rules — pure, no React, no DOM, safe on server and
// client. Exercised by scripts/check-intro.mjs against THIS file.
//
// Sarcafe's portal intro, ported from Ayeka.Bar's (BLUEPRINT §4.15): the same
// mechanics (stages, skip, failsafe, two lengths, the owner's switch), a look of
// its own (docs/SARCAFE_INTRO.md). A dark screen, the cream badge warming like a
// café lamp, two lines arriving word by word, then the page.
//
// ONE SOURCE for every number. The component feeds `introCssVars()` into the
// overlay's inline style and intro.css reads them with var(), so the stylesheet
// carries no timing of its own: to make the intro faster or slower, edit this
// file and nothing else. The harness fails if the stylesheet reads a variable
// this file doesn't provide, or the other way round.
//
// TWO VERSIONS, because it runs on every full load:
//   • FIRST — a device that has never seen it. A real welcome: the lamp warms,
//     the cart's string lights catch one after another, steam rises behind the
//     badge, the words are given room. About five seconds.
//   • REPEAT — every load after that. The short one: about three seconds. The
//     numbers are Ayeka's approved ones and the harness PINS them, so a later
//     tweak to the welcome can never quietly lengthen the one people see daily.
// Either can be skipped with a tap, a key or a scroll.
//
// WHICH WORDS. There are several lines (copy.ts) and a visit gets a different
// one from the last, so a regular is not read the same sentence every morning.
// The very first line a device ever sees is line one, the one the owner chose.
//
// WHERE IT PLAYS
// The portal home `/` on every full document load. `/menu` is deliberately not on
// the list: that is where a table's QR code or NFC chip lands, and someone who
// scanned to read the menu should not sit through a brand moment first. The
// staff and owner areas are not on it either — they are refreshed dozens of
// times a shift. The one addition is the INSTALLED CUSTOMER APP: its manifest
// opens it at `/order` (the order tracker), so that exact path plays the intro
// too — but only inside the installed app (display-mode: standalone), decided in
// CSS, so a customer who opens /order in a browser tab never sees it.

export type IntroEntry = 'site' | 'app'

export const INTRO_PATHS: readonly string[] = ['/', '/order']

/** Paths that play the intro ONLY when launched as the installed app. */
export const INTRO_APP_ONLY_PATHS: readonly string[] = ['/order']

export function isIntroPath(pathname: string | null | undefined): boolean {
  return typeof pathname === 'string' && INTRO_PATHS.includes(pathname)
}

/** How the intro is entered at this path: `site` plays for everyone, `app` only
 *  in the installed app (the overlay is rendered but hidden by CSS elsewhere, so
 *  there is no flash for a browser visitor and no hydration mismatch — the server
 *  cannot know the display mode). `null`: not an intro path. */
export function introEntry(pathname: string | null | undefined): IntroEntry | null {
  if (!isIntroPath(pathname)) return null
  return INTRO_APP_ONLY_PATHS.includes(pathname as string) ? 'app' : 'site'
}

// ---- the owner's switch --------------------------------------------------

/** The value stored for the owner's on/off switch (`intro_enabled` in
 *  app_settings, key + default in lib/settings/keys.ts). The row is owner-
 *  written but hand-editable in the SQL editor, so ONLY an explicit `false`
 *  turns the intro off. A missing row, `null`, the string "false", `0`, anything
 *  odd: the intro stays ON. It is a decoration the owner asked for, so a
 *  settings blip must never silently remove it. */
export function normalizeIntroEnabled(raw: unknown): boolean {
  return raw !== false
}

/** Resolves to `fallback` if `work` has not settled within `ms`, and never
 *  rejects. The intro is a layer on top of EVERY page (the layout renders it),
 *  so reading its switch must never be the reason a page is slow: a Supabase
 *  that hangs instead of failing would otherwise stall every route's render
 *  until the platform's own timeout. The timer is cleared the moment the work
 *  settles, so nothing is left running behind a fast read. */
export function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    work.then(
      (v) => { clearTimeout(timer); resolve(v) },
      () => { clearTimeout(timer); resolve(fallback) },
    )
  })
}

/** How long the page waits for the switch before showing the intro anyway. */
export const INTRO_GATE_TIMEOUT_MS = 1500

// ---- which version a visitor sees ---------------------------------------

export type IntroVariant = 'first' | 'repeat'

/** localStorage key remembering that this device has been shown the welcome.
 *  Per device, not per language, and it never expires. */
export const INTRO_SEEN_KEY = 'sarcafe.intro.seen.v1'

export interface VariantInput {
  /** `?intro=` from the URL — the owner's preview links. */
  forced: string | null | undefined
  /** This device already has the seen marker. */
  seen: boolean
  /** The marker could actually be stored (private windows and blocked storage
   *  throw). */
  canRemember: boolean
}

/** True for the two values `?intro=` may take. Anything else is ignored. */
export function isForcedVariant(v: string | null | undefined): v is IntroVariant {
  return v === 'first' || v === 'repeat'
}

/** Which version to play, and whether this load is only a preview.
 *
 *  A device that cannot remember gets the SHORT version, every time: if the
 *  welcome could not be marked as seen it would play on every load, which is
 *  exactly the tiring thing this design exists to avoid. A preview
 *  (`?intro=first` / `?intro=repeat`) plays whichever was asked for and — the
 *  caller's job — does not touch the marker, so previewing never uses up a real
 *  first visit. */
export function pickVariant(i: VariantInput): { variant: IntroVariant; preview: boolean } {
  if (isForcedVariant(i.forced)) return { variant: i.forced, preview: true }
  if (!i.canRemember || i.seen) return { variant: 'repeat', preview: false }
  return { variant: 'first', preview: false }
}

// ---- which line a visit gets --------------------------------------------

/** localStorage key remembering which line this device was shown last. */
export const INTRO_LINE_KEY = 'sarcafe.intro.line.v1'

export interface LineInput {
  /** `?line=` from the URL (1-based) — the owner's preview links. */
  forced: string | null | undefined
  /** The stored index (0-based) of the line shown last time. */
  last: string | null | undefined
  /** How many lines there are. */
  count: number
  /** Storage works on this device. */
  canRemember: boolean
  /** A random number in [0, 1). Injected so the rule is testable. */
  rand: () => number
}

const DIGITS = /^\d{1,3}$/

/** True when `?line=` names a real line (1..count): the owner's preview. */
export function isForcedLine(v: string | null | undefined, count: number): boolean {
  return typeof v === 'string' && DIGITS.test(v) && Number(v) >= 1 && Number(v) <= count
}

/** Which line this visit plays (0-based), and whether it is only a preview.
 *
 *  • `?line=3` plays the third line as a PREVIEW (writes nothing).
 *  • A device that has never been shown a line gets line ONE — the one the owner
 *    chose first — so a first impression is always that line.
 *  • After that, a random OTHER line: never the same one twice in a row, but no
 *    fixed order either, so it does not feel like a slideshow.
 *  • A device that cannot remember (a private window) gets a random line:
 *    without a "last" there is nothing to avoid repeating, and nothing to lose. */
export function pickLine(i: LineInput): { index: number; preview: boolean } {
  const n = Math.max(1, Math.floor(i.count))
  if (isForcedLine(i.forced, n)) return { index: Number(i.forced) - 1, preview: true }
  const below = (m: number) => Math.min(m - 1, Math.max(0, Math.floor(i.rand() * m)))
  if (!i.canRemember) return { index: below(n), preview: false }
  const last = typeof i.last === 'string' && DIGITS.test(i.last) ? Number(i.last) : null
  if (last === null || last >= n || n === 1) return { index: 0, preview: false }
  const r = below(n - 1)
  return { index: r >= last ? r + 1 : r, preview: false }
}

// ---- the timelines -------------------------------------------------------

/** The longest the whole show may take, from the moment the lamp is lit to the
 *  moment the overlay is gone. It runs on EVERY refresh, so for the repeat
 *  version this number is the difference between "a nice touch" and "I stopped
 *  refreshing the page"; the welcome gets more room because it is shown once.
 *  The harness holds every line in every language to it. */
export const INTRO_BUDGET_MS: Record<IntroVariant, number> = { repeat: 3000, first: 5500 }

interface Line { atMs: number; stepMs: number; wordMs: number }
interface Span { atMs: number; ms: number }

export interface IntroTiming {
  /** The badge and the halo behind it warming up. */
  litMs: number
  /** The thin amber rule between the badge and the words. */
  rule: Span
  /** A sheen of candlelight crossing the badge, once. */
  glint: Span
  /** The headline, word by word. */
  line1: Line
  /** The sub-line. Starts before the headline has finished in the short
   *  version: the eye is already moving down. */
  line2: Line
  /** The "tap to skip" hint — late and quiet, so a first-time visitor reads
   *  the brand first and a regular reads the way out. */
  hint: Span
  /** How long the finished screen is held before leaving. */
  holdMs: number
  exit: {
    /** The overlay's own fade starts a beat after the content begins to leave,
     *  so the badge and words lead and the dark follows. */
    delayMs: number
    ms: number
    /** The badge + words travelling out (inside the fade above). */
    stageMs: number
    /** After this long into the exit the overlay stops catching taps, so a
     *  button that is already visible can be pressed. */
    passAtMs: number
  }
  /** FIRST ONLY — the string lights: the wire and the unlit bulbs fading in. */
  lights: Span
  /** FIRST ONLY — one bulb warming up (0 in the repeat version). */
  bulbMs: number
  /** FIRST ONLY — one steam wisp's rise, scaled per wisp by its own speed. */
  steamMs: number
}

/** The short version: about three seconds. THESE NUMBERS ARE PINNED by the
 *  harness — they are what Ayeka's owner approved for repeat loads and what
 *  Sarcafe's owner asked to keep (2026-10-08). */
const REPEAT: IntroTiming = {
  litMs: 900,
  rule: { atMs: 200, ms: 460 },
  glint: { atMs: 420, ms: 950 },
  line1: { atMs: 150, stepMs: 55, wordMs: 560 },
  line2: { atMs: 640, stepMs: 32, wordMs: 520 },
  hint: { atMs: 1100, ms: 600 },
  holdMs: 650,
  exit: { delayMs: 100, ms: 560, stageMs: 520, passAtMs: 280 },
  lights: { atMs: 0, ms: 0 },
  bulbMs: 0,
  steamMs: 0,
}

/** The welcome: about five seconds, once per device. The same two lines, given
 *  room — the lamp alone for a beat before any word, a slower headline, a held
 *  finish — plus the two things only this version has: the string lights and the
 *  steam. The skip hint comes earlier here: a first-time visitor is the one who
 *  most needs to know the way out. */
const FIRST: IntroTiming = {
  litMs: 1500,
  rule: { atMs: 900, ms: 600 },
  glint: { atMs: 700, ms: 1300 },
  line1: { atMs: 1000, stepMs: 95, wordMs: 760 },
  line2: { atMs: 2000, stepMs: 52, wordMs: 660 },
  hint: { atMs: 1500, ms: 700 },
  holdMs: 1200,
  exit: { delayMs: 120, ms: 700, stageMs: 640, passAtMs: 340 },
  lights: { atMs: 100, ms: 450 },
  bulbMs: 650,
  steamMs: 2200,
}

export const INTRO_TIMINGS: Record<IntroVariant, IntroTiming> = { first: FIRST, repeat: REPEAT }

/** A tap, key press or scroll — the way out for anyone who has seen it. Not
 *  per-version: leaving early is leaving early. */
export const INTRO_SKIP_MS = 260

/** Before showing anything the component waits for `<html lang>` and
 *  `<html class>` to stop changing: the language switcher (useLanguage) and the
 *  accessibility widget each write them in their own post-hydration effect.
 *  `quietMs` of no change settles it; `maxMs` caps the wait. Happens BEFORE the
 *  version is chosen, so it cannot belong to one. */
export const INTRO_SETTLE = { quietMs: 90, maxMs: 450 } as const

/** If the page's script has not taken over this long after first paint, CSS
 *  hides the overlay on its own. The page underneath is fully server-rendered
 *  and works without script, so a hung bundle must never leave a visitor
 *  looking at a logo. Set before any script runs, so it is shared. */
export const INTRO_FAILSAFE_MS = 4000

// ---- the welcome's string lights and steam -------------------------------

/** The cart's string lights: two swags meeting at the centre top (the way the
 *  lights in the portal's illustration converge on the cart's sign), five bulbs
 *  each. `y` is a fraction of the lights box; bulbs hang from the wire. They
 *  catch in a scattered order, not a sweep: bulbs, not a progress bar. */
const LIGHTS = { y0: 0.08, sag: 0.6, perSwag: 5, from: 300, step: 120, rank: [6, 2, 8, 0, 5, 9, 3, 7, 1, 4] } as const

export interface IntroBulb { x: number; y: number; atMs: number }

export const INTRO_BULBS: readonly IntroBulb[] = (() => {
  const out: IntroBulb[] = []
  for (let s = 0; s < 2; s++) {
    for (let k = 1; k <= LIGHTS.perSwag; k++) {
      const u = k / (LIGHTS.perSwag + 1)
      const i = s * LIGHTS.perSwag + (k - 1)
      out.push({ x: (s + u) / 2, y: LIGHTS.y0 + LIGHTS.sag * 4 * u * (1 - u), atMs: LIGHTS.from + (LIGHTS.rank[i] ?? 0) * LIGHTS.step })
    }
  }
  return out
})()

/** The wire is the same parabola the bulbs sit on, as two quadratic Béziers, in
 *  a 0..100 box that is stretched over the lights box (preserveAspectRatio none). */
export const INTRO_WIRE_D: string = (() => {
  const y0 = LIGHTS.y0 * 100
  const yc = (LIGHTS.y0 + 2 * LIGHTS.sag) * 100
  return `M0 ${y0} Q25 ${yc} 50 ${y0} Q75 ${yc} 100 ${y0}`
})()

/** Steam rising from behind the badge. `x` is in badge-lengths from its centre,
 *  `h` the wisp's height in badge-lengths, `v` a per-wisp speed so they never
 *  move in unison, `d` the path in a 40x120 box. */
export interface IntroWisp { x: number; h: number; atMs: number; v: number; d: string }

export const INTRO_WISPS: readonly IntroWisp[] = [
  { x: -0.17, h: 0.5, atMs: 350, v: 1.0, d: 'M20 120 C 6 104, 34 90, 20 70 S 6 30, 20 0' },
  { x: 0.02, h: 0.62, atMs: 750, v: 1.1, d: 'M20 120 C 34 102, 8 86, 21 64 S 33 26, 20 0' },
  { x: 0.18, h: 0.46, atMs: 1150, v: 0.95, d: 'M20 120 C 8 106, 30 92, 22 72 S 8 34, 20 0' },
]

/** The portal's own staggered entrance has finished long before the intro does
 *  (it runs under the overlay), so as the overlay lifts the intro plays that
 *  entrance once more, on the elements that are on screen. Same fade-and-rise as
 *  `rise-in` in globals.css. Sarcafe names those elements by class (`.rise`, and
 *  the portal's hero badge), where Ayeka's are matched by inline style. */
export const INTRO_REPLAY = {
  selector: '#main .rise, #main .portal-hero-mark',
  atMs: 140,
  stepMs: 70,
  durationMs: 560,
  risepx: 16,
} as const

export interface IntroPlan {
  /** When the last word has finished arriving. */
  textEndMs: number
  /** When the exit starts. */
  exitAtMs: number
  /** When the overlay can be removed. */
  doneAtMs: number
}

/** The timeline for a given pair of line lengths (in words). A translation or a
 *  line with more words simply runs a little longer — the exit follows the text,
 *  it is not a fixed time that a long sentence could be cut off by. */
export function planTimeline(words1: number, words2: number, variant: IntroVariant = 'repeat'): IntroPlan {
  const t = INTRO_TIMINGS[variant]
  const end = (line: Line, n: number) => line.atMs + Math.max(0, n - 1) * line.stepMs + line.wordMs
  const textEndMs = Math.max(end(t.line1, words1), end(t.line2, words2))
  const exitAtMs = textEndMs + t.holdMs
  const doneAtMs = exitAtMs + t.exit.delayMs + t.exit.ms + 40
  return { textEndMs, exitAtMs, doneAtMs }
}

/** The last moment any bulb or wisp is still moving (welcome only), for the
 *  harness to hold against the exit. */
export function extrasEndMs(variant: IntroVariant = 'first'): number {
  if (variant !== 'first') return 0
  const t = INTRO_TIMINGS.first
  const bulbs = INTRO_BULBS.reduce((m, b) => Math.max(m, b.atMs + t.bulbMs), 0)
  const steam = INTRO_WISPS.reduce((m, w) => Math.max(m, w.atMs + Math.round(t.steamMs * w.v)), 0)
  return Math.max(bulbs, steam)
}

/** Every custom property intro.css reads, so the numbers above are the only
 *  numbers. Names are `--intro-*`; per-element values (a bulb's `--x/--y/--at`,
 *  a wisp's `--x/--h/--at/--v`, a word's `--i`) are set on those elements.
 *  Both versions provide the SAME keys (the harness checks), so switching
 *  version at the moment the show starts only ever changes values. */
export function introCssVars(variant: IntroVariant = 'repeat'): Record<string, string> {
  const t = INTRO_TIMINGS[variant]
  const ms = (n: number) => `${n}ms`
  return {
    '--intro-lit': ms(t.litMs),
    '--intro-lights-at': ms(t.lights.atMs),
    '--intro-lights': ms(t.lights.ms),
    '--intro-bulb': ms(t.bulbMs),
    '--intro-steam': ms(t.steamMs),
    '--intro-rule-at': ms(t.rule.atMs),
    '--intro-rule': ms(t.rule.ms),
    '--intro-glint-at': ms(t.glint.atMs),
    '--intro-glint': ms(t.glint.ms),
    '--intro-l1-at': ms(t.line1.atMs),
    '--intro-l1-step': ms(t.line1.stepMs),
    '--intro-w1': ms(t.line1.wordMs),
    '--intro-l2-at': ms(t.line2.atMs),
    '--intro-l2-step': ms(t.line2.stepMs),
    '--intro-w2': ms(t.line2.wordMs),
    '--intro-hint-at': ms(t.hint.atMs),
    '--intro-hint': ms(t.hint.ms),
    '--intro-exit-delay': ms(t.exit.delayMs),
    '--intro-exit': ms(t.exit.ms),
    '--intro-stage-exit': ms(t.exit.stageMs),
    '--intro-skip': ms(INTRO_SKIP_MS),
    '--intro-failsafe': ms(INTRO_FAILSAFE_MS),
  }
}
