'use client'

// The PUBLIC Ready board — a TV or a phone propped by the counter, readable from three
// metres. No sign-in, no staff chrome: the link is the credential.
//
// What it must never do is lie by going quiet. A blank board reads as "nothing is
// ready", so on any failed poll the LAST GOOD list stays on screen and a calm
// "מתחבר מחדש…" appears beside it. Only a real 404 (a rotated or wrong link) replaces
// the board, and then with a plain sentence, not an error.
//
// Privacy: this file asks the endpoint for exactly one thing and renders exactly what
// it returns — a first name, a number, a point's name. The endpoint never has a phone,
// a surname or an item to send, and nothing here fetches anything else.
//
// New entries: an entry arrives with ONE rise and a soft chime. Both are keyed to the
// (order, point) pair, so a poll that returns the same list changes nothing — cards
// never re-animate and never reorder. The first load seeds the "already seen" set
// without chiming, or opening a board on a busy counter would ring for every card.
// Audio needs a tap first (browsers refuse sound until a gesture), hence the small
// "הפעלת צליל" control.

import { useCallback, useEffect, useRef, useState } from 'react'
import { BellRing, Link2Off, Maximize2, Minimize2, RefreshCw, Volume2 } from 'lucide-react'
import type { BoardResponse } from '@/lib/pos/api'
import { chime, unlockAudio } from '@/lib/pos/alerts'
import { ticketLabel } from '@/lib/pos/format'
import { useT, usePosLang } from '@/lib/pos/useT'
import { REFRESH } from '@/lib/pos/vocab'
import { useWakeLock } from '@/lib/pos/wakelock'
import { localized } from '@/lib/menu/types'
import { safeColour } from '../shell/safeColour'
import './board.css'

type Status = 'loading' | 'live' | 'reconnecting' | 'invalid'

const REQUEST_TIMEOUT_MS = 10_000
const NEUTRAL = '#9c9086'

const entryKey = (e: { orderId: string; pointId: string }) => `${e.orderId}|${e.pointId}`

export default function BoardView({ token, pointFilter }: { token: string; pointFilter: string | null }) {
  const t = useT()
  const [lang] = usePosLang()
  const [data, setData] = useState<BoardResponse | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [armed, setArmed] = useState(false)
  const [canFullscreen, setCanFullscreen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  // Entries seen on the previous poll, and the ones that arrived AFTER the first load (they get the rise).
  const seen = useRef<Set<string>>(new Set())
  const risen = useRef<Set<string>>(new Set())
  const firstLoad = useRef(true)
  const busy = useRef(false)

  useWakeLock(status !== 'invalid')

  const poll = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(`/api/board/${encodeURIComponent(token)}`, {
        cache: 'no-store',
        credentials: 'omit',
        signal: ctrl.signal,
      })
      if (res.status === 404) {
        setStatus('invalid')
        return
      }
      if (!res.ok) throw new Error('bad status')
      const body = (await res.json()) as BoardResponse
      if (!body || !Array.isArray(body.ready)) throw new Error('bad body')

      const keys = new Set(body.ready.map(entryKey))
      const fresh = body.ready.filter((e) => !seen.current.has(entryKey(e)))
      if (!firstLoad.current) {
        fresh.forEach((e) => risen.current.add(entryKey(e)))
        if (fresh.length > 0) chime('ready')
      }
      // Entries that left stop being "risen": if one comes back it is genuinely new again.
      risen.current.forEach((k) => {
        if (!keys.has(k)) risen.current.delete(k)
      })
      seen.current = keys
      firstLoad.current = false
      setData(body)
      setStatus('live')
    } catch {
      // Keep the last good list; only the quiet "reconnecting" note appears.
      setStatus((s) => (s === 'invalid' ? s : 'reconnecting'))
    } finally {
      window.clearTimeout(timer)
      busy.current = false
    }
  }, [token])

  useEffect(() => {
    if (status === 'invalid') return
    void poll()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void poll()
    }, REFRESH.boardPollMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    const onOnline = () => void poll()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [poll, status === 'invalid']) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCanFullscreen(typeof document !== 'undefined' && !!document.fullscreenEnabled)
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      else void document.documentElement.requestFullscreen().catch(() => {})
    } catch {
      /* a browser that refuses fullscreen simply stays windowed */
    }
  }

  function armSound() {
    // The tap is the gesture the browser wants; play the chime once so the person can hear it works.
    unlockAudio()
    setArmed(true)
    chime('ready')
  }

  if (status === 'invalid') {
    return (
      <main id="main" tabIndex={-1} className="board board--state">
        <div className="board-state">
          <span className="board-state-icon" aria-hidden="true">
            <Link2Off size={44} />
          </span>
          <h1 className="board-state-title">{t('board.invalid.title')}</h1>
          <p className="board-state-body">{t('board.invalid.body')}</p>
        </div>
      </main>
    )
  }

  const ready = (data?.ready ?? []).filter((e) => !pointFilter || e.pointId === pointFilter)
  const brand = data ? localized(data.branchName, lang) : ''

  return (
    <main id="main" tabIndex={-1} className="board">
      <header className="board-top">
        <h1 className="board-brand">{brand || t('board.title')}</h1>
        <div className="board-tools">
          {status === 'reconnecting' ? (
            <span className="board-conn" role="status">
              <RefreshCw size={18} aria-hidden="true" className="board-spin" />
              <span>{t('board.reconnecting')}</span>
            </span>
          ) : null}
          {armed ? (
            <span className="board-tool board-tool--on">
              <Volume2 size={20} aria-hidden="true" />
              <span>{t('board.sound.on')}</span>
            </span>
          ) : (
            <button type="button" className="board-tool press" onClick={armSound}>
              <Volume2 size={20} aria-hidden="true" />
              <span>{t('board.sound.enable')}</span>
            </button>
          )}
          {canFullscreen ? (
            <button type="button" className="board-tool press" onClick={toggleFullscreen}>
              {fullscreen ? <Minimize2 size={20} aria-hidden="true" /> : <Maximize2 size={20} aria-hidden="true" />}
              <span>{fullscreen ? t('board.fullscreen.exit') : t('board.fullscreen')}</span>
            </button>
          ) : null}
        </div>
      </header>

      <section className="board-ready" aria-labelledby="board-ready-h">
        <h2 id="board-ready-h" className="board-zone-title">
          {t('board.ready')}
        </h2>
        {status === 'loading' && !data ? (
          <p className="board-empty" role="status">
            {t('board.loading')}
          </p>
        ) : ready.length === 0 ? (
          <p className="board-empty">{t('board.empty')}</p>
        ) : (
          <ul className="board-grid" aria-live="polite">
            {ready.map((e) => {
              const k = entryKey(e)
              return (
                <li
                  key={k}
                  className={`board-card${risen.current.has(k) ? ' board-card--new' : ''}`}
                  style={{ ['--pt' as string]: safeColour(e.pointColour, NEUTRAL) }}
                  aria-label={t('board.card', { name: e.firstName, ticket: ticketLabel(e.ticketNo), point: e.pointName })}
                >
                  <span className="board-card-name">{e.firstName}</span>
                  <span className="board-card-no ltr-isolate">{ticketLabel(e.ticketNo)}</span>
                  <span className="board-card-point">
                    <BellRing size={22} aria-hidden="true" />
                    <span>{e.pointName}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <footer className="board-prep">{t('board.preparing', { n: data?.preparing ?? 0 })}</footer>
    </main>
  )
}
