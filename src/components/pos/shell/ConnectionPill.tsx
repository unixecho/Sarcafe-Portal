'use client'

// The connection pill is a WARNING, not a status bar: when everything is fine it
// renders nothing at all (a pill that is always there becomes furniture, and the
// night it says something true nobody reads it).
//
// What it can say, in order of how much it matters:
//   * no internet           — shown at once; typed orders are safe on the device.
//   * updates are slow      — the live connection is down but the 8 s refresh is
//                             carrying the screen. Held back 4 s first, so the
//                             normal second after a page load never flashes it.
//   * menu is from the device — two menu checks in a row failed; the menu on screen
//                             is the last good copy (the cashier is never menu-less).
// Each one is a button: tapping it asks the shell to re-read everything right now,
// so a pill that tells you something is wrong also lets you do something about it.
// No technical words: not "realtime", "websocket", "poll" or "sync".

import { useEffect, useState } from 'react'
import { RefreshCw, WifiOff, Wifi, BookmarkCheck } from 'lucide-react'
import { useT } from '@/lib/pos/useT'
import { usePosActions, usePosLink } from '../PosProvider'

/** A normal page load spends a moment 'connecting'; not worth a warning. */
const GRACE_MS = 4000

export function ConnectionPill() {
  const t = useT()
  const { connection, online, menuStale } = usePosLink()
  const { refreshAll } = usePosActions()
  const [graceOver, setGraceOver] = useState(false)
  const [spinning, setSpinning] = useState(false)

  const degraded = online && connection !== 'live'
  useEffect(() => {
    if (!degraded) {
      setGraceOver(false)
      return
    }
    const h = window.setTimeout(() => setGraceOver(true), GRACE_MS)
    return () => window.clearTimeout(h)
  }, [degraded])

  useEffect(() => {
    if (!spinning) return
    const h = window.setTimeout(() => setSpinning(false), 1200)
    return () => window.clearTimeout(h)
  }, [spinning])

  const tap = () => {
    setSpinning(true)
    refreshAll()
  }

  const showSlow = degraded && graceOver
  if (online && !showSlow && !menuStale) return null

  const Spin = <RefreshCw size={16} aria-hidden="true" className={spinning ? 'pos-spin' : undefined} />

  return (
    <>
      {!online && (
        <button
          type="button"
          className="pos-pill pos-pill--danger press"
          onClick={tap}
          aria-label={`${t('core.conn.offlineHint')} ${t('core.conn.refresh')}`}
        >
          <WifiOff size={16} aria-hidden="true" />
          <span>{t('core.conn.offline')}</span>
          {Spin}
        </button>
      )}
      {showSlow && (
        <button
          type="button"
          className="pos-pill pos-pill--warn press"
          onClick={tap}
          aria-label={connection === 'connecting' ? t('core.conn.connecting') : t('core.conn.slowHint')}
        >
          <Wifi size={16} aria-hidden="true" />
          <span>{connection === 'connecting' ? t('core.conn.connecting') : t('core.conn.slow')}</span>
          {Spin}
        </button>
      )}
      {menuStale && (
        <button
          type="button"
          className="pos-pill pos-pill--warn press"
          onClick={tap}
          aria-label={`${t('core.conn.menuCachedHint')} ${t('core.conn.refresh')}`}
        >
          <BookmarkCheck size={16} aria-hidden="true" />
          <span>{t('core.conn.menuCached')}</span>
          {Spin}
        </button>
      )}
    </>
  )
}
