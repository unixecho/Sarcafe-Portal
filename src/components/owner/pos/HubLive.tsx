'use client'

// HubLive — the manager's live hub (/owner/pos). A SIGNAL surface, not a settings
// page: four numbers, the things that are true right now, the points, the feed.
//
// REALTIME (blueprint §1a.6): it subscribes to the same one realtime signal the
// stations use and refetches /api/owner/pos/dashboard when anything POS-shaped is
// dirty — THROTTLED to one fetch per REFRESH.dashboardMinRefetchMs, because a single
// batch touches a dozen rows and the manager wants one new picture, not twelve. The
// 30 s poll and the visibility catch-up stay, but only as the BACKUP: they drive the
// very same `request()` the socket drives, so there is one path, not two that could
// disagree.
//
// STALE-WHILE-REVALIDATE. The old numbers stay exactly where they are while the new
// ones load. The page dims and sets aria-busy only if a load runs long (so a quick
// realtime refetch does not flicker), and it NEVER blanks, collapses or re-animates:
// an open drill-down stays open, a card stays put. A read that fails keeps the last
// good picture and says so — the one thing it must not do is quietly show old numbers
// as if they were current.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { BookOpen, ClipboardList, ScrollText, Settings2, TrendingUp, Users, type LucideIcon } from 'lucide-react'
import type { Branch } from '@/lib/branches'
import { nameOf } from '@/lib/pos/format'
import type { DashboardPayload, Known } from '@/lib/pos/owner-api'
import { subscribeRealtime } from '@/lib/pos/realtime'
import { usePosLang, useT } from '@/lib/pos/useT'
import { REFRESH } from '@/lib/pos/vocab'
import { Banner, BranchBar, useColours, useFailureText, useOpsResource } from './FilterBar'
import LiveFeed from './LiveFeed'
import PointCards from './PointCards'
import PosSignalStack from './PosSignalStack'
import PosStatStrip from './PosStatStrip'
import SessionPill from './SessionPill'
import './ops.css'

const NO_DIRECTORY: DashboardPayload['directory'] = []

/** True only once `on` has stayed true for `ms` — so a fast refetch never makes the page flicker. */
function useSettled(on: boolean, ms: number): boolean {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!on) {
      setSettled(false)
      return
    }
    const id = setTimeout(() => setSettled(true), ms)
    return () => clearTimeout(id)
  }, [on, ms])
  return settled
}

/** Keeps the last list that really loaded, so a failed refresh greys it instead of emptying it. */
function useLastKnown<T>(k: Known<T[]>): { value: Known<T[]>; stale: boolean } {
  const last = useRef<T[] | null>(null)
  if (k.known) last.current = k.value
  if (k.known || last.current === null) return { value: k, stale: false }
  return { value: { known: true, value: last.current }, stale: true }
}

export function HubSkeleton() {
  return (
    <div className="ops-hub" aria-hidden="true">
      <div className="ops-hub-head">
        <div className="sk" style={{ height: 28, width: 180, borderRadius: 8 }} />
        <div className="sk" style={{ height: 40, width: 150, borderRadius: 999 }} />
      </div>
      <div className="ops-strip-grid">
        {[0, 1, 2, 3].map((i) => <div key={i} className="sk ops-stat" style={{ height: 92 }} />)}
      </div>
      <div className="ops-hub-cols">
        <div className="ops-point-grid">
          {[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 210, borderRadius: 18 }} />)}
        </div>
        <div className="ops-feed-list">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="sk" style={{ height: 52, borderRadius: 14 }} />)}
        </div>
      </div>
    </div>
  )
}

const TILES: { href: string; icon: LucideIcon; key: Parameters<ReturnType<typeof useT>>[0] }[] = [
  { href: '/owner/pos/orders', icon: ClipboardList, key: 'owner.ops.tile.orders' },
  { href: '/owner/pos/stats', icon: TrendingUp, key: 'owner.ops.tile.stats' },
  { href: '/owner/pos/log', icon: ScrollText, key: 'owner.ops.tile.log' },
  { href: '/owner/pos/setup', icon: Settings2, key: 'owner.ops.tile.setup' },
  { href: '/owner/staff', icon: Users, key: 'owner.ops.tile.staff' },
  { href: '/owner/editor', icon: BookOpen, key: 'owner.ops.tile.menu' },
]

function Hub({ branches, branchSlug, initial }: { branches: Branch[]; branchSlug: string; initial: DashboardPayload | null }) {
  const t = useT()
  const [lang] = usePosLang()
  const failureText = useFailureText()
  const { data, failed, busy, reload } = useOpsResource<DashboardPayload>('dashboard', { branch: branchSlug }, initial)

  // ---- one refresh path: the socket, the poll and the tab coming back all call request() ----
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  const lastAt = useRef(Date.now())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = useCallback(() => {
    if (timer.current) return // one is already scheduled; it will pick up everything that changed
    const wait = Math.max(0, lastAt.current + REFRESH.dashboardMinRefetchMs - Date.now())
    timer.current = setTimeout(() => {
      timer.current = null
      lastAt.current = Date.now()
      void reloadRef.current()
    }, wait)
  }, [])

  useEffect(() => {
    // Subscribe BEFORE anything else fetches, so a change landing between the two still signals.
    const off = subscribeRealtime(() => request())
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') request()
    }, REFRESH.dashboardPollMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      off()
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [request])

  const colour = useColours(data?.directory ?? NO_DIRECTORY)
  const dim = useSettled(busy, 450)

  const points = useLastKnown(data?.points ?? { known: false, value: [] })
  const feed = useLastKnown(data?.feed ?? { known: false, value: [] })

  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!note) return
    const id = setTimeout(() => setNote(null), 6000)
    return () => clearTimeout(id)
  }, [note])

  const fallbackName = nameOf(branches.find((b) => b.slug === branchSlug)?.name, lang)

  if (!data) {
    if (failed) {
      return (
        <Banner tone="danger" action={<button type="button" className="ops-link-btn press" onClick={() => void reload()}>{t('owner.ops.retry')}</button>}>
          {failureText(failed)}
        </Banner>
      )
    }
    return <HubSkeleton />
  }

  const tz = data.branch.timezone

  return (
    <div className="ops-hub" aria-busy={dim || undefined}>
      <div className="ops-hub-head">
        <h2 className="ops-event-name">{nameOf(data.branch.name, lang) || fallbackName}</h2>
        <SessionPill
          branchSlug={branchSlug}
          active={data.active}
          enabled={data.enabled}
          tz={tz}
          onChanged={(m) => {
            setNote(m)
            lastAt.current = 0 // an action is worth an immediate picture
            request()
          }}
        />
      </div>

      {note && <Banner tone="info" icon={<span />}>{note}</Banner>}
      {failed && (
        <Banner action={<button type="button" className="ops-link-btn press" onClick={() => void reload()}>{t('owner.ops.retry')}</button>}>
          {t('owner.ops.stale')}
        </Banner>
      )}

      <div className={`ops-dimmable${dim ? ' is-dim' : ''}`}>
        <PosStatStrip stats={data.stats} drill={data.drill} presence={data.presence} colour={colour} busy={dim} />
        <PosSignalStack signals={data.signals} drill={data.drill} colour={colour} />

        <div className="ops-hub-cols">
          <PointCards points={points.value} processing={data.processing} colour={colour} stale={points.stale} onRetry={() => void reload()} />
          <LiveFeed feed={feed.value} colour={colour} tz={tz} stale={feed.stale} onRetry={() => void reload()} />
        </div>
      </div>

      <nav className="ops-tiles" aria-label={t('owner.ops.tiles.title')}>
        {TILES.map((tile) => (
          <Link key={tile.href} href={tile.href} className="ops-tile press">
            <tile.icon size={22} strokeWidth={2} aria-hidden="true" />
            <span>{t(tile.key)}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}

export default function HubLive({
  branches, initialBranch, initial,
}: { branches: Branch[]; initialBranch: string; initial: DashboardPayload | null }) {
  const [branch, setBranch] = useState(initialBranch)
  // A different event is a different screen: remount so nothing of the old one lingers.
  // The server-rendered answer only belongs to the branch the server rendered.
  const first = useMemo(() => initial, [initial])
  return (
    <>
      <BranchBar branches={branches} value={branch} onChange={setBranch} />
      <Hub key={branch} branches={branches} branchSlug={branch} initial={branch === initialBranch ? first : null} />
    </>
  )
}
