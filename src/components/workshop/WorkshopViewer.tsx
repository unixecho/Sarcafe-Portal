'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { WORKSHOP_FILE, WORKSHOP_FILE_SIZE_LABEL, WORKSHOP_SLIDES, WORKSHOP_SUBTITLE, WORKSHOP_TITLE } from '@/lib/workshop/slides'
import './workshop.css'

const TOTAL = WORKSHOP_SLIDES.length
const SWIPE_PX = 44

// One slide at a time, the way the deck is meant to be read. Hebrew reads right to left, so "next" is the LEFT arrow, a
// swipe towards the left and the button on the left. The slides are pictures of the deck (the original file is one tap away),
// so what each one says is also written out for screen readers.
export default function WorkshopViewer() {
  const [index, setIndex] = useState(0)
  const [canFullscreen, setCanFullscreen] = useState(false)
  // Zoomed: the slide is drawn about twice as wide inside a window the person pans around, because a 16:9 slide on a phone is small.
  const [zoomed, setZoomed] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const slide = WORKSHOP_SLIDES[index]!

  const go = useCallback((to: number) => setIndex(Math.min(TOTAL - 1, Math.max(0, to))), [])
  useEffect(() => setCanFullscreen(typeof document !== 'undefined' && document.fullscreenEnabled === true), [])
  // The neighbours are fetched ahead, so turning a page is instant on a phone.
  useEffect(() => { stage.current?.scrollTo(0, 0) }, [index, zoomed])
  useEffect(() => {
    for (const neighbour of [index - 1, index + 1]) {
      const item = WORKSHOP_SLIDES[neighbour]
      if (item) new Image().src = item.src
    }
  }, [index])

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowLeft') go(index + 1)
    else if (event.key === 'ArrowRight') go(index - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(TOTAL - 1)
    else return
    event.preventDefault()
  }
  function onPointerUp(event: React.PointerEvent) {
    const from = start.current
    start.current = null
    if (!from || zoomed) return // while zoomed a drag is panning the slide, not turning the page
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return
    go(dx < 0 ? index + 1 : index - 1)
  }

  return (
    <section className="ws" aria-roledescription="carousel" aria-label={WORKSHOP_TITLE} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="ws__intro">
        <h2>{WORKSHOP_TITLE}</h2>
        <p>{WORKSHOP_SUBTITLE}</p>
      </div>

      <div
        ref={stage}
        className={`ws__stage${zoomed ? ' ws__stage--zoom' : ''}`}
        onPointerDown={(event) => { start.current = { x: event.clientX, y: event.clientY } }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { start.current = null }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={slide.src} className="ws__slide" src={slide.src} width={1600} height={900} alt={`שקף ${slide.n} מתוך ${TOTAL}: ${slide.title}`} decoding="async" draggable={false} />
      </div>
      <p className="sr-only">{slide.text}</p>

      <div className="ws__bar">
        <button type="button" className="ws__btn press" onClick={() => go(index - 1)} disabled={index === 0} aria-label="השקף הקודם"><ChevronRight size={22} aria-hidden="true" /></button>
        <p className="ws__count" aria-live="polite"><strong>שקף {index + 1} מתוך {TOTAL}</strong><span>{slide.title}</span></p>
        <button type="button" className="ws__btn press" onClick={() => go(index + 1)} disabled={index === TOTAL - 1} aria-label="השקף הבא"><ChevronLeft size={22} aria-hidden="true" /></button>
      </div>

      <ol className="ws__dots" aria-label="מעבר לשקף">
        {WORKSHOP_SLIDES.map((item, i) => (
          <li key={item.n}>
            <button type="button" className="ws__dot press" aria-current={i === index ? 'true' : undefined} aria-label={`שקף ${item.n}: ${item.title}`} onClick={() => go(i)}>{item.n}</button>
          </li>
        ))}
      </ol>

      <div className="ws__actions">
        <button type="button" className="ws__link press" aria-pressed={zoomed} onClick={() => setZoomed((value) => !value)}>{zoomed ? <ZoomOut size={17} aria-hidden="true" /> : <ZoomIn size={17} aria-hidden="true" />} {zoomed ? 'הקטנה' : 'הגדלה'}</button>
        {canFullscreen && <button type="button" className="ws__link press" onClick={() => void stage.current?.requestFullscreen?.()}><Maximize2 size={17} aria-hidden="true" /> מסך מלא</button>}
        <a className="ws__link press" href={WORKSHOP_FILE} download><Download size={17} aria-hidden="true" /> הורדת המצגת ({WORKSHOP_FILE_SIZE_LABEL})</a>
      </div>
    </section>
  )
}
