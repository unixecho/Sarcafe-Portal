'use client'

// ============================================================================
// TimelineView - what this selling point has already handed over, newest first.
//
// Reached by the iOS-style horizontal slide from the station (a left swipe on its background, or
// its "timeline" button); the back arrow runs the same slide in reverse. The two roots share one
// view-transition name so the browser pairs them into a single sliding group (station.css).
//
// DATA (a direct, paginated read - this is history, not the live queue, so it does not belong in
// the shared live store): this point's DELIVERED lines of the open event, each with its order,
// grouped by ticket. Scoped by POINT, not by person - the record reads the same whoever was on
// shift. Who accepted / handed over and when come from the stamped line columns; who marked a
// line READY is only in the audit trail (pos_events), so that is read for the one order the person
// expands. Column lists come from columns.ts. The customer's phone is part of the shared order
// column list but is never shown or used here.
//
// A refetch (the shared refresh signal) re-reads exactly the rows already loaded and replaces them
// under stable keys, so an open row never collapses and the list never jumps.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { runLocalTransition } from '@/lib/nav/viewTransition'
import { createClient } from '@/lib/supabase/client'
import { readPos } from '@/lib/pos/read-client'
import { EVENT_COLUMNS, ITEM_COLUMNS, ORDER_EMBED } from '@/lib/pos/columns'
import { describeEvent } from '@/lib/pos/events'
import { lineSummary, ticketLabel, timeLabel } from '@/lib/pos/format'
import { formatAgorot } from '@/lib/pos/money'
import { STATION } from '@/lib/pos/vocab'
import { usePosLang, useT } from '@/lib/pos/useT'
import type { PosEvent, PosItem, PosOrder } from '@/lib/pos/types'
import { usePos, useRefreshKey } from '../PosProvider'
import { HandleChip } from '../shell/HandleChip'
import { SkOrderRow } from '../shell/Skeletons'
import './station.css'

type Row = PosItem & { pos_orders: PosOrder }
type Group = { order: PosOrder; lines: PosItem[]; lastAt: string }

const PAGE = STATION.historyLimit
const HARD_CAP = 600

function group(rows: Row[]): Group[] {
  const by = new Map<string, Group>()
  for (const r of rows) {
    const { pos_orders: order, ...line } = r
    const item = line as PosItem
    const g = by.get(order.id) ?? { order, lines: [], lastAt: '' }
    g.lines.push(item)
    if ((item.delivered_at ?? '') > g.lastAt) g.lastAt = item.delivered_at ?? ''
    by.set(order.id, g)
  }
  const out = Array.from(by.values())
  for (const g of out) g.lines.sort((a, b) => a.batch_no - b.batch_no || a.seq - b.seq)
  // Newest handover first. Ties break on ticket number so two reads never order them differently.
  return out.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : b.order.ticket_no - a.order.ticket_no))
}

export default function TimelineView({ pointId, onBack }: { pointId: string; onBack: () => void }) {
  const t = useT()
  const [lang] = usePosLang()
  const { me, branchId, session, pointsById } = usePos()
  const key = useRefreshKey()
  const sessionId = session?.id ?? null
  const point = pointsById.get(pointId)

  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [wanted, setWanted] = useState<number>(PAGE)
  const [more, setMore] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [events, setEvents] = useState<PosEvent[] | null>(null)

  // Re-reads rows 0..wanted-1; a new page just raises `wanted`.
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void (async () => {
      const { data, error } = me.codeOnly ? await readPos<Row[]>({ kind: 'point_history', branch: branchId, session: sessionId, point: pointId, limit: wanted }) : await createClient()
        .from('pos_order_items')
        .select(`${ITEM_COLUMNS}, ${ORDER_EMBED}`)
        .eq('point_id', pointId)
        .eq('status', 'delivered')
        .eq('pos_orders.session_id', sessionId)
        .order('delivered_at', { ascending: false })
        .range(0, wanted - 1)
      if (cancelled) return
      if (error) {
        setFailed(true)
        return
      }
      const list = (data as unknown as Row[] | null) ?? []
      setFailed(false)
      setRows(list.map((r) => ({ ...r, modifiers: Array.isArray(r.modifiers) ? r.modifiers : [] })))
      setMore(list.length >= wanted && wanted < HARD_CAP)
    })()
    return () => {
      cancelled = true
    }
  }, [pointId, sessionId, wanted, key, me.codeOnly, branchId])

  // The audit trail of the one expanded order (who marked it ready, and everything else that happened).
  useEffect(() => {
    if (!openId) {
      setEvents(null)
      return
    }
    let cancelled = false
    void (async () => {
      const { data, error } = me.codeOnly ? await readPos<PosEvent[]>({ kind: 'order_events', branch: branchId, order: openId, direction: 'asc' }) : await createClient()
        .from('pos_events')
        .select(EVENT_COLUMNS)
        .eq('order_id', openId)
        .order('at', { ascending: true })
        .limit(200)
      if (cancelled || error) return
      setEvents((data as unknown as PosEvent[] | null) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [openId, key, me.codeOnly, branchId])

  const groups = useMemo(() => (rows ? group(rows) : null), [rows])

  const back = useCallback(() => {
    runLocalTransition('pos-timeline', 'back', () => flushSync(() => onBack()))
  }, [onBack])

  // Escape goes back, for a connected keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back])

  const readyBy = useMemo(() => {
    const m = new Map<string, string>()
    for (const ev of events ?? []) if (ev.event === 'item_ready' && ev.item_id && ev.actor_id) m.set(ev.item_id, ev.actor_id)
    return m
  }, [events])

  return (
    <div className="stt" style={{ viewTransitionName: 'pos-timeline' }}>
      <header className="stt-head">
        {/* The timeline arrived from the physical right, so "back" points to the physical right in both languages. */}
        <button type="button" className="sth-btn sth-btn--text press" onClick={back}>
          <ArrowRight size={22} aria-hidden="true" />
          <span>{t('station.tl.back')}</span>
        </button>
        <h1 className="stt-title">
          {t('station.tl.title')}
          {point ? <span className="stt-point"> · {point.name}</span> : null}
        </h1>
      </header>

      <div className="stt-body pos-pane-scroll">
        {groups === null ? (
          failed ? (
            <p className="sts-empty" role="status">
              {t('station.tl.failed')}
            </p>
          ) : (
            <div className="stt-list" aria-busy="true">
              <SkOrderRow label={t('core.loading')} />
              <SkOrderRow />
              <SkOrderRow />
            </div>
          )
        ) : groups.length === 0 ? (
          <p className="sts-empty" role="status">
            {t('station.tl.empty')}
          </p>
        ) : (
          <>
            {failed ? (
              <p className="sts-stale" role="status">
                {t('station.stale')}
              </p>
            ) : null}
            <ul className="stt-list">
              {groups.map((g) => {
                const open = openId === g.order.id
                const lastLine = g.lines.reduce<PosItem | null>(
                  (b, l) => (l.delivered_at && (!b || (b.delivered_at ?? '') < l.delivered_at) ? l : b),
                  null,
                )
                const total = g.lines.reduce((s, l) => s + l.qty * l.unit_agorot, 0)
                const detailsId = `stt-${g.order.id}`
                return (
                  <li key={g.order.id} className={`stt-row${open ? ' is-open' : ''}`}>
                    <button
                      type="button"
                      className="stt-toggle press"
                      aria-expanded={open}
                      aria-controls={detailsId}
                      onClick={() => setOpenId(open ? null : g.order.id)}
                    >
                      <span className="stt-toggle-main">
                        <strong className="stt-ticket">
                          <span className="ltr-isolate">{ticketLabel(g.order.ticket_no)}</span>
                          {g.order.customer_name ? ` · ${g.order.customer_name}` : ''}
                        </strong>
                        <span className="stt-by">
                          {t('station.card.createdBy')}
                          <HandleChip staffId={g.order.created_by} handle={g.order.created_by_handle} />
                        </span>
                      </span>
                      <span className="stt-toggle-side">
                        {lastLine?.delivered_at ? (
                          <span className="stt-time">
                            {t('station.done.at')} <span className="ltr-isolate">{timeLabel(lastLine.delivered_at)}</span>
                          </span>
                        ) : null}
                        {me.isManager ? <span className="stt-total ltr-isolate">{formatAgorot(total)}</span> : null}
                        <ChevronDown size={22} aria-hidden="true" className="stt-chev" />
                      </span>
                    </button>

                    <ul className="stt-items">
                      {g.lines.map((l) => (
                        <li key={l.id}>{lineSummary(l, lang)}</li>
                      ))}
                    </ul>

                    {open ? (
                      <div id={detailsId} className="stt-details">
                        <p className="stt-pointline">{t('station.tl.madeAt', { point: point?.name ?? g.lines[0]?.point_name ?? '' })}</p>
                        <ul className="stt-stamps">
                          {g.lines.map((l) => {
                            const rb = readyBy.get(l.id)
                            return (
                              <li key={l.id} className="stt-stamp">
                                <span className="stt-stamp-what">
                                  {lineSummary(l, lang)}
                                </span>
                                <span className="stt-stamp-line">
                                  {l.claimed_by ? (
                                    <span className="stt-step">
                                      {t('station.tl.accepted')} <HandleChip staffId={l.claimed_by} />
                                      {l.claimed_at ? <span className="ltr-isolate"> {timeLabel(l.claimed_at)}</span> : null}
                                    </span>
                                  ) : null}
                                  {l.ready_at ? (
                                    <span className="stt-step">
                                      {t('station.tl.readied')} {rb ? <HandleChip staffId={rb} /> : null}
                                      <span className="ltr-isolate"> {timeLabel(l.ready_at)}</span>
                                    </span>
                                  ) : null}
                                  {l.delivered_by ? (
                                    <span className="stt-step">
                                      {t('station.tl.handed')} <HandleChip staffId={l.delivered_by} />
                                      {l.delivered_at ? <span className="ltr-isolate"> {timeLabel(l.delivered_at)}</span> : null}
                                    </span>
                                  ) : null}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                        <h3 className="stt-sub">{t('station.tl.history')}</h3>
                        {events === null ? (
                          <SkOrderRow />
                        ) : (
                          <ul className="stt-events">
                            {events
                              .map((ev) => ({ ev, d: describeEvent(ev, lang) }))
                              .filter((x) => !x.d.quiet)
                              .map(({ ev, d }) => (
                                <li key={ev.id} className={`stt-event stt-event--${d.tone}`}>
                                  <span className="ltr-isolate stt-event-time">{timeLabel(ev.at)}</span>
                                  <span className="stt-event-text">{d.text}</span>
                                  {ev.actor_id ? <HandleChip staffId={ev.actor_id} handle={ev.actor_handle} /> : null}
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            {more ? (
              <div className="stt-more">
                <button type="button" className="pos-btn press" onClick={() => setWanted((w) => w + PAGE)}>
                  {t('station.tl.more')}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
