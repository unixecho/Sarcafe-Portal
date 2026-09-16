'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { weekStartOf, todayISO } from '@/lib/shifts/time'
import type { ScheduleAction } from '@/lib/shifts/actions'
import type { ShiftsDB } from '@/lib/shifts/types'

type ShiftsContextValue = {
  branchSlug: string
  db: ShiftsDB | null
  loading: boolean
  error: string | null
  weekStart: string
  setWeekStart: (iso: string) => void
  /** Sends an action, awaits the server's authoritative result, then
   *  replaces state with a fresh read. No local optimistic apply — see
   *  lib/shifts/actions.ts's header for why that's a deliberate
   *  simplification here. Returns whether it succeeded so callers (a
   *  sheet's Save button) can decide whether to close. */
  dispatch: (action: ScheduleAction) => Promise<boolean>
  refresh: () => Promise<void>
}

const ShiftsContext = createContext<ShiftsContextValue | null>(null)

export default function ShiftsProvider({
  branchSlug,
  initialWeekStart,
  children,
}: {
  branchSlug: string
  /** Pins the week the provider opens on (e.g. a `?week=` deep link from
   *  the print view) instead of defaulting to the current week. */
  initialWeekStart?: string
  children: ReactNode
}) {
  const [weekStart, setWeekStart] = useState(() => (initialWeekStart ? weekStartOf(initialWeekStart) : weekStartOf(todayISO())))
  const [db, setDb] = useState<ShiftsDB | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/shifts/state?branch=${branchSlug}&week=${weekStart}`, { cache: 'no-store' })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error?.message ?? 'שגיאה בטעינת הלוח')
      setDb(payload.db as ShiftsDB)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת הלוח')
    } finally {
      setLoading(false)
    }
  }, [branchSlug, weekStart])

  useEffect(() => {
    void load()
  }, [load])

  const dispatch = useCallback(
    async (action: ScheduleAction) => {
      try {
        const res = await fetch('/api/shifts/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action),
        })
        const payload = await res.json()
        if (!res.ok) {
          setError(payload?.error?.message ?? 'הפעולה נכשלה')
          return false
        }
        await load()
        return true
      } catch {
        setError('הפעולה נכשלה — בדקו את החיבור לרשת')
        return false
      }
    },
    [load]
  )

  const value = useMemo<ShiftsContextValue>(
    () => ({ branchSlug, db, loading, error, weekStart, setWeekStart, dispatch, refresh: load }),
    [branchSlug, db, loading, error, weekStart, dispatch, load]
  )

  return <ShiftsContext.Provider value={value}>{children}</ShiftsContext.Provider>
}

export function useShifts(): ShiftsContextValue {
  const ctx = useContext(ShiftsContext)
  if (!ctx) throw new Error('useShifts must be used within a ShiftsProvider')
  return ctx
}
