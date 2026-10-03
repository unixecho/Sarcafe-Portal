'use client'

// LiveFeed — the last few things that happened, worded by describeEvent() (the one
// place an event becomes a sentence, shared with the order timeline and the log).
//
// THREE HONESTIES
//   * A failed read is its own state ("לא הצלחנו לטעון"), never an empty list. An empty
//     feed means a quiet room; a failed one means we cannot see the room.
//   * "New" is judged against the SERVER's timestamp of the newest event the manager
//     has actually had in view — not the browser clock (a tablet that is two minutes
//     fast would otherwise hide, or invent, the unread badge).
//   * Quiet events (the pickup stamp that always precedes a hand-over) are hidden, and
//     runs of the same event by the same person are folded ("3×") by groupFeed(), so a
//     batch of twelve lines is one row, not twelve.
//
// Rows are keyed by event id and nothing animates on update: a new event simply appears
// at the top, and the rows already read do not move or re-enter.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { describeEvent, groupFeed } from '@/lib/pos/events'
import type { Known } from '@/lib/pos/owner-api'
import type { PosEvent } from '@/lib/pos/types'
import { usePosLang, useT } from '@/lib/pos/useT'
import { Banner, OpsIcon, Who, clock } from './FilterBar'

type Colour = (id: string | null | undefined) => string

const newestOf = (events: readonly PosEvent[]): number =>
  events.reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), 0)

export default function LiveFeed({
  feed, colour, tz, stale, onRetry,
}: {
  feed: Known<PosEvent[]>
  colour: Colour
  tz?: string
  /** the newest read failed and these rows are the last good ones */
  stale: boolean
  onRetry: () => void
}) {
  const t = useT()
  const [lang] = usePosLang()
  const sectionRef = useRef<HTMLElement>(null)
  const events = feed.value
  const newest = useMemo(() => newestOf(events), [events])

  // Opening the page is not "news": start from what is already there.
  const [seenAt, setSeenAt] = useState(() => newest)
  const inView = useRef(false)
  const newestRef = useRef(newest)

  useEffect(() => {
    const el = sectionRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      inView.current = entries.some((e) => e.isIntersecting)
      if (inView.current && document.visibilityState === 'visible') setSeenAt((s) => Math.max(s, newestRef.current))
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    newestRef.current = newest
    // New rows arriving while the feed is on screen are seen the moment they land.
    if (inView.current && document.visibilityState === 'visible') setSeenAt((s) => Math.max(s, newest))
  }, [newest])

  const rows = useMemo(
    () => groupFeed(events.filter((e) => !describeEvent(e, lang).quiet)),
    [events, lang],
  )
  const unread = events.filter((e) => (Date.parse(e.at) || 0) > seenAt && !describeEvent(e, lang).quiet).length

  return (
    <section ref={sectionRef} className="ops-feed" aria-label={t('owner.ops.feed.title')}>
      <header className="ops-feed-head">
        <h2 className="ops-h2">{t('owner.ops.feed.title')}</h2>
        {unread > 0 && (
          <button type="button" className="ops-unread press" onClick={() => setSeenAt(newest)}>
            {t('owner.ops.feed.unread', { n: unread })}
          </button>
        )}
      </header>

      {!feed.known && events.length === 0 ? (
        <Banner action={<button type="button" className="ops-link-btn press" onClick={onRetry}>{t('owner.ops.retry')}</button>}>
          {t('owner.ops.feed.failed')}
        </Banner>
      ) : (
        <>
          {(stale || !feed.known) && (
            <Banner action={<button type="button" className="ops-link-btn press" onClick={onRetry}>{t('owner.ops.retry')}</button>}>
              {t('owner.ops.stale')}
            </Banner>
          )}
          {rows.length === 0 ? (
            <p className="ops-drill-none">{t('owner.ops.feed.quiet')}</p>
          ) : (
            <ol className="ops-feed-list">
              {rows.map(({ event: e, count }) => {
                const d = describeEvent(e, lang)
                const isNew = (Date.parse(e.at) || 0) > seenAt
                const inner = (
                  <>
                    <span className={`ops-feed-icon ops-tone--${d.tone}`}><OpsIcon name={d.icon} size={16} /></span>
                    <span className="ops-feed-body">
                      <span className="ops-feed-text">
                        {count > 1 && <b className="ltr-isolate">{count}× </b>}
                        {d.text}
                      </span>
                      <span className="ops-feed-meta">
                        {(e.actor_handle || e.actor_id) && <Who handle={e.actor_handle} colour={colour(e.actor_id)} />}
                        {isNew && <span className="ops-new">{t('owner.ops.feed.new')}</span>}
                      </span>
                    </span>
                    <time className="ops-feed-time ltr-isolate" dateTime={e.at}>{clock(e.at, tz)}</time>
                  </>
                )
                return (
                  <li key={e.id}>
                    {e.order_id ? (
                      <Link className="ops-feed-row press" href={`/owner/pos/orders?order=${encodeURIComponent(e.order_id)}`}>{inner}</Link>
                    ) : (
                      <div className="ops-feed-row">{inner}</div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
