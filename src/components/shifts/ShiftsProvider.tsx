'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { wallClockNow, weekStartOf } from '@/lib/shifts/time'
import type { DispatchResult, ScheduleAction } from '@/lib/shifts/actions'
import type { ShiftsDB } from '@/lib/shifts/types'
import ScheduleToast, { type ToastState } from '@/components/shifts/ScheduleToast'
import '@/components/shifts/schedule.css'

const POLL_MS = 15_000
const GENERIC_ERROR = 'משהו השתבש. בדקו את החיבור לרשת ונסו שוב.'

function applyLocalAction(current: ShiftsDB, action: ScheduleAction, data?: Record<string, unknown>): ShiftsDB {
  if (action.type === 'setMember') {
    return {
      ...current,
      roster: current.roster.map((row) => (row.staffId === action.staffId ? { ...row, ...action.patch } : row)),
    }
  }
  if (action.type === 'updateSettings') {
    return { ...current, settings: { ...current.settings, ...action.patch } }
  }
  if (action.type === 'setDayNote') {
    return {
      ...current,
      weeks: current.weeks.map((week) => {
        if (week.id !== action.weekId) return week
        const dayNotes = { ...week.dayNotes }
        if (action.note.trim()) dayNotes[action.date] = action.note.trim()
        else delete dayNotes[action.date]
        return { ...week, dayNotes }
      }),
    }
  }
  if (action.type === 'saveShift' && data?.shift && Array.isArray(data.assignments)) {
    const shift = data.shift as ShiftsDB['shifts'][number]
    const assignments = data.assignments as ShiftsDB['assignments']
    return {
      ...current,
      shifts: [...current.shifts.filter((candidate) => candidate.id !== shift.id), shift],
      assignments: [...current.assignments.filter((assignment) => assignment.shiftId !== shift.id), ...assignments],
    }
  }
  return current
}

const instantAction = (action: ScheduleAction) =>
  action.type === 'saveShift' || action.type === 'setMember' || action.type === 'updateSettings' || action.type === 'setDayNote'

type DispatchOptions = {
  /** Words shown after the action succeeds (a plain sentence, or built from what the action returned). */
  success?: string | ((data: Record<string, unknown>) => string)
  /** The caller shows the failure itself (inside its own sheet) — no error toast. */
  quiet?: boolean
}

type ShiftsContextValue = {
  branchSlug: string
  db: ShiftsDB | null
  loading: boolean
  /** Only meaningful while no data has loaded yet; once `db` exists failures are toasts. */
  error: string | null
  weekStart: string
  setWeekStart: (iso: string) => void
  goToToday: () => void
  /** Sends an action and keeps the interface responsive while the database remains
   *  authoritative. Safe settings/member edits are reflected immediately; a saved
   *  shift is applied from the server's confirmed response, then a quiet full read
   *  reconciles related warnings/audit data. EVERY outcome is visible — a
   *  success toast with the words passed in `success`, or the server's plain-Hebrew
   *  explanation of what went wrong and what to do (unless `quiet`). */
  dispatch: (action: ScheduleAction, options?: DispatchOptions) => Promise<DispatchResult>
  refresh: () => Promise<void>
  toast: (kind: ToastState['kind'], text: string) => void
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
  const [weekStart, setWeekStartState] = useState(() => (initialWeekStart ? weekStartOf(initialWeekStart) : weekStartOf(wallClockNow('Asia/Jerusalem').date)))
  const [db, setDb] = useState<ShiftsDB | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toastState, setToastState] = useState<ToastState | null>(null)
  const requestSeq = useRef(0)
  const busy = useRef(0)

  const toast = useCallback((kind: ToastState['kind'], text: string) => {
    setToastState({ id: Date.now() + Math.random(), kind, text })
  }, [])

  const load = useCallback(
    async (silent = false) => {
      const seq = ++requestSeq.current
      if (!silent) setLoading(true)
      try {
        const res = await fetch(`/api/shifts/state?branch=${encodeURIComponent(branchSlug)}&week=${weekStart}`, { cache: 'no-store' })
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error(payload?.error?.message ?? 'שגיאה בטעינת הלוח')
        // An answer to an older question (the week changed meanwhile) must never overwrite a newer one.
        if (seq !== requestSeq.current) return
        setDb(payload.db as ShiftsDB)
        setError(null)
      } catch (e) {
        if (seq !== requestSeq.current) return
        // A background refresh that fails is not worth interrupting anyone for; the next one will retry.
        if (!silent) setError(e instanceof Error ? e.message : 'שגיאה בטעינת הלוח')
      } finally {
        if (seq === requestSeq.current && !silent) setLoading(false)
      }
    },
    [branchSlug, weekStart]
  )

  useEffect(() => {
    void load()
  }, [load])

  // Keep the board current without anyone pressing refresh: a request that arrives
  // while the manager has the screen open shows up on its own (and on return to the tab).
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible' && busy.current === 0) void load(true)
    }
    const id = window.setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [load])

  const dispatch = useCallback(
    async (action: ScheduleAction, options: DispatchOptions = {}): Promise<DispatchResult> => {
      busy.current++
      // These patches are reversible views of the exact validated action. The
      // database still makes the decision; a refusal below reloads the truth.
      if (action.type === 'setMember' || action.type === 'updateSettings' || action.type === 'setDayNote') {
        setDb((current) => (current ? applyLocalAction(current, action) : current))
      }
      try {
        const res = await fetch('/api/shifts/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action),
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok) {
          const message: string = payload?.error?.message ?? GENERIC_ERROR
          const details = (payload?.error?.details ?? {}) as Record<string, unknown>
          const reason = typeof details.reason === 'string' ? details.reason : null
          // A refusal that needs a decision from the person (confirm / re-load) is handled by the caller.
          if (!options.quiet) toast('error', message)
          if (instantAction(action)) void load(true)
          // The schedule may have moved under us (someone else changed it): show the truth.
          if (reason === 'stale' || reason === 'not_found' || reason === 'not_pending' || reason === 'assignment_changed') void load(true)
          return { ok: false, message, reason, details }
        }
        const data = (payload?.data ?? {}) as Record<string, unknown>
        if (instantAction(action)) {
          setDb((current) => (current ? applyLocalAction(current, action, data) : current))
          void load(true)
        } else {
          await load(true)
        }
        if (options.success) toast('ok', typeof options.success === 'function' ? options.success(data) : options.success)
        return { ok: true, data }
      } catch {
        if (!options.quiet) toast('error', GENERIC_ERROR)
        return { ok: false, message: GENERIC_ERROR, reason: null, details: {} }
      } finally {
        busy.current--
      }
    },
    [load, toast]
  )

  const setWeekStart = useCallback((iso: string) => setWeekStartState(weekStartOf(iso)), [])
  const goToToday = useCallback(() => setWeekStartState(weekStartOf(wallClockNow('Asia/Jerusalem').date)), [])

  const value = useMemo<ShiftsContextValue>(
    () => ({ branchSlug, db, loading, error, weekStart, setWeekStart, goToToday, dispatch, refresh: () => load(true), toast }),
    [branchSlug, db, loading, error, weekStart, setWeekStart, goToToday, dispatch, load, toast]
  )

  return (
    <ShiftsContext.Provider value={value}>
      {children}
      <ScheduleToast toast={toastState} onDismiss={() => setToastState(null)} />
    </ShiftsContext.Provider>
  )
}

export function useShifts(): ShiftsContextValue {
  const ctx = useContext(ShiftsContext)
  if (!ctx) throw new Error('useShifts must be used within a ShiftsProvider')
  return ctx
}
