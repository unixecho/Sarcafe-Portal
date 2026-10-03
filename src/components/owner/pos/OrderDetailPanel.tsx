'use client'

// OrderDetailPanel — one order, all of it, for a manager: every line with its
// extras, who did each step and when, the whole per-order timeline, and the
// people who touched it WITH their emails (managers see an email here and in the
// log and nowhere else; a cashier never does).
//
// It is a SheetShell, so it has a real focus trap, Escape, focus restore and a
// scroll lock for free. The data is fetched when it opens (the history list
// deliberately carries no lines) and a failed read is said plainly with a retry.
//
// Money is shown exactly as the server stored it. When the order was typed from a
// slip and the two totals differ, the difference is the first thing under the
// header — it is the one fact on this panel somebody may need to act on.

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Ban, Bell, Check, Flame, Hand, Hourglass, Phone, TriangleAlert } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { describeEvent } from '@/lib/pos/events'
import { lineSummary, ticketLabel, type PosLang } from '@/lib/pos/format'
import { formatAgorot, lineTotalAgorot } from '@/lib/pos/money'
import type { OrderDetail } from '@/lib/pos/owner-api'
import type { PosItem } from '@/lib/pos/types'
import { usePosLang, useT } from '@/lib/pos/useT'
import { safeColour } from '@/components/pos/shell/safeColour'
import { Banner, OpsIcon, Who, clock, dayLabel, opsGet, useColours, useFailureText } from './FilterBar'

type Step = { key: string; icon: React.ReactNode; word: string; at: string; by: string | null }

export default function OrderDetailPanel({
  open, orderId, branchSlug, tz, onClose,
}: { open: boolean; orderId: string | null; branchSlug: string; tz?: string; onClose: () => void }) {
  const t = useT()
  const [lang] = usePosLang()
  const failureText = useFailureText()
  const titleId = useId()
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!orderId) return
    setLoading(true)
    const r = await opsGet<OrderDetail>(`orders/${encodeURIComponent(orderId)}`, { branch: branchSlug })
    setLoading(false)
    if (r.ok) {
      setDetail(r.data)
      setFailed(null)
    } else setFailed(r.code)
  }, [orderId, branchSlug])

  useEffect(() => {
    if (!open || !orderId) return
    // A different order must never flash the previous one's lines.
    setDetail((d) => (d && d.order.id === orderId ? d : null))
    setFailed(null)
    void load()
  }, [open, orderId, load])

  const colour = useColours(detail?.directory ?? [])
  const staffById = useMemo(() => new Map((detail?.staff ?? []).map((s) => [s.id, s])), [detail])

  const who = (id: string | null | undefined, snapshot?: string | null) =>
    id || snapshot ? <Who handle={snapshot ?? staffById.get(id ?? '')?.handle ?? null} colour={colour(id)} /> : null

  const steps = (it: PosItem): Step[] => {
    const out: Step[] = []
    const add = (key: string, icon: React.ReactNode, word: string, at: string | null, by: string | null) => {
      if (at) out.push({ key, icon, word, at, by })
    }
    add('sent', <Hourglass size={14} aria-hidden="true" />, t('owner.ops.step.sent'), it.sent_at, it.created_by)
    add('claimed', <Flame size={14} aria-hidden="true" />, t('owner.ops.step.claimed'), it.claimed_at, it.claimed_by)
    add('ready', <Bell size={14} aria-hidden="true" />, t('owner.ops.step.ready'), it.ready_at, it.claimed_by)
    add('picked', <Hand size={14} aria-hidden="true" />, t('owner.ops.step.picked'), it.picked_up_at, it.picked_up_by)
    add('delivered', <Check size={14} aria-hidden="true" />, t('owner.ops.step.delivered'), it.delivered_at, it.delivered_by)
    add('voided', <Ban size={14} aria-hidden="true" />, t('owner.ops.step.voided'), it.voided_at, it.voided_by)
    return out
  }

  const o = detail?.order
  const pointOf = (id: string) => detail?.points.find((p) => p.id === id)

  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId} className="ops-sheet ops-sheet--wide">
      <div className="ops-sheet-headrow">
        <h2 id={titleId} className="ops-sheet-title">
          {o ? (
            <>
              <span className="ltr-isolate">{ticketLabel(o.ticket_no)}</span> · {o.customer_name || t('owner.ops.order.noName')}
            </>
          ) : (
            t('owner.ops.order.title')
          )}
        </h2>
        <button type="button" className="ops-link-btn press" onClick={onClose}>{t('owner.ops.close')}</button>
      </div>

      <div className="sheet-scroll ops-detail" aria-busy={loading || undefined}>
        {failed && !detail && (
          <Banner tone="danger" action={<button type="button" className="ops-link-btn press" onClick={() => void load()}>{t('owner.ops.retry')}</button>}>
            {failureText(failed)}
          </Banner>
        )}
        {!detail && !failed && (
          <div aria-hidden="true" className="ops-detail-skel">
            {[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 56, borderRadius: 14 }} />)}
          </div>
        )}

        {detail && o && (
          <>
            {failed && (
              <Banner action={<button type="button" className="ops-link-btn press" onClick={() => void load()}>{t('owner.ops.retry')}</button>}>
                {t('owner.ops.stale')}
              </Banner>
            )}

            <div className="ops-detail-top">
              <span className={`ops-status ops-status--${o.status}`}>
                {o.status === 'completed' ? <Check size={14} aria-hidden="true" /> : o.status === 'void' ? <Ban size={14} aria-hidden="true" /> : <Hourglass size={14} aria-hidden="true" />}
                {t(o.status === 'completed' ? 'owner.ops.status.completed' : o.status === 'void' ? 'owner.ops.status.void' : 'owner.ops.status.open')}
              </span>
              {detail.session?.kind === 'training' && <span className="ops-tag">{t('owner.ops.order.training')}</span>}
              <span className="ops-muted">{t('owner.ops.order.createdBy')}</span>
              {who(o.created_by, o.created_by_handle)}
              <time className="ltr-isolate ops-muted" dateTime={o.created_at}>{dayLabel(o.created_at, tz)} {clock(o.created_at, tz)}</time>
            </div>

            {o.slip_mismatch && (
              <Banner icon={<TriangleAlert size={18} />}>
                {t('owner.ops.order.mismatch', {
                  order: formatAgorot(o.total_agorot),
                  slip: o.slip_total_agorot === null ? '—' : formatAgorot(o.slip_total_agorot),
                })}
              </Banner>
            )}
            {o.status === 'void' && (
              <Banner tone="danger" icon={<Ban size={18} />}>
                {t('owner.ops.order.voided', { why: o.void_reason || '—' })}
              </Banner>
            )}

            <dl className="ops-kv">
              <div><dt>{t('owner.ops.order.total')}</dt><dd className="ltr-isolate"><b>{formatAgorot(o.total_agorot)}</b></dd></div>
              {o.slip_total_agorot !== null && (
                <div><dt>{t('owner.ops.order.slip')}</dt><dd className="ltr-isolate">{formatAgorot(o.slip_total_agorot)}</dd></div>
              )}
              {o.receipt_ref && <div><dt>{t('owner.ops.order.receipt')}</dt><dd className="ltr-isolate">{o.receipt_ref}</dd></div>}
              {o.customer_phone && (
                <div>
                  <dt>{t('owner.ops.order.phone')}</dt>
                  <dd>
                    <a className="ops-phone press" href={`tel:${o.customer_phone.replace(/[^\d+]/g, '')}`}>
                      <Phone size={14} aria-hidden="true" /><span className="ltr-isolate">{o.customer_phone}</span>
                    </a>
                  </dd>
                </div>
              )}
              {o.note && <div><dt>{t('owner.ops.order.note')}</dt><dd>{o.note}</dd></div>}
            </dl>

            <h3 className="ops-h3">{t('owner.ops.order.lines')}</h3>
            <ul className="ops-lines">
              {[...detail.items].sort((a, b) => a.seq - b.seq).map((it) => {
                const p = pointOf(it.point_id)
                const gone = it.status === 'voided'
                return (
                  <li key={it.id} className={`ops-line${gone ? ' is-void' : ''}`}>
                    <div className="ops-line-top">
                      <span className="ops-line-name">{lineSummary(it, lang as PosLang)}</span>
                      <b className="ltr-isolate">{formatAgorot(lineTotalAgorot(it.unit_agorot, it.qty))}</b>
                    </div>
                    <div className="ops-line-sub">
                      <span className="ops-pointdot"><i aria-hidden="true" style={{ background: safeColour(p?.colour, '#9c9086') }} />{p?.name ?? it.point_name}</span>
                      {it.for_name && <span>{t('owner.ops.order.for', { name: it.for_name })}</span>}
                      {it.note && <span>{it.note}</span>}
                      {gone && <span className="ops-stage"><Ban size={14} aria-hidden="true" />{t('owner.ops.step.voided')}{it.void_reason ? ` · ${it.void_reason}` : ''}</span>}
                    </div>
                    <ol className="ops-steps">
                      {steps(it).map((s) => (
                        <li key={s.key}>
                          <span className="ops-stage">{s.icon}{s.word}</span>
                          <time className="ltr-isolate" dateTime={s.at}>{clock(s.at, tz)}</time>
                          {s.by && s.key !== 'sent' && who(s.by)}
                        </li>
                      ))}
                    </ol>
                  </li>
                )
              })}
            </ul>

            <h3 className="ops-h3">{t('owner.ops.order.people')}</h3>
            <ul className="ops-people-list">
              {detail.staff.map((s) => (
                <li key={s.id}>
                  <Who handle={s.handle} colour={s.colour ?? colour(s.id)} />
                  {s.displayName && <span className="ops-muted">{s.displayName}</span>}
                  {s.email && <span className="ltr-isolate ops-email">{s.email}</span>}
                </li>
              ))}
            </ul>

            <h3 className="ops-h3">{t('owner.ops.order.timeline')}</h3>
            <ol className="ops-timeline">
              {detail.events.map((e) => {
                const d = describeEvent(e, lang as PosLang)
                return (
                  <li key={e.id}>
                    <span className={`ops-feed-icon ops-tone--${d.tone}`}><OpsIcon name={d.icon} size={16} /></span>
                    <span className="ops-feed-body">
                      <span className="ops-feed-text">{d.text}</span>
                      {(e.actor_handle || e.actor_id) && <span className="ops-feed-meta">{who(e.actor_id, e.actor_handle)}</span>}
                    </span>
                    <time className="ops-feed-time ltr-isolate" dateTime={e.at}>{clock(e.at, tz)}</time>
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </div>
    </SheetShell>
  )
}
