'use client'

import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import type { Lang } from '@/lib/menu/types'
import { INTRO_LINES, introCopy, splitLine } from '@/lib/intro/copy'
import {
  INTRO_BULBS, INTRO_LINE_KEY, INTRO_REPLAY, INTRO_SEEN_KEY, INTRO_SETTLE, INTRO_SKIP_MS, INTRO_TIMINGS,
  INTRO_WIRE_D, INTRO_WISPS, introCssVars, introEntry, isForcedLine, isForcedVariant, pickLine, pickVariant,
  planTimeline, type IntroVariant,
} from '@/lib/intro/config'
import './intro.css'

// The portal's intro: a dark screen, the cream badge warming like a café lamp,
// two lines of copy arriving word by word, then the page. It plays on EVERY full
// load of the portal — so the whole design is about not being tiring: a tap, key
// press or scroll ends it on the spot, it comes in two lengths, and the words
// change from visit to visit. A device that has never seen it gets the WELCOME
// (about five seconds: the string lights catch, steam rises behind the badge,
// the words are given room); every load after that gets the SHORT one (about
// three). See lib/intro/config.ts. Ported from Ayeka.Bar's intro (BLUEPRINT
// §4.15); design notes in docs/SARCAFE_INTRO.md.
//
// ---- why it lives in the ROOT LAYOUT ----
// It has to be in the server-rendered HTML, or the portal would flash for a
// moment before the overlay mounted. A portal (ModalPortal) cannot do that — it
// renders nothing on the server. And rendering it inside a page puts it under
// `#a11y-scope` (which carries the accessibility widget's CSS `filter`) and
// src/app/template.tsx's entrance wrapper (which carries a `transform` while it
// animates): either one turns an ancestor into the containing block for
// `position: fixed`, and the overlay would size itself to the whole page instead
// of the screen (BLUEPRINT §4.14a). In the layout it is a sibling of both —
// rendered through <IntroGate>, which is the owner's on/off switch (/owner/intro)
// and decides on the server whether it exists at all. The same placement is why
// it appears exactly once per DOCUMENT: a layout survives client-side
// navigation, so coming back to the portal from the menu does not replay it. A
// refresh does — that is the point.
//
// ---- the installed app ----
// The customer app's manifest opens it at /order. That path is an intro path too,
// but only inside the installed app: the server cannot know the display mode, so
// it renders the overlay on /order with data-entry="app", intro.css hides it
// unless `display-mode: standalone`, and this component, finding itself
// `display: none`, plays nothing. No flash for a browser tab, no hydration
// mismatch.
//
// ---- three stages, driven by cumulative attributes ----
// 1. STANDBY — what the server renders and what shows until the page's script has
//    run: a dark screen and a dim badge. Static; no animation at all. A slow
//    phone sees a calm logo, not half a show. The server cannot know which
//    version a visitor will get (that is in localStorage), so it renders the
//    short one's variables and nothing version-specific.
// 2. LIT (`data-lit` + `data-variant`) — the show. Set once the page has hydrated
//    and the language is known, IN THE SAME COMMIT as the version's variables
//    and the line, so no animation ever starts with the wrong numbers. Every
//    delay counts from this moment.
// 3. OUT (`data-out`) or SKIP (`data-skip`) — leaving, then removed.
// The attributes are only ever added, never removed: taking one away would
// switch its animation off and a later one on, and a CSS animation switched back
// on starts again from frame zero (BLUEPRINT §4.3 / §4.14c).
//
// ---- which version and which line, and the markers ----
// `pickVariant` and `pickLine` (pure, lib/intro/config.ts). The markers are
// written at the moment the show STARTS, not when it ends: a visitor who skips at
// one second, or who refreshes impatiently at two, has seen enough — making them
// sit through the long one again would be the exact thing this exists to avoid.
// And they are only trusted if they could actually be stored: a private window
// that throws on write gets the SHORT version every time, never the welcome on
// every load. `?intro=first` / `?intro=repeat` and `?line=N` (the owner's preview
// links) play what was asked for and touch nothing.
//
// ---- the failsafe ----
// The overlay hides itself with a pure-CSS timer (`intro-failsafe`) if script
// never takes over; arming/disarming is the `data-armed` attribute. The page
// beneath is fully server-rendered and works without script, so a hung bundle
// must never leave a visitor looking at a logo. If script arrives AFTER it fired
// there is nothing left to show and nothing is replayed.
//
// ---- reading the language and the motion preference ----
// Not from storage, from the page itself: `<html lang>` is what the language
// switcher (useLanguage) keeps in sync — the accessibility widget relies on the
// same contract — and `<html class="a11y-motion-off">` is what the widget writes
// for "pause animations". Both are written by other components' effects right
// after hydration, so the show waits for them to settle (whenSettled).
//
// ---- skipping ----
// pointerdown on the overlay, any key (but not a shortcut), or a scroll. The
// overlay keeps catching taps until it is gone: on touch, the `click` that
// follows a tap goes to whatever is under the finger when the finger lifts, so an
// overlay that stopped catching taps the instant it was tapped would let "tap to
// skip" press the button underneath. (Only the natural exit hands taps through,
// and only once it is mostly transparent — `data-pass`.) Left non-focusable and
// `aria-hidden` on purpose: it is a decoration, the real page is right there for
// assistive technology, and nothing here may trap a keyboard.

type Exit = null | 'out' | 'skip'

// Both versions' variables, built once. The server renders the short one's.
const VARS: Record<IntroVariant, CSSProperties> = {
  first: introCssVars('first') as CSSProperties,
  repeat: introCssVars('repeat') as CSSProperties,
}
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
// Pressing one of these alone is not "the visitor wants in" — and neither is a
// keydown that names no key at all (soft keyboards and IME composition send
// `Unidentified`), which says nothing about intent.
const IGNORED_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'ContextMenu', 'Dead', 'Unidentified', '']

export default function Intro() {
  const pathname = usePathname()
  // Decided ONCE, at the first render, and never revisited: this component sits
  // in the layout and outlives every navigation, so reading the live pathname
  // would replay the intro each time the visitor returned to the portal.
  const [entry] = useState(() => introEntry(pathname))
  const enabled = entry !== null
  const [armed, setArmed] = useState(false)
  const [lit, setLit] = useState(false)
  const [variant, setVariant] = useState<IntroVariant | null>(null)
  const [line, setLine] = useState<number | null>(null)
  const [exit, setExit] = useState<Exit>(null)
  const [pass, setPass] = useState(false)
  const [done, setDone] = useState(false)
  const [lang, setLang] = useState<Lang | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled || done) return
    const root = rootRef.current
    if (!root) return
    const html = document.documentElement

    // Nothing to show: the failsafe already put the overlay away (script came
    // very late), this is /order in a browser tab (hidden by CSS), the visitor
    // turned animation off, or the tab was opened in the background — nobody
    // would see the show, and whoever switches to it later should land on the
    // page, not a half-played intro.
    const shown = getComputedStyle(root)
    if (shown.visibility === 'hidden' || shown.display === 'none' || document.visibilityState === 'hidden') {
      setDone(true)
      return
    }

    setArmed(true)
    html.classList.add('intro-lock')

    const timers: number[] = []
    const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)) }
    let leaving: Exit = null
    let stopSettle = () => {}
    // The exit's own timings belong to whichever version is playing, which is not
    // known until the settle below completes — hence a variable, set there.
    let timing = INTRO_TIMINGS.repeat

    const leave = (how: 'out' | 'skip') => {
      if (leaving) return
      leaving = how
      stopSettle()
      setExit(how)
      if (how === 'out') {
        replayPage()
        later(() => setPass(true), timing.exit.passAtMs)
        later(() => setDone(true), timing.exit.delayMs + timing.exit.ms + 40)
      } else {
        later(() => setDone(true), INTRO_SKIP_MS + 40)
      }
    }

    stopSettle = whenSettled(INTRO_SETTLE.quietMs, INTRO_SETTLE.maxMs, () => {
      if (leaving) return
      if (html.classList.contains('a11y-motion-off')) { setDone(true); return }
      const raw = html.lang
      const l: Lang = raw === 'en' || raw === 'ar' ? raw : 'he'
      const show = chooseShow()
      timing = INTRO_TIMINGS[show.variant]
      const c = introCopy(show.line, l)
      const plan = planTimeline(splitLine(c.line1).length, splitLine(c.line2).length, show.variant)
      // One commit: the language, the version's variables, its line and the
      // attribute that starts every animation.
      setLang(l)
      setVariant(show.variant)
      setLine(show.line)
      setLit(true)
      later(() => leave('out'), plan.exitAtMs)
    })

    const skip = () => leave('skip')
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || IGNORED_KEYS.indexOf(e.key) !== -1) return
      skip()
    }
    root.addEventListener('pointerdown', skip)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', skip, { passive: true })

    return () => {
      stopSettle()
      timers.forEach((t) => window.clearTimeout(t))
      root.removeEventListener('pointerdown', skip)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', skip)
      html.classList.remove('intro-lock')
    }
  }, [enabled, done])

  if (!enabled || done) return null

  const copy = lang !== null && line !== null ? introCopy(line, lang) : null
  const dir = lang === 'en' ? 'ltr' : 'rtl'

  return (
    <div
      ref={rootRef}
      className="intro"
      aria-hidden="true"
      style={VARS[variant ?? 'repeat']}
      data-entry={entry ?? undefined}
      data-armed={armed ? '' : undefined}
      data-lit={lit ? '' : undefined}
      data-variant={variant ?? undefined}
      data-out={exit === 'out' ? '' : undefined}
      data-skip={exit === 'skip' ? '' : undefined}
      data-pass={pass ? '' : undefined}
    >
      <div className="intro-stage">
        <div className="intro-halo" />
        {/* The welcome's two extras. They are rendered only once the version is
            known (state, not server HTML), so a returning visitor never sees an
            unlit string flash during standby. They sit before the badge so the
            steam rises from BEHIND it. */}
        {variant === 'first' && <Lights />}
        {variant === 'first' && <Steam />}
        <div className="intro-coin">
          {/* The cream badge — the same disc LogoMark draws. The logo is a
              transparent cutout; the disc is what a dark screen needs to carry
              it. next/image serves a small optimized copy (the raw PNG is
              847 KB) and preloads it, since this is the first thing on screen. */}
          <div className="intro-badge">
            <Image src="/sarcafe-logo.png" alt="" width={224} height={224} sizes="(min-width: 1024px) 300px, 224px" priority draggable={false} />
            <span className="intro-glint" />
          </div>
        </div>
        {copy && lang && (
          <>
            <div className="intro-copy" lang={lang} dir={dir}>
              <span className="intro-rule" />
              <p className="intro-line intro-l1"><Words line={copy.line1} /></p>
              <p className="intro-line intro-l2"><Words line={copy.line2} /></p>
            </div>
            <p className="intro-hint" lang={lang} dir={dir}>{copy.skip}</p>
          </>
        )}
      </div>
    </div>
  )
}

/** Which version and which line this load plays, and the bookkeeping that goes
 *  with them.
 *
 *  A preview (`?intro=first|repeat`, `?line=N`, the owner's links) touches
 *  nothing. Anything else reads the markers and, if the seen marker is absent,
 *  WRITES it right here — at the moment the show starts — and the write doubles as
 *  the test that storage works at all: if it throws (a private window, blocked
 *  storage) the device cannot remember, and gets the short version rather than
 *  the welcome on every load, and a random line rather than a remembered one. */
function chooseShow(): { variant: IntroVariant; line: number } {
  const params = new URLSearchParams(window.location.search)
  const forcedVariant = params.get('intro')
  const forcedLine = params.get('line')
  const count = INTRO_LINES.length
  const preview = isForcedVariant(forcedVariant) || isForcedLine(forcedLine, count)

  let seen = false
  let last: string | null = null
  let canRemember = true
  try {
    seen = window.localStorage.getItem(INTRO_SEEN_KEY) !== null
    last = window.localStorage.getItem(INTRO_LINE_KEY)
    if (!seen && !preview) window.localStorage.setItem(INTRO_SEEN_KEY, String(Date.now()))
  } catch {
    canRemember = false
  }

  const v = pickVariant({ forced: forcedVariant, seen, canRemember })
  const l = pickLine({ forced: forcedLine, last, count, canRemember, rand: Math.random })
  if (!preview && canRemember) {
    try {
      window.localStorage.setItem(INTRO_LINE_KEY, String(l.index))
    } catch {
      // storage went away between the two writes; the next load is just random
    }
  }
  return { variant: v.variant, line: l.index }
}

/** One span per word, each carrying its own index for the stagger. The plain
 *  space between spans is what lets the line wrap like text. */
function Words({ line }: { line: string }) {
  const words = splitLine(line)
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className={w.hl ? 'intro-w hl' : 'intro-w'} style={{ '--i': i } as CSSProperties}>{w.text}</span>
          {i < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </>
  )
}

/** The cart's string lights: a wire and ten bulbs that catch one after another. */
function Lights() {
  return (
    <div className="intro-lights">
      <svg className="intro-wire" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={INTRO_WIRE_D} />
      </svg>
      {INTRO_BULBS.map((b, i) => (
        <i key={i} className="intro-bulb" style={{ '--x': b.x, '--y': b.y, '--at': `${b.atMs}ms` } as CSSProperties}>
          <b />
        </i>
      ))}
    </div>
  )
}

/** Steam rising from behind the badge. */
function Steam() {
  return (
    <div className="intro-steam">
      {INTRO_WISPS.map((w, i) => (
        <svg
          key={i} className="intro-wisp" viewBox="0 0 40 120" preserveAspectRatio="none"
          style={{ '--x': w.x, '--h': w.h, '--at': `${w.atMs}ms`, '--v': w.v } as CSSProperties}
        >
          <path d={w.d} />
        </svg>
      ))}
    </div>
  )
}

/** Calls `cb` once `<html lang>` and `<html class>` have stopped changing for
 *  `quietMs` (or after `maxMs` regardless). The language switcher and the
 *  accessibility widget each write one of them from their own post-hydration
 *  effect, a render or two after this component mounts; reading earlier would
 *  catch Hebrew for an English visitor and miss "pause animations". Returns a
 *  function that cancels. */
function whenSettled(quietMs: number, maxMs: number, cb: () => void): () => void {
  let quiet = 0
  let cap = 0
  let finished = false
  const stop = () => {
    finished = true
    window.clearTimeout(quiet)
    window.clearTimeout(cap)
    observer.disconnect()
  }
  const fire = () => {
    if (finished) return
    stop()
    cb()
  }
  const observer = new MutationObserver(() => {
    window.clearTimeout(quiet)
    quiet = window.setTimeout(fire, quietMs)
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'class'] })
  quiet = window.setTimeout(fire, quietMs)
  cap = window.setTimeout(fire, maxMs)
  return stop
}

/** The portal's own entrance finished long ago, under the overlay. As the dark
 *  lifts, play it once more on whatever is on screen — the room fades up first,
 *  then the page assembles itself — instead of revealing a page that is already
 *  standing still. Purely additive: with no script, or on any failure here, the
 *  page is simply there. Skipped under reduced motion (it moves 16px). */
function replayPage() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const viewport = window.innerHeight
  let n = 0
  Array.from(document.querySelectorAll<HTMLElement>(INTRO_REPLAY.selector)).forEach((el) => {
    if (typeof el.animate !== 'function') return
    const r = el.getBoundingClientRect()
    if (r.bottom <= 0 || r.top >= viewport) return
    el.animate(
      [
        { opacity: 0, transform: `translateY(${INTRO_REPLAY.risepx}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: INTRO_REPLAY.durationMs, delay: INTRO_REPLAY.atMs + n * INTRO_REPLAY.stepMs, easing: EASE, fill: 'backwards' },
    )
    n++
  })
}
