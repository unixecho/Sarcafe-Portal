'use client'

import { useMemo, type CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TabBar } from 'glisse'
import { CalendarClock, ClipboardCheck, House, MoreHorizontal, UserRound, Users } from 'lucide-react'
import { settleGlass } from './GlassMotion'

// The bottom tab bar of the glass home screens. Real links (Next's <Link>); "עוד" opens the tool finder on the page.
// Hebrew reads right to left, so the first tab sits on the right: the bar is an LTR box with the items reversed (as <Seg>).
// glisse moves the thumb by --lg-tab-width; glass.css sets it so the tabs share the bar exactly (never stretch the bar itself).
export type DockKind = 'manager' | 'employee'
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
  const tabs = useMemo(() => tabsFor(kind, home), [kind, home])
  const current = tabs.find((t) => t.match?.test(pathname))?.value ?? null
  const items = useMemo(() => [...tabs].reverse().map(({ value, label, href, icon }) => ({ value, label, icon, ...(href ? { href } : {}) })), [tabs])
  return (
    <nav className="gl-dock" aria-label="ניווט ראשי">
      <div dir="ltr" style={{ '--gl-tabs': tabs.length } as CSSProperties}>
        <TabBar
          aria-label="ניווט ראשי"
          link={Link}
          items={items}
          value={current}
          onValueChange={(value) => { settleGlass(); if (value === 'more') openFinder() }}
        />
      </div>
    </nav>
  )
}
