'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { TabBar } from 'glisse'
import { CalendarClock, ClipboardCheck, House, MoreHorizontal, UserRound, Users } from 'lucide-react'
import { settleGlass } from './GlassMotion'
import type { DockKind } from '@/lib/nav/dock'
import { NAV_START_EVENT, type NavStartDetail } from '@/lib/nav/events'

// The bottom tab bar. It is drawn by <DockHost> in the /owner and /staff layouts, so it stays mounted while the person moves between
// its tabs, and it has its own view-transition layer (glass.css) so it stays still while the page slides. Real links (Next's <Link>,
// prefetched: the destination's skeleton is ready before the tap). "עוד" opens the tool finder (on this page, or home's).
// Hebrew reads right to left, so the first tab sits on the right: the bar is an LTR box with the items reversed (as <Seg>).
// glisse moves the thumb by --lg-tab-width; glass.css sets it so the tabs share the bar exactly (never stretch the bar itself).
export type { DockKind } from '@/lib/nav/dock'
export const FINDER_ID = 'tool-finder'

type Tab = { value: string; label: string; href?: string; icon: React.ReactNode; match?: RegExp }

function tabsFor(kind: DockKind, home: string): Tab[] {
  return kind === 'manager'
    ? [
        { value: 'home', label: 'בית', href: home, icon: <House size={22} />, match: /^\/(owner\/dashboard|staff\/dev)$/ },
        { value: 'schedule', label: 'סידור', href: '/owner/schedule', icon: <CalendarClock size={22} />, match: /^\/owner\/schedule/ },
        { value: 'staff', label: 'צוות', href: '/owner/staff', icon: <Users size={22} />, match: /^\/owner\/staff/ },
        { value: 'checklists', label: 'צ׳קליסטים', href: '/owner/checklists', icon: <ClipboardCheck size={22} />, match: /^\/owner\/checklists/ },
        { value: 'more', label: 'עוד', icon: <MoreHorizontal size={22} /> },
      ]
    : [
        { value: 'home', label: 'בית', href: home, icon: <House size={22} />, match: /^\/staff$/ },
        { value: 'schedule', label: 'משמרות', href: '/staff/schedule', icon: <CalendarClock size={22} />, match: /^\/staff\/schedule/ },
        { value: 'checklists', label: 'צ׳קליסט', href: '/staff/checklists', icon: <ClipboardCheck size={22} />, match: /^\/staff\/checklists/ },
        { value: 'profile', label: 'פרופיל', href: '/staff/profile', icon: <UserRound size={22} />, match: /^\/staff\/profile/ },
        { value: 'more', label: 'עוד', icon: <MoreHorizontal size={22} /> },
      ]
}

/** Opens the tool finder on this page (scrolls to it and puts the cursor in it). */
export function openFinder() {
  const box = document.getElementById(FINDER_ID)
  if (!box) return false
  box.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  window.setTimeout(() => box.querySelector('input')?.focus({ preventScroll: true }), 320)
  return true
}

export default function GlassDock({ kind, home }: { kind: DockKind; home: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const tabs = useMemo(() => tabsFor(kind, home), [kind, home])
  const current = tabs.find((t) => t.match?.test(pathname))?.value ?? null
  // The tapped tab lights up at once, before the next page arrives (a phone's tab bar does not wait for the network).
  // PageTransitions stops the click before React sees it (it re-dispatches every link through a view transition), so the tab learns
  // of the tap from its announcement, and lights synchronously, before the transition's snapshot.
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => { setPending(null) }, [pathname])
  useEffect(() => {
    const onStart = (e: Event) => {
      const path = (e as CustomEvent<NavStartDetail>).detail.path.split(/[?#]/)[0] ?? ''
      const tab = tabs.find((t) => t.href && t.match?.test(path))
      if (tab && tab.value !== current) flushSync(() => setPending(tab.value))
    }
    window.addEventListener(NAV_START_EVENT, onStart)
    return () => window.removeEventListener(NAV_START_EVENT, onStart)
  }, [tabs, current])
  const items = useMemo(() => [...tabs].reverse().map(({ value, label, href, icon }) => ({ value, label, icon, ...(href ? { href } : {}) })), [tabs])
  return (
    <nav className="gl-dock" aria-label="ניווט ראשי">
      <div dir="ltr" style={{ '--gl-tabs': tabs.length } as CSSProperties}>
        <TabBar
          aria-label="ניווט ראשי"
          link={Link}
          items={items}
          value={pending ?? current}
          onValueChange={(value) => {
            settleGlass()
            if (value !== 'more') { if (value !== current) setPending(value); return }
            if (!openFinder()) router.push(`${home}#${FINDER_ID}`)
          }}
        />
      </div>
    </nav>
  )
}
