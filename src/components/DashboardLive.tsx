'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { FileEdit, Package, Bell, MessageCircle, ChevronDown } from 'lucide-react'
import StatStrip from '@/components/StatStrip'
import BranchSwitcher from '@/components/BranchSwitcher'
import SheetShell from '@/components/SheetShell'
import { isDashboardBranchConfirmed, setDashboardBranchConfirmed } from '@/lib/branches/current'
import type { Branch, BranchSlug } from '@/lib/branches'
import type { DashboardStats } from '@/lib/owner/dashboard-stats'
import type { Signal } from '@/lib/owner/signals'

const POLL_MS = 30_000
const COLLAPSE_THRESHOLD = 90 // chars — past this, a signal's own detail text starts collapsed

// Signals are keyed by a stable `id` server-side (lib/owner/signals.ts);
// resolved to an icon here by id rather than trusting the data layer's own
// `icon` (still a legacy emoji string) to pick the right glyph.
const SIGNAL_ICONS: Record<string, typeof FileEdit> = {
  'menu-unpublished': FileEdit,
  'menu-out-of-stock': Package,
  'feedback-new': MessageCircle,
}

type DashboardPayload = { stats: DashboardStats; signals: Signal[] }

export default function DashboardLive({
  branches,
  initialBranch,
  initial,
}: {
  branches: Branch[]
  initialBranch: BranchSlug
  initial: DashboardPayload
}) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)
  const [data, setData] = useState<DashboardPayload>(initial)
  const [loading, setLoading] = useState(false)
  // Prompted once per login (sessionStorage — cleared on sign-out and when
  // the tab closes), not on every visit: the always-visible BranchSwitcher
  // right below already covers "which branch am I on" for the rest of the
  // session, so re-prompting every time was friction without a matching
  // safety benefit. Starts already-confirmed on the server-rendered first
  // paint (avoids a flash of the sheet before the mount effect can check
  // sessionStorage) and the effect below corrects it if this is actually a
  // fresh login.
  const [branchConfirmed, setBranchConfirmed] = useState(true)

  useEffect(() => {
    if (branches.length > 1 && !isDashboardBranchConfirmed()) setBranchConfirmed(false)
  }, [branches.length])

  function confirmBranch() {
    setDashboardBranchConfirmed()
    setBranchConfirmed(true)
  }

  const refresh = useCallback(async (forBranch: BranchSlug) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/owner/dashboard?branch=${forBranch}`)
      if (!res.ok) return // last-good state stays on screen; no blank, no error flash
      const payload = (await res.json()) as DashboardPayload
      setData(payload)
    } catch {
      // Network hiccup — keep showing the last-good state.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh(branch)
    const interval = window.setInterval(() => refresh(branch), POLL_MS)

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') refresh(branch)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [branch, refresh])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SheetShell open={!branchConfirmed} onClose={confirmBranch} labelledBy="branch-confirm-title">
        <h2 id="branch-confirm-title" style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 800 }}>
          איזה סניף?
        </h2>
        <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: 'var(--text-dim)' }}>
          המספרים והתראות שלמטה יתייחסו לסניף שתבחרו. נשאל שוב רק בכניסה הבאה.
        </p>
        <BranchSwitcher branches={branches} value={branch} onChange={setBranch} />
        <button
          type="button"
          className="press"
          onClick={confirmBranch}
          style={{
            marginTop: 16,
            width: '100%',
            minHeight: 'var(--tap-min)',
            borderRadius: 999,
            border: 'none',
            background: 'var(--neon)',
            color: 'var(--bg)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          המשך ל{branches.find((b) => b.slug === branch)?.name.he ?? 'לוח הבקרה'}
        </button>
      </SheetShell>

      <BranchSwitcher branches={branches} value={branch} onChange={setBranch} disabled={loading} />

      {/* Dimmed + inert (not just visually opaque) while switching branches
          — a tap mid-fetch on a signal link or a stat's own affordance
          would act on whichever branch's data happens to still be on
          screen, not necessarily the one the chip now shows as selected. */}
      <div style={{ opacity: loading ? 0.5 : 1, pointerEvents: loading ? 'none' : 'auto', transition: 'opacity 0.15s var(--ease)' }} aria-busy={loading}>
        <StatStrip stats={data.stats} />

        {data.signals.length > 0 && (
          <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.signals.map((signal) => (
              <SignalRow key={signal.id} signal={signal} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SignalRow({ signal }: { signal: Signal }) {
  const SignalIcon = SIGNAL_ICONS[signal.id] ?? Bell
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 14px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elev)',
    border: `1px solid ${signal.rank >= 60 ? 'rgba(255,122,69,0.4)' : 'var(--line)'}`,
    color: 'var(--text)',
    textDecoration: 'none',
  }
  const icon = <SignalIcon aria-hidden="true" size={20} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--neon-soft)' }} />

  // A customer's own written feedback can run long, unlike every other
  // signal's short, app-composed detail line — collapsed by default past
  // COLLAPSE_THRESHOLD, with its own expand toggle, rather than either
  // dumping the full text unconditionally or truncating it with no way to
  // read the rest.
  const [expanded, setExpanded] = useState(false)
  if (signal.expandable && signal.detail) {
    const long = signal.detail.length > COLLAPSE_THRESHOLD
    return (
      <li>
        <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <button
            type="button"
            className="press"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', textAlign: 'start', cursor: long ? 'pointer' : 'default' }}
            disabled={!long}
          >
            {icon}
            <strong style={{ flex: 1, textAlign: 'start', fontSize: '0.88rem', fontWeight: 700 }}>{signal.title}</strong>
            {long && (
              <ChevronDown size={16} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--text-faint)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s var(--ease)' }} />
            )}
          </button>
          <p
            style={{
              margin: 0,
              marginInlineStart: 30,
              fontSize: '0.8rem',
              color: 'var(--text-faint)',
              lineHeight: 1.5,
              ...(long && !expanded
                ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
                : {}),
            }}
          >
            {signal.detail}
          </p>
          {signal.href && (
            <Link href={signal.href} className="press" style={{ marginInlineStart: 30, alignSelf: 'flex-start', fontSize: '0.78rem', color: 'var(--neon-2)', fontWeight: 600 }}>
              פתיחה בתיבת המשוב ←
            </Link>
          )}
        </div>
      </li>
    )
  }

  const content = (
    <>
      {icon}
      <span style={{ flex: 1, textAlign: 'start' }}>
        <strong style={{ display: 'block', fontSize: '0.88rem' }}>{signal.title}</strong>
        {signal.detail && <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-faint)' }}>{signal.detail}</span>}
      </span>
    </>
  )
  return <li>{signal.href ? <Link href={signal.href} style={rowStyle}>{content}</Link> : <div style={rowStyle}>{content}</div>}</li>
}
