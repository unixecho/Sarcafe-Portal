'use client'

// PointCards — one card per selling point: how deep its queue is, how long the
// oldest line has waited, how fast it usually is, who is checked in, and who is
// working on something right now.
//
// The bottleneck flag is the server's (`queue >= DASHBOARD.backlogWarn`, the very
// same test as the "point backlog" signal), not re-derived here — two cards and a
// signal that disagreed about "busy" would make the manager stop trusting all three.
//
// Cards keep their order and their keys across a refetch (the server sorts by the
// owner's sort order), and nothing here animates on update: a number changing is
// the news, not a card re-entering.

import { useMemo } from 'react'
import { Bell, Clock, Flame, Gauge, Hourglass, TriangleAlert } from 'lucide-react'
import { sinceLabel } from '@/lib/pos/format'
import type { Known, PointCard, ProcessingRow } from '@/lib/pos/owner-api'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import { usePosLang, useT } from '@/lib/pos/useT'
import { safeColour } from '@/components/pos/shell/safeColour'
import { Banner, Who } from './FilterBar'

type Colour = (id: string | null | undefined) => string

export default function PointCards({
  points, processing, colour, stale, onRetry,
}: {
  points: Known<PointCard[]>
  processing: Known<ProcessingRow[]>
  colour: Colour
  /** the last good answer is being shown because the newest read failed */
  stale: boolean
  onRetry: () => void
}) {
  const t = useT()
  const [lang] = usePosLang()

  // point -> people currently working a line there, with how many lines
  const working = useMemo(() => {
    const out = new Map<string, { id: string; handle: string; lines: number }[]>()
    if (!processing.known) return out
    for (const row of processing.value) {
      const per = new Map<string, number>()
      for (const l of row.current) per.set(l.pointId, (per.get(l.pointId) ?? 0) + 1)
      per.forEach((n, pointId) => {
        const list = out.get(pointId) ?? []
        list.push({ id: row.staff.id, handle: row.staff.handle, lines: n })
        out.set(pointId, list)
      })
    }
    return out
  }, [processing])

  if (!points.known && points.value.length === 0) {
    return (
      <section className="ops-points" aria-label={t('owner.ops.points.title')}>
        <h2 className="ops-h2">{t('owner.ops.points.title')}</h2>
        <Banner action={<button type="button" className="ops-link-btn press" onClick={onRetry}>{t('owner.ops.retry')}</button>}>
          {t('owner.ops.points.failed')}
        </Banner>
      </section>
    )
  }

  return (
    <section className="ops-points" aria-label={t('owner.ops.points.title')}>
      <h2 className="ops-h2">{t('owner.ops.points.title')}</h2>
      {stale && (
        <Banner action={<button type="button" className="ops-link-btn press" onClick={onRetry}>{t('owner.ops.retry')}</button>}>
          {t('owner.ops.stale')}
        </Banner>
      )}
      {points.value.length === 0 ? (
        <p className="ops-drill-none">{t('owner.ops.points.none')}</p>
      ) : (
        <ul className="ops-point-grid">
          {points.value.map((p) => {
            const Icon = resolveCategoryIcon(p.icon)
            const c = safeColour(p.colour, '#9c9086')
            const people = working.get(p.id) ?? []
            return (
              <li key={p.id} className={`ops-point${p.bottleneck ? ' ops-point--busy' : ''}`} style={{ ['--pc' as string]: c }}>
                <header className="ops-point-head">
                  <span className="ops-point-icon" aria-hidden="true"><Icon size={20} /></span>
                  <h3>{p.name}</h3>
                  {p.bottleneck && (
                    <span className="ops-flag ops-flag--warn"><TriangleAlert size={14} aria-hidden="true" />{t('owner.ops.points.busy')}</span>
                  )}
                  {p.stuck > 0 && (
                    <span className="ops-flag ops-flag--danger"><Clock size={14} aria-hidden="true" />{t('owner.ops.points.stuck', { n: p.stuck })}</span>
                  )}
                </header>

                <dl className="ops-queue">
                  <div><dt><Hourglass size={14} aria-hidden="true" />{t('owner.ops.stage.waiting')}</dt><dd className="ltr-isolate">{p.waiting}</dd></div>
                  <div><dt><Flame size={14} aria-hidden="true" />{t('owner.ops.stage.preparing')}</dt><dd className="ltr-isolate">{p.preparing}</dd></div>
                  <div><dt><Bell size={14} aria-hidden="true" />{t('owner.ops.stage.ready')}</dt><dd className="ltr-isolate">{p.ready}</dd></div>
                </dl>

                <dl className="ops-facts">
                  <div>
                    <dt>{t('owner.ops.points.oldest')}</dt>
                    <dd>{p.oldestWaitSeconds === null ? '—' : sinceLabel(p.oldestWaitSeconds, lang)}</dd>
                  </div>
                  <div>
                    <dt><Gauge size={14} aria-hidden="true" />{t('owner.ops.points.median')}</dt>
                    <dd>{p.medianPrepSeconds === null ? '—' : sinceLabel(p.medianPrepSeconds, lang)}</dd>
                  </div>
                </dl>

                <div className="ops-people">
                  <span className="ops-people-label">{t('owner.ops.points.checkedIn')}</span>
                  {p.checkedIn.length === 0 ? (
                    <span className="ops-muted">{t('owner.ops.points.nobody')}</span>
                  ) : (
                    <span className="ops-who-row">
                      {p.checkedIn.map((s) => <Who key={s.id} handle={s.handle} colour={colour(s.id)} />)}
                    </span>
                  )}
                </div>
                <div className="ops-people">
                  <span className="ops-people-label">{t('owner.ops.points.working')}</span>
                  {people.length === 0 ? (
                    <span className="ops-muted">{t('owner.ops.points.idle')}</span>
                  ) : (
                    <span className="ops-who-row">
                      {people.map((s) => (
                        <span key={s.id} className="ops-who-since">
                          <Who handle={s.handle} colour={colour(s.id)} />
                          <small className="ltr-isolate">×{s.lines}</small>
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
