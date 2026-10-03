'use client'

// StatsView — the numbers for an event, and where they came from.
//
// EVERY NUMBER IS THE SERVER'S. Money, shares, medians, rates: all computed in
// src/lib/pos/server/stats.ts and only formatted here. The one thing this file derives
// is a chart's x-axis (which 15-minute slot a bucket belongs to) and "which bar is the
// peak", for the chart's text alternative — neither is money.
//
// `known` IS HONOURED EVERYWHERE. A number whose read failed is "—", and a whole
// section whose read failed says so and offers a retry; it never shows an empty
// table that looks like "nothing happened".
//
// The picker defaults to the active (or most recent) LIVE session — what a manager at
// the end of a night means by "tonight". Practice sessions are excluded unless asked.
// Switching the picker keeps the old numbers on screen, dimmed, until the new ones land.

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { Branch } from '@/lib/branches'
import { nameOf, sinceLabel } from '@/lib/pos/format'
import { formatAgorot } from '@/lib/pos/money'
import type { DashboardDrill, Known, PosStat, StatsPayload, TimingSet, TimingStat } from '@/lib/pos/owner-api'
import { usePosLang, useT } from '@/lib/pos/useT'
import { safeColour } from '@/components/pos/shell/safeColour'
import BarChart, { type ChartBucket, type ChartSeries } from './BarChart'
import { DrillPanel } from './PosSignalStack'
import {
  Banner, BranchBar, FieldSelect, SwitchRow, Who, clock, dayLabel, useColours, useFailureText, useOpsResource,
  DEFAULT_ZONE,
} from './FilterBar'
import './ops.css'

const TOP_ITEMS = 10

function Section({
  id, title, known, onRetry, children,
}: { id: string; title: string; known: boolean; onRetry: () => void; children: ReactNode }) {
  const t = useT()
  return (
    <section className="ops-card" aria-labelledby={id}>
      <h2 id={id} className="ops-h2">{title}</h2>
      {known ? children : (
        <Banner action={<button type="button" className="ops-link-btn press" onClick={onRetry}>{t('owner.ops.retry')}</button>}>
          {t('owner.ops.drill.failed')}
        </Banner>
      )}
    </section>
  )
}

function Bar({ share, colour }: { share: number; colour: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(share * 100)))
  return (
    <span className="ops-bar" aria-hidden="true">
      <i style={{ width: `${pct}%`, background: safeColour(colour, '#ff7a45') }} />
    </span>
  )
}

const pct = (share: number) => `${Math.round(share * 100)}%`

function Stats({ branchSlug, tzFallback, initial }: { branchSlug: string; tzFallback: string; initial: StatsPayload | null }) {
  const t = useT()
  const [lang] = usePosLang()
  const failureText = useFailureText()
  const [session, setSession] = useState('')
  const [training, setTraining] = useState(false)
  const [showAllItems, setShowAllItems] = useState(false)

  const { data, failed, busy, reload } = useOpsResource<StatsPayload>(
    'stats',
    { branch: branchSlug, session: session || undefined, training: training ? '1' : undefined },
    initial,
  )
  const colour = useColours(data?.directory ?? [])
  const tz = data?.timezone ?? tzFallback
  const retry = () => void reload()

  // ---- chart inputs ----
  const peak = useMemo(() => {
    if (!data?.peakHours.known) return null
    const buckets: ChartBucket[] = data.peakHours.value.map((b) => ({ startsAt: b.startsAt, label: b.label, values: { orders: b.orders } }))
    const top = data.peakHours.value.reduce<(typeof data.peakHours.value)[number] | null>((m, b) => (!m || b.orders > m.orders ? b : m), null)
    return { buckets, top }
  }, [data])

  const through = useMemo(() => {
    if (!data?.throughput.known || !data.perPoint.known) return null
    const series: ChartSeries[] = data.perPoint.value.map((p) => ({ key: p.pointId, name: p.name, colour: p.colour }))
    const byStart = new Map<string, ChartBucket>()
    for (const b of data.throughput.value) {
      const cur = byStart.get(b.startsAt) ?? { startsAt: b.startsAt, label: b.label, values: {} }
      cur.values[b.pointId] = (cur.values[b.pointId] ?? 0) + b.items
      byStart.set(b.startsAt, cur)
    }
    const buckets = Array.from(byStart.values()).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    return { series, buckets }
  }, [data])

  if (!data) {
    return failed ? (
      <Banner tone="danger" action={<button type="button" className="ops-link-btn press" onClick={retry}>{t('owner.ops.retry')}</button>}>
        {failureText(failed)}
      </Banner>
    ) : <StatsSkeleton />
  }

  const num = (s: PosStat) => (s.known ? String(s.value) : '—')
  const money = (s: PosStat) => (s.known ? formatAgorot(s.value) : '—')
  const secs = (k: Known<number | null>) => (k.known && k.value !== null ? sinceLabel(k.value, lang) : '—')
  const dec = (s: PosStat) => (s.known ? s.value.toLocaleString('he-IL', { maximumFractionDigits: 1 }) : '—')
  const ts = (v: number | null) => (v === null ? '—' : sinceLabel(v, lang))

  const sessionOptions = [
    { value: 'all', label: t('owner.ops.stats.allEvents') },
    ...data.pickerSessions.map((s) => ({
      value: s.id,
      label: `${s.kind === 'training' ? `${t('owner.ops.order.training')} · ` : ''}${dayLabel(s.started_at, tz)} ${clock(s.started_at, tz)}${s.status === 'active' ? ` · ${t('owner.ops.history.active')}` : ''}`,
    })),
  ]
  const scopeText =
    data.scope.sessionId === null
      ? t('owner.ops.stats.scopeAll', { n: data.scope.sessions.length })
      : data.scope.sessions[0]
        ? t('owner.ops.stats.scopeOne', { day: dayLabel(data.scope.sessions[0].started_at, tz), t: clock(data.scope.sessions[0].started_at, tz) })
        : ''

  const timingCell = (s: TimingStat) => (
    <td>
      <span>{ts(s.medianSeconds)}</span>
      <small className="ops-muted"> / {ts(s.p90Seconds)}</small>
    </td>
  )
  const timingRow = (name: ReactNode, set: TimingSet, key: string) => (
    <tr key={key}>
      <th scope="row">{name}</th>
      {timingCell(set.queueWait)}
      {timingCell(set.prep)}
      {timingCell(set.uncollected)}
      {timingCell(set.total)}
    </tr>
  )

  const items = data.perItem.known ? data.perItem.value : []
  const shownItems = showAllItems ? items : items.slice(0, TOP_ITEMS)

  return (
    <div className="ops-stats" aria-busy={busy || undefined}>
      <div className="ops-statsbar">
        <FieldSelect label={t('owner.ops.stats.session')} value={session} options={sessionOptions} placeholder={t('owner.ops.stats.latest')} onChange={setSession} />
        <SwitchRow label={t('owner.ops.filter.training')} hint={t('owner.ops.stats.trainingHint')} on={training} onChange={setTraining} />
      </div>
      {failed && (
        <Banner action={<button type="button" className="ops-link-btn press" onClick={retry}>{t('owner.ops.retry')}</button>}>
          {t('owner.ops.stale')}
        </Banner>
      )}

      <div className={`ops-dimmable${busy ? ' is-dim' : ''}`}>
        <section className="ops-hero" aria-label={t('owner.ops.stats.hero')}>
          <span className="ops-hero-label">{t('owner.ops.stats.hero')}</span>
          <span className="ops-hero-value ltr-isolate">{money(data.hero.salesAgorot)}</span>
          {scopeText && <span className="ops-muted">{scopeText}</span>}
        </section>

        <div className="ops-tiles-grid">
          <div className="ops-stat ops-stat--plain"><span className="ops-stat-label">{t('owner.ops.stats.orders')}</span><span className="ops-stat-value ltr-isolate">{num(data.tiles.orders)}</span></div>
          <div className="ops-stat ops-stat--plain"><span className="ops-stat-label">{t('owner.ops.stats.avg')}</span><span className="ops-stat-value ltr-isolate">{money(data.tiles.averageTicketAgorot)}</span></div>
          <div className="ops-stat ops-stat--plain"><span className="ops-stat-label">{t('owner.ops.stats.voidRate')}</span><span className="ops-stat-value ltr-isolate">{data.tiles.voidRatePercent.known ? `${data.tiles.voidRatePercent.value}%` : '—'}</span></div>
          <div className="ops-stat ops-stat--plain"><span className="ops-stat-label">{t('owner.ops.stats.prep')}</span><span className="ops-stat-value">{secs(data.tiles.medianPrepSeconds)}</span></div>
        </div>
        <dl className="ops-minis">
          <div><dt>{t('owner.ops.stats.itemsPerTicket')}</dt><dd className="ltr-isolate">{dec(data.tiles.itemsPerTicket)}</dd></div>
          <div><dt>{t('owner.ops.stats.served')}</dt><dd className="ltr-isolate">{num(data.tiles.customersServed)}</dd></div>
          <div><dt>{t('owner.ops.stats.total')}</dt><dd>{secs(data.tiles.medianTotalSeconds)}</dd></div>
        </dl>

        {/* ---- by hour ---- */}
        <Section id="st-hours" title={t('owner.ops.stats.hours')} known={data.peakHours.known} onRetry={retry}>
          {peak && peak.buckets.length > 0 ? (
            <BarChart
              title={t('owner.ops.stats.hours')}
              summary={peak.top ? t('owner.ops.stats.peakSummary', { t: peak.top.label, n: peak.top.orders }) : t('owner.ops.stats.hours')}
              series={[{ key: 'orders', name: t('owner.ops.stats.orders'), colour: '#ff7a45' }]}
              buckets={peak.buckets}
              unit={t('owner.ops.stats.orders')}
            />
          ) : <p className="ops-drill-none">{t('owner.ops.drill.none')}</p>}
        </Section>
        <Section id="st-flow" title={t('owner.ops.stats.flow')} known={data.throughput.known && data.perPoint.known} onRetry={retry}>
          {through && through.buckets.length > 0 ? (
            <BarChart
              title={t('owner.ops.stats.flow')}
              summary={t('owner.ops.stats.flowSummary', { n: through.series.length })}
              series={through.series}
              buckets={through.buckets}
              unit={t('owner.ops.stats.itemsUnit')}
            />
          ) : <p className="ops-drill-none">{t('owner.ops.drill.none')}</p>}
        </Section>

        {/* ---- by point ---- */}
        <Section id="st-points" title={t('owner.ops.stats.points')} known={data.perPoint.known} onRetry={retry}>
          {data.perPoint.known && data.perPoint.value.length === 0 ? <p className="ops-drill-none">{t('owner.ops.drill.none')}</p> : (
            <ul className="ops-rank">
              {data.perPoint.known && data.perPoint.value.map((p) => (
                <li key={p.pointId} className="ops-rank-row">
                  <span className="ops-pointdot"><i aria-hidden="true" style={{ background: safeColour(p.colour, '#9c9086') }} />{p.name}</span>
                  <Bar share={p.share} colour={p.colour} />
                  <span className="ops-rank-nums">
                    <b className="ltr-isolate">{formatAgorot(p.agorot)}</b>
                    <span className="ops-muted">{t('owner.ops.stats.pointNums', { orders: p.orders, qty: p.qty, share: pct(p.share) })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ---- by item ---- */}
        <Section id="st-items" title={t('owner.ops.stats.items')} known={data.perItem.known} onRetry={retry}>
          {items.length === 0 ? <p className="ops-drill-none">{t('owner.ops.drill.none')}</p> : (
            <>
              <ol className="ops-rank">
                {shownItems.map((it, i) => (
                  <li key={it.key} className="ops-rank-row">
                    <span className="ops-rank-name"><span className="ops-muted ltr-isolate">{i + 1}.</span> {nameOf(it.name, lang)}</span>
                    <Bar share={it.share} colour="#ff7a45" />
                    <span className="ops-rank-nums">
                      <b className="ltr-isolate">{formatAgorot(it.agorot)}</b>
                      <span className="ops-muted">{t('owner.ops.stats.itemNums', { qty: it.qty, share: pct(it.share) })}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {items.length > TOP_ITEMS && (
                <button type="button" className="ops-link-btn press" onClick={() => setShowAllItems((v) => !v)}>
                  {showAllItems ? t('owner.ops.stats.topOnly', { n: TOP_ITEMS }) : t('owner.ops.stats.showAll', { n: items.length })}
                </button>
              )}
            </>
          )}
        </Section>

        <Section id="st-cats" title={t('owner.ops.stats.categories')} known={data.categories.known} onRetry={retry}>
          {data.categories.known && data.categories.value.length === 0 ? <p className="ops-drill-none">{t('owner.ops.drill.none')}</p> : (
            <ul className="ops-rank">
              {data.categories.known && data.categories.value.map((c) => (
                <li key={c.categoryId ?? 'none'} className="ops-rank-row">
                  <span className="ops-rank-name">{nameOf(c.title, lang) || t('owner.ops.stats.noCategory')}</span>
                  <Bar share={c.share} colour="#57d9c0" />
                  <span className="ops-rank-nums">
                    <b className="ltr-isolate">{formatAgorot(c.agorot)}</b>
                    <span className="ops-muted">{t('owner.ops.stats.itemNums', { qty: c.qty, share: pct(c.share) })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ---- by person ---- */}
        <Section id="st-staff" title={t('owner.ops.stats.staff')} known={data.perStaff.known} onRetry={retry}>
          {data.perStaff.known && data.perStaff.value.length === 0 ? <p className="ops-drill-none">{t('owner.ops.drill.none')}</p> : (
            <div className="ops-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('owner.ops.stats.person')}</th>
                    <th scope="col">{t('owner.ops.stats.entered')}</th>
                    <th scope="col">{t('owner.ops.stats.accepted')}</th>
                    <th scope="col">{t('owner.ops.stats.readied')}</th>
                    <th scope="col">{t('owner.ops.stats.handed')}</th>
                    <th scope="col">{t('owner.ops.stats.voids')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perStaff.known && data.perStaff.value.map((s) => (
                    <tr key={s.staff.id}>
                      <th scope="row"><Who handle={s.staff.handle} colour={colour(s.staff.id)} /></th>
                      <td className="ltr-isolate">{s.ordersEntered} · {formatAgorot(s.agorotEntered)}</td>
                      <td className="ltr-isolate">{s.accepted}</td>
                      <td className="ltr-isolate">{s.readied === null ? '—' : s.readied}</td>
                      <td className="ltr-isolate">{s.handedOver}</td>
                      <td className="ltr-isolate">{s.voids}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ---- how fast ---- */}
        <Section id="st-timing" title={t('owner.ops.stats.timing')} known={data.timing.known && data.perPoint.known} onRetry={retry}>
          <p className="ops-muted">{t('owner.ops.stats.timingHint')}</p>
          <div className="ops-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('owner.ops.stats.pointCol')}</th>
                  <th scope="col">{t('owner.ops.stats.queueWait')}</th>
                  <th scope="col">{t('owner.ops.stats.prepCol')}</th>
                  <th scope="col">{t('owner.ops.stats.pickupWait')}</th>
                  <th scope="col">{t('owner.ops.stats.totalCol')}</th>
                </tr>
              </thead>
              <tbody>
                {data.timing.known && timingRow(<b>{t('owner.ops.stats.everything')}</b>, data.timing.value, 'all')}
                {data.perPoint.known && data.perPoint.value.map((p) =>
                  timingRow(
                    <span className="ops-pointdot"><i aria-hidden="true" style={{ background: safeColour(p.colour, '#9c9086') }} />{p.name}</span>,
                    p.timing,
                    p.pointId,
                  ),
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ---- money that does not match / things nobody collected ---- */}
        <Section id="st-slips" title={t('owner.ops.stats.slips')} known={data.slips.known} onRetry={retry}>
          {data.slips.known && (
            <>
              <p>{t('owner.ops.stats.slipsLine', { slips: data.slips.value.ordersWithSlip, bad: data.slips.value.mismatches })}</p>
              {data.slips.value.rows.length > 0 && (
                // DrillPanel reads exactly one key; the same rows render the same way here as on the hub.
                <DrillPanel
                  drillKey="slipMismatches"
                  drill={{ slipMismatches: { known: true, value: { total: data.slips.value.rows.length, rows: data.slips.value.rows } } } as unknown as DashboardDrill}
                  colour={colour}
                />
              )}
            </>
          )}
        </Section>

        <Section id="st-uncollected" title={t('owner.ops.stats.uncollected')} known={data.uncollected.known} onRetry={retry}>
          <DrillPanel drillKey="uncollected" drill={{ uncollected: data.uncollected } as unknown as DashboardDrill} colour={colour} />
        </Section>

        <Section id="st-voids" title={t('owner.ops.stats.voidsTitle')} known={data.voids.known} onRetry={retry}>
          {data.voids.known && (
            <>
              <p>{t('owner.ops.stats.voidsLine', { lines: data.voids.value.voidedLines, total: data.voids.value.totalLines, orders: data.voids.value.voidedOrders })}</p>
              <div className="ops-voids">
                {data.voids.value.byReason.length > 0 && (
                  <div>
                    <h3 className="ops-h3">{t('owner.ops.stats.byReason')}</h3>
                    <ul className="ops-plain">{data.voids.value.byReason.map((r) => <li key={r.reason}>{r.reason} <b className="ltr-isolate">{r.lines}</b></li>)}</ul>
                  </div>
                )}
                {data.voids.value.byStaff.length > 0 && (
                  <div>
                    <h3 className="ops-h3">{t('owner.ops.stats.byPerson')}</h3>
                    <ul className="ops-plain">{data.voids.value.byStaff.map((s) => <li key={s.staff.id}><Who handle={s.staff.handle} colour={colour(s.staff.id)} /> <b className="ltr-isolate">{s.lines}</b></li>)}</ul>
                  </div>
                )}
                {data.voids.value.byItem.length > 0 && (
                  <div>
                    <h3 className="ops-h3">{t('owner.ops.stats.byItem')}</h3>
                    <ul className="ops-plain">{data.voids.value.byItem.slice(0, 6).map((i) => <li key={i.key}>{nameOf(i.name, lang)} <b className="ltr-isolate">{i.qty}</b></li>)}</ul>
                  </div>
                )}
              </div>
            </>
          )}
        </Section>

        <Section id="st-presence" title={t('owner.ops.stats.presence')} known={data.presence.known} onRetry={retry}>
          {data.presence.known && data.presence.value.length === 0 ? <p className="ops-drill-none">{t('owner.ops.drill.none')}</p> : (
            <div className="ops-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('owner.ops.stats.person')}</th>
                    <th scope="col">{t('owner.ops.stats.pointCol')}</th>
                    <th scope="col">{t('owner.ops.stats.minutes')}</th>
                    <th scope="col">{t('owner.ops.stats.perHour')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.presence.known && data.presence.value.map((p) => (
                    <tr key={`${p.staff.id}:${p.pointId}`}>
                      <th scope="row"><Who handle={p.staff.handle} colour={colour(p.staff.id)} /></th>
                      <td>{p.pointName}</td>
                      <td className="ltr-isolate">{p.minutes}</td>
                      <td className="ltr-isolate">{p.itemsPerHour === null ? '—' : p.itemsPerHour.toLocaleString('he-IL', { maximumFractionDigits: 1 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section id="st-soldout" title={t('owner.ops.stats.soldOut')} known={data.soldOut.known} onRetry={retry}>
          {data.soldOut.known && data.soldOut.value.length === 0 ? <p className="ops-drill-none">{t('owner.ops.drill.none')}</p> : (
            <ul className="ops-plain">
              {data.soldOut.known && data.soldOut.value.map((e) => (
                <li key={`${e.at}:${e.summary}`}>
                  <time className="ltr-isolate ops-muted" dateTime={e.at}>{dayLabel(e.at, tz)} {clock(e.at, tz)}</time> {e.summary}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <nav className="ops-links">
          <Link className="ops-link-btn press" href="/owner/pos/orders">{t('owner.ops.tile.orders')}</Link>
          <Link className="ops-link-btn press" href="/owner/pos/log">{t('owner.ops.tile.log')}</Link>
        </nav>
      </div>
    </div>
  )
}

export function StatsSkeleton() {
  return (
    <div className="ops-stats" aria-hidden="true">
      <div className="ops-statsbar">
        <div className="sk" style={{ height: 52, borderRadius: 14, flex: 1 }} />
        <div className="sk" style={{ height: 52, borderRadius: 14, flex: 1 }} />
      </div>
      <div className="sk" style={{ height: 120, borderRadius: 20 }} />
      <div className="ops-tiles-grid">
        {[0, 1, 2, 3].map((i) => <div key={i} className="sk ops-stat" style={{ height: 88 }} />)}
      </div>
      {[0, 1, 2].map((i) => <div key={i} className="sk" style={{ height: 220, borderRadius: 18 }} />)}
    </div>
  )
}

export default function StatsViewRoot({
  branches, initialBranch, timezones, initial,
}: { branches: Branch[]; initialBranch: string; timezones: Record<string, string>; initial: StatsPayload | null }) {
  const [branch, setBranch] = useState(initialBranch)
  return (
    <>
      <BranchBar branches={branches} value={branch} onChange={setBranch} />
      <Stats key={branch} branchSlug={branch} tzFallback={timezones[branch] ?? DEFAULT_ZONE} initial={branch === initialBranch ? initial : null} />
    </>
  )
}
