'use client'

import { setCurrentBranchCookie } from '@/lib/branches/current'
import type { Branch, BranchSlug } from '@/lib/branches'

// The one branch-chip row every /owner/* page renders identically — pulled
// out of DashboardLive/EditorWorkspace, which each carried a byte-identical
// copy with no shared memory between them (the actual bug report: picking a
// branch on one page had no effect on the next). Selecting a chip here both
// updates the caller's own state (instant, no round trip) and persists the
// choice via setCurrentBranchCookie() so the *next* page navigated to reads
// the same branch server-side.
export default function BranchSwitcher({
  branches,
  value,
  onChange,
  extra,
  disabled,
}: {
  branches: Branch[]
  value: BranchSlug
  onChange: (slug: BranchSlug) => void
  /** e.g. EditorWorkspace's "+ add branch" tile, appended after the chips. */
  extra?: React.ReactNode
  /** True while a caller is mid-fetch for the currently-selected branch —
   *  blocks re-switching until that data actually lands, so a second tap
   *  can't race the first and leave the page showing branch A's number
   *  under branch B's chip. */
  disabled?: boolean
}) {
  function select(slug: BranchSlug) {
    setCurrentBranchCookie(slug)
    onChange(slug)
  }

  return (
    <div role="group" aria-label="בחירת סניף" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', opacity: disabled ? 0.6 : 1 }}>
      {branches.map((b) => {
        const selected = b.slug === value
        return (
          <button
            key={b.slug}
            type="button"
            className="press"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => select(b.slug)}
            style={{
              flex: '1 1 auto',
              minHeight: 'var(--tap-min)',
              padding: '0 14px',
              borderRadius: 999,
              border: `1px solid ${selected ? 'var(--neon)' : 'var(--line-strong)'}`,
              background: selected ? 'rgba(255,122,69,0.14)' : 'var(--bg-elev)',
              color: selected ? 'var(--neon-soft)' : 'var(--text)',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            {b.name.he}
          </button>
        )
      })}
      {extra}
    </div>
  )
}
