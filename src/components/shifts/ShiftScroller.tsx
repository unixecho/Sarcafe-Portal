'use client'

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, Coffee, MapPin } from 'lucide-react'
import { initialsOf } from '@/lib/shifts/names'
import type { OnShiftSlot } from '@/lib/staff/on-shift'

// One branch's three slides (previous shift, now, next shift) in a strip you swipe sideways, with arrow buttons for a mouse.
// It opens on "now". Time reads right to left in a Hebrew page, so the previous shift is on the right and the next on the left.
// One whole slide at a time: each is exactly the strip's width, so no neighbour half-shows and every border is inside the strip.
// The browser does the swiping (scroll-snap); this file only moves the STRIP itself, never the page: scrollIntoView also scrolls
// every scrollable ancestor, which slid the whole page sideways (2026-10-28). Moves are the physical distance between a slide's
// centre and the strip's, handed to scrollBy, so the sign RTL scrollLeft uses (negative today, positive in old engines) never matters.
const TITLE: Record<OnShiftSlot['kind'], string> = { previous: 'המשמרת הקודמת', now: 'עכשיו', next: 'המשמרת הבאה' }
const EMPTY: Record<OnShiftSlot['kind'], string> = { previous: 'אין משמרת קודמת מפורסמת', now: 'אין משמרת פעילה כרגע', next: 'אין משמרת הבאה מפורסמת' }

// The server renders nothing to position, so the layout effect only runs in the browser; this keeps React quiet about it there.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export default function ShiftScroller({ slots, viewerId, branchName }: { slots: OnShiftSlot[]; viewerId: string; branchName: string }) {
  const strip = useRef<HTMLDivElement>(null)
  const nowIndex = Math.max(0, slots.findIndex((slot) => slot.kind === 'now'))
  const [active, setActive] = useState(nowIndex)
  const activeRef = useRef(nowIndex)
  // Which slide the reader is looking at, by kind: a refresh keeps them there (it never jumps back to "now" after a swipe), and
  // someone still on "now" stays on the live shift as it changes.
  const viewed = useRef<OnShiftSlot['kind']>('now')
  const kinds = slots.map((slot) => slot.kind).join(',')
  const liveKey = slots[nowIndex]?.people.map((p) => p.key).join(',') ?? ''

  function show(index: number) {
    if (index === activeRef.current) return
    activeRef.current = index
    setActive(index)
  }

  function goTo(index: number, smooth: boolean) {
    const box = strip.current
    const slide = box?.children[index] as HTMLElement | undefined
    if (!box || !slide) return
    const b = box.getBoundingClientRect()
    const s = slide.getBoundingClientRect()
    const delta = s.left + s.width / 2 - (b.left + box.clientLeft + box.clientWidth / 2)
    if (Math.abs(delta) >= 1) {
      const still = !smooth || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      box.scrollBy({ left: delta, behavior: still ? 'auto' : 'smooth' })
    }
    viewed.current = slots[index]?.kind ?? viewed.current
    show(index)
  }

  // Before the first paint after hydration, and after every refresh: put the slide being looked at back in the middle. Slides are
  // the strip's own width, so fonts loading or a phone turning sideways do not move it (scroll-snap re-snaps on resize).
  useBrowserLayoutEffect(() => {
    const at = slots.findIndex((slot) => slot.kind === viewed.current)
    goTo(at >= 0 ? at : nowIndex, false)
  }, [kinds, liveKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // The dots and arrows follow the slide that is mostly in view. An observer instead of a scroll handler: nothing runs per frame,
  // and the strip re-renders only when the visible slide actually changes.
  useEffect(() => {
    const box = strip.current
    if (!box || typeof IntersectionObserver === 'undefined') return
    const kindsNow = kinds.split(',') as OnShiftSlot['kind'][]
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue
        const index = Array.prototype.indexOf.call(box.children, entry.target)
        if (index < 0) continue
        viewed.current = kindsNow[index] ?? viewed.current
        show(index)
      }
    }, { root: box, threshold: 0.6 })
    Array.from(box.children).forEach((child) => io.observe(child))
    return () => io.disconnect()
  }, [kinds])

  // Arrow keys move one slide; left is "next" in a right-to-left page.
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const forward = (event.key === 'ArrowLeft') === rtl
    goTo(Math.min(slots.length - 1, Math.max(0, activeRef.current + (forward ? 1 : -1))), true)
  }

  return (
    <div className="shs">
      <div ref={strip} className="shs__strip" role="group" aria-label={`המשמרות בסניף ${branchName}: הקודמת, הנוכחית והבאה`} tabIndex={0} onKeyDown={onKey}>
        {slots.map((slot) => (
          <section key={slot.kind} className={`shs__slide shs__slide--${slot.kind}`} aria-label={TITLE[slot.kind]}>
            <header className="shs__head">
              <strong>{slot.kind === 'now' && slot.people.length > 0 && <i className="shs__pulse" aria-hidden="true" />}{TITLE[slot.kind]}</strong>
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
      {slots.length > 1 && (
        <div className="shs__nav">
          <button type="button" className="shs__arrow press" onClick={() => goTo(Math.max(0, activeRef.current - 1), true)} disabled={active === 0} aria-label="המשמרת הקודמת">
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <div className="shs__dots" aria-hidden="true">{slots.map((slot, index) => <span key={slot.kind} className={index === active ? 'is-on' : ''} />)}</div>
          <button type="button" className="shs__arrow press" onClick={() => goTo(Math.min(slots.length - 1, activeRef.current + 1), true)} disabled={active === slots.length - 1} aria-label="המשמרת הבאה">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
