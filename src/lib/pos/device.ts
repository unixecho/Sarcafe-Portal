'use client'

// Which layout to render: phone, tablet or desktop. Ayeka's device.ts, in spirit.
//
// Decided by WIDTH ONLY. A pointer-type query ("is this a touch device?") would push the
// primary device here — a coarse-pointer tablet — onto the phone path, and a tablet is exactly
// the screen the register and the stations are designed for. The breakpoints match the CSS
// media queries (768 / 1280), and the answer is read from matchMedia so JS and CSS can never
// disagree about which side of a breakpoint the viewport is on.
//
// It listens to matchMedia AND resize AND orientationchange, because no single one is reliable
// on every tablet (older iPad Safari reports a rotation late, and some embedded webviews never
// fire the matchMedia change). The snapshot is a plain string, so the extra events cost nothing:
// React skips every render where the answer did not change. The server snapshot is 'tablet',
// the layout the product is built around, so a first paint before hydration is the closest
// guess rather than a phone flash.

import { useMemo, useSyncExternalStore } from 'react'

export type Device = 'phone' | 'tablet' | 'desktop'

export const BREAKPOINT = { tablet: 768, desktop: 1280 } as const

/** Pure: which device a viewport width belongs to. Exactly 768 is a tablet, exactly 1280 a desktop. */
export function deviceForWidth(width: number): Device {
  if (!Number.isFinite(width)) return 'tablet'
  if (width >= BREAKPOINT.desktop) return 'desktop'
  if (width >= BREAKPOINT.tablet) return 'tablet'
  return 'phone'
}

const QUERIES = [`(min-width: ${BREAKPOINT.tablet}px)`, `(min-width: ${BREAKPOINT.desktop}px)`] as const

function read(): Device {
  if (typeof window === 'undefined') return 'tablet'
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia(QUERIES[1]).matches) return 'desktop'
    if (window.matchMedia(QUERIES[0]).matches) return 'tablet'
    return 'phone'
  }
  return deviceForWidth(window.innerWidth)
}

function subscribe(onChange: () => void) {
  const lists = typeof window.matchMedia === 'function' ? QUERIES.map((q) => window.matchMedia(q)) : []
  for (const mq of lists) {
    // Safari before 14 only has the deprecated addListener.
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
  }
  window.addEventListener('resize', onChange)
  window.addEventListener('orientationchange', onChange)
  return () => {
    for (const mq of lists) {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
    window.removeEventListener('resize', onChange)
    window.removeEventListener('orientationchange', onChange)
  }
}

export function useDevice(): Device {
  return useSyncExternalStore(subscribe, read, () => 'tablet' as Device)
}

export function useLayout(): { device: Device; atLeastTablet: boolean; atLeastDesktop: boolean } {
  const device = useDevice()
  return useMemo(
    () => ({ device, atLeastTablet: device !== 'phone', atLeastDesktop: device === 'desktop' }),
    [device],
  )
}
