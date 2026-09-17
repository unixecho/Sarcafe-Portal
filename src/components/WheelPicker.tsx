'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { haptic } from '@/lib/haptics'

// The iOS wheel picker — ported per BLUEPRINT.md §5.5. Columns scrolling
// under one fixed selection rail. Snapping is CSS (`scroll-snap-type: y
// mandatory`), never JavaScript, so touch momentum and rubber-banding are
// the platform's own — a hand-rolled version always feels a half-beat off
// on a real phone. The component only reads back where the scroll settled.
//
// THE BUG THIS MUST NEVER REINTRODUCE: the column must never move under a
// finger that is still down. If a re-render (from a parent reacting to
// onChange) re-parks the column to the "current" value while the user is
// mid-drag, the dial visibly fights back. `holding` gates every effect that
// would otherwise scroll the column programmatically.
//
// Pointer events are the MOUSE path (desktop has no native drag-to-scroll,
// so it's emulated here); touch events are the FINGER path. `touch-action:
// pan-y` hands a real touch gesture to the browser's own scroller almost
// immediately, which fires `pointercancel` the moment the pan starts — so
// the pointermove handler below naturally stops adjusting scrollTop once
// native scrolling takes over, and `holding` for the touch case is owned by
// the touch handlers instead, not by pointerup/pointercancel.

export const WHEEL_ITEM_H = 40
const VISIBLE = 5
const SETTLE_MS = 110
const PAD_ITEMS = (VISIBLE - 1) / 2

export type WheelOption = { value: string; label: string }

function WheelColumn({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: WheelOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const holding = useRef(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drag = useRef<{ y: number; scrollTop: number } | null>(null)
  const indexOf = useCallback((v: string) => Math.max(0, options.findIndex((o) => o.value === v)), [options])
  const [index, setIndex] = useState(() => indexOf(value))

  // Parks the column on the selected value — but never while a finger (or
  // the mouse, mid-drag) is still down. See the file header note.
  useEffect(() => {
    if (holding.current) return
    const el = scrollRef.current
    const i = indexOf(value)
    if (el) el.scrollTop = i * WHEEL_ITEM_H
    setIndex(i)
  }, [value, indexOf])

  const commit = useCallback(
    (smooth = false) => {
      const el = scrollRef.current
      if (!el) return
      const i = Math.min(options.length - 1, Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_H)))
      el.scrollTo({ top: i * WHEEL_ITEM_H, behavior: smooth ? 'smooth' : 'auto' })
      setIndex(i)
      const next = options[i]
      if (next && next.value !== value) {
        haptic('tick')
        onChange(next.value)
      }
    },
    [options, value, onChange],
  )

  function scheduleSettle() {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => {
      if (!holding.current) commit()
    }, SETTLE_MS)
  }

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current)
    },
    [],
  )

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') return // the touch handlers own this gesture
    e.currentTarget.setPointerCapture(e.pointerId)
    holding.current = true
    drag.current = { y: e.clientY, scrollTop: scrollRef.current?.scrollTop ?? 0 }
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current || !scrollRef.current) return
    scrollRef.current.scrollTop = drag.current.scrollTop - (e.clientY - drag.current.y)
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
    drag.current = null
    holding.current = false
    scheduleSettle()
  }
  function onPointerCancel() {
    // Fires the instant a real touch pan is claimed by the browser's own
    // scroller (touch-action: pan-y) — abandon the mouse-drag bookkeeping
    // without touching `holding`, which the touch handlers below own for
    // this gesture.
    drag.current = null
  }
  function onTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    holding.current = true
    const t = e.touches[0]
    if (t) drag.current = { y: t.clientY, scrollTop: scrollRef.current?.scrollTop ?? 0 }
  }
  function onTouchEnd() {
    holding.current = false
    drag.current = null
    scheduleSettle()
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const el = scrollRef.current
    if (!el) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const dir = e.key === 'ArrowUp' ? -1 : 1
      const i = Math.min(options.length - 1, Math.max(0, index + dir))
      el.scrollTo({ top: i * WHEEL_ITEM_H, behavior: 'smooth' })
      window.setTimeout(commit, 260)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      el.scrollTo({ top: (e.key === 'Home' ? 0 : options.length - 1) * WHEEL_ITEM_H, behavior: 'smooth' })
      window.setTimeout(commit, 260)
    }
  }

  return (
    <div
      ref={scrollRef}
      className="wheel-scroll"
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      style={{ height: WHEEL_ITEM_H * VISIBLE, paddingBlock: WHEEL_ITEM_H * PAD_ITEMS }}
      onScroll={scheduleSettle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => (
        <div key={o.value} role="option" aria-selected={i === index} className="wheel-item" style={{ height: WHEEL_ITEM_H }}>
          {o.label}
        </div>
      ))}
    </div>
  )
}

export type WheelColumnSpec = {
  options: WheelOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}

/** One or more synchronized columns under a single fixed selection rail. */
export default function WheelPicker({ columns }: { columns: WheelColumnSpec[] }) {
  return (
    <div className="wheel-picker">
      <div className="wheel-rail" aria-hidden="true" />
      {columns.map((col, i) => (
        <WheelColumn key={i} {...col} />
      ))}
    </div>
  )
}

const HOURS: WheelOption[] = Array.from({ length: 24 }, (_, i) => {
  const label = String(i).padStart(2, '0')
  return { value: label, label }
})
const MINUTES: WheelOption[] = Array.from({ length: 60 }, (_, i) => {
  const label = String(i).padStart(2, '0')
  return { value: label, label }
})

/** Thin wrapper over WheelPicker producing/consuming "HH:MM" strings — the
 * shape every existing native `<input type="time">` call site already uses,
 * so swapping one in for the other needs no change to the surrounding
 * component's state. */
export function TimeWheel({ value, onChange, label }: { value: string; onChange: (value: string) => void; label?: string }) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  const h = match?.[1] ?? '00'
  const m = match?.[2] ?? '00'
  return (
    <WheelPicker
      columns={[
        { options: HOURS, value: h, onChange: (v) => onChange(`${v}:${m}`), ariaLabel: `${label ?? 'שעה'} — שעות` },
        { options: MINUTES, value: m, onChange: (v) => onChange(`${h}:${v}`), ariaLabel: `${label ?? 'שעה'} — דקות` },
      ]}
    />
  )
}
