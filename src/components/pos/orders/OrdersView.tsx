'use client'

// "Where is my order?" — the question a cashier gets most. The live list, newest first.
//
//   * Rows come from the SHARED live store (useLive) — this screen runs no orders query
//     of its own, so it can never disagree with the stations. The one exception is
//     "load earlier", a direct read of the event's older orders, which the live store
//     deliberately does not hold.
//   * The list is ordered by ticket number and NEVER by status: a row that moves when
//     its status changes jumps under the finger that was about to tap it.
//   * A failed read looks different from an empty list. With nothing in hand it is a
//     screen of its own with a retry; with a list in hand it is a quiet strip above
//     the last good list.
//   * "Ready to hand over" is the runner's tab: lines that are READY at points that do
//     not hand over themselves, each with a one-tap button (optimistic, via advance()).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw, Search, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { readPos } from '@/lib/pos/read-client'
import { ITEM_COLUMNS, ORDER_COLUMNS } from '@/lib/pos/columns'
import { useT } from '@/lib/pos/useT'
import { normalizePhone } from '@/lib/pos/validate'
import type { StrKey } from '@/lib/pos/i18n'
import type { PosItem, PosOrder, PosOrderWithItems } from '@/lib/pos/types'
import { usePos } from '../PosProvider'
import { useLive } from '../live/LiveStore'
import { usePosNav } from '../PosNav'
import { SkOrderRow } from '../shell/Skeletons'
import { OrderRow, readyForHandover } from './OrderRow'
import './orders.css'

type Filter = 'open' | 'ready' | 'all'
const FILTERS: readonly Filter[] = ['open', 'ready', 'all']
const FILTER_KEY: Record<Filter, StrKey> = {
  open: 'orders.filter.open',
  ready: 'orders.filter.ready',
  all: 'orders.filter.all',
}
const EMPTY_KEY: Record<Filter, StrKey> = {
  open: 'orders.empty.open',
  ready: 'orders.empty.ready',
  all: 'orders.empty.all',
}

const PAGE = 40
/** Pages fetched in one tap while every row of a page is already on screen. */
const MAX_PAGES_PER_TAP = 5
/** Age labels refresh at this pace — minutes are the finest unit worth repainting. */
const NOW_TICK_MS = 30_000

type RawOrder = PosOrder & { pos_order_items?: PosItem[] | null }

function withItems(raw: RawOrder): PosOrderWithItems {
  const { pos_order_items, ...order } = raw
  const items = [...(pos_order_items ?? [])].sort((a, b) => a.seq - b.seq)
  return { ...(order as PosOrder), items }
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), NOW_TICK_MS)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function matches(order: PosOrder, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const digits = q.replace(/\D/g, '')
  const wantsTicket = q.startsWith('#')
  if (digits && (String(order.ticket_no) === digits || (wantsTicket && String(order.ticket_no).startsWith(digits)))) return true
  if (wantsTicket) return false
  if (order.customer_name.toLowerCase().includes(q)) return true
  if ((order.receipt_ref ?? '').toLowerCase().includes(q)) return true
  // Phone digits need a few digits to mean anything: "4" must not match every number.
  if (digits.length >= 3 && order.customer_phone) {
    const phone = normalizePhone(order.customer_phone)
    if (typeof phone === 'string' && phone.replace(/\D/g, '').includes(digits)) return true
  }
  return false
}

export default function OrdersView() {
  const t = useT()
  const { me, branchId, pointsById, session } = usePos()
  const { orders, loaded, failed, advance, refreshNow } = useLive()
  const { openOrder } = usePosNav()
  const now = useNow()

  const [filter, setFilter] = useState<Filter>('open')
  const [query, setQuery] = useState('')

  // ---- earlier orders: a direct read, paged by ticket number ---------------------------------
  const sessionId = session?.id ?? null
  const [older, setOlder] = useState<PosOrderWithItems[]>([])
  const [olderBusy, setOlderBusy] = useState(false)
  const [olderError, setOlderError] = useState(false)
  const [olderDone, setOlderDone] = useState(false)
  const cursor = useRef<number | null>(null)
  const sessionRef = useRef(sessionId)

  useEffect(() => {
    // A new event: whatever was paged in belongs to the old one.
    sessionRef.current = sessionId
    cursor.current = null
    setOlder([])
    setOlderDone(false)
    setOlderError(false)
  }, [sessionId])

  const liveIds = useMemo(() => new Set(orders.map((o) => o.id)), [orders])
  const liveIdsRef = useRef(liveIds)
  liveIdsRef.current = liveIds

  const loadOlder = useCallback(async () => {
    if (!sessionId || olderBusy || olderDone) return
    setOlderBusy(true)
    setOlderError(false)
    try {
      const sb = createClient()
      const known = new Set<string>(liveIdsRef.current)
      let gathered: PosOrderWithItems[] = []
      for (let i = 0; i < MAX_PAGES_PER_TAP; i++) {
        let result: { data: unknown; error: unknown }
        if (me.codeOnly) {
          result = await readPos<RawOrder[]>({ kind: 'orders', branch: branchId, session: sessionId, before: cursor.current ?? undefined })
        } else {
          let q = sb.from('pos_orders').select(`${ORDER_COLUMNS}, pos_order_items(${ITEM_COLUMNS})`).eq('session_id', sessionId).order('ticket_no', { ascending: false }).limit(PAGE)
          if (cursor.current !== null) q = q.lt('ticket_no', cursor.current)
          result = await q
        }
        const { data, error } = result
        if (sessionRef.current !== sessionId) return
        if (error) throw error
        const rows = (data as unknown as RawOrder[] | null) ?? []
        const last = rows[rows.length - 1]
        if (last) cursor.current = last.ticket_no
        const fresh = rows.filter((r) => !known.has(r.id)).map(withItems)
        fresh.forEach((o) => known.add(o.id))
        gathered = gathered.concat(fresh)
        if (rows.length < PAGE) {
          setOlderDone(true)
          break
        }
        // The first pages are mostly orders the live list already holds; keep going until something is new.
        if (gathered.length > 0) break
      }
      if (gathered.length) setOlder((prev) => prev.concat(gathered))
    } catch {
      if (sessionRef.current === sessionId) setOlderError(true)
    } finally {
      setOlderBusy(false)
    }
  }, [sessionId, olderBusy, olderDone, me.codeOnly, branchId])

  // ---- the list ----------------------------------------------------------------------------
  const merged = useMemo(() => {
    const seen = new Set<string>()
    const all: PosOrderWithItems[] = []
    for (const o of orders) {
      seen.add(o.id)
      all.push(o)
    }
    for (const o of older) if (!seen.has(o.id)) all.push(o)
    // Newest first by ticket number — never by status.
    return all.sort((a, b) => b.ticket_no - a.ticket_no)
  }, [orders, older])

  const handoverOf = useMemo(() => {
    const m = new Map<string, ReturnType<typeof readyForHandover>>()
    for (const o of merged) {
      if (o.status === 'void') continue
      const h = readyForHandover(o, pointsById)
      if (h.length) m.set(o.id, h)
    }
    return m
  }, [merged, pointsById])

  const counts = useMemo(
    () => ({
      open: merged.filter((o) => o.status === 'open').length,
      ready: handoverOf.size,
      all: merged.length,
    }),
    [merged, handoverOf],
  )

  const searching = query.trim() !== ''
  const visible = useMemo(() => {
    // While searching, the filter steps aside: a customer's name is found whatever state its order is in.
    return merged.filter((o) => {
      if (searching) return matches(o, query)
      if (filter === 'open') return o.status === 'open'
      if (filter === 'ready') return handoverOf.has(o.id)
      return true
    })
  }, [merged, filter, query, searching, handoverOf])

  const onHandover = useCallback(
    (ids: string[]) => {
      void advance(ids, 'ready', 'delivered')
    },
    [advance],
  )

  const showSkeleton = !loaded && merged.length === 0
  const hardFail = failed && loaded && merged.length === 0
  const showHandover = filter === 'ready' && !searching

  return (
    <div className="ord">
      <div className="ord-head">
        <div className="ord-search">
          <Search size={20} aria-hidden="true" className="ord-search-icon" />
          <label htmlFor="ord-q" className="sr-only">
            {t('orders.search.label')}
          </label>
          <input
            id="ord-q"
            className="pos-input ord-search-input"
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t('orders.search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button type="button" className="ord-search-clear press" onClick={() => setQuery('')} aria-label={t('orders.search.clear')}>
              <X size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div role="group" aria-label={t('orders.filter.label')} className="ord-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`ord-filter press${filter === f && !searching ? ' is-on' : ''}`}
              aria-pressed={filter === f && !searching}
              onClick={() => setFilter(f)}
            >
              <span>{t(FILTER_KEY[f])}</span>
              <span className="ord-filter-n ltr-isolate">{counts[f]}</span>
            </button>
          ))}
        </div>
        {failed && !hardFail && loaded && merged.length > 0 ? (
          <p className="ord-stale" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{t('orders.stale')}</span>
          </p>
        ) : null}
      </div>

      <div className="pos-pane-scroll ord-scroll">
        <div className="ord-list-wrap">
          {showSkeleton ? (
            <div className="ord-skeleton">
              {Array.from({ length: 6 }, (_, i) => (
                <SkOrderRow key={i} />
              ))}
            </div>
          ) : hardFail || (failed && merged.length === 0) ? (
            <div className="ord-empty ord-empty--bad" role="alert">
              <AlertTriangle size={30} aria-hidden="true" />
              <h2 className="ord-empty-title">{t('orders.failed.title')}</h2>
              <p className="ord-empty-body">{t('orders.failed.body')}</p>
              <button type="button" className="pos-btn press" onClick={refreshNow}>
                <RefreshCw size={18} aria-hidden="true" />
                <span>{t('orders.failed.retry')}</span>
              </button>
            </div>
          ) : (
            <>
              {visible.length === 0 ? (
                <div className="ord-empty" role="status">
                  <p className="ord-empty-title">
                    {searching ? t(olderDone ? 'orders.empty.search' : 'orders.empty.searchOlder') : t(EMPTY_KEY[filter])}
                  </p>
                </div>
              ) : (
                <ul className="ord-list">
                  {visible.map((o) => (
                    <OrderRow
                      key={o.id}
                      order={o}
                      points={pointsById}
                      nowMs={now}
                      onOpen={openOrder}
                      handover={showHandover ? handoverOf.get(o.id) : undefined}
                      onHandover={onHandover}
                    />
                  ))}
                </ul>
              )}

              <div className="ord-older">
                {olderError ? (
                  <p className="ord-older-note ord-older-note--bad" role="alert">
                    {t('orders.older.failed')}
                  </p>
                ) : null}
                {olderDone ? (
                  <p className="ord-older-note">{t('orders.older.none')}</p>
                ) : (
                  <button
                    type="button"
                    className="pos-btn press"
                    onClick={() => void loadOlder()}
                    disabled={olderBusy || !sessionId}
                    aria-busy={olderBusy}
                  >
                    {olderBusy ? t('orders.older.loading') : t('orders.older.load')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
