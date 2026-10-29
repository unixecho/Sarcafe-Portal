'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  INTRO_MAX_MS, INTRO_MIN_MS, INTRO_NAME_KEY, INTRO_OUT_MS, INTRO_PLAYED_KEY, INTRO_SIGNED_KEY, INTRO_STEPS, INTRO_STEP_MS, cleanName,
  stepAt, whoIs, type IntroWho,
} from '@/lib/staff/app-intro-copy'
import './staff-app-intro.css'

// The staff app's opening screen: jokes while the installed app "works out who you are" (owner, 2026-10-28). Since 2026-10-29
// it IS the loading screen: it plays while the page is still being prepared and ends as soon as the page is ready, instead of a
// black screen first and a fixed few seconds of jokes on top of a page that had already arrived. It plays once per launch of the
// Home Screen app (sessionStorage), never in a plain browser tab, and a tap ends it.
//
// How it gets on screen early: the staff layout reads who is signed in behind a Suspense boundary (app/staff/layout.tsx), so the
// root layout, and this overlay in it, reach the phone at once. The server cannot know the display mode, so on /staff it renders
// the overlay "armed" and staff-app-intro.css shows it only under `display-mode: standalone`; the effect below removes it again for
// a browser tab or a launch that already played. A tiny inline script marks <html> before first paint when this launch already
// played, so a full reload inside the app does not flash the screen.
//
// When it ends: a still-loading screen carries `data-staff-loading` (the layout's fallback and app/staff/loading.tsx). Once none is
// left, the page is ready and the screen fades out, after at least INTRO_MIN_MS so it never just blinks, and at INTRO_MAX_MS
// whatever happens. On the sign-in page (a signed-out launch) nothing is loading, so it ends right after its first line.
//
// Who the person is comes from <StaffIdentityBeacon> in the staff layout, which only runs once that layout has loaded. Until it has
// reported, the screen keeps telling filler jokes instead of guessing "no account". Where it has not (the sign-in page), the
// answer is "nobody signed in". `?staffIntro=1` forces it in any browser for checking; nothing else reads that.

type Phase = 'standby' | 'play' | 'out' | 'gone'

const INLINE = `try{if(sessionStorage.getItem(${JSON.stringify(INTRO_PLAYED_KEY)}))document.documentElement.setAttribute('data-sai-played','')}catch(e){}`

function readIdentity(): { who: IntroWho; name: string; known: boolean } {
  let signed: string | null = null
  let saved = ''
  try {
    signed = sessionStorage.getItem(INTRO_SIGNED_KEY)
    saved = cleanName(localStorage.getItem(INTRO_NAME_KEY))
  } catch { /* Private browsing: the screen still plays, as for a stranger. */ }
  return { who: whoIs(signed === '1', saved), name: saved, known: signed !== null }
}

const pageReady = () => !document.querySelector('[data-staff-loading]')

export default function StaffAppIntro() {
  const pathname = usePathname() ?? ''
  const armed = pathname === '/staff' || pathname.startsWith('/staff/')
  const [phase, setPhase] = useState<Phase>('standby')
  const [step, setStep] = useState(0)
  const [turn, setTurn] = useState(0)
  const [identity, setIdentity] = useState<{ who: IntroWho; name: string }>({ who: 'stranger', name: '' })
  const rolls = useRef({ filler: 0, checking: 0 })
  const finish = useRef<() => void>(() => {})

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    const params = new URLSearchParams(window.location.search)
    const forced = params.get('staffIntro') === '1'
    // A signed-out launch lands on /login?next=/staff…: that is still the staff app, and the very case the jokes are for.
    const staffLogin = window.location.pathname === '/login' && (params.get('next') ?? '').startsWith('/staff')
    let played = false
    try { played = sessionStorage.getItem(INTRO_PLAYED_KEY) === '1' } catch { /* never remembered: plays each load */ }
    if (!((standalone && (armed || staffLogin)) || forced) || (played && !forced)) { setPhase('gone'); return }
    try { sessionStorage.setItem(INTRO_PLAYED_KEY, '1') } catch { /* see above */ }

    rolls.current = { filler: Math.random(), checking: Math.random() }
    const startedAt = Date.now()
    const timers: number[] = []
    let observer: MutationObserver | undefined
    let ended = false
    let current = 0

    const end = () => {
      if (ended) return
      ended = true
      timers.forEach((id) => window.clearTimeout(id))
      window.clearInterval(ticker)
      observer?.disconnect()
      setPhase('out')
      window.setTimeout(() => setPhase('gone'), INTRO_OUT_MS)
    }
    finish.current = end
    // Ready: end now, or once the first line has been on screen for INTRO_MIN_MS.
    const check = () => {
      if (ended || !pageReady()) return
      const wait = INTRO_MIN_MS - (Date.now() - startedAt)
      if (wait <= 0) end()
      else timers.push(window.setTimeout(end, wait))
    }

    // The lines: first line, a filler, then (once the staff layout has said who this is) the identity check and the greeting.
    // While nobody has said yet, another filler takes the identity check's turn; the greeting stays up until the page is ready.
    const ticker = window.setInterval(() => {
      const known = readIdentity()
      const sure = known.known || !armed
      if (current === 1 && !sure) { setTurn((value) => value + 1); return }
      if (current >= INTRO_STEPS - 1) return
      current += 1
      setIdentity({ who: known.who, name: known.name })
      setStep(current)
    }, INTRO_STEP_MS)

    setIdentity(readIdentity())
    setPhase('play')
    observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    check()
    timers.push(window.setTimeout(end, INTRO_MAX_MS))
    return () => { ended = true; timers.forEach((id) => window.clearTimeout(id)); window.clearInterval(ticker); observer?.disconnect() }
    // Runs once per document: the layout survives client navigation, so a later route change never replays it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function skip() {
    if (phase === 'play') finish.current()
  }

  useEffect(() => {
    if (phase !== 'play') return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' || event.key === 'Enter') skip() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const script = armed ? <script dangerouslySetInnerHTML={{ __html: INLINE }} /> : null
  if (phase === 'gone') return script
  if (phase === 'standby' && !armed) return null

  const live = phase === 'play' || phase === 'out'
  // Each extra filler (turn) moves one joke further down the list, so the same line never shows twice in a row.
  const fillerRoll = (rolls.current.filler + turn * 0.21) % 1
  const line = stepAt(step, identity.who, identity.name, { filler: fillerRoll, checking: rolls.current.checking })
  return (
    <>
      {script}
      <div
        className="sai"
        data-armed={armed ? '' : undefined}
        data-live={live ? '' : undefined}
        data-out={phase === 'out' ? '' : undefined}
        role="status"
        aria-live="polite"
        aria-label="Sarcafe צוות נפתחת"
        onClick={skip}
      >
        <div className="sai__stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sai__logo" src="/sarcafe-logo.png" alt="" width={96} height={96} decoding="async" />
          <p key={live ? `${step}-${turn}` : -1} className={`sai__line sai__line--${live ? line.tone : 'plain'}`}>{live ? line.text : ''}</p>
          <div className="sai__bar" aria-hidden="true"><span /></div>
        </div>
        {live && <button type="button" className="sai__skip press" onClick={(event) => { event.stopPropagation(); skip() }}>דלגו</button>}
      </div>
    </>
  )
}
