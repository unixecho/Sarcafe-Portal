'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  beginBackTransition,
  directionFor,
  navigateWithTransition,
  recordNavigation,
  settleNavigation,
} from '@/lib/nav/viewTransition'

// Mounted once in the root layout. Ported near-verbatim from AyekaBar — no
// app-specific logic. Intercepts same-origin link clicks and re-dispatches
// them through the View Transition API; no custom <Link> component is
// needed anywhere in the app for this to work.
export default function PageTransitions() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = (event.target as HTMLElement)?.closest?.('a')
      if (!anchor) return
      if (anchor.hasAttribute('data-no-transition')) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#')) return

      let url: URL
      try {
        url = new URL(href, window.location.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      if (url.pathname.startsWith('/api/')) return

      event.preventDefault()
      event.stopPropagation()

      const path = `${url.pathname}${url.search}${url.hash}`
      navigateWithTransition(path, directionFor(path), () => router.push(path))
    }

    // Capture phase so this fires before any per-link handler.
    document.addEventListener('click', onClick, true)

    // Hardware/gesture/browser-button back never goes through the link-click
    // handler above, so it needs its own View Transition start — see
    // beginBackTransition()'s doc comment for why this was missing before.
    function onPopState() {
      beginBackTransition()
    }
    window.addEventListener('popstate', onPopState)

    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState)
    }
  }, [router])

  useEffect(() => {
    settleNavigation()
    recordNavigation(pathname)
  }, [pathname])

  return null
}
