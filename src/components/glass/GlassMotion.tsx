'use client'

import { useEffect } from 'react'

// glisse's refraction (an SVG displacement filter, Chromium only) is re-run every frame for glass over moving content. While the page
// scrolls it is swapped for plain blur (html.is-scrolling); settleGlass() does the same for 0.9 s after a branch or tab switch
// (html.is-switching) while the moving thumb keeps its lens. Measured in docs/SARCAFE_GLASS_UI.md: the worst frame went from ~930 ms
// to ~100 ms at 4x CPU throttle.
let switchTimer = 0
export function settleGlass(ms = 900) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.add('is-switching')
  window.clearTimeout(switchTimer)
  switchTimer = window.setTimeout(() => root.classList.remove('is-switching'), ms)
}

export default function GlassMotion() {
  useEffect(() => {
    const root = document.documentElement
    let timer = 0
    const onScroll = () => {
      if (!root.classList.contains('is-scrolling')) root.classList.add('is-scrolling')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => root.classList.remove('is-scrolling'), 180)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); window.clearTimeout(timer); root.classList.remove('is-scrolling', 'is-switching') }
  }, [])
  return null
}
