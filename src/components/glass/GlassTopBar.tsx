'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Glass, Menu, type MenuEntry } from 'glisse'
import { Beaker, Bell, BellRing, Check, CircleAlert, CircleCheck, ClipboardCheck, LogOut, Palette, UserRound } from 'lucide-react'
import { pushPathFor } from '@/lib/push/staff-rules'
import { noticeTone } from '@/lib/push/notice-tone'
import { clearDashboardBranchConfirmed } from '@/lib/branches/current'
import { THEME_ROW_ID } from '@/lib/staff/theme'
import Seg from './Seg'
import { useGlassBranch } from './BranchContext'
import { glassToast } from './toast'

// The glass top bar (the owner's favourite, 2026-11-04: keep it exactly like this). Logo, the branch switch for a manager, the
// notifications and the account. Every menu here is glisse's <Menu>: the icon morphs into the card. That is THE menu style of the
// app (docs/SARCAFE_GLASS_UI.md): any new menu, popover or picker looks like these.

type Notice = { id: string; kind?: string; title: string; body: string | null; link?: Record<string, unknown> | null; created_at: string; read_at: string | null }
const POLL_MS = 45_000
// A time range such as 07:00–14:00 inside Hebrew is flipped by the bidi rules; it is set apart left-to-right.
const RANGE = /(\d{1,2}[:/]\d{1,2}[–-]\d{1,2}[:/]\d{1,2})/
const Isolate = ({ text }: { text: string }) => <>{text.split(RANGE).map((part, i) => (i % 2 ? <bdi key={i} dir="ltr">{part}</bdi> : part))}</>
const ago = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 1) return 'עכשיו'
  if (minutes < 60) return `לפני ${minutes} דק׳`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? 'לפני שעה' : `לפני ${hours} שעות`
  const days = Math.round(hours / 24)
  return days === 1 ? 'אתמול' : `לפני ${days} ימים`
}

export type TopBarAccount = { developer: boolean; manager: boolean }

export default function GlassTopBar({ title, account, logo = '/sarcafe-logo.png' }: { title?: string; account: TopBarAccount; logo?: string }) {
  const router = useRouter()
  const branch = useGlassBranch()
  const [notices, setNotices] = useState<Notice[] | null>(null)
  const [unread, setUnread] = useState(0)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/staff/notifications', { cache: 'no-store' })
      if (!response.ok) throw new Error('notifications')
      const data = (await response.json()) as { notifications: Notice[]; unread: number }
      setNotices(data.notifications)
      setUnread(data.unread)
      setFailed(false)
    } catch { setFailed(true) }
  }, [])
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return true
    try {
      const response = await fetch('/api/staff/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids.slice(0, 40) }), keepalive: true })
      if (!response.ok) throw new Error('read')
      const now = new Date().toISOString()
      setNotices((list) => (list ?? []).map((n) => (ids.includes(n.id) ? { ...n, read_at: now } : n)))
      setUnread((count) => Math.max(0, count - ids.length))
      return true
    } catch {
      glassToast('לא הצלחנו לסמן כנקרא. נסו שוב.', 'bad')
      return false
    }
  }, [])

  const noticeItems: MenuEntry[] = useMemo(() => {
    if (failed && !notices) return [{ label: <span className="gl-nt gl-nt--bad"><span className="gl-nt__top"><strong>לא הצלחנו לטעון את ההתראות</strong></span><small>נסו שוב בעוד רגע</small></span>, icon: <CircleAlert size={16} />, onSelect: () => void load() }]
    if (!notices) return [{ label: 'טוען…', disabled: true }]
    const unreadIds = notices.filter((n) => !n.read_at).map((n) => n.id)
    const head: MenuEntry = {
      label: <span className="gl-nt"><span className="gl-nt__top"><strong>{unread ? 'סימון הכול כנקרא' : 'הכול נקרא'}</strong></span><small>{unread ? `${unread} התראות חדשות` : 'אין התראות חדשות'}</small></span>,
      icon: <Check size={16} />,
      disabled: unreadIds.length === 0,
      onSelect: () => { void markRead(unreadIds).then((ok) => { if (ok) glassToast('כל ההתראות סומנו כנקראו', 'ok') }) },
    }
    if (!notices.length) return [head]
    const rows: MenuEntry[] = notices.slice(0, 15).map((n) => {
      const tone = noticeTone(n.kind, n.title)
      return {
        icon: tone === 'ok' ? <CircleCheck size={16} className="gl-tone-ok" /> : tone === 'bad' ? <CircleAlert size={16} className="gl-tone-bad" /> : n.read_at ? <Bell size={16} /> : <BellRing size={16} />,
        label: (
          <span className={`gl-nt${tone !== 'neutral' ? ` gl-nt--${tone}` : ''}`}>
            <span className="gl-nt__top"><strong><Isolate text={n.title} /></strong>{!n.read_at && <span className={`gl-pill gl-pill--tiny${tone === 'ok' ? ' gl-pill--ok' : tone === 'bad' ? ' gl-pill--bad' : ''}`}>חדש</span>}</span>
            {n.body && <small className="gl-nt__body"><Isolate text={n.body} /></small>}
            <small className="gl-nt__time">{ago(n.created_at)}</small>
          </span>
        ),
        onSelect: () => {
          if (!n.read_at) void markRead([n.id])
          router.push(pushPathFor(n.kind ?? '', n.link ?? null, { manager: account.manager, title: n.title }))
        },
      }
    })
    const all: MenuEntry[] = account.developer ? ['separator', { label: 'מרכז ההתראות', icon: <Bell size={16} />, onSelect: () => router.push('/staff/dev?view=alerts') }] : []
    return [head, 'separator', ...rows, ...all]
  }, [failed, notices, unread, markRead, load, router, account])

  const accountItems: MenuEntry[] = useMemo(() => {
    const items: MenuEntry[] = [
      { label: 'הפרופיל שלי', icon: <UserRound size={18} />, onSelect: () => router.push('/staff/profile') },
      {
        label: 'מראה האפליקציה', icon: <Palette size={18} />,
        onSelect: () => {
          const row = document.getElementById(THEME_ROW_ID)
          if (row) { row.scrollIntoView({ block: 'center' }); (row as HTMLButtonElement).click() } else router.push('/staff/profile')
        },
      },
    ]
    if (account.developer) items.push({ label: 'מצב מפתח', icon: <Beaker size={18} />, onSelect: () => router.push('/staff/dev?view=dev') }, { label: 'סקירת QA של הבוקר', icon: <ClipboardCheck size={18} />, onSelect: () => router.push('/staff/dev/qa') })
    items.push('separator', {
      label: 'התנתקות', icon: <LogOut size={18} />, destructive: true,
      onSelect: () => {
        void (async () => {
          try {
            const response = await fetch('/api/auth/signout', { method: 'POST' })
            if (!response.ok) throw new Error('signout')
            clearDashboardBranchConfirmed()
            router.push('/login')
            router.refresh()
          } catch { glassToast('ההתנתקות לא הצליחה. נסו שוב.', 'bad') }
        })()
      },
    })
    return items
  }, [account.developer, router])

  const showBranches = !!branch && branch.branches.length > 1
  return (
    <header className="gl-top">
      <Glass className="gl-top__bar">
        <span className="gl-top__logo"><img src={logo} alt="Sarcafe" width={32} height={32} /></span>
        {showBranches ? (
          <div className="gl-top__branch">
            <Seg label="סניף" value={branch.slug} onChange={branch.select} items={branch.branches.map((b) => ({ value: b.slug, label: b.name }))} />
          </div>
        ) : (
          <span className="gl-top__title">{title ?? 'Sarcafe'}</span>
        )}
        <span className="gl-top__bell gl-notif">
          <Menu aria-label={unread ? `התראות, ${unread} חדשות` : 'התראות'} align="start" icon={<Bell size={20} />} items={noticeItems} />
          {unread > 0 && <span className="gl-top__dot" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
        </span>
        <span className="gl-account"><Menu aria-label="החשבון שלי" align="start" icon={<UserRound size={20} />} items={accountItems} /></span>
      </Glass>
    </header>
  )
}
