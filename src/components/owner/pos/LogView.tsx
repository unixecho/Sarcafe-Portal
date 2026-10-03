'use client'

// LogView — the full audit log. Every row is one sentence (describeEvent(), the same
// wording as the live feed and the order timeline) plus WHO, and a tap opens the
// details as plain label/value pairs — never a JSON dump: a manager reading "why was
// this cancelled?" should not have to parse braces.
//
// The actor's email appears only in the expanded row (managers see it here and in the
// order detail, nowhere else). Filters mirror the brief: event type — grouped the way a
// person thinks about it —, person (by nickname), selling point, date.
//
// Pagination appends (cursor), so reading down the log never reshuffles what is above.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import type { Branch } from '@/lib/branches'
import { describeEvent } from '@/lib/pos/events'
import { formatAgorot } from '@/lib/pos/money'
import type { LogPage, LogRow, PointsPayload } from '@/lib/pos/owner-api'
import type { PosEventType } from '@/lib/pos/types'
import { usePosLang, useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import {
  Banner, BranchBar, DEFAULT_ZONE, DateField, FieldSelect, FilterBar, OpsIcon, SwitchRow, Who,
  clock, dayLabel, opsGet, useColours, useFailureText, usePagedRows,
} from './FilterBar'
import './ops.css'

const GROUPS: { id: string; label: StrKey; events: readonly PosEventType[] }[] = [
  { id: 'orders', label: 'owner.ops.log.g.orders', events: ['order_created', 'items_added', 'order_edited', 'order_voided', 'order_completed'] },
  { id: 'items', label: 'owner.ops.log.g.items', events: ['item_claimed', 'item_ready', 'item_picked_up', 'item_delivered', 'item_reverted', 'item_voided'] },
  { id: 'event', label: 'owner.ops.log.g.event', events: ['session_opened', 'session_closed', 'training_wiped'] },
  {
    id: 'settings',
    label: 'owner.ops.log.g.settings',
    events: ['point_created', 'point_updated', 'point_deactivated', 'routes_changed', 'settings_changed', 'board_token_rotated', 'pii_cleared'],
  },
  { id: 'people', label: 'owner.ops.log.g.people', events: ['checkin', 'checkout', 'handle_changed', 'pin_changed', 'quick_login'] },
]

/** The words for a payload field. Anything not listed is shown with its name tidied, never hidden. */
const FIELD_LABELS: Record<string, StrKey> = {
  customer_name: 'owner.ops.key.customer_name',
  previous_name: 'owner.ops.key.previous_name',
  ticket_no: 'owner.ops.key.ticket_no',
  total_agorot: 'owner.ops.key.total',
  slip_total_agorot: 'owner.ops.key.slip',
  slip_mismatch: 'owner.ops.key.slip_mismatch',
  items: 'owner.ops.key.items',
  name: 'owner.ops.key.name',
  type: 'owner.ops.key.type',
  qty: 'owner.ops.key.qty',
  reason: 'owner.ops.key.reason',
  point: 'owner.ops.key.point',
  from: 'owner.ops.key.from',
  to: 'owner.ops.key.to',
  old: 'owner.ops.key.old',
  new: 'owner.ops.key.new',
  kind: 'owner.ops.key.kind',
  orders: 'owner.ops.key.orders',
  phones: 'owner.ops.key.phones',
  names: 'owner.ops.key.names',
  enabled: 'owner.ops.key.enabled',
  moved_to: 'owner.ops.key.moved_to',
  voided_uncollected: 'owner.ops.key.voided_uncollected',
  employee_no: 'owner.ops.key.employee_no',
  note: 'owner.ops.key.note',
}

const STATE_WORDS: Record<string, StrKey> = {
  sent: 'owner.ops.stage.waiting',
  preparing: 'owner.ops.stage.preparing',
  ready: 'owner.ops.stage.ready',
  delivered: 'owner.ops.stage.done',
}

const tidy = (k: string) => k.replace(/_/g, ' ')

type Pair = { label: string; value: string }

function payloadPairs(
  payload: Record<string, unknown>,
  t: (k: StrKey, p?: Record<string, string | number>) => string,
): Pair[] {
  const out: Pair[] = []
  const word = (v: unknown) => {
    const s = String(v)
    return STATE_WORDS[s] ? t(STATE_WORDS[s]) : s
  }
  for (const [k, v] of Object.entries(payload)) {
    // ids are plumbing, not information
    if (v === null || v === undefined || v === '' || k === 'id' || k.endsWith('_id') || k.endsWith('_uid')) continue
    const label = FIELD_LABELS[k] ? t(FIELD_LABELS[k]) : tidy(k)
    let value: string
    if (typeof v === 'boolean') value = t(v ? 'owner.ops.yes' : 'owner.ops.no')
    else if (typeof v === 'number') value = k.endsWith('_agorot') ? formatAgorot(v) : String(v)
    else if (typeof v === 'string') value = k === 'from' || k === 'to' ? word(v) : v
    else if (Array.isArray(v)) {
      value = v
        .map((x) => {
          if (x && typeof x === 'object') {
            const o = x as Record<string, unknown>
            const nm = typeof o.name === 'string' ? o.name : ''
            const q = typeof o.qty === 'number' && o.qty > 1 ? `${o.qty}× ` : ''
            return nm ? `${q}${nm}` : Object.values(o).filter((y) => typeof y === 'string' || typeof y === 'number').join(' · ')
          }
          return String(x)
        })
        .filter(Boolean)
        .join('\n')
    } else if (typeof v === 'object') {
      value = Object.entries(v as Record<string, unknown>)
        .filter(([, y]) => typeof y === 'string' || typeof y === 'number' || typeof y === 'boolean')
        .map(([kk, y]) => `${tidy(kk)}: ${String(y)}`)
        .join('\n')
    } else continue
    if (value !== '') out.push({ label, value })
  }
  return out
}

function Log({
  branchSlug, tz, initial,
}: { branchSlug: string; tz: string; initial: LogPage | null }) {
  const t = useT()
  const [lang] = usePosLang()
  const failureText = useFailureText()

  const [groups, setGroups] = useState<string[]>([])
  const [handle, setHandle] = useState('')
  const [point, setPoint] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [training, setTraining] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  const [points, setPoints] = useState<PointsPayload | null>(null)
  useEffect(() => {
    let live = true
    void opsGet<PointsPayload>('points', { branch: branchSlug }).then((r) => live && r.ok && setPoints(r.data))
    return () => { live = false }
  }, [branchSlug])

  const events = useMemo(
    () => GROUPS.filter((g) => groups.includes(g.id)).flatMap((g) => g.events).join(',') || undefined,
    [groups],
  )
  const params = useMemo(
    () => ({
      branch: branchSlug,
      events,
      handle: handle || undefined,
      point: point || undefined,
      from: from || undefined,
      to: to || undefined,
      training: training ? '1' : undefined,
    }),
    [branchSlug, events, handle, point, from, to, training],
  )
  const list = usePagedRows<LogRow>('log', params, initial, (r) => r.id)
  const colour = useColours(list.directory)

  const toggleGroup = (id: string) => setGroups((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]))
  const activeCount = groups.length + [handle, point, from, to, training ? '1' : ''].filter(Boolean).length
  const reset = () => { setGroups([]); setHandle(''); setPoint(''); setFrom(''); setTo(''); setTraining(false) }

  return (
    <div className="ops-history">
      <FilterBar activeCount={activeCount} onReset={reset} busy={list.busy}>
        <div className="ops-field ops-field--grow">
          <span className="ops-field-label">{t('owner.ops.log.types')}</span>
          <div className="ops-chips" role="group" aria-label={t('owner.ops.log.types')}>
            {GROUPS.map((g) => (
              <button key={g.id} type="button" className="ops-chip press" aria-pressed={groups.includes(g.id)} onClick={() => toggleGroup(g.id)}>
                {t(g.label)}
              </button>
            ))}
          </div>
        </div>
        <FieldSelect
          label={t('owner.ops.filter.person')}
          value={handle}
          options={list.directory.map((d) => ({ value: d.handle, label: d.handle }))}
          placeholder={t('owner.ops.filter.anyone')}
          onChange={setHandle}
        />
        <FieldSelect
          label={t('owner.ops.filter.point')}
          value={point}
          options={(points?.points ?? []).map((p) => ({ value: p.id, label: p.name }))}
          placeholder={t('owner.ops.filter.anyPoint')}
          onChange={setPoint}
        />
        <DateField label={t('owner.ops.filter.from')} value={from} onChange={setFrom} />
        <DateField label={t('owner.ops.filter.to')} value={to} onChange={setTo} />
        <SwitchRow label={t('owner.ops.log.training')} hint={t('owner.ops.log.trainingHint')} on={training} onChange={setTraining} />
      </FilterBar>

      <div className="ops-list-head">
        <span className="ops-muted" role="status">{list.loaded ? t('owner.ops.log.shown', { n: list.rows.length }) : ''}</span>
      </div>

      {list.failed && (
        <Banner tone={list.loaded ? 'warn' : 'danger'} action={<button type="button" className="ops-link-btn press" onClick={() => void list.reload()}>{t('owner.ops.retry')}</button>}>
          {list.loaded ? t('owner.ops.stale') : failureText(list.failed)}
        </Banner>
      )}

      {!list.loaded && !list.failed ? (
        <div aria-hidden="true" className="ops-order-list">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="sk" style={{ height: 58, borderRadius: 14 }} />)}
        </div>
      ) : list.loaded && list.rows.length === 0 && !list.busy ? (
        <p className="ops-drill-none">{t('owner.ops.log.none')}</p>
      ) : (
        <ol className={`ops-log-list${list.busy ? ' is-dim' : ''}`} aria-busy={list.busy || undefined}>
          {list.rows.map((r) => {
            const d = describeEvent(r, lang)
            const isOpen = open === r.id
            const pairs = isOpen ? payloadPairs(r.payload ?? {}, t) : []
            return (
              <li key={r.id} className="ops-log-item">
                <button type="button" className="ops-log-row press" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                  <span className={`ops-feed-icon ops-tone--${d.tone}`}><OpsIcon name={d.icon} size={16} /></span>
                  <span className="ops-feed-body">
                    <span className="ops-feed-text">{d.text}</span>
                    <span className="ops-feed-meta">
                      {(r.actor_handle || r.actor_id) && <Who handle={r.actor_handle} colour={colour(r.actor_id)} />}
                      {r.point_name && <span className="ops-tag">{r.point_name}</span>}
                      {r.session_kind === 'training' && <span className="ops-tag">{t('owner.ops.order.training')}</span>}
                    </span>
                  </span>
                  <span className="ops-log-when ltr-isolate">
                    <span>{dayLabel(r.at, tz)}</span>
                    <time dateTime={r.at}>{clock(r.at, tz)}</time>
                  </span>
                  <ChevronDown size={16} aria-hidden="true" className="ops-filter-chev" data-open={isOpen} />
                </button>
                {isOpen && (
                  <div className="ops-log-detail">
                    <dl className="ops-kv">
                      {pairs.map((p) => (
                        <div key={p.label}><dt>{p.label}</dt><dd className="ops-pre">{p.value}</dd></div>
                      ))}
                      {r.actor_email && (
                        <div><dt>{t('owner.ops.log.email')}</dt><dd className="ltr-isolate ops-email">{r.actor_email}</dd></div>
                      )}
                    </dl>
                    {pairs.length === 0 && !r.actor_email && <p className="ops-muted">{t('owner.ops.log.noDetails')}</p>}
                    {r.order_id && (
                      <Link className="ops-link-btn press" href={`/owner/pos/orders?order=${encodeURIComponent(r.order_id)}`}>
                        {t('owner.ops.log.openOrder')}
                      </Link>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {list.hasMore && (
        <button type="button" className="ops-btn ops-btn--block press" disabled={list.moreBusy} onClick={() => void list.more()}>
          {list.moreBusy ? t('owner.ops.history.loadingMore') : t('owner.ops.history.more')}
        </button>
      )}
    </div>
  )
}

export default function LogView({
  branches, initialBranch, timezones, initial,
}: { branches: Branch[]; initialBranch: string; timezones: Record<string, string>; initial: LogPage | null }) {
  const [branch, setBranch] = useState(initialBranch)
  return (
    <>
      <BranchBar branches={branches} value={branch} onChange={setBranch} />
      <Log key={branch} branchSlug={branch} tz={timezones[branch] ?? DEFAULT_ZONE} initial={branch === initialBranch ? initial : null} />
    </>
  )
}
