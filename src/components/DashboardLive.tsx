'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bell, Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ClipboardCheck, FileEdit, MessageCircle, Package, UsersRound, Wrench } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import Seg from '@/components/glass/Seg'
import { useGlassBranch } from '@/components/glass/BranchContext'
import { TOOL_BADGES_EVENT } from '@/components/glass/tools/ToolsProvider'
import { isDashboardBranchConfirmed, setDashboardBranchConfirmed } from '@/lib/branches/current'
import { toolBadges } from '@/lib/tools/badges'
import type { Branch, BranchSlug } from '@/lib/branches'
import type { DashboardStats } from '@/lib/owner/dashboard-stats'
import type { Signal } from '@/lib/owner/signals'

const POLL_MS = 30_000
const COLLAPSE_THRESHOLD = 90 // chars — past this, a signal's own detail text starts collapsed

// Signals are keyed by a stable `id` server-side (lib/owner/signals.ts); resolved to an icon (and a tone) here by id.
const SIGNAL_ICONS: Record<string, typeof FileEdit> = { 'menu-unpublished': FileEdit, 'menu-out-of-stock': Package, 'feedback-new': MessageCircle }
/** Bad news is red (owner, 2026-11-05). Out of stock is bad news; an unpublished draft and new feedback are just "look at this". */
const SIGNAL_TONE: Record<string, 'bad' | undefined> = { 'menu-out-of-stock': 'bad' }

export type DashboardPayload = { stats: DashboardStats; signals: Signal[]; shortages: number | null; requests: number | null }

// The live part of the owner's glass dashboard: the menu numbers, the signals, and what needs attention, for the branch chosen in
// the top bar (components/glass/BranchContext). Polled every 30 s and on refocus; a failed read keeps the last good state on screen.
export default function DashboardLive({ branches, initialBranch, initial }: { branches: Branch[]; initialBranch: BranchSlug; initial: DashboardPayload }) {
  const shared = useGlassBranch()
  const branch = shared?.slug ?? initialBranch
  const [data, setData] = useState<DashboardPayload>(initial)
  const [loading, setLoading] = useState(false)
  // Asked once per login (sessionStorage), not on every visit: the top bar always shows which branch this is.
  const [branchConfirmed, setBranchConfirmed] = useState(true)
  useEffect(() => { if (branches.length > 1 && !isDashboardBranchConfirmed()) setBranchConfirmed(false) }, [branches.length])
  function confirmBranch() { setDashboardBranchConfirmed(); setBranchConfirmed(true) }

  const refresh = useCallback(async (forBranch: BranchSlug, quiet: boolean) => {
    if (!quiet) setLoading(true)
    try {
      const res = await fetch(`/api/owner/dashboard?branch=${encodeURIComponent(forBranch)}`, { cache: 'no-store' })
      if (!res.ok) return // last-good state stays on screen; no blank, no error flash
      const payload = (await res.json()) as DashboardPayload
      setData(payload)
      window.dispatchEvent(new CustomEvent(TOOL_BADGES_EVENT, { detail: toolBadges(payload) }))
    } catch {
      // Network hiccup — keep showing the last-good state.
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (branch !== initialBranch || data !== initial) void refresh(branch, false)
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(branch, true) }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(branch, true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [branch, refresh]) // eslint-disable-line react-hooks/exhaustive-deps

  const { stats, signals, shortages } = data
  const out = stats.outOfStockCount.known ? Number(stats.outOfStockCount.value) : null
  const draft = stats.hasUnpublishedChanges.known ? !!stats.hasUnpublishedChanges.value : null
  const name = branches.find((b) => b.slug === branch)?.name.he ?? ''

  return (
    <>
      <SheetShell open={!branchConfirmed} onClose={confirmBranch} labelledBy="branch-confirm-title">
        <h2 id="branch-confirm-title" style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 800 }}>איזה סניף?</h2>
        <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: 'var(--text-dim)' }}>המספרים וההתראות שלמטה יתייחסו לסניף שתבחרו. אפשר להחליף בכל רגע בשורה העליונה.</p>
        {shared && <Seg fill label="בחירת סניף" value={branch} onChange={shared.select} items={branches.map((b) => ({ value: b.slug, label: b.name.he }))} />}
        <button type="button" className="press" onClick={confirmBranch} style={{ marginTop: 16, width: '100%', minHeight: 'var(--tap-min)', borderRadius: 999, border: 'none', background: 'var(--neon)', color: 'var(--on-neon, var(--bg))', fontWeight: 700, cursor: 'pointer' }}>
          המשך ל{name || 'לוח הבקרה'}
        </button>
      </SheetShell>

      {/* Dimmed and inert while a branch switch loads: a tap mid-fetch would act on the previous branch's numbers. */}
      <div className="gl-field" style={{ gap: 14, opacity: loading ? 0.55 : 1, pointerEvents: loading ? 'none' : 'auto', transition: 'opacity .15s' }} aria-busy={loading}>
        <section className="gl-stats" aria-label={`מצב התפריט${name ? ` ב${name}` : ''}`}>
          <div className="gl-surf gl-stat"><b className="ltr-isolate">{stats.categoryCount.known ? String(stats.categoryCount.value) : '—'}</b><span>קטגוריות בתפריט</span></div>
          <div className={`gl-surf gl-stat${out ? ' gl-stat--bad' : out === 0 ? ' gl-stat--ok' : ''}`}><b className="ltr-isolate">{out === null ? '—' : out}</b><span>פריטים אזלו</span></div>
          <div className={`gl-surf gl-stat${draft === false ? ' gl-stat--ok' : ''}`}><b className="gl-stat__word">{draft === null ? '—' : draft ? 'טיוטה' : 'עדכני'}</b><span>סטטוס פרסום</span></div>
        </section>

        {signals.length > 0 && <ul className="gl-list">{signals.map((signal) => <SignalRow key={signal.id} signal={signal} />)}</ul>}

        <section className="gl-list" aria-label="הכי חשוב עכשיו">
          <Link href={`/owner/issues?branch=${encodeURIComponent(branch)}`} className={`gl-surf gl-row-card${shortages ? ' gl-surf--bad' : shortages === 0 ? ' gl-surf--ok' : ''}`}>
            <span className={`gl-ico${shortages ? ' gl-ico--bad' : shortages === 0 ? ' gl-ico--ok' : ''}`} aria-hidden="true">{shortages ? <AlertTriangle size={22} /> : shortages === 0 ? <CheckCircle2 size={22} /> : <Wrench size={22} />}</span>
            <span className="gl-row-card__copy"><strong>חוסרים ופערים</strong><small>{shortages === null ? 'לא זמין כרגע. לחצו לנסות שוב' : shortages === 0 ? 'הכול בסדר, אין מה לטפל' : shortages === 1 ? 'דבר אחד לטיפול' : `${shortages} דברים לטיפול`}</small></span>
            <ChevronLeft size={18} aria-hidden="true" className="gl-chev" />
          </Link>
          <Link href="/staff/schedule" className="gl-surf gl-row-card gl-row-card--main">
            <span className="gl-ico" aria-hidden="true"><UsersRound size={24} /></span>
            <span className="gl-row-card__copy"><strong>מי במשמרת &amp; משמרות</strong><small>המשמרת הקודמת, הנוכחית והבאה בכל סניף</small></span>
            <ChevronLeft size={18} aria-hidden="true" className="gl-chev" />
          </Link>
          <nav className="gl-wrap" aria-label={`פעולות בסניף ${name}`}>
            <Link className="gl-chip gl-chip--soft" href={`/owner/schedule?branch=${encodeURIComponent(branch)}`}><CalendarDays size={16} aria-hidden="true" />לוח משמרות</Link>
            <Link className="gl-chip gl-chip--soft" href={`/owner/checklists?branch=${encodeURIComponent(branch)}`}><ClipboardCheck size={16} aria-hidden="true" />צ׳קליסטים</Link>
            <Link className="gl-chip gl-chip--soft" href="/owner/branches"><Building2 size={16} aria-hidden="true" />ניהול סניפים</Link>
          </nav>
        </section>
      </div>
    </>
  )
}

function SignalRow({ signal }: { signal: Signal }) {
  const SignalIcon = SIGNAL_ICONS[signal.id] ?? Bell
  const tone = SIGNAL_TONE[signal.id]
  const [expanded, setExpanded] = useState(false)
  const icon = <span className={`gl-ico${tone ? ` gl-ico--${tone}` : ''}`} aria-hidden="true"><SignalIcon size={20} strokeWidth={2} /></span>
  const card = `gl-surf gl-row-card${tone ? ` gl-surf--${tone}` : ''}`
  // A customer's own written feedback can run long: collapsed past COLLAPSE_THRESHOLD, with its own toggle.
  if (signal.expandable && signal.detail) {
    const long = signal.detail.length > COLLAPSE_THRESHOLD
    return (
      <li className={card} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} disabled={!long} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', textAlign: 'start', cursor: long ? 'pointer' : 'default' }}>
          {icon}
          <strong style={{ flex: 1, fontSize: '0.92rem' }}>{signal.title}</strong>
          {long && <ChevronDown size={16} aria-hidden="true" style={{ color: 'var(--text-dim)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />}
        </button>
        <p style={{ margin: 0, marginInlineStart: 54, fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.5, ...(long && !expanded ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}) }}>{signal.detail}</p>
        {signal.href && <Link href={signal.href} className="gl-chip gl-chip--soft" style={{ marginInlineStart: 54, justifySelf: 'start', alignSelf: 'flex-start' }}>פתיחה בתיבת המשוב</Link>}
      </li>
    )
  }
  const content = (
    <>
      {icon}
      <span className="gl-row-card__copy"><strong>{signal.title}</strong>{signal.detail && <small>{signal.detail}</small>}</span>
      {signal.href && <ChevronLeft size={18} aria-hidden="true" className="gl-chev" />}
    </>
  )
  return <li>{signal.href ? <Link href={signal.href} className={card}>{content}</Link> : <div className={card}>{content}</div>}</li>
}
