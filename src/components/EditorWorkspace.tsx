'use client'

import { useState } from 'react'
import MenuEditor from '@/components/MenuEditor'
import { BRANCHES, branchName, type BranchSlug } from '@/lib/branches'

/**
 * Owns the branch switcher for the menu editor. A branch-scoped
 * general_manager (allowedBranchSlug set) gets no switcher at all — the
 * server already resolved they only have one branch to edit.
 */
export default function EditorWorkspace({ allowedBranchSlug }: { allowedBranchSlug: string | null }) {
  const branches = allowedBranchSlug ? BRANCHES.filter((b) => b.slug === allowedBranchSlug) : BRANCHES
  const [branch, setBranch] = useState<BranchSlug>(branches[0]?.slug ?? BRANCHES[0].slug)

  return (
    <>
      {branches.length > 1 && (
        <div role="group" aria-label="בחירת סניף" style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {branches.map((b) => {
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
      )}
      <MenuEditor key={branch} branchSlug={branch} branchLabel={branchName(branch)} />
    </>
  )
}
