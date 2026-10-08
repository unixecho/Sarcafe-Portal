'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import SheetShell from '@/components/SheetShell'
import ScheduleToast, { type ToastState } from '@/components/shifts/ScheduleToast'
import { Avatar, EmptyState, Pill } from '@/components/shifts/ui'
import AddStaffSheet from '@/components/staff/AddStaffSheet'
import StaffEditSheet from '@/components/staff/StaffEditSheet'
import { messageOf, reasonOf, type BranchOption, type ScheduleMemberRow, type StaffRow } from '@/components/staff/types'
import { setCurrentBranchCookie } from '@/lib/branches/current'
import { badgeLabel } from '@/lib/staff/badges'
import { formatPhone, handleProblem } from '@/lib/pos/validate'
import { staffColourMap } from '@/lib/pos/colour'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import '@/components/owner/pos/menu-mods.css'
import '@/components/shifts/schedule.css'

type Filter = 'active' | 'inactive' | 'all'

// THE staff page: everyone who has ever worked here, easy to scan, one tap to
// change anything about a person. Four things a manager does here, none of which
// needs instructions:
//   add someone      (+ button — only a name is required)
//   find someone     (search, active / not active, branch)
//   change someone   (tap them — one sheet holds details, scheduling, POS access)
//   stop someone     (deactivate: keeps all history; or delete if they never did anything)
export default function StaffManager({
  branches,
  initialBranchSlug = '',
  currentStaffId = null,
}: {
  branches: BranchOption[]
  /** '' = all branches. Resolved server-side from the shared sarcafe_branch
   * cookie (lib/branches/current.ts) — staff is legitimately cross-branch,
   * so unlike the editor/dashboard an unset cookie means "show everyone,"
   * not "pick the first branch." */
  initialBranchSlug?: string
  /** The signed-in owner's own staff id, so the UI can refuse "deactivate myself" up front. */
  currentStaffId?: string | null
}) {
  const t = useT()
  const [staff, setStaff] = useState<StaffRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [scheduleMembers, setScheduleMembers] = useState<ScheduleMemberRow[]>([])
  const [filter, setFilter] = useState<Filter>('active')
  const [query, setQuery] = useState('')
  const [filterSlug, setFilterSlug] = useState<string>(initialBranchSlug)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const flash = (kind: ToastState['kind'], text: string) => setToast({ id: Date.now() + Math.random(), kind, text })

  // ---- POS access (nickname / employee number / quick code) — unchanged behaviour ----
  const [prompt, setPrompt] = useState<(PromptRequest & { staffId: string; kind: 'handle' | 'empNo' | 'passcode' }) | null>(null)
  const [confirmClear, setConfirmClear] = useState<(ConfirmRequest & { staffId: string }) | null>(null)
  const [quickBusy, setQuickBusy] = useState<string | null>(null)
  // The passcode exists in this state ONLY while its sheet is on screen (see closeCode).
  const [codeSheet, setCodeSheet] = useState<{ name: string; code: string } | null>(null)
  const [codeOpen, setCodeOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const codeTimer = useRef<number | null>(null)

  // The automatic colour for people who never picked one -- same round-robin the register uses.
  const colours = useMemo(() => staffColourMap((staff ?? []).map((r) => ({ id: r.id, handle: r.handle ?? '', colour: r.colour ?? null }))), [staff])

  async function load() {
    try {
      const res = await fetch('/api/owner/staff', { cache: 'no-store' })
      if (!res.ok) throw new Error('load')
      const payload = await res.json()
      setStaff(payload.staff)
      setScheduleMembers(payload.scheduleMembers ?? [])
      setLoadError(null)
    } catch {
      setLoadError('לא הצלחנו לטעון את הצוות. בדקו את החיבור ונסו שוב.')
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const filterBranchId = branches.find((b) => b.slug === filterSlug)?.id ?? null
  const visible = useMemo(() => {
    if (!staff) return null
    const q = query.trim().toLowerCase()
    return staff
      .filter((r) => (filter === 'all' ? true : filter === 'active' ? r.active : !r.active))
      // A branch filter shows that branch's people AND the all-branch people who also work there.
      .filter((r) => !filterBranchId || r.branch_id === null || r.branch_id === filterBranchId)
      .filter((r) => !q || [r.label, r.first_name, r.last_name, r.email, r.phone, r.handle].some((v) => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label, 'he'))
  }, [staff, filter, filterBranchId, query])

  const counts = useMemo(() => ({ active: (staff ?? []).filter((r) => r.active).length, inactive: (staff ?? []).filter((r) => !r.active).length }), [staff])
  const editing = staff?.find((r) => r.id === editingId) ?? null

  async function toggleSchedulable(row: StaffRow, targetBranchId: string, next: boolean) {
    try {
      const res = await fetch('/api/shifts/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'setMember', branchId: targetBranchId, staffId: row.id, patch: { schedulable: next } }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) return flash('error', messageOf(payload, 'לא הצלחנו לשמור. נסו שוב.'))
      setScheduleMembers((prev) => [...prev.filter((m) => !(m.branch_id === targetBranchId && m.staff_id === row.id)), { branch_id: targetBranchId, staff_id: row.id, schedulable: next }])
      flash('ok', next ? `${row.label} חזר/ה להיות זמין/ה לשיבוץ ✓` : `${row.label} לא יופיע/תופיע ברשימת השיבוץ ✓`)
    } catch {
      flash('error', 'בעיית חיבור. בדקו את הרשת ונסו שוב.')
    }
  }

  async function saveHandle(staffId: string, value: string) {
    const problem = handleProblem(value)
    if (problem) return flash('error', t(`owner.menu.staff.handleProblem.${problem}` as StrKey))
    try {
      const res = await fetch('/api/owner/staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: staffId, handle: value }) })
      if (!res.ok) {
        const reason = reasonOf(await res.json().catch(() => null))
        return flash('error', reason === 'taken' ? t('owner.menu.staff.handleTaken') : reason === 'invalid' ? t('owner.menu.staff.handleProblem.bad_chars') : t('owner.menu.staff.failed'))
      }
    } catch {
      return flash('error', t('owner.menu.staff.failed'))
    }
    flash('ok', 'הכינוי נשמר ✓')
    void load()
  }

  async function saveEmployeeNo(staffId: string, value: string) {
    const n = /^\d{1,5}$/.test(value.trim()) ? Number(value.trim()) : NaN
    if (!Number.isInteger(n) || n < 1 || n > 99999) return flash('error', t('owner.menu.staff.empNoInvalid'))
    try {
      const res = await fetch('/api/owner/staff/passcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId, employeeNo: n }) })
      if (!res.ok) {
        const reason = reasonOf(await res.json().catch(() => null))
        return flash('error', reason === 'taken' ? t('owner.menu.staff.empNoTaken') : reason === 'invalid' ? t('owner.menu.staff.empNoInvalid') : t('owner.menu.staff.failed'))
      }
    } catch {
      return flash('error', t('owner.menu.staff.failed'))
    }
    flash('ok', 'מספר העובד נשמר ✓')
    void load()
  }

  async function generateCode(row: StaffRow) {
    setQuickBusy(row.id)
    try {
      const res = await fetch('/api/owner/staff/passcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: row.id, action: 'generate' }) })
      const payload = (await res.json().catch(() => null)) as { passcode?: unknown } | null
      if (!res.ok || typeof payload?.passcode !== 'string') return flash('error', t('owner.menu.staff.failed'))
      // Shown once, then forgotten: it lives in this state only while the sheet is up.
      if (codeTimer.current) window.clearTimeout(codeTimer.current)
      setCopied(false)
      setCodeSheet({ name: row.label, code: payload.passcode })
      setCodeOpen(true)
      void load()
    } catch {
      flash('error', t('owner.menu.staff.failed'))
    } finally {
      setQuickBusy(null)
    }
  }

  async function setManualCode(staffId: string, value: string) {
    if (!/^\d{6}$/.test(value.trim())) return flash('error', 'הקוד חייב להכיל בדיוק 6 ספרות.')
    setQuickBusy(staffId)
    try {
      const res = await fetch('/api/owner/staff/passcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, action: 'set', passcode: value.trim() }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) return flash('error', messageOf(payload, 'לא הצלחנו לשמור את הקוד.'))
      flash('ok', 'קוד הכניסה נשמר ✓')
      void load()
    } catch {
      flash('error', 'בעיית חיבור. בדקו את הרשת ונסו שוב.')
    } finally {
      setQuickBusy(null)
    }
  }

  function closeCode() {
    setCodeOpen(false)
    // Keep the digits just long enough for the sheet's exit animation, then drop them.
    codeTimer.current = window.setTimeout(() => {
      setCodeSheet(null)
      setCopied(false)
    }, 400)
  }
  useEffect(
    () => () => {
      if (codeTimer.current) window.clearTimeout(codeTimer.current)
    },
    []
  )

  async function copyCode() {
    if (!codeSheet) return
    try {
      await navigator.clipboard.writeText(codeSheet.code)
      setCopied(true)
    } catch {
      /* no clipboard access: the code is still on screen to read out */
    }
  }

  async function clearCode(staffId: string) {
    setQuickBusy(staffId)
    try {
      const res = await fetch('/api/owner/staff/passcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId, action: 'clear' }) })
      if (!res.ok) flash('error', t('owner.menu.staff.failed'))
      else {
        flash('ok', 'קוד הכניסה בוטל ✓')
        void load()
      }
    } catch {
      flash('error', t('owner.menu.staff.failed'))
    } finally {
      setQuickBusy(null)
    }
  }

  return (
    <div className="sch-wrap" style={{ gap: 14 }}>
      <div className="sch-row" style={{ flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <h2 className="sch-h" style={{ fontSize: '1.05rem' }}>
            הצוות
          </h2>
          <p className="sch-sub">
            {staff ? `${counts.active} פעילים${counts.inactive > 0 ? ` · ${counts.inactive} לא פעילים` : ''}` : 'טוען…'}
          </p>
        </div>
        <button type="button" className="sch-btn sch-btn--primary press" onClick={() => setAdding(true)}>
          <Plus size={20} aria-hidden="true" /> הוספת איש/אשת צוות
        </button>
      </div>

      <label style={{ position: 'relative', display: 'block' }}>
        <span className="sr-only">חיפוש בצוות</span>
        <Search size={18} aria-hidden="true" style={{ position: 'absolute', insetInlineStart: 14, top: 17, color: 'var(--text-faint)' }} />
        <input className="sch-input" style={{ paddingInlineStart: 42 }} placeholder="חיפוש לפי שם, טלפון או אימייל" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <div className="sch-row" style={{ flexWrap: 'wrap' }}>
        <div className="sch-segment" role="group" aria-label="סינון לפי סטטוס">
          {(
            [
              ['active', 'פעילים'],
              ['inactive', 'לא פעילים'],
              ['all', 'הכול'],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} className="press" onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        {branches.length > 1 && (
          <div role="group" aria-label="סינון לפי סניף" className="sch-wrapflex">
            {[{ slug: '', name: { he: 'כל הסניפים' } }, ...branches].map((b) => (
              <button
                key={b.slug || 'all'}
                type="button"
                className="sch-chip press"
                aria-pressed={b.slug === filterSlug}
                onClick={() => {
                  setFilterSlug(b.slug)
                  if (b.slug) setCurrentBranchCookie(b.slug)
                }}
              >
                {b.name.he}
              </button>
            ))}
          </div>
        )}
      </div>

      {loadError && (
        <div className="sch-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="sch-btn sch-btn--sm press" onClick={() => void load()}>
            ניסיון נוסף
          </button>
        </div>
      )}

      {!visible ? (
        !loadError && <div className="sk" style={{ height: 140 }} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={query ? 'לא נמצא אף אחד בחיפוש הזה' : filter === 'inactive' ? 'אין אנשי צוות לא פעילים' : 'עוד אין אנשי צוות'}
          hint={query ? 'נסו שם אחר, או סינון אחר.' : filter === 'active' ? 'לחצו על "הוספת איש/אשת צוות" כדי להתחיל.' : undefined}
        />
      ) : (
        <div className="sch-staff">
          {visible.map((row) => {
            const branch = row.branch_id ? (branches.find((b) => b.id === row.branch_id)?.name.he ?? '') : branches.length > 1 ? 'כל הסניפים' : ''
            return (
              <button key={row.id} type="button" className={`sch-staffrow press${row.active ? '' : ' sch-staffrow--off'}`} onClick={() => setEditingId(row.id)} aria-label={`${row.label} — עריכה`}>
                <Avatar name={row.label} color={colours.get(row.id)} large />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontWeight: 800, fontSize: '1rem' }}>{row.label}</span>
                  <span className="sch-sub">{[row.role === 'owner' ? 'בעלים' : badgeLabel(row.badge) || 'צוות', branch].filter(Boolean).join(' · ')}</span>
                  {(row.phone || row.email) && (
                    <span className="sch-sub sch-faint" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {row.phone && <span dir="ltr">{formatPhone(row.phone)}</span>}
                      {row.email && <span dir="ltr">{row.email}</span>}
                    </span>
                  )}
                  <span className="sch-wrapflex">
                    {!row.active && <Pill tone="neutral">לא פעיל/ה</Pill>}
                    {row.active && !row.email && <Pill tone="neutral">ללא אימייל</Pill>}
                    {row.active && row.email && !row.has_google && <Pill tone="warn">עוד לא התחבר/ה</Pill>}
                    {row.active && row.has_google && !row.handle_set_at && <Pill tone="neutral">כינוי לקופה עוד לא אושר</Pill>}
                  </span>
                </span>
                <span aria-hidden="true" className="dir-flip sch-faint" style={{ fontSize: '1.3rem' }}>
                  ›
                </span>
              </button>
            )
          })}
        </div>
      )}

      <AddStaffSheet
        open={adding}
        onClose={() => setAdding(false)}
        branches={branches}
        defaultBranchId={filterBranchId ?? ''}
        onCreated={(label) => {
          setAdding(false)
          flash('ok', `${label} נוסף/ה לצוות ✓ אפשר לשבץ אותו/ה בלוח המשמרות עכשיו.`)
          setFilter('active')
          void load()
        }}
      />

      <StaffEditSheet
        row={editing}
        branches={branches}
        scheduleMembers={scheduleMembers}
        colour={editing ? (colours.get(editing.id) ?? '#888888') : '#888888'}
        isSelf={!!editing && editing.id === currentStaffId}
        quickBusy={!!editing && quickBusy === editing.id}
        onClose={() => setEditingId(null)}
        onChanged={(message) => {
          setEditingId(null)
          flash('ok', message)
          void load()
        }}
        onToggleSchedulable={toggleSchedulable}
        onEditHandle={(row) =>
          setPrompt({ staffId: row.id, kind: 'handle', title: t('owner.menu.staff.handleEditTitle'), label: t('owner.menu.staff.handle'), initialValue: row.handle ?? '', submitLabel: t('owner.menu.staff.save') })
        }
        onEditEmpNo={(row) =>
          setPrompt({ staffId: row.id, kind: 'empNo', title: t('owner.menu.staff.empNoTitle'), label: t('owner.menu.staff.empNoLabel'), initialValue: String(row.employee_no ?? ''), submitLabel: t('owner.menu.staff.save') })
        }
        onGenerateCode={generateCode}
        onSetCode={(row) => setPrompt({ staffId: row.id, kind: 'passcode', title: 'בחירת קוד כניסה', label: 'קוד בן 6 ספרות', initialValue: '', submitLabel: 'שמירת הקוד', inputMode: 'numeric', digitsOnly: true, exactLength: 6, validationMessage: 'הקוד חייב להכיל בדיוק 6 ספרות.' })}
        onClearCode={(row) =>
          setConfirmClear({ staffId: row.id, title: t('owner.menu.staff.clearTitle'), body: t('owner.menu.staff.clearBody', { name: row.handle || row.label }), confirmLabel: t('owner.menu.staff.clearConfirm'), danger: true })
        }
      />

      <PromptSheet
        request={prompt}
        onCancel={() => setPrompt(null)}
        onSubmit={(value) => {
          const current = prompt
          setPrompt(null)
          if (!current) return
          if (current.kind === 'handle') void saveHandle(current.staffId, value)
          else if (current.kind === 'empNo') void saveEmployeeNo(current.staffId, value)
          else void setManualCode(current.staffId, value)
        }}
      />

      <ConfirmSheet
        request={confirmClear}
        onCancel={() => setConfirmClear(null)}
        onConfirm={() => {
          const current = confirmClear
          setConfirmClear(null)
          if (current) void clearCode(current.staffId)
        }}
      />

      <SheetShell open={codeOpen} onClose={closeCode} labelledBy="staff-code-title">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 2px 8px' }}>
          <h2 id="staff-code-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
            {t('owner.menu.staff.codeTitle', { name: codeSheet?.name ?? '' })}
          </h2>
          <div className="mm-code ltr-isolate" dir="ltr" role="img" aria-label={t('owner.menu.staff.codeAria', { digits: (codeSheet?.code ?? '').split('').join(' ') })}>
            {codeSheet?.code}
          </div>
          <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--warn)', fontWeight: 600 }}>{t('owner.menu.staff.codeWarn')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="sch-btn press" style={{ flex: 1 }} onClick={copyCode}>
              {copied ? t('owner.menu.staff.codeCopied') : t('owner.menu.staff.codeCopy')}
            </button>
            <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 1 }} onClick={closeCode}>
              {t('owner.menu.staff.codeDone')}
            </button>
          </div>
          <span role="status" className="sr-only">
            {copied ? t('owner.menu.staff.codeCopied') : ''}
          </span>
        </div>
      </SheetShell>

      <ScheduleToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
