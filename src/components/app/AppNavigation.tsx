'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Accessibility,
  Bell,
  CalendarClock,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  History,
  House,
  Link2,
  Menu,
  MessageCircle,
  Receipt,
  ShoppingBag,
  Sparkles,
  Star,
  Tablet,
  UserRound,
  Users,
  X,
} from 'lucide-react'

type Item = { href: string; label: string; icon: typeof House }
type Group = { label: string; items: Item[] }

const STAFF_GROUPS: Group[] = [
  { label: 'המשמרת שלי', items: [
    { href: '/staff', label: 'בית', icon: House },
    { href: '/staff/schedule', label: 'משמרות ובקשות', icon: CalendarClock },
    { href: '/staff/checklists', label: 'צ׳קליסט למשמרת', icon: ClipboardCheck },
    { href: '/pos', label: 'העמדה שלי', icon: Receipt },
  ] },
  { label: 'החשבון', items: [
    { href: '/staff/profile', label: 'הפרופיל שלי', icon: UserRound },
  ] },
]

const OWNER_GROUPS: Group[] = [
  { label: 'ניהול היום', items: [
    { href: '/owner/dashboard', label: 'לוח הבקרה', icon: House },
    { href: '/owner/schedule', label: 'סידור עבודה', icon: CalendarClock },
    { href: '/owner/staff', label: 'העובדים שלי', icon: Users },
    { href: '/owner/checklists', label: 'צ׳קליסטים ודיווחים', icon: ClipboardCheck },
  ] },
  { label: 'שירות', items: [
    { href: '/staff/pos', label: 'הזמנות מהירות', icon: ShoppingBag },
    { href: '/owner/pos', label: 'קופת אירועים', icon: Receipt },
    { href: '/owner/tablet', label: 'זמינות פריטים', icon: Tablet },
    { href: '/owner/editor', label: 'עריכת תפריט', icon: ClipboardList },
  ] },
  { label: 'העסק', items: [
    { href: '/owner/reviews', label: 'ביקורות', icon: Star },
    { href: '/owner/feedback', label: 'משוב', icon: MessageCircle },
    { href: '/owner/links', label: 'קישורים ושיתוף', icon: Link2 },
    { href: '/owner/audit', label: 'יומן פעילות', icon: History },
    { href: '/owner/intro', label: 'מסך פתיחה', icon: Sparkles },
    { href: '/owner/accessibility', label: 'נגישות', icon: Accessibility },
  ] },
]

export default function AppNavigation() {
  const pathname = usePathname()
  const owner = pathname.startsWith('/owner')
  const groups = owner ? OWNER_GROUPS : STAFF_GROUPS
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="app-nav">
      <button
        type="button"
        className="app-header__icon app-nav__trigger press"
        aria-label={open ? 'סגירת תפריט הניווט' : 'פתיחת תפריט הניווט'}
        aria-expanded={open}
        aria-controls="app-navigation-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
      {open && <button type="button" className="app-nav__scrim" aria-label="סגירת התפריט" onClick={() => setOpen(false)} />}
      <div
        id="app-navigation-panel"
        ref={panel}
        className={`app-nav__panel${open ? ' app-nav__panel--open' : ''}`}
        aria-hidden={!open}
      >
        <div className="app-nav__grabber" aria-hidden="true" />
        <div className="app-nav__title">
          <div><strong>{owner ? 'Sarcafe ניהול' : 'Sarcafe צוות'}</strong><span>{owner ? 'כל כלי הניהול' : 'המשמרת, העמדה והחשבון'}</span></div>
          <ChevronDown size={18} aria-hidden="true" />
        </div>
        <nav aria-label={owner ? 'ניווט מנהלים' : 'ניווט עובדים'} className="app-nav__groups">
          {groups.map((group) => (
            <section key={group.label} className="app-nav__group">
              <h2>{group.label}</h2>
              <div className="app-nav__grid">
                {group.items.map((item) => {
                  const active = pathname === item.href || (item.href !== '/staff' && item.href !== '/owner/dashboard' && pathname.startsWith(`${item.href}/`))
                  return (
                    <Link key={item.href} href={item.href} className="app-nav__item press" aria-current={active ? 'page' : undefined} tabIndex={open ? 0 : -1}>
                      <item.icon size={20} strokeWidth={1.9} aria-hidden="true" />
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            </section>
          ))}
        </nav>
        <div className="app-nav__hint"><Bell size={15} aria-hidden="true" /><span>עדכונים נשארים זמינים במסך הבית ובלוח המשמרות.</span></div>
      </div>
    </div>
  )
}
