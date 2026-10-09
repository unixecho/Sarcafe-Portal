'use client'

import { Building2 } from 'lucide-react'
import SelectSheet from '@/components/SelectSheet'
import { setCurrentBranchCookie } from '@/lib/branches/current'
import type { Branch, BranchSlug } from '@/lib/branches'

// The one branch-context control every /owner/* page renders identically.
// Selecting here both
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
    <div className="branch-context-switcher" role="group" aria-label="הקשר הסניף הפעיל" style={{ opacity: disabled ? 0.6 : 1 }}>
      <span className="branch-context-switcher__icon"><Building2 size={19} aria-hidden="true" /></span>
      <span className="branch-context-switcher__copy"><small>הסניף הפעיל</small><strong>{branches.find((branch) => branch.slug === value)?.name.he ?? value}</strong></span>
      <SelectSheet
        label="בחירת סניף לניהול"
        placeholder="בחירת סניף"
        value={value}
        options={branches.map((branch) => ({ value: branch.slug, label: branch.name.he }))}
        onChange={(slug) => select(slug as BranchSlug)}
        disabled={disabled}
        allowEmpty={false}
        style={{ minHeight: 42, borderRadius: 12, border: '1px solid var(--line-interactive)', background: 'var(--bg)', color: 'var(--text)', padding: '0 12px', minWidth: 150 }}
      />
      {extra}
    </div>
  )
}
