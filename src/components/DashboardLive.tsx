'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { FileEdit, Package, Bell } from 'lucide-react'
import StatStrip from '@/components/StatStrip'
import BranchSwitcher from '@/components/BranchSwitcher'
import type { Branch, BranchSlug } from '@/lib/branches'
import type { DashboardStats } from '@/lib/owner/dashboard-stats'
import type { Signal } from '@/lib/owner/signals'

const POLL_MS = 30_000

// Signals are keyed by a stable `id` server-side (lib/owner/signals.ts);
// resolved to an icon here by id rather than trusting the data layer's own
// `icon` (still a legacy emoji string) to pick the right glyph.
const SIGNAL_ICONS: Record<string, typeof FileEdit> = {
  'menu-unpublished': FileEdit,
  'menu-out-of-stock': Package,
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

  const refresh = useCallback(async (forBranch: BranchSlug) => {
    try {
      const res = await fetch(`/api/owner/dashboard?branch=${forBranch}`)
      if (!res.ok) return // last-good state stays on screen; no blank, no error flash
      const payload = (await res.json()) as DashboardPayload
      setData(payload)
    } catch {
      // Network hiccup — keep showing the last-good state.
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
      <BranchSwitcher branches={branches} value={branch} onChange={setBranch} />

      <StatStrip stats={data.stats} />

      {data.signals.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.signals.map((signal) => {
            const SignalIcon = SIGNAL_ICONS[signal.id] ?? Bell
            const content = (
              <>
                <SignalIcon aria-hidden="true" size={20} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--neon-soft)' }} />
                <span style={{ flex: 1, textAlign: 'start' }}>
                  <strong style={{ display: 'block', fontSize: '0.88rem' }}>{signal.title}</strong>
                  {signal.detail && (
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-faint)' }}>
                      {signal.detail}
                    </span>
                  )}
                </span>
              </>
            )
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
            return (
              <li key={signal.id}>
                {signal.href ? (
                  <Link href={signal.href} style={rowStyle}>
                    {content}
                  </Link>
                ) : (
                  <div style={rowStyle}>{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
