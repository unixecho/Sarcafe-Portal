'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { EMPTY_DRAFT, draftChanges, pruneDraft, rosterWithDraft, validateSettings, withDraft, type DraftState, type EditableSettings, type MemberPatch } from '@/lib/shifts/draft'
import type { ScheduleStaffRow, ShiftSettings } from '@/lib/shifts/types'

// The settings draft: every control on the settings screen edits THIS, in the
// browser, and nothing is sent until Save. It lives above the tabs (so switching
// tabs cannot lose it) and in sessionStorage per branch (so a reload or an
// accidental navigation cannot either). The saved values come from the server as
// before; the draft is only ever what is different from them.

type DraftValue = {
  /** The saved settings with the draft on top — what every control shows. */
  settings: ShiftSettings
  /** The roster with each person's drafted flags on top. */
  roster: ScheduleStaffRow[]
  patch: (partial: Partial<EditableSettings>) => void
  patchMember: (staffId: string, patch: MemberPatch) => void
  dirty: boolean
  /** What is unsaved, in words ("שעות פעילות · 2 עובדים"). */
  labels: string[]
  restored: boolean
  saving: boolean
  error: string | null
  save: () => Promise<boolean>
  discard: () => void
}

const DraftContext = createContext<DraftValue | null>(null)
const storageKey = (branchId: string) => `sarcafe:settings-draft:v1:${branchId}`

function readStored(branchId: string): DraftState {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey(branchId)) ?? 'null') as Partial<DraftState> | null
    if (parsed && typeof parsed.settings === 'object' && parsed.settings && typeof parsed.members === 'object' && parsed.members) return { settings: parsed.settings, members: parsed.members }
  } catch {
    // Storage can be blocked or the entry corrupt; an empty draft is always a correct start.
  }
  return EMPTY_DRAFT
}

const isEmpty = (d: DraftState) => Object.keys(d.settings).length === 0 && Object.keys(d.members).length === 0

/** Mount only once the schedule has loaded (ScheduleWorkspace does). */
export function SettingsDraftProvider({ children }: { children: ReactNode }) {
  const { db, dispatch, refresh } = useShifts()
  const branchId = db!.branchId
  const [initial] = useState(() => readStored(branchId))
  const [draft, setDraft] = useState<DraftState>(initial)
  const [restored, setRestored] = useState(!isEmpty(initial))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remote = useMemo(() => ({ settings: db!.settings, roster: db!.roster }), [db])
  const remoteRef = useRef(remote)
  remoteRef.current = remote
  const draftRef = useRef(draft)
  draftRef.current = draft

  // Something saved elsewhere (or by this screen a moment ago) that now equals the draft is not a change any more.
  useEffect(() => {
    setDraft((d) => pruneDraft(remote, d))
  }, [remote])

  const changes = useMemo(() => draftChanges(remote, draft), [remote, draft])
  const dirty = changes.count > 0

  useEffect(() => {
    try {
      if (isEmpty(draft)) sessionStorage.removeItem(storageKey(branchId))
      else sessionStorage.setItem(storageKey(branchId), JSON.stringify(draft))
    } catch {
      // The draft still works for this visit without storage.
    }
  }, [draft, branchId])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const patch = useCallback((partial: Partial<EditableSettings>) => {
    setError(null)
    setDraft((d) => pruneDraft(remoteRef.current, { ...d, settings: { ...d.settings, ...partial } }))
  }, [])

  const patchMember = useCallback((staffId: string, memberPatch: MemberPatch) => {
    setError(null)
    setDraft((d) => pruneDraft(remoteRef.current, { ...d, members: { ...d.members, [staffId]: { ...d.members[staffId], ...memberPatch } } }))
  }, [])

  const save = useCallback(async () => {
    const snapshot = draftRef.current
    const c = draftChanges(remoteRef.current, snapshot)
    if (c.count === 0) return true
    const problem = validateSettings(withDraft(remoteRef.current.settings, snapshot))
    if (problem) {
      setError(problem)
      return false
    }
    setSaving(true)
    setError(null)
    const res = await dispatch(
      {
        type: 'saveDraft',
        branchId: remoteRef.current.settings.branchId,
        settings: Object.keys(c.settings).length ? c.settings : undefined,
        members: c.members.length ? c.members : undefined,
      },
      { quiet: true, success: 'ההגדרות נשמרו ✓ — העדכון חי עכשיו, כולל מה שהלקוחות רואים באתר.' }
    )
    setSaving(false)
    if (res.ok) {
      // Anything edited while the request was in flight stays a draft; the server's own reading has already replaced the saved values.
      setDraft((d) => (d === snapshot ? EMPTY_DRAFT : d))
      setRestored(false)
      return true
    }
    setError(res.message)
    // A part may have been applied before the refusal: show the truth, so only what really failed stays in the draft.
    void refresh()
    return false
  }, [dispatch, refresh])

  const discard = useCallback(() => {
    setDraft(EMPTY_DRAFT)
    setRestored(false)
    setError(null)
  }, [])

  const value = useMemo<DraftValue>(
    () => ({
      settings: withDraft(remote.settings, draft),
      roster: rosterWithDraft(remote.roster, draft),
      patch,
      patchMember,
      dirty,
      labels: changes.labels,
      restored,
      saving,
      error,
      save,
      discard,
    }),
    [remote, draft, patch, patchMember, dirty, changes.labels, restored, saving, error, save, discard]
  )

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>
}

/** For screens that may render before the schedule has loaded (and so before a draft exists). */
export function useSettingsDirty(): boolean {
  return useContext(DraftContext)?.dirty ?? false
}

export function useSettingsDraft(): DraftValue {
  const ctx = useContext(DraftContext)
  if (!ctx) throw new Error('useSettingsDraft must be used within a SettingsDraftProvider')
  return ctx
}

/** The one place a manager is told what is unsaved, on every tab, and where it is saved or put back. */
export function SettingsSaveBar() {
  const { dirty, labels, restored, saving, error, save, discard } = useSettingsDraft()
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  if (!dirty && !saving && !error) return null
  return (
    <>
      <div className="sch-savebar-spacer" aria-hidden="true" />
      <div className="sch-savebar" role="region" aria-label="שינויים שלא נשמרו">
        <div className="sch-savebar__text">
          <strong>{restored ? 'שוחזרו שינויים שלא נשמרו' : 'שינויים שלא נשמרו'}</strong>
          {labels.length > 0 && <span>{labels.join(' · ')}</span>}
          {error && (
            <span role="alert" className="sch-savebar__error">
              {error}
            </span>
          )}
        </div>
        <button
          type="button"
          className="sch-btn press"
          disabled={saving}
          onClick={() =>
            setConfirm({ title: 'לבטל את כל השינויים?', body: 'ההגדרות יחזרו למה שנשמר עד עכשיו.', confirmLabel: 'ביטול השינויים', cancelLabel: 'להמשיך לערוך', danger: true })
          }
        >
          ביטול
        </button>
        <button type="button" className="sch-btn sch-btn--primary press" disabled={saving} onClick={() => void save()}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </div>
      <ConfirmSheet
        request={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          discard()
        }}
      />
    </>
  )
}
