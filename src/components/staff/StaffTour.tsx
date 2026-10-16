'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ChevronLeft, ClipboardCheck, Receipt, ShoppingBag, UserRound, type LucideIcon } from 'lucide-react'
import StaffPushCard from '@/components/staff/StaffPushCard'
import { haptic } from '@/lib/haptics'
import { TOUR_ROWS, TOUR_SLIDES, clampSlide, isLastSlide, type TourRowId } from '@/lib/staff/tour'
import { WIZARD_END_HREF } from '@/lib/staff/onboarding-wizard'

const ROW_ICON: Record<TourRowId, LucideIcon> = { checklists: ClipboardCheck, schedule: CalendarClock, orders: ShoppingBag, events: Receipt, profile: UserRound }

// The employee's first-run tour — the wizard's last screen (the "demo"). A miniature of the real home screen sits on top and
// lights the row each slide is about (the rows are lib/staff/tour.ts's, which scripts/check-onboarding-wizard.mjs compares
// with the real screen); the words are below. It stores nothing. Every slide moves focus to its heading, "דילוג" leaves at
// any time, and the last button goes to the employee home.
export default function StaffTour({ who, onFinish }: { who: string; onFinish?: () => void }) {
  const [index, setIndex] = useState(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const i = clampSlide(index)
  const slide = TOUR_SLIDES[i]!
  const last = isLastSlide(i)
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [i])
  function go(next: number) { haptic('select'); setIndex(clampSlide(next)) }

  return (
    <section className="ob-tour" aria-labelledby="tour-h">
      <p className="ob-kicker">{i === 0 ? `החשבון מוכן, ${who}! ✅` : `סיור קצר · ${i + 1} מתוך ${TOUR_SLIDES.length}`}</p>
      <div className="ob-mini" aria-hidden="true">
        <div className="ob-mini__shift">המשמרת הקרובה שלי</div>
        <div className="ob-mini__rows">
          {TOUR_ROWS.map((row) => {
            const Icon = ROW_ICON[row.id]
            const on = slide.key === 'overview' || slide.row === row.id
            return (
              <div key={row.id} className={`ob-mini__row${on ? ' ob-mini__row--on' : ''}`}>
                <Icon size={17} /><span>{row.he}</span><ChevronLeft size={14} />
              </div>
            )
          })}
        </div>
      </div>
      <div key={slide.key} className="ob-slide rise">
        <h1 id="tour-h" ref={headingRef} tabIndex={-1}>{slide.title}</h1>
        <p className="ob-lead">{slide.lead}</p>
        <ul className="ob-points">
          {slide.points.map((p) => <li key={p}><span aria-hidden="true">•</span><span>{p}</span></li>)}
        </ul>
        {slide.key === 'alerts' && <StaffPushCard variant="wizard" />}
      </div>
      <div className="ob-dots" aria-hidden="true">
        {TOUR_SLIDES.map((s, k) => <span key={s.key} className={`ob-dot${k === i ? ' ob-dot--now' : ''}${k <= i ? ' ob-dot--done' : ''}`} />)}
      </div>
      <div className="ob-actions">
        {i > 0 && <button type="button" className="sch-btn press" onClick={() => go(i - 1)}>הקודם</button>}
        {last
          ? <Link href={WIZARD_END_HREF} className="sch-btn sch-btn--primary press" style={{ flex: 1 }} onClick={onFinish}>סיום — לאזור הצוות</Link>
          : <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 1 }} onClick={() => go(i + 1)}>{i === 0 ? 'מתחילים' : 'הבא'}</button>}
      </div>
      {!last && <Link href={WIZARD_END_HREF} className="ob-skip press" onClick={onFinish}>דילוג על הסיור</Link>}
    </section>
  )
}
