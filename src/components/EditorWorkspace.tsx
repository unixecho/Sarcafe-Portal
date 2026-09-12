'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import MenuEditor from '@/components/MenuEditor'
import AddBranchSheet from '@/components/AddBranchSheet'
import { branchName, type Branch, type BranchSlug } from '@/lib/branches'

/**
 * Owns the branch switcher for the menu editor. A branch-scoped
 * general_manager (allowedBranchSlug set) gets no switcher at all — the
 * server already resolved they only have one branch to edit. A true owner
 * additionally gets a "+" tile to create a new location on the spot
 * ("if she branches out with another branch") — its menu starts empty, so
 * switching to it hands straight into MenuEditor's onboarding wizard with
 * no extra wiring needed.
 */
export default function EditorWorkspace({
  branches: initialBranches,
  allowedBranchSlug,
  isOwner,
}: {
  branches: Branch[]
  allowedBranchSlug: string | null
  isOwner: boolean
}) {
  const [branches, setBranches] = useState(
    allowedBranchSlug ? initialBranches.filter((b) => b.slug === allowedBranchSlug) : initialBranches
  )
  const [branch, setBranch] = useState<BranchSlug>(branches[0]?.slug ?? '')
  const [addOpen, setAddOpen] = useState(false)

  const showSwitcher = branches.length > 1 || isOwner

  return (
    <>
      {showSwitcher && (
        <div role="group" aria-label="בחירת סניף" style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
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
                  flex: '1 1 auto',
                  minHeight: 'var(--tap-min)',
                  padding: '0 14px',
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
          {isOwner && (
            <button
              type="button"
              className="press"
              onClick={() => setAddOpen(true)}
              aria-label="הוספת סניף חדש"
              title="הוספת סניף חדש"
              style={{
                width: 'var(--tap-min)',
                minHeight: 'var(--tap-min)',
                borderRadius: 999,
                border: '1px dashed var(--line-strong)',
                background: 'transparent',
                color: 'var(--text-dim)',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
              }}
            >
              <Plus size={18} strokeWidth={2.25} />
            </button>
          )}
        </div>
      )}

      {branch && <MenuEditor key={branch} branchSlug={branch} branchLabel={branchName(branches, branch)} />}

      {isOwner && (
        <AddBranchSheet
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onCreated={(newBranch) => {
            setBranches((prev) => [...prev, newBranch])
            setBranch(newBranch.slug)
          }}
        />
      )}
    </>
  )
}
