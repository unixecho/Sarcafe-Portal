'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Coffee, ChevronLeft, ChevronRight, Star } from 'lucide-react'
import type { Lang } from '@/components/LanguageSwitch'
import { visibleReviews, type PortalReview, type PortalReviewsBlock } from '@/lib/reviews'

// The portal's "wall of love" for one branch — real customer quotes that
// drift sideways on their own and can be grabbed like a native iOS
// carousel. Mechanics ported from AyekaBar's ReviewWall (the rAF-driven
// real scroller, seamless double-render loop, arrow/dot glide-by-distance)
// — that project already spent real iteration getting the physics right,
// so this keeps them rather than reinventing them badly. The look, the
// copy and the icon set are Sarcafe's own; see globals.css's `.rw-*` rules
// for the warm-paper/sage treatment instead of AyekaBar's dark neon glass.
//
// WHY A REAL SCROLLER AND NOT A CSS MARQUEE
// A transform-based marquee loops beautifully and cannot be touched: on a
// phone — which is how nearly everyone reaches this portal — a quote
// slides away mid-read and there's no way to hold it in place. The track
// is therefore a genuine `overflow-x: auto` scroller whose scrollLeft is
// nudged forward each frame instead, which keeps native momentum, native
// overscroll and native scrollbars, and lets any touch take over instantly.
// The arrows and dots drive that same scrollLeft, so drift/swipe/arrow/dot
// are all the one mechanism.
//
// FOUR THINGS THAT LOOK LIKE BUGS AND ARE NOT (kept from the source):
// 1. The track is forced `direction: ltr` even under RTL — it's a marquee,
//    not a reading sequence, so pinning one code path avoids a
//    per-direction scrollLeft-sign branch in every browser. Each card still
//    sets its own `dir` from the language it's written in.
// 2. The list renders twice (the second copy `aria-hidden`) — once
//    scrollLeft passes one copy's width we subtract that width, and since
//    both halves are identical the wrap is invisible.
// 3. Scroll-snap toggles on/off rather than staying on: driving scrollLeft
//    from rAF while snap is active fights the browser every frame.
// 4. An arrow/dot glide stores DISTANCE STILL TO TRAVEL, never a target
//    scrollLeft — the seamless wrap rewrites scrollLeft mid-glide, so a
//    remembered absolute target could suddenly be a full loop away.
// 5. The drift accumulates its own float (`posRef`) instead of reading
//    `el.scrollLeft` back each frame — the getter rounds to whole pixels,
//    and at this drift's speed a single frame's nudge is under a pixel.

const SPEED_PX_S = 22
const IDLE_MS = 2500
const GLIDE_BASE_MS = 340
const GLIDE_PER_CARD_MS = 130
const GLIDE_MAX_MS = 900

const I18N: Record<Lang, { eyebrow: string; onGoogle: string; prev: string; next: string; goTo: (n: number) => string }> = {
  he: {
    eyebrow: 'מה אומרים עלינו',
    onGoogle: 'לכל הביקורות בגוגל',
    prev: 'הביקורת הקודמת',
    next: 'הביקורת הבאה',
    goTo: (n) => `מעבר לביקורת ${n}`,
  },
  en: {
    eyebrow: 'What people say',
    onGoogle: 'See all reviews on Google',
    prev: 'Previous review',
    next: 'Next review',
    goTo: (n) => `Go to review ${n}`,
  },
  ar: {
    eyebrow: 'ماذا يقولون عنا',
    onGoogle: 'كل التقييمات على غوغل',
    prev: 'التقييم السابق',
    next: 'التقييم التالي',
    goTo: (n) => `الانتقال إلى التقييم ${n}`,
  },
}

function Stars({ n }: { n: number }) {
  return (
    <span className="rw-stars" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={13} strokeWidth={1.6} fill={i <= n ? 'currentColor' : 'none'} />
      ))}
    </span>
  )
}

function Card({ review }: { review: PortalReview }) {
  return (
    <figure className="rw-card" dir={review.lang === 'en' ? 'ltr' : 'rtl'} lang={review.lang}>
      <blockquote className="rw-text">{review.text}</blockquote>
      <figcaption className="rw-foot">
        <span className="rw-avatar" aria-hidden>
          <Coffee size={16} strokeWidth={2} />
        </span>
        <Stars n={review.stars} />
      </figcaption>
    </figure>
  )
}

/** Fewest cards to travel from `from` to `to` on a loop of `n`, either way round. */
function shortestHop(from: number, to: number, n: number): number {
  const forward = (((to - from) % n) + n) % n
  return forward > n / 2 ? forward - n : forward
}

/** Keeps a position inside [0, period) without ever reading the DOM back —
 *  pure, so it's cheap to call every frame against the accumulator. */
function wrapValue(x: number, period: number): number {
  if (period <= 0) return x
  if (x >= period) return x - period
  if (x < 0) return x + period
  return x
}

export default function ReviewWall({ block, reviewUrl, lang }: { block: PortalReviewsBlock; reviewUrl: string | null; lang: Lang }) {
  const items = visibleReviews(block)
  const t = I18N[lang]

  const sectionRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const resumeAtRef = useRef(0)
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const periodRef = useRef(0)
  const originRef = useRef(0)
  const glideRef = useRef<{ dist: number; moved: number; start: number; dur: number } | null>(null)
  const reducedRef = useRef(false)
  const posRef = useRef(0)

  const [inView, setInView] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [snap, setSnap] = useState(false)
  const [active, setActive] = useState(0)

  const count = items.length

  // Measured from the DOM rather than computed as scrollWidth / 2 — the
  // track carries horizontal padding (counted once by scrollWidth, zero
  // times by the repeat period) and the two copies are separated by one
  // flex gap belonging to neither half. The distance between a card and
  // its own copy IS the period, by definition.
  const measure = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const first = track.children[0] as HTMLElement | undefined
    const copy = track.children[count] as HTMLElement | undefined
    periodRef.current = first && copy ? copy.offsetLeft - first.offsetLeft : 0
    originRef.current = first ? first.offsetLeft - track.offsetLeft + first.offsetWidth / 2 : 0
  }, [count])

  const wrap = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollLeft = wrapValue(el.scrollLeft, periodRef.current)
  }, [])

  const syncActive = useCallback(() => {
    const el = scrollerRef.current
    const period = periodRef.current
    if (!el || period <= 0 || count === 0) return
    const stride = period / count
    const centre = el.scrollLeft + el.clientWidth / 2
    const i = Math.round((centre - originRef.current) / stride)
    const wrapped = ((i % count) + count) % count
    setActive((prev) => (prev === wrapped ? prev : wrapped))
  }, [count])

  const yieldToUser = useCallback(() => {
    resumeAtRef.current = performance.now() + IDLE_MS
    setSnap(true)
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
    snapTimerRef.current = setTimeout(() => setSnap(false), IDLE_MS)
  }, [])

  const glide = useCallback(
    (cards: number) => {
      const el = scrollerRef.current
      const period = periodRef.current
      if (!el || period <= 0 || !cards) return
      const stride = period / count
      const now = performance.now()

      if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
      setSnap(false)

      if (reducedRef.current) {
        el.scrollLeft += cards * stride
        wrap()
        posRef.current = el.scrollLeft
        syncActive()
        resumeAtRef.current = now + IDLE_MS
        return
      }

      const inFlight = glideRef.current
      const dist = cards * stride + (inFlight ? inFlight.dist - inFlight.moved : 0)
      const dur = Math.min(GLIDE_MAX_MS, GLIDE_BASE_MS + GLIDE_PER_CARD_MS * Math.abs(dist / stride))

      glideRef.current = { dist, moved: 0, start: now, dur }
      resumeAtRef.current = now + dur + IDLE_MS
    },
    [count, wrap, syncActive],
  )

  useEffect(() => () => {
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
  }, [])

  // Reveal + drift wait until the wall is actually on screen — nothing
  // below the fold should cost anything before it's looked at.
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setInView(true)
      return
    }
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    let delivered = false
    const io = new IntersectionObserver(
      ([entry]) => {
        delivered = true
        if (entry?.isIntersecting) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    io.observe(el)
    const failsafe = setTimeout(() => {
      if (!delivered) setInView(true)
    }, 2000)
    return () => {
      clearTimeout(failsafe)
      io.disconnect()
    }
  }, [])

  // Card width is viewport-relative, so the period changes on resize/rotate
  // and must be re-measured rather than measured once.
  useEffect(() => {
    measure()
    syncActive()
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      measure()
      syncActive()
    })
    ro.observe(track)
    return () => ro.disconnect()
  }, [measure, syncActive])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      reducedRef.current = mq.matches
      setReduced(mq.matches)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!inView || reduced) return
    let raf = 0
    let last = performance.now()
    posRef.current = scrollerRef.current?.scrollLeft ?? 0

    const step = (now: number) => {
      const dt = Math.min(now - last, 50)
      last = now
      const el = scrollerRef.current
      if (!el) {
        raf = requestAnimationFrame(step)
        return
      }

      const g = glideRef.current
      if (g) {
        const p = Math.min(1, (now - g.start) / g.dur)
        const eased = 1 - Math.pow(1 - p, 3)
        const want = g.dist * eased
        posRef.current += want - g.moved
        g.moved = want
        if (p >= 1) glideRef.current = null
        posRef.current = wrapValue(posRef.current, periodRef.current)
        el.scrollLeft = posRef.current
      } else if (!document.hidden && now >= resumeAtRef.current) {
        posRef.current += (SPEED_PX_S * dt) / 1000
        posRef.current = wrapValue(posRef.current, periodRef.current)
        el.scrollLeft = posRef.current
      } else {
        posRef.current = el.scrollLeft
      }

      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [inView, reduced])

  if (!items.length) return null

  const doubled = [
    ...items.map((r) => ({ r, key: `a-${r.id}`, ghost: false })),
    ...items.map((r) => ({ r, key: `b-${r.id}`, ghost: true })),
  ]
  const paged = count > 1

  return (
    <section id="reviews" ref={sectionRef} className={`rw${inView ? ' in' : ''}`} aria-label={t.eyebrow}>
      <header className="rw-head">
        <p className="rw-eyebrow">{t.eyebrow}</p>
        <div className="rw-score">
          <span className="rw-rating">{block.rating.toFixed(1)}</span>
          <Stars n={Math.round(block.rating)} />
        </div>
        {reviewUrl && (
          <a className="rw-count tap44" href={reviewUrl} target="_blank" rel="noopener noreferrer">
            {t.onGoogle}
          </a>
        )}
      </header>

      <div className="rw-stage">
        {/* Physical, not `.dir-flip` — same reasoning as AyekaBar's Chevron:
            the LEFT arrow always moves the wall left, in every language,
            matching what the motion itself shows. */}
        {paged && (
          <button type="button" className="rw-arrow rw-arrow-back" aria-label={t.prev} onClick={() => glide(-1)}>
            <ChevronLeft size={17} aria-hidden="true" />
          </button>
        )}

        <div
          ref={scrollerRef}
          className="rw-scroller"
          style={{ scrollSnapType: snap ? 'x mandatory' : 'none' }}
          onScroll={syncActive}
          onPointerDown={yieldToUser}
          onWheel={yieldToUser}
          onTouchStart={yieldToUser}
          onKeyDown={yieldToUser}
          tabIndex={0}
          role="group"
          aria-label={t.eyebrow}
        >
          <div className="rw-track" ref={trackRef}>
            {doubled.map(({ r, key, ghost }) => (
              <div key={key} className="rw-slot" aria-hidden={ghost || undefined}>
                <Card review={r} />
              </div>
            ))}
          </div>
        </div>

        {paged && (
          <button type="button" className="rw-arrow rw-arrow-fwd" aria-label={t.next} onClick={() => glide(1)}>
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        )}
      </div>

      {paged && (
        <div className="rw-dots">
          {items.map((r, i) => (
            <button
              key={r.id}
              type="button"
              className={`rw-dot${i === active ? ' is-on' : ''}`}
              aria-label={t.goTo(i + 1)}
              aria-current={i === active || undefined}
              onClick={() => glide(shortestHop(active, i, count))}
            />
          ))}
        </div>
      )}
    </section>
  )
}
