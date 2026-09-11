'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import StatStrip from '@/components/StatStrip'
import { BRANCHES, type BranchSlug } from '@/lib/branches'
import type { DashboardStats } from '@/lib/owner/dashboard-stats'
import type { Signal } from '@/lib/owner/signals'

const POLL_MS = 30_000

type DashboardPayload = { stats: DashboardStats; signals: Signal[] }

export default function DashboardLive({
  initialBranch,
  initial,
}: {
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
      <div role="group" aria-label="בחירת סניף" style={{ display: 'flex', gap: 6 }}>
        {BRANCHES.map((b) => {
          const selected = b.slug === branch
          return (
            <button
              key={b.slug}
              type="button"
              className="press"
              aria-pressed={selected}
              onClick={() => setBranch(b.slug)}
              style={{
                flex: 1,
                minHeight: 'var(--tap-min)',
                borderRadius: 999,
                border: `1px solid ${selected ? 'var(--neon)' : 'var(--line-strong)'}`,
                background: selected ? 'rgba(255,122,69,0.14)' : 'var(--bg-elev)',
                color: selected ? 'var(--neon-soft)' : 'var(--text)',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              {b.name.he}
            </button>
          )
        })}
      </div>

      <StatStrip stats={data.stats} />

      {data.signals.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.signals.map((signal) => {
            const content = (
              <>
                <span aria-hidden="true" style={{ fontSize: '1.1rem' }}>
                  {signal.icon}
                </span>
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
