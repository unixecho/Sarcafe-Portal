'use client'

// The switcher: Register | one chip per selling point | Orders. Each chip carries a
// LIVE backlog count read from the shared live store (no query of its own), turning
// red when the oldest waiting item has crossed the "late" line, so a person at the
// register sees that the kitchen is drowning without opening the kitchen.
//
// Peer views reached from here REPLACE the history entry (they are tabs; Back must
// not walk through a hundred flips). Dock taps are a peek, not a decision: the
// device's remembered post is only changed on the Home screen.

import { useEffect, useState } from 'react'
import { ClipboardList, Store } from 'lucide-react'
import { ageStage } from '@/lib/pos/aging'
import { AGING } from '@/lib/pos/vocab'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import { useT } from '@/lib/pos/useT'
import { useLiveData } from '../live/LiveStore'
import { usePos } from '../PosProvider'
import { usePosNav } from '../PosNav'
import { safeColour } from './safeColour'

export function Dock() {
  const t = useT()
  const { points } = usePos()
  const { view, go } = usePosNav()
  const { backlog } = useLiveData()
  const [now, setNow] = useState(() => Date.now())

  // Only tick while somebody is waiting: an idle dock re-renders nothing.
  const anyWaiting = points.some((p) => (backlog.get(p.id)?.inFlight ?? 0) > 0)
  useEffect(() => {
    if (!anyWaiting) return
    setNow(Date.now())
    const h = window.setInterval(() => setNow(Date.now()), AGING.tickMs)
    return () => window.clearInterval(h)
  }, [anyWaiting])

  const activePoint = view.v === 'station' || view.v === 'timeline' ? view.point : null

  return (
    <nav className="pos-dock" aria-label={t('core.nav.label')}>
      <button
        type="button"
        className="pos-dock-item pos-dock-item--solo press"
        aria-current={view.v === 'register' ? 'page' : undefined}
        aria-label={t('core.nav.register')}
        onClick={() => go({ v: 'register' }, { replace: true })}
      >
        <Store size={20} aria-hidden="true" />
        <span className="pos-dock-label--solo">{t('core.nav.register')}</span>
      </button>

      <div className="pos-dock-points" role="group" aria-label={t('core.nav.stations')}>
        {points.map((p) => {
          const b = backlog.get(p.id)
          const n = b?.inFlight ?? 0
          const sentAt = b?.oldestSentAt ? Date.parse(b.oldestSentAt) : NaN
          const late = n > 0 && Number.isFinite(sentAt) && ageStage(sentAt, now) !== 'fresh' && ageStage(sentAt, now) !== 'warming'
          const Icon = resolveCategoryIcon(p.icon)
          const label = n > 0 ? t(late ? 'core.nav.backlogLate' : 'core.nav.backlog', { n, name: p.name }) : p.name
          return (
            <button
              key={p.id}
              type="button"
              className="pos-dock-item press"
              style={{ ['--dot' as string]: safeColour(p.colour, '#9c9086') }}
              aria-current={activePoint === p.id ? 'page' : undefined}
              aria-label={label}
              onClick={() => go({ v: 'station', point: p.id }, { replace: true })}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="pos-chip-text" aria-hidden="true">
                {p.name}
              </span>
              {n > 0 ? (
                <span className={`pos-badge${late ? ' pos-badge--late' : ''}`} aria-hidden="true">
                  <span className="ltr-isolate">{n}</span>
                </span>
              ) : (
                <span className="pos-dot" aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className="pos-dock-item pos-dock-item--solo press"
        aria-current={view.v === 'orders' ? 'page' : undefined}
        aria-label={t('core.nav.orders')}
        onClick={() => go({ v: 'orders' }, { replace: true })}
      >
        <ClipboardList size={20} aria-hidden="true" />
        <span className="pos-dock-label--solo">{t('core.nav.orders')}</span>
      </button>
    </nav>
  )
}
