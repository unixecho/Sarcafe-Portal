'use client'

// One order, in full: who it is for, every line and where it stands, what happened to
// it and when. Opened over whichever screen the person is on (PosApp mounts this while
// the URL names an order), so it works from the orders list, a station card, or a
// reloaded link.
//
// Data. The order itself comes from the shared live store, so a line that just became
// ready flips here the same instant it flips on the station. An order the live store
// does not hold (older than the last hour, or a link opened after a reload) is read
// directly ONCE and then refreshed on the shared signal — never a blank. The timeline
// is a direct read of the order's audit events; it keeps showing what it had while a
// refresh runs, so the list never flickers back to empty.
//
// Actions are only offered when they can work, and when one is withheld for a reason
// the person can fix (an order that is finished cannot take new items) the reason is
// written next to it rather than leaving a dead button.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Ban, Bell, Check, CheckCircle2, Circle, Flame, Hand, MessageSquare, Pencil, Phone, Plus, Receipt, Undo2, X,
  AlertTriangle, type LucideIcon,
} from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { createClient } from '@/lib/supabase/client'
import { readPos } from '@/lib/pos/read-client'
import { haptic } from '@/lib/haptics'
import { EVENT_COLUMNS, ITEM_COLUMNS, ORDER_COLUMNS } from '@/lib/pos/columns'
import { describeEvent, groupFeed } from '@/lib/pos/events'
import { canUndoDelivered } from '@/lib/pos/lifecycle'
import { describeModifier } from '@/lib/pos/modifiers'
import { formatAgorot } from '@/lib/pos/money'
import { nameOf, sinceLabel, ticketLabel, timeLabel } from '@/lib/pos/format'
import { formatPhone } from '@/lib/pos/validate'
import { useT, usePosLang } from '@/lib/pos/useT'
import type { PosEvent, PosItem, PosOrder, PosOrderWithItems } from '@/lib/pos/types'
import { usePos, useRefreshKey } from '../PosProvider'
import { useLive } from '../live/LiveStore'
import { usePosNav } from '../PosNav'
import { usePosToast } from '../shell/Toast'
import { HandleChip } from '../shell/HandleChip'
import { errorText } from '../shell/errorText'
import { StatusChip, groupByPoint } from './OrderRow'
import VoidSheet, { type VoidTarget } from './VoidSheet'
import EditCustomerSheet from './EditCustomerSheet'
import './orders.css'

const EVENT_ICONS: Record<string, LucideIcon> = {
  receipt: Receipt,
  plus: Plus,
  pencil: Pencil,
  flame: Flame,
  bell: Bell,
  hand: Hand,
  check: Check,
  'undo-2': Undo2,
  x: X,
  ban: Ban,
  'circle-check': CheckCircle2,
}

type RawOrder = PosOrder & { pos_order_items?: PosItem[] | null }

function useNowEvery(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

/** The order, from the live store when it is there, else one direct read. */
function useOrder(orderId: string): { order: PosOrderWithItems | null; state: 'loading' | 'ready' | 'missing' } {
  const { byId } = useLive()
  const { me, branchId } = usePos()
  const key = useRefreshKey()
  const live = byId.get(orderId) ?? null
  const [fetched, setFetched] = useState<PosOrderWithItems | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    // The live store has it: nothing to read.
    if (live) return
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = me.codeOnly ? await readPos<RawOrder>({ kind: 'order', branch: branchId, order: orderId }) : await createClient()
          .from('pos_orders')
          .select(`${ORDER_COLUMNS}, pos_order_items(${ITEM_COLUMNS})`)
          .eq('id', orderId)
          .maybeSingle()
        if (cancelled || error) return
        const raw = data as unknown as RawOrder | null
        if (!raw) {
          setMissing(true)
          return
        }
        const { pos_order_items, ...rest } = raw
        setMissing(false)
        setFetched({ ...(rest as PosOrder), items: [...(pos_order_items ?? [])].sort((a, b) => a.seq - b.seq) })
      } catch {
        /* a failed read keeps what we had; the screen says "loading" rather than inventing a state */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orderId, live, key, me.codeOnly, branchId])

  if (live) return { order: live, state: 'ready' }
  if (fetched && fetched.id === orderId) return { order: fetched, state: 'ready' }
  return { order: null, state: missing ? 'missing' : 'loading' }
}

type EventRow = Pick<PosEvent, 'id' | 'event' | 'order_id' | 'actor_id' | 'actor_handle' | 'at' | 'payload'>

function useTimeline(orderId: string): { events: EventRow[] | null; failed: boolean } {
  const { me, branchId } = usePos()
  const key = useRefreshKey()
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = me.codeOnly ? await readPos<EventRow[]>({ kind: 'order_events', branch: branchId, order: orderId }) : await createClient()
          .from('pos_events')
          .select(EVENT_COLUMNS)
          .eq('order_id', orderId)
          .order('id', { ascending: false })
          .limit(120)
        if (cancelled) return
        if (error) {
          setFailed(true)
          return
        }
        setFailed(false)
        setEvents((data as unknown as EventRow[] | null) ?? [])
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orderId, key, me.codeOnly, branchId])
  return { events, failed }
}

export default function OrderDetailSheet({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const t = useT()
  const { order, state } = useOrder(orderId)
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null)
  const [editing, setEditing] = useState(false)
  // A nested sheet owns Escape/Tab while it is open; this one steps aside.
  const nested = !!voidTarget || editing

  return (
    <SheetShell open onClose={onClose} labelledBy="ord-detail-title" suspended={nested}>
      {order ? (
        <Detail
          order={order}
          onClose={onClose}
          onVoid={setVoidTarget}
          onEdit={() => setEditing(true)}
        />
      ) : (
        <div className="ord-detail-empty" role="status">
          <h2 id="ord-detail-title" className="pos-sheet-title">
            {state === 'missing' ? t('orders.detail.notFound.title') : t('orders.detail.loading')}
          </h2>
          {state === 'missing' ? <p className="pos-sheet-sub">{t('orders.detail.notFound.body')}</p> : null}
          <button type="button" className="pos-btn press" onClick={onClose}>
            {t('orders.detail.close')}
          </button>
        </div>
      )}
      <VoidSheet target={voidTarget} onClose={() => setVoidTarget(null)} />
      {order ? <EditCustomerSheet open={editing} order={order} onClose={() => setEditing(false)} /> : null}
    </SheetShell>
  )
}

function Detail({
  order,
  onClose,
  onVoid,
  onEdit,
}: {
  order: PosOrderWithItems
  onClose: () => void
  onVoid: (target: VoidTarget) => void
  onEdit: () => void
}) {
  const t = useT()
  const [lang] = usePosLang()
  const { me, pointsById } = usePos()
  const { advance } = useLive()
  const { go } = usePosNav()
  const { toast } = usePosToast()
  const now = useNowEvery(5_000)
  const { events, failed: timelineFailed } = useTimeline(order.id)

  const ticket = ticketLabel(order.ticket_no)
  const name = order.customer_name.trim() || t('orders.row.noName')
  const phone = order.customer_phone ? formatPhone(order.customer_phone) : ''
  const isOpen = order.status === 'open'
  const isVoid = order.status === 'void'

  const liveLines = order.items.filter((l) => l.status !== 'voided')
  const cancellable = liveLines.filter((l) => l.status !== 'delivered')
  const groups = useMemo(() => groupByPoint(order.items), [order.items])

  const feed = useMemo(() => groupFeed((events ?? []).filter((e) => !describeEvent(e, lang).quiet)), [events, lang])

  const handOver = useCallback(
    async (ids: string[]) => {
      haptic('tick')
      await advance(ids, 'ready', 'delivered')
    },
    [advance],
  )

  const takeBack = useCallback(
    async (id: string) => {
      haptic('select')
      const r = await advance([id], 'delivered', 'ready')
      if (r.ok.length) toast(t('orders.act.takenBack'), { tone: 'ok' })
    },
    [advance, toast, t],
  )

  const lineLabel = (l: PosItem) => `${l.qty}× ${nameOf(l.name, lang)}`

  return (
    <>
      <header className="ord-detail-head">
        <div className="ord-detail-titlewrap">
          <h2 id="ord-detail-title" className="pos-sheet-title">
            <span className="ltr-isolate">{ticket}</span> · {name}
          </h2>
          <div className="ord-chips">
            {isVoid ? (
              <StatusChip status="voided" />
            ) : (
              groups.map((g) => (
                <StatusChip key={g.pointId} status={g.status} label={g.pointName} colour={pointsById.get(g.pointId)?.colour} />
              ))
            )}
          </div>
        </div>
        <button type="button" className="ord-x press" onClick={onClose} aria-label={t('orders.detail.close')}>
          <X size={22} aria-hidden="true" />
        </button>
      </header>

      <div className="sheet-scroll ord-detail-scroll">
        {isVoid ? (
          <p className="ord-banner ord-banner--bad" role="status">
            <Ban size={18} aria-hidden="true" />
            <span>
              {order.void_reason
                ? t('orders.detail.cancelledNote', { reason: order.void_reason })
                : t('orders.detail.cancelledNoReason')}
            </span>
          </p>
        ) : null}

        {/* ---- customer ---- */}
        <section className="ord-card" aria-label={t('orders.detail.customer')}>
          <h3 className="ord-section-title">{t('orders.detail.customer')}</h3>
          <div className="ord-kv">
            <span className="ord-customer-name">{name}</span>
            {phone ? (
              <a className="ord-call press" href={`tel:${order.customer_phone}`} aria-label={t('orders.detail.call', { name })}>
                <Phone size={18} aria-hidden="true" />
                <span className="ltr-isolate">{phone}</span>
              </a>
            ) : (
              <span className="ord-dim">{t('orders.detail.noPhone')}</span>
            )}
          </div>
          {order.receipt_ref ? (
            <div className="ord-kv">
              <span className="ord-dim">{t('orders.detail.receipt')}</span>
              <span className="ltr-isolate ord-strong">{order.receipt_ref}</span>
            </div>
          ) : null}
          {order.note ? (
            <p className="ord-note">
              <MessageSquare size={16} aria-hidden="true" />
              <span>
                <span className="ord-dim">{t('orders.detail.note')}: </span>
                {order.note}
              </span>
            </p>
          ) : null}
          <p className="ord-by-line">
            <HandleChip staffId={order.created_by} handle={order.created_by_handle} />
            <span className="ord-dim">{t('orders.detail.enteredBy', { time: timeLabel(order.created_at) })}</span>
          </p>
        </section>

        {/* ---- lines ---- */}
        <section aria-label={t('orders.detail.lines')}>
          <h3 className="ord-section-title">{t('orders.detail.lines')}</h3>
          <ul className="ord-lines">
            {order.items.map((l) => {
              const point = pointsById.get(l.point_id)
              const voided = l.status === 'voided'
              const handoverHere = l.status === 'ready' && !!point && !point.hands_over
              const undo = canUndoDelivered(l, me.id, now, me.isManager)
              const canVoid = !isVoid && !voided && (l.status !== 'delivered' || me.isManager)
              return (
                <li key={l.id} className={`ord-line${voided ? ' is-voided' : ''}`}>
                  <div className="ord-line-top">
                    <span className="ord-line-name">{lineLabel(l)}</span>
                    <span className="ord-line-price ltr-isolate">{formatAgorot(l.qty * l.unit_agorot)}</span>
                  </div>
                  {l.type_label || l.variant_label ? (
                    <p className="ord-line-sub">
                      {[l.type_label ? nameOf(l.type_label, lang) : '', l.variant_label ?? ''].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                  {l.modifiers.length > 0 ? (
                    <ul className="ord-mods">
                      {l.modifiers.map((m, i) => (
                        <li key={`${m.group_uid}-${m.option_uid}-${i}`}>{describeModifier(m, lang)}</li>
                      ))}
                    </ul>
                  ) : null}
                  {l.for_name ? <p className="ord-line-sub">{t('orders.detail.forName', { name: l.for_name })}</p> : null}
                  {l.note ? (
                    <p className="ord-note">
                      <MessageSquare size={16} aria-hidden="true" />
                      <span>{l.note}</span>
                    </p>
                  ) : null}

                  <div className="ord-line-status">
                    <StatusChip status={l.status} label={l.point_name} colour={point?.colour} />
                  </div>
                  <Trail line={l} />

                  {handoverHere || undo || canVoid ? (
                    <div className="ord-line-actions">
                      {handoverHere ? (
                        <button type="button" className="pos-btn pos-btn--primary press" onClick={() => void handOver([l.id])}>
                          <Check size={18} aria-hidden="true" />
                          <span>{t('orders.act.handover')}</span>
                        </button>
                      ) : null}
                      {l.status === 'delivered' && undo ? (
                        <button type="button" className="pos-btn press" onClick={() => void takeBack(l.id)}>
                          <Undo2 size={18} aria-hidden="true" />
                          <span>{me.isManager && l.delivered_by !== me.id ? t('orders.act.takeBack') : t('orders.act.undoHandover')}</span>
                        </button>
                      ) : null}
                      {canVoid ? (
                        <button
                          type="button"
                          className="pos-btn ord-danger press"
                          aria-label={t('orders.act.voidItemFor', { name: nameOf(l.name, lang) })}
                          onClick={() =>
                            onVoid({ orderId: order.id, ticketNo: order.ticket_no, itemIds: [l.id], label: lineLabel(l) })
                          }
                        >
                          <Ban size={18} aria-hidden="true" />
                          <span>{t('orders.act.voidItem')}</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>

        {/* ---- totals ---- */}
        <section className="ord-card ord-totals">
          <div className="ord-kv">
            <span className="ord-strong">{t('orders.detail.total')}</span>
            <span className="ord-total-big ltr-isolate">{formatAgorot(order.total_agorot)}</span>
          </div>
          {order.slip_total_agorot !== null ? (
            <div className="ord-kv">
              <span className="ord-dim">{t('orders.detail.slip')}</span>
              <span className="ord-slip">
                <span className="ltr-isolate ord-strong">{formatAgorot(order.slip_total_agorot)}</span>
                {order.slip_mismatch ? (
                  <span className="ord-flag ord-flag--warn">
                    <AlertTriangle size={14} aria-hidden="true" />
                    {t('orders.detail.slipMismatch')}
                  </span>
                ) : (
                  <span className="ord-flag ord-flag--ok">
                    <Check size={14} aria-hidden="true" />
                    {t('orders.detail.slipMatch')}
                  </span>
                )}
              </span>
            </div>
          ) : null}
        </section>

        {/* ---- timeline ---- */}
        <section aria-label={t('orders.detail.timeline')}>
          <h3 className="ord-section-title">{t('orders.detail.timeline')}</h3>
          {events === null && !timelineFailed ? null : timelineFailed && (events === null || events.length === 0) ? (
            <p className="pos-hint pos-hint--bad" role="alert">
              {t('orders.detail.timelineFailed')}
            </p>
          ) : feed.length === 0 ? (
            <p className="pos-hint">{t('orders.detail.timelineEmpty')}</p>
          ) : (
            <ol className="ord-timeline">
              {feed.map((row) => {
                const d = describeEvent(row.event, lang)
                const Icon = EVENT_ICONS[d.icon] ?? Circle
                return (
                  <li key={row.ids[0]} className={`ord-ev ord-ev--${d.tone}`}>
                    <span className="ord-ev-icon" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <span className="ord-ev-body">
                      <span className="ord-ev-text">
                        {d.text}
                        {row.count > 1 ? ` · ${t('orders.detail.timelineCount', { n: row.count })}` : ''}
                      </span>
                      <span className="ord-ev-meta">
                        {row.event.actor_id || row.event.actor_handle ? (
                          <HandleChip staffId={row.event.actor_id} handle={row.event.actor_handle} />
                        ) : null}
                        <span className="ltr-isolate">{timeLabel(row.event.at)}</span>
                        <span className="ord-dim">{t('orders.row.age', { time: sinceLabel((now - Date.parse(row.event.at)) / 1000) })}</span>
                      </span>
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>

      <footer className="ord-detail-foot">
        {!isOpen ? <p className="ord-foot-note">{t('orders.act.addDisabledDone')}</p> : null}
        <div className="ord-foot-actions">
          <button
            type="button"
            className="pos-btn pos-btn--primary press"
            disabled={!isOpen}
            onClick={() => go({ v: 'register', addTo: order.id })}
          >
            <Plus size={18} aria-hidden="true" />
            <span>{t('orders.act.add')}</span>
          </button>
          <button type="button" className="pos-btn press" onClick={onEdit}>
            <Pencil size={18} aria-hidden="true" />
            <span>{t('orders.act.edit')}</span>
          </button>
          {isOpen && cancellable.length > 0 ? (
            <button
              type="button"
              className="pos-btn ord-danger press"
              onClick={() => onVoid({ orderId: order.id, ticketNo: order.ticket_no, itemIds: null, label: '' })}
            >
              <Ban size={18} aria-hidden="true" />
              <span>{t('orders.act.voidOrder')}</span>
            </button>
          ) : null}
        </div>
      </footer>
    </>
  )
}

/** What happened to a line, in order, with who did it as a handle chip (names live in the directory, never in the row). */
function Trail({ line }: { line: PosItem }) {
  const t = useT()
  const rows: { key: string; text: string; who: string | null }[] = []
  if (line.claimed_at) rows.push({ key: 'c', text: t('orders.detail.accepted', { time: timeLabel(line.claimed_at) }), who: line.claimed_by })
  if (line.ready_at) rows.push({ key: 'r', text: t('orders.detail.readyAt', { time: timeLabel(line.ready_at) }), who: null })
  if (line.delivered_at) rows.push({ key: 'd', text: t('orders.detail.deliveredBy', { time: timeLabel(line.delivered_at) }), who: line.delivered_by })
  if (line.status === 'voided' && line.voided_at) {
    const reason = line.void_reason ? ` · ${t('orders.detail.voidReason', { reason: line.void_reason })}` : ''
    rows.push({ key: 'v', text: `${t('orders.detail.voidedBy', { time: timeLabel(line.voided_at) })}${reason}`, who: line.voided_by })
  }
  if (rows.length === 0) return null
  return (
    <ul className="ord-trail">
      {rows.map((r) => (
        <li key={r.key}>
          <span>{r.text}</span>
          {r.who ? <HandleChip staffId={r.who} /> : null}
        </li>
      ))}
    </ul>
  )
}
