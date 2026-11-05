'use client'

import { createContext, useCallback, useContext, useMemo, useState, useTransition, type ReactNode } from 'react'
import { setCurrentBranchCookie } from '@/lib/branches/current'
import { settleGlass } from './GlassMotion'

// The branch a manager is looking at, shared by the glass top bar (where it is switched) and everything on the dashboard that
// depends on it (the live stats, the team message). The choice is the same `sarcafe_branch` cookie as before, so the inner pages
// open on the same branch. The data update is a transition, so the switch animation never waits for a re-render.
export type GlassBranch = { slug: string; name: string }
type Value = { branches: GlassBranch[]; slug: string; pending: boolean; select: (slug: string) => void }
const BranchCtx = createContext<Value | null>(null)

export function GlassBranchProvider({ branches, initial, children }: { branches: GlassBranch[]; initial: string; children: ReactNode }) {
  const [slug, setSlug] = useState(branches.some((b) => b.slug === initial) ? initial : branches[0]?.slug ?? '')
  const [pending, startTransition] = useTransition()
  const select = useCallback((next: string) => {
    if (!branches.some((b) => b.slug === next)) return
    settleGlass()
    setCurrentBranchCookie(next)
    startTransition(() => setSlug(next))
  }, [branches])
  const value = useMemo(() => ({ branches, slug, pending, select }), [branches, slug, pending, select])
  return <BranchCtx.Provider value={value}>{children}</BranchCtx.Provider>
}

/** The dashboard branch, or null outside a manager dashboard (an employee's home has no branch switch). */
export function useGlassBranch(): Value | null {
  return useContext(BranchCtx)
}
