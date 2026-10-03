'use client'

// OrdersHistory — every order, newest first, filterable, paginated by cursor.
//
//   #42 · דנה · 054… · נוצרה ע״י Maya · פיצה ✓ קפה ⏳ · ₪58 · 14:12
//
// A row is a summary a manager can scan: who, what is done and what is still
// cooking at each point, how much, when. Colour is never the only signal — every
// point chip carries an icon and (for a screen reader) the state in words. The phone
// number is shown only as its first digits here; the full number is in the detail
// panel one tap away, which is manager-only like this whole page.
//
// Filtering never blanks the list: the rows already shown stay (dimmed) until the new
// answer lands, and "load more" APPENDS, so the row you were reading does not move.

import { useEffect, useMemo, useState } from 'react'
import { Ban, Bell, Check, Download, Hourglass, TriangleAlert } from 'lucide-react'
import type { Branch } from '@/lib/branches'
import { ticketLabel } from '@/lib/pos/format'
import { formatAgorot } from '@/lib/pos/money'
import type {
  OrderListRow, OrdersPage, PointChip, PointsPayload, SessionsPayload,
} from '@/lib/pos/owner-api'
import { useT } from '@/lib/pos/useT'
import {
  Banner, BranchBar, ChipGroup, DEFAULT_ZONE, DateField, FieldSelect, FilterBar, SwitchRow, TextField, Who,
  clock, dayLabel, isSameDay, opsGet, useColours, useFailureText, usePagedRows,
} from './FilterBar'
import OrderDetailPanel from './OrderDetailPanel'
import './ops.css'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

type ChipState = 'voided' | 'done' | 'ready' | 'pending'
function chipState(c: PointChip): ChipState {
  const total = c.sent + c.preparing + c.ready + c.delivered + c.voided
  if (total > 0 && c.voided === total) return 'voided'
  if (c.sent + c.preparing > 0) return 'pending'
  if (c.ready > 0) return 'ready'
  return 'done'
}

function PointChips({ points }: { points: PointChip[] }) {
  const t = useT()
  return (
    <span className="ops-order-chips">
      {points.map((p) => {
        const s = chipState(p)
        return (
          <span key={p.point_id} className={`ops-pchip ops-pchip--${s}`}>
            {p.point_name}
            {s === 'done' ? <Check size={14} aria-hidden="true" />
              : s === 'ready' ? <Bell size={14} aria-hidden="true" />
              : s === 'voided' ? <Ban size={14} aria-hidden="true" />
              : <Hourglass size={14} aria-hidden="true" />}
            <span className="sr-only">{t(`owner.ops.chip.${s}` as 'owner.ops.chip.done')}</span>
          </span>
        )
      })}
    </span>
  )
}

function History({
  branchSlug, tz, initial, openOrder,
}: { branchSlug: string; tz: string; initial: OrdersPage | null; openOrder: string | null }) {
  const t = useT()
  const failureText = useFailureText()

  const [session, setSession] = useState('')
  const [status, setStatus] = useState('')
  const [point, setPoint] = useState('')
  const [handle, setHandle] = useState('')
  const [text, setText] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [training, setTraining] = useState(false)
  const q = useDebounced(text.trim(), 350)

  // what the pickers offer — fetched once per branch, never blocks the list
  const [sessions, setSessions] = useState<SessionsPayload | null>(null)
  const [points, setPoints] = useState<PointsPayload | null>(null)
  useEffect(() => {
    let live = true
    void opsGet<SessionsPayload>('session', { branch: branchSlug }).then((r) => live && r.ok && setSessions(r.data))
    void opsGet<PointsPayload>('points', { branch: branchSlug }).then((r) => live && r.ok && setPoints(r.data))
    return () => { live = false }
  }, [branchSlug])

  const params = useMemo(
    () => ({
      branch: branchSlug,
      session: session || undefined,
      status: status || undefined,
      point: point || undefined,
      handle: handle || undefined,
      q: q || undefined,
      from: from || undefined,
      to: to || undefined,
      training: training ? '1' : undefined,
    }),
    [branchSlug, session, status, point, handle, q, from, to, training],
  )
  const list = usePagedRows<OrderListRow>('orders', params, initial, (r) => r.id)
  const colour = useColours(list.directory)

  const [detailId, setDetailId] = useState<string | null>(openOrder)
  const [detailOpen, setDetailOpen] = useState(!!openOrder)

  const sessionOptions = (sessions?.recent ?? []).map((s) => ({
    value: s.id,
    label: `${s.kind === 'training' ? `${t('owner.ops.order.training')} · ` : ''}${dayLabel(s.started_at, tz)} ${clock(s.started_at, tz)}${s.status === 'active' ? ` · ${t('owner.ops.history.active')}` : ''}`,
  }))
  const pointOptions = (points?.points ?? []).map((p) => ({ value: p.id, label: p.name }))
  const handleOptions = list.directory.map((d) => ({ value: d.handle, label: d.handle }))

  const activeCount = [session, status, point, handle, text.trim(), from, to, training ? '1' : ''].filter(Boolean).length
  const reset = () => {
    setSession(''); setStatus(''); setPoint(''); setHandle(''); setText(''); setFrom(''); setTo(''); setTraining(false)
  }

  // ---- CSV ----
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState<string | null>(null)
  async function exportCsv() {
    setExporting(true)
    setExportErr(null)
    try {
      const qs = new URLSearchParams({ branch: branchSlug })
      if (session) qs.set('session', session)
      if (training) qs.set('training', '1')
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const res = await fetch(`/api/owner/pos/export?${qs.toString()}`, { credentials: 'same-origin', cache: 'no-store' })
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null)
        const code = (body as { error?: { code?: unknown } } | null)?.error?.code
        setExportErr(failureText(typeof code === 'string' ? code : res.status === 429 ? 'rate_limited' : 'internal_error'))
        return
      }
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'orders.csv'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      setExportErr(failureText('network'))
    } finally {
      setExporting(false)
    }
  }

  const now = Date.now()

  return (
    <div className="ops-history">
      <FilterBar activeCount={activeCount} onReset={reset} busy={list.busy}>
        <FieldSelect label={t('owner.ops.filter.session')} value={session} options={sessionOptions} placeholder={t('owner.ops.filter.allSessions')} onChange={setSession} />
        <ChipGroup
          label={t('owner.ops.filter.status')}
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: t('owner.ops.filter.any') },
            { value: 'open', label: t('owner.ops.status.open') },
            { value: 'completed', label: t('owner.ops.status.completed') },
            { value: 'void', label: t('owner.ops.status.void') },
          ]}
        />
        <FieldSelect label={t('owner.ops.filter.point')} value={point} options={pointOptions} placeholder={t('owner.ops.filter.anyPoint')} onChange={setPoint} />
        <FieldSelect label={t('owner.ops.filter.person')} value={handle} options={handleOptions} placeholder={t('owner.ops.filter.anyone')} onChange={setHandle} />
        <TextField label={t('owner.ops.filter.search')} value={text} onChange={setText} placeholder={t('owner.ops.filter.searchHint')} />
        <DateField label={t('owner.ops.filter.from')} value={from} onChange={setFrom} />
        <DateField label={t('owner.ops.filter.to')} value={to} onChange={setTo} />
        <SwitchRow label={t('owner.ops.filter.training')} hint={t('owner.ops.filter.trainingHint')} on={training} onChange={setTraining} />
      </FilterBar>

      <div className="ops-list-head">
        <span className="ops-muted" role="status">
          {list.loaded ? t('owner.ops.history.shown', { n: list.rows.length }) : ''}
        </span>
        <button type="button" className="ops-btn press" disabled={exporting} onClick={() => void exportCsv()}>
          <Download size={18} aria-hidden="true" />
          {exporting ? t('owner.ops.history.exporting') : t('owner.ops.history.export')}
        </button>
      </div>
      {exportErr && <Banner tone="danger">{exportErr}</Banner>}

      {list.failed && (
        <Banner tone={list.loaded ? 'warn' : 'danger'} action={<button type="button" className="ops-link-btn press" onClick={() => void list.reload()}>{t('owner.ops.retry')}</button>}>
          {list.loaded ? t('owner.ops.stale') : failureText(list.failed)}
        </Banner>
      )}

      {!list.loaded && !list.failed ? (
        <div aria-hidden="true" className="ops-order-list">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="sk" style={{ height: 76, borderRadius: 16 }} />)}
        </div>
      ) : list.loaded && list.rows.length === 0 && !list.busy ? (
        <p className="ops-drill-none">{t('owner.ops.history.none')}</p>
      ) : (
        <ul className={`ops-order-list${list.busy ? ' is-dim' : ''}`} aria-busy={list.busy || undefined}>
          {list.rows.map((r) => {
            const phone = r.customer_phone ? `${r.customer_phone.replace(/\D/g, '').slice(0, 3)}…` : null
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className="ops-order press"
                  onClick={() => {
                    setDetailId(r.id)
                    setDetailOpen(true)
                  }}
                >
                  <span className="ops-order-id ltr-isolate">{ticketLabel(r.ticket_no)}</span>
                  <span className="ops-order-main">
                    <span className="ops-order-line1">
                      <b>{r.customer_name || t('owner.ops.order.noName')}</b>
                      {phone && <span className="ltr-isolate ops-muted">{phone}</span>}
                      <span className="ops-muted">{t('owner.ops.order.createdBy')}</span>
                      <Who handle={r.created_by_handle} colour={colour(r.created_by)} />
                    </span>
                    <PointChips points={r.points} />
                  </span>
                  <span className="ops-order-side">
                    <b className="ltr-isolate">{formatAgorot(r.total_agorot)}</b>
                    <span className="ops-order-time">
                      {!isSameDay(r.created_at, now, tz) && <span>{dayLabel(r.created_at, tz)} </span>}
                      <time className="ltr-isolate" dateTime={r.created_at}>{clock(r.created_at, tz)}</time>
                    </span>
                    <span className="ops-order-flags">
                      <span className={`ops-status ops-status--${r.status}`}>
                        {r.status === 'completed' ? <Check size={14} aria-hidden="true" /> : r.status === 'void' ? <Ban size={14} aria-hidden="true" /> : <Hourglass size={14} aria-hidden="true" />}
                        {t(r.status === 'completed' ? 'owner.ops.status.completed' : r.status === 'void' ? 'owner.ops.status.void' : 'owner.ops.status.open')}
                      </span>
                      {r.session_kind === 'training' && <span className="ops-tag">{t('owner.ops.order.training')}</span>}
                      {r.slip_mismatch && (
                        <span className="ops-flag ops-flag--warn"><TriangleAlert size={14} aria-hidden="true" />{t('owner.ops.history.mismatch')}</span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {list.hasMore && (
        <button type="button" className="ops-btn ops-btn--block press" disabled={list.moreBusy} onClick={() => void list.more()}>
          {list.moreBusy ? t('owner.ops.history.loadingMore') : t('owner.ops.history.more')}
        </button>
      )}

      <OrderDetailPanel open={detailOpen} orderId={detailId} branchSlug={branchSlug} tz={tz} onClose={() => setDetailOpen(false)} />
    </div>
  )
}

export default function OrdersHistory({
  branches, initialBranch, timezones, initial, openOrder,
}: { branches: Branch[]; initialBranch: string; timezones: Record<string, string>; initial: OrdersPage | null; openOrder: string | null }) {
  const [branch, setBranch] = useState(initialBranch)
  return (
    <>
      <BranchBar branches={branches} value={branch} onChange={setBranch} />
      <History key={branch} branchSlug={branch} tz={timezones[branch] ?? DEFAULT_ZONE} initial={branch === initialBranch ? initial : null} openOrder={branch === initialBranch ? openOrder : null} />
    </>
  )
}
