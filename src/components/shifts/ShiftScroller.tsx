'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Coffee, MapPin } from 'lucide-react'
import { initialsOf } from '@/lib/shifts/names'
import type { OnShiftSlot } from '@/lib/staff/on-shift'

// One branch's three slides (previous shift, now, next shift) in a strip you swipe sideways, with arrow buttons for a mouse.
// It opens on "now". Time reads right to left in a Hebrew page, so the previous shift is on the right and the next on the left.
// Position is measured from the slides' own rectangles instead of scrollLeft, because scrollLeft is negative in right-to-left
// boxes and has differed between browsers.
const TITLE: Record<OnShiftSlot['kind'], string> = { previous: 'המשמרת הקודמת', now: 'עכשיו', next: 'המשמרת הבאה' }
const EMPTY: Record<OnShiftSlot['kind'], string> = { previous: 'אין משמרת קודמת מפורסמת', now: 'אין משמרת פעילה כרגע', next: 'אין משמרת הבאה מפורסמת' }

export default function ShiftScroller({ slots, viewerId, branchName }: { slots: OnShiftSlot[]; viewerId: string; branchName: string }) {
  const strip = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(Math.max(0, slots.findIndex((slot) => slot.kind === 'now')))

  const nearest = () => {
    const box = strip.current
    if (!box) return 0
    const mid = box.getBoundingClientRect().left + box.clientWidth / 2
    let best = 0
    let bestGap = Infinity
    Array.from(box.children).forEach((child, index) => {
      const r = (child as HTMLElement).getBoundingClientRect()
      const gap = Math.abs(r.left + r.width / 2 - mid)
      if (gap < bestGap) { best = index; bestGap = gap }
    })
    return best
  }

  function goTo(index: number, smooth: boolean) {
    const box = strip.current
    const slide = box?.children[index] as HTMLElement | undefined
    if (!box || !slide) return
    const b = box.getBoundingClientRect()
    const s = slide.getBoundingClientRect()
    box.scrollBy({ left: s.left + s.width / 2 - (b.left + b.width / 2), behavior: smooth ? 'smooth' : 'auto' })
  }

  // Start on "now" without moving the page: only this strip scrolls.
  useEffect(() => { goTo(Math.max(0, slots.findIndex((slot) => slot.kind === 'now')), false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="shs">
      <div ref={strip} className="shs__strip" role="group" aria-label={`המשמרות בסניף ${branchName}: הקודמת, הנוכחית והבאה`} tabIndex={0} onScroll={() => setActive(nearest())}>
        {slots.map((slot) => (
          <section key={slot.kind} className={`shs__slide shs__slide--${slot.kind}`} aria-label={TITLE[slot.kind]}>
            <header className="shs__head">
              <strong>{TITLE[slot.kind]}</strong>
              {slot.hours && <span className="shs__when">{slot.when} <bdi className="ltr-isolate">{slot.hours}</bdi></span>}
            </header>
            {slot.people.length > 0 ? (
              <ul className="osn__list">
                {slot.people.map((person) => {
                  const mine = person.staffId === viewerId
                  return (
                    <li key={person.key} className={`osn__person${mine ? ' osn__person--me' : ''}`}>
                      <span className="osn__avatar" aria-hidden="true">{initialsOf(person.name)}</span>
                      <span className="osn__who">
                        <strong>{person.name}{mine && <em> · אתם</em>}</strong>
                        {person.station && <small><MapPin size={12} aria-hidden="true" /> {person.station}</small>}
                      </span>
                      <span className="osn__hours ltr-isolate">{person.startTime}–{person.endTime}</span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="osn__empty"><Coffee size={16} aria-hidden="true" />{EMPTY[slot.kind]}</p>
            )}
          </section>
        ))}
      </div>
      <div className="shs__nav">
        <button type="button" className="shs__arrow press" onClick={() => goTo(Math.max(0, active - 1), true)} disabled={active === 0} aria-label="המשמרת הקודמת">
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <div className="shs__dots" aria-hidden="true">{slots.map((slot, index) => <span key={slot.kind} className={index === active ? 'is-on' : ''} />)}</div>
        <button type="button" className="shs__arrow press" onClick={() => goTo(Math.min(slots.length - 1, active + 1), true)} disabled={active === slots.length - 1} aria-label="המשמרת הבאה">
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
