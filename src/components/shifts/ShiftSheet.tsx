'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, BellRing, Check, ChevronDown, Plus, Trash2, UserPlus, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import SelectSheet from '@/components/SelectSheet'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import { TimeWheel } from '@/components/WheelPicker'
import Switch from '@/components/Switch'
import { Avatar, InlineError, Notice, Pill } from '@/components/shifts/ui'
import StaffPickerSheet from '@/components/shifts/StaffPickerSheet'
import MoveShiftSheet from '@/components/shifts/MoveShiftSheet'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { defaultTimesFor, hoursFor, matchPreset } from '@/lib/shifts/presets'
import { clashesFor, nameOf, pendingRequestsByShift, swapPendingAssignmentIds } from '@/lib/shifts/view'
import { issuesOf } from '@/lib/shifts/messages'
import { coverageOf } from '@/lib/shifts/coverage'
import { staffColor, suggestedRoleId } from '@/lib/shifts/people'
import { durationMinutes, formatDayLabel, formatHours, formatShiftLabel, hasStarted, isValidShiftTimes, toMinutes, weekDates, weekdayLabel, weekStartOf } from '@/lib/shifts/time'
import type { RoleRequirement, Shift, ShiftsDB } from '@/lib/shifts/types'

type Person = { key: string; staffId: string; roleId: string | null; assignmentId?: string }
type Form = {
  date: string
  startTime: string
  endTime: string
  presetId: string | null
  stationId: string
  requirements: RoleRequirement[]
  requestsOpen: boolean
  note: string
  people: Person[]
}

function buildForm(db: ShiftsDB, shift: Shift | null, date: string): Form {
  if (shift) {
    return {
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      presetId: shift.presetId,
      stationId: shift.stationId ?? '',
      requirements: shift.requirements,
      requestsOpen: shift.requestsOpen,
      note: shift.note ?? '',
      people: db.assignments
        .filter((a) => a.shiftId === shift.id)
        .map((a) => ({ key: a.id, staffId: a.staffId ?? '', roleId: a.roleId, assignmentId: a.id })),
    }
  }
  // A NEW shift starts from what Settings says (the next unused template for that day,
  // else the template list's first, else the day's opening hours) — never from a number
  // typed into the code.
  const d = defaultTimesFor(date, db.settings, db.shifts.filter((s) => s.date === date))
  return { date, startTime: d.startTime, endTime: d.endTime, presetId: d.presetId, stationId: '', requirements: [], requestsOpen: false, note: '', people: [] }
}

// Create / edit ONE shift — the same sheet for both, and ONE Save: times, who
// works it, what it needs, all applied together or not at all (the database
// does it atomically). Nothing the manager taps here changes the schedule until
// they press שמירה, and closing with unsaved changes asks first.
export default function ShiftSheet({
  open,
  onClose,
  weekId,
  date,
  shiftId,
}: {
  open: boolean
  onClose: () => void
  weekId: string
  /** The day a NEW shift is being added to (ignored when editing). */
  date: string
  shiftId: string | null
}) {
  const { db, dispatch } = useShifts()
  const ids = useId()
  const titleId = `${ids}-title`

  const shift = db && shiftId ? (db.shifts.find((s) => s.id === shiftId) ?? null) : null
  const serverSig = shift && db ? `${shift.updatedAt}|${db.assignments.filter((a) => a.shiftId === shift.id).map((a) => a.id + a.roleId).join(',')}` : 'new'

  const [form, setForm] = useState<Form | null>(null)
  const initialRef = useRef<string>('')
  const [editing, setEditing] = useState<'start' | 'end' | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [moveFor, setMoveFor] = useState<{ assignmentId: string; staffId: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null)
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)
  const [prompt, setPrompt] = useState<(PromptRequest & { requestId: string }) | null>(null)
  const [busyRequest, setBusyRequest] = useState<string | null>(null)

  const dirty = form !== null && JSON.stringify(form) !== initialRef.current
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  // Seed on open …
  useEffect(() => {
    if (!open || !db) return
    const f = buildForm(db, shift, date)
    initialRef.current = JSON.stringify(f)
    setForm(f)
    setEditing(null)
    setMoreOpen(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shiftId, date])

  // … and adopt a newer server copy (someone approved a request, a swap went through)
  // only while the manager has not started changing anything — never clobber their edits.
  useEffect(() => {
    if (!open || !db || dirtyRef.current || form === null) return
    const f = buildForm(db, shift, date)
    initialRef.current = JSON.stringify(f)
    setForm(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSig])

  const week = db?.weeks.find((w) => w.id === weekId)
  const swapIds = useMemo(() => (db ? swapPendingAssignmentIds(db.swaps) : new Set<string>()), [db])

  if (!db || !form || !week) return null
  const settings = db.settings
  const weekStart = week.weekStart
  const roleById = new Map(settings.roles.map((r) => [r.id, r]))
  const hours = hoursFor(form.date, settings)
  const duration = isValidShiftTimes(form.startTime, form.endTime) ? formatHours(durationMinutes({ startTime: form.startTime, endTime: form.endTime })) : null
  const crossesMidnight = toMinutes(form.endTime) <= toMinutes(form.startTime)
  const outsideHours = isValidShiftTimes(form.startTime, form.endTime) && !crossesMidnight && toMinutes(hours.close) > toMinutes(hours.open) && (form.startTime < hours.open || form.endTime > hours.close)
  const matched = matchPreset(form, settings.presets)
  const requests = shift ? (pendingRequestsByShift(db.requests).get(shift.id) ?? []) : []
  const started = shift ? hasStarted(shift, db.now) : false
  const timesValid = isValidShiftTimes(form.startTime, form.endTime)

  // Who the manager can already see is double-booked (the database also checks the other branch).
  const clashes = new Map<string, Shift>()
  for (const p of form.people) {
    if (!p.staffId) continue
    const c = clashesFor(p.staffId, { date: form.date, startTime: form.startTime, endTime: form.endTime }, weekStartOf(form.date), db.shifts, db.assignments, shiftId)[0]
    if (c) clashes.set(p.key, c)
  }
  const coverage = coverageOf({ requirements: form.requirements }, form.people.map((p) => ({ roleId: p.roleId })))

  function patch(p: Partial<Form>) {
    setForm((f) => (f ? { ...f, ...p } : f))
    setError(null)
  }
  function setTime(edge: 'startTime' | 'endTime', value: string) {
    setForm((f) => {
      if (!f) return f
      const next = { ...f, [edge]: value }
      return { ...next, presetId: matchPreset(next, settings.presets)?.id ?? null }
    })
    setError(null)
  }
  function choosePreset(id: string) {
    const p = settings.presets.find((x) => x.id === id)
    if (!p) return
    setForm((f) => (f ? { ...f, startTime: p.startTime, endTime: p.endTime, presetId: p.id } : f))
    setEditing(null)
    setError(null)
  }
  function addPeople(staffIds: string[]) {
    setPickerOpen(false)
    setForm((f) => {
      if (!f) return f
      const assignedRoleIds = f.people.map((person) => person.roleId)
      const added: Person[] = []
      for (const id of staffIds.filter((staffId) => !f.people.some((person) => person.staffId === staffId))) {
        const row = db!.roster.find((candidate) => candidate.staffId === id)
        const preset = settings.presets.find((candidate) => candidate.id === f.presetId)
        const roleId = suggestedRoleId(row, settings.roles, preset, f.requirements, assignedRoleIds)
        added.push({ key: `new:${id}`, staffId: id, roleId })
        assignedRoleIds.push(roleId)
      }
      return { ...f, people: [...f.people, ...added] }
    })
    setError(null)
  }
  function setRole(key: string, roleId: string) {
    setForm((f) => (f ? { ...f, people: f.people.map((p) => (p.key === key ? { ...p, roleId: roleId || null } : p)) } : f))
  }
  function removePerson(key: string) {
    setForm((f) => (f ? { ...f, people: f.people.filter((p) => p.key !== key) } : f))
    setError(null)
  }
  function updateRequirement(roleId: string, min: number) {
    setForm((f) => {
      if (!f) return f
      const rest = f.requirements.filter((r) => r.roleId !== roleId)
      return { ...f, requirements: min <= 0 ? rest : [...rest, { roleId, min }] }
    })
  }

  function tryClose() {
    if (!dirty) return onClose()
    setConfirm({
      title: 'לצאת בלי לשמור?',
      body: 'השינויים שעשיתם במשמרת הזו לא יישמרו.',
      confirmLabel: 'יציאה בלי לשמור',
      cancelLabel: 'המשך עריכה',
      danger: true,
      onYes: onClose,
    })
  }

  async function save() {
    if (!form) return
    setError(null)
    if (!timesValid) return setError({ message: 'שעת הסיום חייבת להיות שונה משעת ההתחלה.', stale: false })
    if (clashes.size > 0) {
      const [key, c] = [...clashes.entries()][0]!
      const who = nameOf(db!, form.people.find((p) => p.key === key)?.staffId)
      return setError({ message: `${who} כבר משובץ/ת ב${formatShiftLabel(c.date, c.startTime, c.endTime)}. אי אפשר בשתי משמרות חופפות — הסירו אותו/ה או שנו את השעות.`, stale: false })
    }
    setSaving(true)
    const res = await dispatch(
      {
        type: 'saveShift',
        weekId,
        shiftId: shift?.id ?? null,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        presetId: form.presetId,
        stationId: form.stationId || null,
        requirements: form.requirements.filter((r) => r.min > 0),
        requestsOpen: form.requestsOpen,
        note: form.note.trim() || null,
        assignees: form.people.filter((p) => p.staffId).map((p) => ({ staffId: p.staffId, roleId: p.roleId, ...(p.assignmentId ? { assignmentId: p.assignmentId } : {}) })),
        expectedUpdatedAt: shift?.updatedAt ?? null,
      },
      {
        quiet: true,
        success: shift
          ? `המשמרת עודכנה · ${formatShiftLabel(form.date, form.startTime, form.endTime)}`
          : `המשמרת נוספה · ${formatShiftLabel(form.date, form.startTime, form.endTime)}`,
      }
    )
    setSaving(false)
    if (res.ok) {
      initialRef.current = JSON.stringify(form)
      onClose()
    } else {
      setError({ message: res.message, stale: res.reason === 'stale' })
    }
  }

  function askDelete() {
    if (!shift) return
    const names = form!.people.map((p) => nameOf(db!, p.staffId))
    const bits: string[] = []
    if (names.length) bits.push(`משובצים בה: ${names.join(', ')} — הם יוסרו ממנה.`)
    if (requests.length) bits.push('בקשות להצטרף למשמרת הזו יבוטלו.')
    if ([...swapIds].length && db!.assignments.some((a) => a.shiftId === shift.id && swapIds.has(a.id))) bits.push('בקשות החלפה שממתינות עליה יבוטלו.')
    setConfirm({
      title: `למחוק את המשמרת ${formatShiftLabel(shift.date, shift.startTime, shift.endTime)}?`,
      body: `${bits.join(' ')}${bits.length ? ' ' : ''}אי אפשר לבטל את המחיקה.`,
      confirmLabel: 'מחיקת המשמרת',
      danger: true,
      onYes: async () => {
        setSaving(true)
        const res = await dispatch({ type: 'deleteShift', shiftId: shift.id }, { quiet: true, success: 'המשמרת נמחקה' })
        setSaving(false)
        if (res.ok) {
          initialRef.current = JSON.stringify(form)
          onClose()
        } else setError({ message: res.message, stale: false })
      },
    })
  }

  async function decide(requestId: string, approve: boolean, note: string | null, force = false) {
    setBusyRequest(requestId)
    const req = requests.find((r) => r.id === requestId)
    const res = await dispatch(
      { type: 'decideRequest', requestId, approve, note, force },
      { quiet: true, success: approve ? `${req?.staffName ?? 'העובד/ת'} שובצ/ה למשמרת` : 'הבקשה נדחתה, והעובד/ת קיבל/ה הודעה' }
    )
    setBusyRequest(null)
    if (res.ok) return
    if (res.reason === 'needs_confirmation') {
      const issues = issuesOf(res.details)
      setConfirm({
        title: 'כדאי לבדוק לפני האישור',
        body: `${issues.map((i) => `• ${i.message}`).join('\n')}\n\nלאשר בכל זאת?`,
        confirmLabel: 'אישור בכל זאת',
        onYes: () => void decide(requestId, true, note, true),
      })
      return
    }
    setError({ message: res.message, stale: false })
  }

  const title = shift ? 'עריכת משמרת' : 'משמרת חדשה'

  return (
    <>
      <SheetShell open={open} onClose={tryClose} labelledBy={titleId} suspended={pickerOpen || !!moveFor || !!confirm || !!prompt} className="sch-sheet">
        <div className="sch-sheet__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} className="sch-sheet__title">
              {title}
            </h2>
            <p className="sch-sheet__sub">{formatDayLabel(form.date)}</p>
          </div>
          <button type="button" className="sch-iconbtn press" onClick={tryClose} aria-label="סגירה">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="sheet-scroll" style={{ gap: 18 }}>
          {started && shift && <Notice tone="warn">המשמרת הזו כבר התחילה או עברה. שינויים בה משפיעים על ההיסטוריה — ודאו שזה מה שרציתם.</Notice>}

          {/* ---- which day ---- */}
          <div className="sch-block">
            <span className="sch-label" style={{ margin: 0 }}>
              באיזה יום?
            </span>
            <div className="sch-wrapflex" role="group" aria-label="יום">
              {weekDates(weekStart).map((d, i) => (
                <button key={d} type="button" className="sch-chip press" aria-pressed={form.date === d} onClick={() => patch({ date: d })} aria-label={`יום ${weekdayLabel(i)} ${formatDayLabel(d)}`}>
                  {weekdayLabel(i)} <small className="ltr-isolate">{formatDayLabel(d).split(' ').pop()}</small>
                </button>
              ))}
            </div>
          </div>

          {/* ---- hours: templates first, then the exact times ---- */}
          <div className="sch-block">
            <span className="sch-label" style={{ margin: 0 }}>
              באילו שעות?
            </span>
            {settings.presets.length > 0 && (
              <div className="sch-wrapflex" role="group" aria-label="תבניות משמרת">
                {settings.presets.map((p) => (
                  <button key={p.id} type="button" className="sch-chip press" aria-pressed={matched?.id === p.id} onClick={() => choosePreset(p.id)}>
                    {p.name} <small className="ltr-isolate">{p.startTime}–{p.endTime}</small>
                  </button>
                ))}
                <button type="button" className="sch-chip press" aria-pressed={!matched} onClick={() => setEditing(editing ? null : 'start')}>
                  שעות אחרות
                </button>
              </div>
            )}
            <div className="sch-row" style={{ alignItems: 'stretch' }}>
              <button type="button" className="sch-timecell press" aria-expanded={editing === 'start'} onClick={() => setEditing(editing === 'start' ? null : 'start')} aria-label={`שעת התחלה ${form.startTime} — לחצו לשינוי`}>
                <small>התחלה</small>
                <strong>{form.startTime}</strong>
              </button>
              <span aria-hidden="true" style={{ alignSelf: 'center', color: 'var(--text-faint)' }}>
                ←
              </span>
              <button type="button" className="sch-timecell press" aria-expanded={editing === 'end'} onClick={() => setEditing(editing === 'end' ? null : 'end')} aria-label={`שעת סיום ${form.endTime} — לחצו לשינוי`}>
                <small>סיום</small>
                <strong>{form.endTime}</strong>
              </button>
            </div>
            {editing && (
              <div className="rise ltr-isolate" style={{ display: 'flex', justifyContent: 'center' }}>
                <TimeWheel
                  value={editing === 'start' ? form.startTime : form.endTime}
                  onChange={(v) => setTime(editing === 'start' ? 'startTime' : 'endTime', v)}
                  label={editing === 'start' ? 'שעת התחלה' : 'שעת סיום'}
                />
              </div>
            )}
            <p className="sch-sub">
              {duration ? `משך המשמרת: ${duration}${crossesMidnight ? ' (עוברת את חצות)' : ''}. ` : ''}
              {matched ? `זו תבנית "${matched.name}".` : 'שעות מותאמות אישית.'}{' '}
              <span className="sch-faint">
                שעות הפעילות ביום הזה: <span className="ltr-isolate">{hours.open}–{hours.close}</span>
              </span>
            </p>
            {outsideHours && <Notice tone="info">השעות חורגות משעות הפעילות ביום הזה. זה בסדר אם יש הכנה או סגירה — רק שימו לב.</Notice>}
            {!timesValid && <InlineError>שעת הסיום חייבת להיות שונה משעת ההתחלה.</InlineError>}
          </div>

          {/* ---- who works it ---- */}
          <div className="sch-block">
            <div className="sch-row">
              <span className="sch-label" style={{ margin: 0, flex: 1 }}>
                מי עובד/ת במשמרת?
                {coverage.needed > 0 && (
                  <span className="sch-faint" style={{ fontWeight: 600 }}>
                    {' '}
                    · דרושים {coverage.needed}, משובצים {coverage.assigned}
                  </span>
                )}
              </span>
            </div>

            {form.people.length === 0 && <p className="sch-sub">עוד אף אחד לא משובץ.</p>}
            {form.people.map((p) => {
              const name = nameOf(db, p.staffId, db.assignments.find((a) => a.id === p.assignmentId)?.staffName)
              const row = db.roster.find((r) => r.staffId === p.staffId)
              const clash = clashes.get(p.key)
              const inSwap = !!p.assignmentId && swapIds.has(p.assignmentId)
              return (
                <div key={p.key} className="sch-card" style={{ padding: 10, gap: 8, borderColor: clash ? 'var(--danger)' : undefined }}>
                  <div className="sch-row">
                    <Avatar
                      name={name}
                      color={staffColor(p.staffId, db.roster)}
                      emoji={db.roster.find((row) => row.staffId === p.staffId)?.avatarEmoji}
                      large
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{name}</div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 3 }}>
                        {row && !row.active && <Pill tone="danger">לא פעיל/ה</Pill>}
                        {inSwap && (
                          <Pill tone="swap" icon={<ArrowLeftRight size={13} aria-hidden="true" />}>
                            החלפה ממתינה
                          </Pill>
                        )}
                        {row && !row.hasLogin && <Pill tone="neutral">ללא כניסה לאפליקציה</Pill>}
                      </div>
                    </div>
                    <button type="button" className="sch-iconbtn press" onClick={() => removePerson(p.key)} aria-label={`הסרת ${name} מהמשמרת`} style={{ color: 'var(--danger)' }}>
                      <X size={18} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="sch-row" style={{ flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                      <SelectSheet
                        label={`תפקיד של ${name}`}
                        placeholder="ללא תפקיד"
                        value={p.roleId ?? ''}
                        options={settings.roles.map((r) => ({ value: r.id, label: r.name }))}
                        onChange={(v) => setRole(p.key, v)}
                        style={{ minHeight: 44, borderRadius: 12, border: '1px solid var(--line-interactive)', background: 'var(--bg)', color: 'var(--text)', padding: '0 12px', fontSize: '0.88rem', width: '100%' }}
                      />
                    </div>
                    {p.assignmentId && (
                      <button
                        type="button"
                        className="sch-btn sch-btn--sm press"
                        disabled={dirty}
                        title={dirty ? 'שמרו קודם את השינויים' : undefined}
                        onClick={() => setMoveFor({ assignmentId: p.assignmentId!, staffId: p.staffId })}
                      >
                        <ArrowLeftRight size={15} aria-hidden="true" /> העברה למשמרת אחרת
                      </button>
                    )}
                  </div>
                  {clash && <InlineError>{name} כבר משובץ/ת ב{formatShiftLabel(clash.date, clash.startTime, clash.endTime)} — חופף לשעות האלה.</InlineError>}
                </div>
              )
            })}
            <button type="button" className="sch-add sch-add--block press" onClick={() => setPickerOpen(true)}>
              <UserPlus size={17} aria-hidden="true" /> הוספת עובד/ת
            </button>
          </div>

          {/* ---- requests to join, decided right here ---- */}
          {requests.length > 0 && (
            <div className="sch-block">
              <span className="sch-label" style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                <BellRing size={15} aria-hidden="true" /> ביקשו להצטרף למשמרת הזו
              </span>
              {dirty && <p className="sch-sub">שמרו קודם את השינויים שעשיתם, ואז אפשר לאשר או לדחות בקשות.</p>}
              {requests.map((r) => (
                <div key={r.id} className="sch-card sch-card--attention" style={{ gap: 8 }}>
                  <div className="sch-row">
                    <Avatar name={nameOf(db, r.staffId, r.staffName)} large />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{nameOf(db, r.staffId, r.staffName)}</div>
                      {r.note && <div className="sch-sub">״{r.note}״</div>}
                    </div>
                  </div>
                  <div className="sch-row">
                    <button type="button" className="sch-btn sch-btn--ok sch-btn--sm press" style={{ flex: 1 }} disabled={dirty || busyRequest === r.id} onClick={() => decide(r.id, true, null)}>
                      <Check size={16} aria-hidden="true" /> אישור
                    </button>
                    <button
                      type="button"
                      className="sch-btn sch-btn--danger sch-btn--sm press"
                      style={{ flex: 1 }}
                      disabled={dirty || busyRequest === r.id}
                      onClick={() => setPrompt({ requestId: r.id, title: 'לדחות את הבקשה?', label: 'סיבה (אפשר להשאיר ריק)', submitLabel: 'דחיית הבקשה', allowEmpty: true })}
                    >
                      <X size={16} aria-hidden="true" /> דחייה
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ---- the less common things ---- */}
          <div className="sch-block">
            <button type="button" className="sch-btn sch-btn--ghost sch-btn--sm press" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)} style={{ justifyContent: 'space-between' }}>
              <span>עוד אפשרויות (עמדה, בקשות, צוות והערה)</span>
              <ChevronDown size={16} aria-hidden="true" style={{ transform: moreOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s var(--ease)' }} />
            </button>
            {moreOpen && (
              <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {settings.stations.length > 0 && (
                  <div>
                    <span className="sch-label">עמדה</span>
                    <SelectSheet
                      label="עמדה"
                      placeholder="ללא"
                      value={form.stationId}
                      options={settings.stations.map((s) => ({ value: s.id, label: `${s.emoji} ${s.name}` }))}
                      onChange={(v) => patch({ stationId: v })}
                      style={{ minHeight: 'var(--tap-min)', borderRadius: 12, border: '1px solid var(--line-interactive)', background: 'var(--bg)', color: 'var(--text)', padding: '0 14px', width: '100%' }}
                    />
                  </div>
                )}
                <button type="button" role="switch" aria-checked={form.requestsOpen} className="sch-switchrow press" onClick={() => patch({ requestsOpen: !form.requestsOpen })}>
                  <span style={{ flex: 1, minWidth: 0 }}><strong>פתיחת המשמרת לבקשות</strong><small>{form.requestsOpen ? 'עובדים יראו שאפשר לבקש את המשמרת.' : 'רק החלפה או מסירת משמרת קיימת אפשריות.'}</small></span>
                  <Switch on={form.requestsOpen} />
                </button>
                <div>
                  <span className="sch-label">כמה אנשים דרושים מכל תפקיד?</span>
                  <p className="sch-sub" style={{ marginBottom: 8 }}>
                    אם תגדירו, הלוח יסמן &quot;חסר/ה&quot; כשאין מספיק אנשים. בקשות הצטרפות יופיעו רק אם פתחתם אותן במתג למעלה.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {settings.roles.map((role) => {
                      const req = form.requirements.find((r) => r.roleId === role.id)
                      const min = req?.min ?? 0
                      return (
                        <div key={role.id} className="sch-row">
                          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: role.color }} />
                          <span style={{ flex: 1, fontSize: '0.92rem', fontWeight: 600 }}>{role.name}</span>
                          <button type="button" className="sch-iconbtn press" onClick={() => updateRequirement(role.id, Math.max(0, min - 1))} aria-label={`פחות ${role.name}`} disabled={min === 0}>
                            −
                          </button>
                          <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{min}</span>
                          <button type="button" className="sch-iconbtn press" onClick={() => updateRequirement(role.id, min + 1)} aria-label={`עוד ${role.name}`}>
                            <Plus size={18} aria-hidden="true" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <label>
                  <span className="sch-label">הערה למשמרת</span>
                  <input className="sch-input" value={form.note} maxLength={300} onChange={(e) => patch({ note: e.target.value })} placeholder="למשל: משלוח בבוקר" />
                </label>
              </div>
            )}
          </div>

          {error && (
            <div>
              <InlineError>{error.message}</InlineError>
              {error.stale && (
                <button
                  type="button"
                  className="sch-btn sch-btn--sm press"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    const f = buildForm(db, shift, date)
                    initialRef.current = JSON.stringify(f)
                    setForm(f)
                    setError(null)
                  }}
                >
                  טעינה מחדש של המשמרת
                </button>
              )}
            </div>
          )}
        </div>

        <div className="sch-sheet__foot">
          {shift && (
            <button type="button" className="sch-btn sch-btn--danger press" disabled={saving} onClick={askDelete} aria-label="מחיקת המשמרת">
              <Trash2 size={18} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 1 }} disabled={saving || !timesValid || (!!shift && !dirty)} onClick={save}>
            {saving ? 'שומר…' : shift ? (dirty ? 'שמירת השינויים' : 'אין שינויים לשמור') : 'הוספת המשמרת'}
          </button>
        </div>
      </SheetShell>

      <StaffPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        target={{ date: form.date, startTime: form.startTime, endTime: form.endTime, shiftId }}
        excludeStaffIds={form.people.map((p) => p.staffId)}
        onAdd={addPeople}
      />

      {shift && moveFor && (
        <MoveShiftSheet
          open
          onClose={() => setMoveFor(null)}
          assignmentId={moveFor.assignmentId}
          staffId={moveFor.staffId}
          fromShift={shift}
          onMoved={() => {
            setMoveFor(null)
            onClose()
          }}
        />
      )}

      <ConfirmSheet
        request={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          c?.onYes()
        }}
      />
      <PromptSheet
        request={prompt}
        onCancel={() => setPrompt(null)}
        onSubmit={(value) => {
          const p = prompt
          setPrompt(null)
          if (p) void decide(p.requestId, false, value || null)
        }}
      />
    </>
  )
}
