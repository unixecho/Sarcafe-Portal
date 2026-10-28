'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  INTRO_NAME_KEY, INTRO_OUT_MS, INTRO_PLAYED_KEY, INTRO_SIGNED_KEY, INTRO_STEPS, INTRO_STEP_MS, cleanName, stepAt, whoIs,
  type IntroWho,
} from '@/lib/staff/app-intro-copy'
import './staff-app-intro.css'

// The staff app's opening screen: a few seconds of jokes while the installed app "works out who you are" (owner, 2026-10-28).
// It plays once per launch of the Home Screen app (sessionStorage), never in a plain browser tab, and a tap ends it.
//
// Why it sits in the ROOT layout and not in /staff/layout: every page is wrapped in app/template.tsx, whose entrance animation
// carries a `transform`, and a `transform` ancestor makes `position: fixed` size itself to that wrapper instead of the screen.
// The customer intro is placed the same way (components/intro/Intro.tsx). The server cannot know the display mode, so on
// /staff it renders the overlay "armed" and staff-app-intro.css shows it only under `display-mode: standalone`; the effect below
// removes it again for a browser tab or a launch that already played. A tiny inline script marks <html> before first paint when
// this launch already played, so a full reload inside the app does not flash the screen.
//
// Who the person is comes from two places: <StaffIdentityBeacon> in the staff layout (the server knows the session) leaves the
// answer in storage a moment after start, and the screen only asks for it at the third line, about 1.7 s in.
// `?staffIntro=1` forces it in any browser for checking; nothing else reads that.

type Phase = 'standby' | 'play' | 'out' | 'gone'

const INLINE = `try{if(sessionStorage.getItem(${JSON.stringify(INTRO_PLAYED_KEY)}))document.documentElement.setAttribute('data-sai-played','')}catch(e){}`

function readIdentity(): { who: IntroWho; name: string } {
  let signed = false
  let saved = ''
  try {
    signed = sessionStorage.getItem(INTRO_SIGNED_KEY) === '1'
    saved = cleanName(localStorage.getItem(INTRO_NAME_KEY))
  } catch { /* Private browsing: the screen still plays, as for a stranger. */ }
  return { who: whoIs(signed, saved), name: saved }
}

export default function StaffAppIntro() {
  const pathname = usePathname() ?? ''
  const armed = pathname === '/staff' || pathname.startsWith('/staff/')
  const [phase, setPhase] = useState<Phase>('standby')
  const [step, setStep] = useState(0)
  const [identity, setIdentity] = useState<{ who: IntroWho; name: string }>({ who: 'stranger', name: '' })
  const rolls = useRef({ filler: 0, checking: 0 })
  const timers = useRef<number[]>([])

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
    setIdentity(readIdentity())
    setPhase('play')
    const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) }
    for (let i = 1; i < INTRO_STEPS; i += 1) at(i * INTRO_STEP_MS, () => { setIdentity(readIdentity()); setStep(i) })
    at(INTRO_STEPS * INTRO_STEP_MS, () => setPhase('out'))
    at(INTRO_STEPS * INTRO_STEP_MS + INTRO_OUT_MS, () => setPhase('gone'))
    return () => { timers.current.forEach((id) => window.clearTimeout(id)); timers.current = [] }
    // Runs once per document: the layout survives client navigation, so a later route change never replays it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function skip() {
    if (phase !== 'play') return
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
    setPhase('out')
    timers.current.push(window.setTimeout(() => setPhase('gone'), INTRO_OUT_MS))
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
  const line = stepAt(step, identity.who, identity.name, rolls.current)
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
        style={{ ['--sai-total' as string]: `${INTRO_STEPS * INTRO_STEP_MS}ms` }}
      >
        <div className="sai__stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sai__logo" src="/sarcafe-logo.png" alt="" width={96} height={96} decoding="async" />
          <p key={live ? step : -1} className={`sai__line sai__line--${live ? line.tone : 'plain'}`}>{live ? line.text : ''}</p>
          <div className="sai__bar" aria-hidden="true"><span /></div>
        </div>
        {live && <button type="button" className="sai__skip press" onClick={(event) => { event.stopPropagation(); skip() }}>דלגו</button>}
      </div>
    </>
  )
}
