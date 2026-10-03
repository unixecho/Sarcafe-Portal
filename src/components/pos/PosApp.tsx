'use client'

// ============================================================================
// PosApp — the one client tree mounted under /pos.
//
//   ToastProvider > PosProvider > PosNavProvider > LiveProvider > <Shell/>
//
// The order is load-bearing: the live store toasts, reads the config and listens for
// the shared refresh signal; navigation reads the points (to land a person on their
// station); everything below reads all three. See PosProvider.tsx's header for the
// API the screens consume — that header is the contract.
//
// SCREENS ARE MOUNTED ONLY WHILE ACTIVE, one at a time, keyed by view. A flip
// unmounts the old one; anything that must survive (the cart draft) lives in
// localStorage or a store.
//
// What the shell shows, in order of precedence (a blank screen is never one of them):
//   no event for this person   -> "no event to work in"
//   sign-in ended              -> "sign in again" (typed orders stay in the outbox)
//   register switched off      -> "not switched on for this event"
//   no open service period     -> "the event is not open yet" (updates by itself)
//   nickname not confirmed     -> the nickname gate sheet; nothing is usable behind it
//   otherwise                  -> the active view
// ============================================================================

import { useEffect, useState } from 'react'
import { useWakeLock } from '@/lib/pos/wakelock'
import { unlockAudio } from '@/lib/pos/alerts'
import { usePosLang } from '@/lib/pos/useT'
import type { BootstrapResponse } from '@/lib/pos/api'
import { LiveProvider } from './live/LiveStore'
import { PosProvider, usePos, usePosLink } from './PosProvider'
import { PosNavProvider, usePosNav, viewKey } from './PosNav'
import { Dock } from './shell/Dock'
import { HandleGate } from './shell/HandleGate'
import { HomeView } from './shell/HomeView'
import { SkShellBody } from './shell/Skeletons'
import { StateScreen } from './shell/StateScreen'
import { ToastProvider } from './shell/Toast'
import { TopBar } from './shell/TopBar'
import RegisterView from './register/RegisterView'
import StationView from './station/StationView'
import TimelineView from './station/TimelineView'
import OrdersView from './orders/OrdersView'
import OrderDetailSheet from './orders/OrderDetailSheet'
import MeSheet from './me/MeSheet'
import { useT } from '@/lib/pos/useT'
import './pos.css'

export default function PosApp({ initial }: { initial: BootstrapResponse }) {
  return (
    <ToastProvider>
      <PosProvider initial={initial}>
        <PosNavProvider>
          <LiveProvider>
            <Shell />
          </LiveProvider>
        </PosNavProvider>
      </PosProvider>
    </ToastProvider>
  )
}

function Shell() {
  const t = useT()
  const [lang] = usePosLang()
  const { branch, enabled, session, me, pointsById } = usePos()
  const { signedOut } = usePosLink()
  const nav = usePosNav()
  const [meOpen, setMeOpen] = useState(false)

  // The screen stays awake while there is an event to work.
  useWakeLock(Boolean(branch && enabled && session))

  // Sheets are portalled to <body>, outside .pos-app, so they follow the document's
  // direction and language: set both for the life of the POS and put them back.
  useEffect(() => {
    const el = document.documentElement
    const prev = { lang: el.lang, dir: el.dir }
    el.lang = lang
    el.dir = lang === 'en' ? 'ltr' : 'rtl'
    return () => {
      el.lang = prev.lang
      el.dir = prev.dir
    }
  }, [lang])

  // Browsers only allow sound after a tap: the first touch anywhere is that tap.
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true, passive: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  const gated = !me.handleConfirmed
  const { view } = nav

  let body: React.ReactNode
  let working = false
  if (!branch) body = <StateScreen kind="nobranch" />
  else if (signedOut) body = <StateScreen kind="signedOut" />
  else if (!enabled) body = <StateScreen kind="disabled" />
  else if (!session) body = <StateScreen kind="closed" />
  else if (!nav.ready) body = <SkShellBody label={t('core.loading')} />
  else {
    working = true
    switch (view.v) {
      case 'home':
        body = <HomeView />
        break
      case 'register':
        body = <RegisterView addTo={view.addTo} />
        break
      case 'orders':
        body = <OrdersView />
        break
      case 'station': {
        const p = pointsById.get(view.point)
        body = p && p.active ? <StationView pointId={view.point} /> : <GoneState />
        break
      }
      case 'timeline': {
        const p = pointsById.get(view.point)
        body =
          p && p.active ? (
            <TimelineView pointId={view.point} onBack={nav.back} />
          ) : (
            <GoneState />
          )
        break
      }
    }
  }

  return (
    <div className="pos-app" lang={lang} dir={lang === 'en' ? 'ltr' : 'rtl'}>
      {/* While the nickname gate is up nothing behind it may be reached, by touch or keyboard. */}
      <div style={{ display: 'contents' }} {...(gated ? { inert: true } : {})}>
        <TopBar onOpenMe={() => setMeOpen(true)} />
        {session?.kind === 'training' ? (
          <div className="pos-strip" role="note">
            {t('core.event.trainingStrip')}
          </div>
        ) : null}
        <main className="pos-main" id="pos-main" tabIndex={-1}>
          <div className="pos-view" key={working ? viewKey(view) : 'state'}>
            {body}
          </div>
        </main>
        {branch && enabled && session ? <Dock /> : null}
      </div>

      {working && nav.orderId ? <OrderDetailSheet key={nav.orderId} orderId={nav.orderId} onClose={nav.closeOrder} /> : null}
      {branch ? <MeSheet open={meOpen && !gated} onClose={() => setMeOpen(false)} /> : null}
      {branch ? <HandleGate /> : null}
    </div>
  )
}

/** A station that was removed (or an old link to one). Offers the way out, never a blank. */
function GoneState() {
  const t = useT()
  const { go } = usePosNav()
  return (
    <StateScreen kind="gone">
      <button type="button" className="pos-btn pos-btn--primary press" onClick={() => go({ v: 'home' }, { replace: true })}>
        {t('core.gone.action')}
      </button>
    </StateScreen>
  )
}
