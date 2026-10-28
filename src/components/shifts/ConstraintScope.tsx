'use client'

import { createContext, useContext } from 'react'
import type { ConstraintBranch } from '@/lib/shifts/constraint-branches'

// What the constraints form needs to know that the schedule shell owns: the branches this person may send constraints for (with
// their hours), which branch the schedule is showing, and how to move to another one. Without a provider (any other screen that
// might reuse the form) the form behaves as before: no hours, no branch limit.
export type ConstraintScopeValue = { branches: ConstraintBranch[]; current: string; switchTo: (slug: string) => void }

const Scope = createContext<ConstraintScopeValue | null>(null)
export const ConstraintScopeProvider = Scope.Provider
export const useConstraintScope = () => useContext(Scope)
