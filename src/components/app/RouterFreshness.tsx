'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'

// Revisits are instant (owner, 2026-11-05): next.config keeps visited pages in the router's cache for 3 minutes, so tapping a tab
// you saw a moment ago shows it at once with nothing loading. Its live parts re-read only their own numbers (DashboardLive, the
// bell, the team message: each refreshes in place). What a cached page could miss is a SAVE made since it was cached (a checklist
// sent, a schedule saved: every save goes through an /api route), so:
//  - any successful same-origin write to /api/* (except the tool-history tap counter) marks the app "changed";
//  - the next page shown after a change asks the server for its data once (router.refresh: it updates in place, no skeleton);
//  - coming back to the app after more than a minute in the background does the same.
// Mounted in the /owner and /staff layouts. The fetch hook is installed once per tab and only reads the response status.
const IGNORED = ['/api/staff/tool-usage']
let changedAt = 0
let installed = false

function watchWrites() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await original(input, init)
    try {
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (response.ok && method !== 'GET' && method !== 'HEAD') {
        const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const url = new URL(href, window.location.href)
        if (url.origin === window.location.origin && url.pathname.startsWith('/api/') && !IGNORED.some((p) => url.pathname.startsWith(p))) changedAt = Date.now()
      }
    } catch { /* never let the watcher break a request */ }
    return response
  }
}

export default function RouterFreshness() {
  const router = useRouter()
  const pathname = usePathname()
  const refreshedAt = useRef(Date.now())
  const hiddenAt = useRef(0)

  useEffect(() => { watchWrites() }, [])

  useEffect(() => {
    if (changedAt <= refreshedAt.current) return
    // after the page's slide (PageTransitions), so the refresh never fights the transition
    const t = window.setTimeout(() => { refreshedAt.current = Date.now(); router.refresh() }, 350)
    return () => window.clearTimeout(t)
  }, [pathname, router])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return }
      if (hiddenAt.current && Date.now() - hiddenAt.current > 60_000) { refreshedAt.current = Date.now(); router.refresh() }
      hiddenAt.current = 0
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [router])

  return null
}
