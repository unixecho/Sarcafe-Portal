'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Maximize2, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react'
import { WORKSHOP_FILE, WORKSHOP_FILE_SIZE_LABEL, WORKSHOP_SLIDES, WORKSHOP_SUBTITLE, WORKSHOP_TITLE } from '@/lib/workshop/slides'
import './workshop.css'

const TOTAL = WORKSHOP_SLIDES.length
const SWIPE_PX = 44
const TAP_PX = 10
const HIDE_CONTROLS_MS = 3200

// One slide at a time, the way the deck is meant to be read. Hebrew reads right to left, so "next" is the LEFT arrow, a
// swipe towards the left and the button on the left. The slides are pictures of the deck (the original file is one tap away),
// so what each one says is also written out for screen readers.
//
// "מסך מלא" opens a viewing mode that covers the whole screen with the slide, for turning the phone sideways. It is our own
// full-window layer, not only the browser's Fullscreen API: iPhone Safari has no fullscreen for anything but video, and the
// layer works everywhere. Where the browser also offers real fullscreen and orientation lock (Android) both are asked for.
export default function WorkshopViewer() {
  const [index, setIndex] = useState(0)
  // Zoomed: the slide is drawn about twice as wide inside a window the person pans around, because a 16:9 slide on a phone is small.
  const [zoomed, setZoomed] = useState(false)
  const [full, setFull] = useState(false)
  const [controls, setControls] = useState(true)
  const stage = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const enteredFullscreen = useRef(false)
  const hideTimer = useRef<number | null>(null)
  const slide = WORKSHOP_SLIDES[index]!

  const go = useCallback((to: number) => setIndex(Math.min(TOTAL - 1, Math.max(0, to))), [])
  // The neighbours are fetched ahead, so turning a page is instant on a phone.
  useEffect(() => { stage.current?.scrollTo(0, 0) }, [index, zoomed])
  useEffect(() => {
    for (const neighbour of [index - 1, index + 1]) {
      const item = WORKSHOP_SLIDES[neighbour]
      if (item) new Image().src = item.src
    }
  }, [index])

  // The controls of the full-screen layer fade away so the slide has the whole screen; any touch brings them back.
  const showControls = useCallback(() => {
    setControls(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControls(false), HIDE_CONTROLS_MS)
  }, [])

  const openFull = useCallback(() => {
    setFull(true)
    showControls()
  }, [showControls])
  const closeFull = useCallback(() => {
    setFull(false)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
  }, [])

  useEffect(() => {
    if (!full) return
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden' // the page behind must not scroll under a thumb
    // Real fullscreen and a landscape lock where the browser allows them (Android Chrome); both are refused on iPhone, which is fine.
    const el = layer.current
    if (el?.requestFullscreen && document.fullscreenEnabled) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => { enteredFullscreen.current = true }).catch(() => undefined)
    }
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
    void orientation?.lock?.('landscape')?.catch?.(() => undefined)
    const onFullscreenChange = () => {
      // Leaving real fullscreen (the system back gesture) leaves the viewing mode too.
      if (enteredFullscreen.current && !document.fullscreenElement) { enteredFullscreen.current = false; closeFull() }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    layer.current?.focus()
    return () => {
      root.style.overflow = previous
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      // Not "entered" any more BEFORE exiting, so the change event this causes does not close anything a second time.
      enteredFullscreen.current = false
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
      try { screen.orientation?.unlock?.() } catch { /* not locked */ }
    }
  }, [full, closeFull])
  // Keys follow the slide (a separate effect: turning a page must not re-ask the browser for fullscreen).
  useEffect(() => {
    if (!full) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFull()
      else if (event.key === 'ArrowLeft') go(index + 1)
      else if (event.key === 'ArrowRight') go(index - 1)
      else return
      event.preventDefault()
      showControls()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full, index, go, closeFull, showControls])

  function onKeyDown(event: React.KeyboardEvent) {
    if (full) return // the full-screen layer has its own key handling (the layer sits inside this section, so keys bubble here too)
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
  // In the full-screen layer: a swipe turns the page, and a tap on the left third is next, on the right third previous (the
  // Hebrew direction), in the middle it shows or hides the controls.
  function onLayerPointerUp(event: React.PointerEvent) {
    const from = start.current
    start.current = null
    if (!from) return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) >= Math.abs(dy) * 1.5) { go(dx < 0 ? index + 1 : index - 1); showControls(); return }
    if (Math.abs(dx) > TAP_PX || Math.abs(dy) > TAP_PX) return
    const width = (event.currentTarget as HTMLElement).clientWidth
    if (event.clientX < width * 0.3) { go(index + 1); showControls() }
    else if (event.clientX > width * 0.7) { go(index - 1); showControls() }
    else if (controls) { setControls(false); if (hideTimer.current) window.clearTimeout(hideTimer.current) }
    else showControls()
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
        <button type="button" className="ws__link ws__link--primary press" onClick={openFull}><Maximize2 size={17} aria-hidden="true" /> מסך מלא (לצפייה לרוחב)</button>
        <button type="button" className="ws__link press" aria-pressed={zoomed} onClick={() => setZoomed((value) => !value)}>{zoomed ? <ZoomOut size={17} aria-hidden="true" /> : <ZoomIn size={17} aria-hidden="true" />} {zoomed ? 'הקטנה' : 'הגדלה'}</button>
        <a className="ws__link press" href={WORKSHOP_FILE} download><Download size={17} aria-hidden="true" /> הורדת המצגת ({WORKSHOP_FILE_SIZE_LABEL})</a>
      </div>

      {full && (
        <div
          ref={layer}
          className={`ws-full${controls ? ' ws-full--controls' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={`${WORKSHOP_TITLE}, מסך מלא`}
          tabIndex={-1}
          onPointerDown={(event) => { start.current = { x: event.clientX, y: event.clientY } }}
          onPointerUp={onLayerPointerUp}
          onPointerCancel={() => { start.current = null }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={slide.src} className="ws-full__slide" src={slide.src} width={1600} height={900} alt={`שקף ${slide.n} מתוך ${TOTAL}: ${slide.title}`} decoding="async" draggable={false} />
          <div className="ws-full__top">
            <button type="button" className="ws-full__btn press" onClick={closeFull} onPointerUp={(event) => event.stopPropagation()} aria-label="יציאה ממסך מלא"><X size={22} aria-hidden="true" /></button>
            <p className="ws-full__count" aria-live="polite"><strong dir="ltr">{index + 1} / {TOTAL}</strong><span>{slide.title}</span></p>
          </div>
          <button type="button" className="ws-full__btn ws-full__nav ws-full__nav--prev press" onClick={() => { go(index - 1); showControls() }} onPointerUp={(event) => event.stopPropagation()} disabled={index === 0} aria-label="השקף הקודם"><ChevronRight size={26} aria-hidden="true" /></button>
          <button type="button" className="ws-full__btn ws-full__nav ws-full__nav--next press" onClick={() => { go(index + 1); showControls() }} onPointerUp={(event) => event.stopPropagation()} disabled={index === TOTAL - 1} aria-label="השקף הבא"><ChevronLeft size={26} aria-hidden="true" /></button>
          <p className="ws-full__rotate" role="status"><RotateCw size={18} aria-hidden="true" /> סובבו את הטלפון לרוחב כדי לראות את השקף בגדול</p>
        </div>
      )}
    </section>
  )
}
