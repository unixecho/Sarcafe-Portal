'use client'

// HOME — "where are you working today?". Big friendly tiles, plain words. Picking a
// tile both goes there AND remembers it for this device (savePost), so tomorrow the
// tablet opens straight onto it; the person can come back here from the top bar any
// time. A person assigned to a station sees it first, tagged "your station".

import { ClipboardList, Settings, Store } from 'lucide-react'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import { useT } from '@/lib/pos/useT'
import { useLiveData } from '../live/LiveStore'
import { usePos } from '../PosProvider'
import { postOfView, usePosNav, type PosView } from '../PosNav'
import { safeColour } from './safeColour'

export function HomeView() {
  const t = useT()
  const { points, pointStaff, me } = usePos()
  const { backlog } = useLiveData()
  const { go, savePost } = usePosNav()

  const mine = new Set(pointStaff.filter((x) => x.staff_id === me.id).map((x) => x.point_id))
  const ordered = [...points].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)))

  const pick = (view: PosView) => {
    const post = postOfView(view)
    if (post) savePost(post)
    go(view)
  }

  return (
    <div className="pos-pane-scroll">
      <div className="pos-home">
        <div>
          <h1 className="pos-home-title">{t('core.home.title')}</h1>
          <p className="pos-home-sub">{t('core.home.sub')}</p>
        </div>

        <div className="pos-tiles">
          <button
            type="button"
            className="pos-tile press"
            style={{ ['--tile' as string]: 'var(--neon)' }}
            onClick={() => pick({ v: 'register' })}
          >
            <span className="pos-tile-top">
              <span className="pos-tile-icon" aria-hidden="true">
                <Store size={28} />
              </span>
            </span>
            <span>
              <span className="pos-tile-name" style={{ display: 'block' }}>{t('core.nav.register')}</span>
              <span className="pos-tile-hint" style={{ display: 'block' }}>{t('core.home.registerHint')}</span>
            </span>
          </button>

          {ordered.map((p) => {
            const Icon = resolveCategoryIcon(p.icon)
            const n = backlog.get(p.id)?.inFlight ?? 0
            return (
              <button
                key={p.id}
                type="button"
                className="pos-tile press"
                style={{ ['--tile' as string]: safeColour(p.colour, '#9c9086') }}
                onClick={() => pick({ v: 'station', point: p.id })}
              >
                <span className="pos-tile-top">
                  <span className="pos-tile-icon" aria-hidden="true">
                    <Icon size={28} />
                  </span>
                  {n > 0 ? (
                    <span className="pos-badge">{t('core.home.waiting', { n })}</span>
                  ) : null}
                </span>
                <span>
                  <span className="pos-tile-name" style={{ display: 'block' }}>{p.name}</span>
                  <span className="pos-tile-hint" style={{ display: 'block' }}>
                    {p.hands_over ? t('core.home.stationHint') : t('core.home.stationHintNoHandover')}
                  </span>
                  {mine.has(p.id) ? (
                    <span className="pos-tile-tags">
                      <span className="pos-pill pos-pill--ok">{t('core.home.mine')}</span>
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}

          <button
            type="button"
            className="pos-tile press"
            style={{ ['--tile' as string]: 'var(--text-faint)' }}
            onClick={() => pick({ v: 'orders' })}
          >
            <span className="pos-tile-top">
              <span className="pos-tile-icon" aria-hidden="true">
                <ClipboardList size={28} />
              </span>
            </span>
            <span>
              <span className="pos-tile-name" style={{ display: 'block' }}>{t('core.home.ordersTitle')}</span>
              <span className="pos-tile-hint" style={{ display: 'block' }}>{t('core.home.ordersHint')}</span>
            </span>
          </button>
        </div>

        {points.length === 0 ? <p className="pos-home-sub">{t('core.home.noPoints')}</p> : null}

        {me.isManager ? (
          <a className="pos-tile pos-tile--link press" href="/owner/pos" style={{ textDecoration: 'none' }}>
            <span className="pos-tile-icon" aria-hidden="true">
              <Settings size={26} />
            </span>
            <span className="pos-tile-name">{t('core.top.manager')}</span>
          </a>
        ) : null}
      </div>
    </div>
  )
}
