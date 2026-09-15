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

  // Entrance stagger. Ayeka's COUNTER, not hand-written delays, because both
  // blocks below are conditional: a branch-scoped general_manager gets no
  // switcher, and there is no editor at all until a branch exists. A skipped
  // block skips its delay() call, so whatever follows moves one step earlier
  // instead of leaving a visible hole where the missing block would have been.
  // The numbers are the owner dashboard's own — 60ms for the first body block,
  // 80ms between blocks (60 / 140 / 220) — so the owner app reads as one app
  // page to page; the header itself is at 0ms, it rises inside OwnerHeader.
  // Deliberately NOT given a delay(): the individual branch chips (one row is
  // one block — staggering chips makes a manager wait to see which branch is
  // selected) and AddBranchSheet (a sheet, with its own entrance already).
  let d = 0
  const delay = () => `${60 + d++ * 80}ms`

  return (
    <>
      {showSwitcher && (
        <div role="group" aria-label="בחירת סניף" className="rise" style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', animationDelay: delay() }}>
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

      {/* One rise for the whole editor, and the wrapper is deliberately NOT
          keyed by branch — only MenuEditor inside it is. Keying the wrapper
          would replay the entrance on every branch switch, which is a
          transition, not an entrance. rise-in ends at `transform: none`, so
          the 16px translate is gone the moment it finishes and the wrapper
          stops being the containing block for MenuEditor's fixed-position
          sheets; only during those 0.55s could one be anchored to the wrapper
          instead of the viewport, and nothing can be opened that fast. */}
      {branch && (
        <div className="rise" style={{ animationDelay: delay() }}>
          <MenuEditor key={branch} branchSlug={branch} branchLabel={branchName(branches, branch)} />
        </div>
      )}

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
