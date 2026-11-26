'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Check, CheckCircle2, Clock, PartyPopper, Plus, Send, SkipForward, UserMinus, UserPlus, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { TimeWheel } from '@/components/WheelPicker'
import { Avatar, InlineError, Notice, Pill } from '@/components/shifts/ui'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { hoursFor } from '@/lib/shifts/presets'
import { clashesFor, nameOf, pendingRequestsByShift } from '@/lib/shifts/view'
import { staffColor, suggestedRoleId } from '@/lib/shifts/people'
import { avoidText, fitFor } from '@/lib/shifts/time-off'
import { formatDayLabel, formatShiftLabel, hasStarted, isValidShiftTimes, parseISODate, weekDates, weekStartOf, weekdayLongLabel } from '@/lib/shifts/time'
import {
  addCustomShift,
  addSeat,
  alsoToday,
  changedShifts,
  clearSeat,
  draftBlock,
  draftShiftIds,
  emptySteps,
  nextStep,
  placePerson,
  seedDay,
  stepId,
  type FillShift,
  type FillStep,
} from '@/lib/shifts/day-fill'
import { reachOf, reachText } from '@/lib/shifts/reach'
import type { ShiftsDB } from '@/lib/shifts/types'

// "שיבוץ היום" — the guided way to fill a day, for someone who just wants to put names on shifts.
// Open a day → the first empty shift is already selected and the sheet asks "who works here?" →
// one tap on a name puts that person there and the next empty shift is selected → when every shift
// has someone, a summary of the day and ONE button: אישור, which saves the day and opens the next one.
// Nothing is written before אישור (the owner's rule: one Save, never autosave), and closing with picks
// that were not saved asks first. The model is lib/shifts/day-fill.ts.

type Phase = 'pick' | 'summary' | 'custom' | 'done'

const LABEL_IDEAS = ['הכנות', 'תגבור', 'סגירה', 'חצי משמרת', 'הדרכה']

const dowOf = (date: string) => parseISODate(date).getUTCDay()
const shiftName = (s: FillShift) => s.name || 'משמרת'

/** The next day of the week worth filling: open per Settings, or already has shifts. */
function nextDayOf(db: ShiftsDB, date: string): string | null {
  const dates = weekDates(weekStartOf(date))
  for (const d of dates.slice(dates.indexOf(date) + 1)) {
    if (db.settings.workingDays.includes(dowOf(d)) || db.shifts.some((s) => s.date === d)) return d
  }
  return null
}

export default function DayFillSheet({
  open,
  onClose,
  weekId,
  date: startDate,
  canPublish,
  onPublish,
}: {
  open: boolean
  onClose: () => void
  weekId: string
  /** The day the owner tapped. */
  date: string
  /** The week has something the team does not see yet. */
  canPublish: boolean
  onPublish: () => void
}) {
  const { db, dispatch, toast } = useShifts()
  const ids = useId()
  const titleId = `${ids}-title`
  const dbRef = useRef(db)
  dbRef.current = db

  const [date, setDate] = useState(startDate)
  const [draft, setDraft] = useState<FillShift[]>([])
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [step, setStep] = useState<FillStep | null>(null)
  const [history, setHistory] = useState<FillStep[]>([])
  const [phase, setPhase] = useState<Phase>('pick')
  const [placed, setPlaced] = useState<{ who: string; what: string; hours: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)
  const [savedDays, setSavedDays] = useState(0)
  const customN = useRef(0)
  const [custom, setCustom] = useState<{ start: string; end: string; label: string; editing: 'start' | 'end' | null }>({ start: '08:00', end: '12:00', label: '', editing: null })
  const scrollRef = useRef<HTMLDivElement>(null)

  function openDay(d: string, source: ShiftsDB) {
    const seeded = seedDay({ date: d, settings: source.settings, shifts: source.shifts, assignments: source.assignments, started: (s) => hasStarted(s, source.now) })
    const first = nextStep(seeded, new Set())
    setDate(d)
    setDraft(seeded)
    setSkipped(new Set())
    setHistory([])
    setStep(first)
    setPhase(first ? 'pick' : 'summary')
    setPlaced(null)
    setError(null)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  useEffect(() => {
    if (!open || !dbRef.current) return
    setSavedDays(0)
    openDay(startDate, dbRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startDate])

  const draftIds = useMemo(() => draftShiftIds(draft), [draft])

  if (!db) return null
  const settings = db.settings
  const dirty = changedShifts(draft).length > 0
  const dow = dowOf(date)
  const isWorkingDay = settings.workingDays.includes(dow)
  const nextDay = nextDayOf(db, date)
  const dayWord = weekdayLongLabel(dow)
  const target = step ? draft.find((s) => s.key === step.key) ?? null : null
  const openSeats = draft.filter((s) => !s.locked).reduce((n, s) => n + s.seats, 0)
  const filledSeats = draft.filter((s) => !s.locked).reduce((n, s) => n + Math.min(s.people.length, s.seats), 0)

  // ---- moving between seats ----------------------------------------------------------------
  function goTo(next: FillStep | null, from: FillStep | null = step) {
    if (from) setHistory((h) => [...h, from])
    setStep(next)
    setPhase(next ? 'pick' : 'summary')
    scrollRef.current?.scrollTo({ top: 0 })
  }

  function pick(staffId: string) {
    if (!step || !target) return
    const row = db!.roster.find((r) => r.staffId === staffId)
    const preset = target.presetId ? settings.presets.find((p) => p.id === target.presetId) : undefined
    const roleId = suggestedRoleId(row, settings.roles, preset, target.requirements, target.people.map((p) => p.roleId))
    const next = placePerson(draft, step.key, step.seat, { staffId, roleId })
    setDraft(next)
    setError(null)
    setPlaced({ who: nameOf(db!, staffId), what: shiftName(target), hours: `${target.startTime}–${target.endTime}` })
    const after = new Set(skipped)
    after.delete(stepId(step))
    setSkipped(after)
    goTo(nextStep(next, after))
  }

  function skip() {
    if (!step) return
    const after = new Set(skipped).add(stepId(step))
    setSkipped(after)
    setPlaced(null)
    goTo(nextStep(draft, after))
  }

  function removeFromSeat() {
    if (!step || !target?.people[step.seat]) return
    const next = clearSeat(draft, step.key, step.seat)
    setDraft(next)
    setPlaced(null)
    const after = new Set(skipped).add(stepId({ key: step.key, seat: next.find((s) => s.key === step.key)!.people.length }))
    setSkipped(after)
    goTo(nextStep(next, after))
  }

  function back() {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    setStep(prev)
    setPhase('pick')
    setPlaced(null)
  }

  function editSeat(key: string, seat: number) {
    setPlaced(null)
    goTo({ key, seat }, null)
  }

  function chooseShift(s: FillShift) {
    if (s.locked) return
    const empty = emptySteps(draft).find((st) => st.key === s.key)
    setPlaced(null)
    goTo(empty ?? { key: s.key, seat: 0 }, step)
  }

  function moreSeat(key: string) {
    const next = addSeat(draft, key)
    setDraft(next)
    const s = next.find((x) => x.key === key)!
    setPlaced(null)
    goTo({ key, seat: s.people.length }, null)
  }

  function startCustom() {
    const h = hoursFor(date, settings)
    setCustom({ start: h.open, end: h.close, label: '', editing: null })
    setPhase('custom')
    scrollRef.current?.scrollTo({ top: 0 })
  }

  function confirmCustom() {
    if (!isValidShiftTimes(custom.start, custom.end)) return
    customN.current += 1
    const { day, key } = addCustomShift(draft, date, custom.start, custom.end, custom.label, customN.current)
    setDraft(day)
    setPlaced(null)
    goTo({ key, seat: 0 }, null)
  }

  // ---- saving the day ----------------------------------------------------------------------
  async function saveDay(then: 'next' | 'finish') {
    const toSave = changedShifts(draft)
    setSaving(true)
    setError(null)
    const failed: FillShift[] = []
    let firstError: string | null = null
    let people = 0
    for (const s of toSave) {
      const res = await dispatch(
        {
          type: 'saveShift',
          weekId,
          shiftId: s.shiftId,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          presetId: s.presetId,
          stationId: s.stationId,
          requirements: s.requirements.filter((r) => r.min > 0),
          requestsOpen: s.requestsOpen,
          note: s.note,
          assignees: s.people.map((p) => ({ staffId: p.staffId, roleId: p.roleId, ...(p.assignmentId ? { assignmentId: p.assignmentId } : {}) })),
          expectedUpdatedAt: s.updatedAt,
        },
        { quiet: true }
      )
      if (res.ok) people += s.people.length
      else {
        failed.push(s)
        firstError ??= `${shiftName(s)} ${s.startTime}–${s.endTime}: ${res.message}`
      }
    }
    setSaving(false)
    const latest = dbRef.current ?? db!
    if (failed.length > 0) {
      // What was saved is now on the board; what failed stays in the sheet as the owner left it.
      const fresh = seedDay({ date, settings: latest.settings, shifts: latest.shifts, assignments: latest.assignments, started: (s) => hasStarted(s, latest.now) })
      const failedKeys = new Set(failed.map((f) => f.key))
      const merged = [...fresh.filter((f) => !failedKeys.has(f.key)), ...failed]
      setDraft(merged.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime)))
      setPhase('summary')
      setStep(null)
      setError(`${failed.length === 1 ? 'משמרת אחת לא נשמרה' : `${failed.length} משמרות לא נשמרו`} — ${firstError}`)
      return
    }
    if (toSave.length > 0) {
      toast('ok', `${dayWord} נשמר ✓ ${people === 1 ? 'עובד/ת אחד/ת שובצ/ה' : `${people} שיבוצים`}`)
      setSavedDays((n) => n + 1)
    }
    const nd = nextDayOf(latest, date)
    if (then === 'next' && nd) openDay(nd, latest)
    else setPhase('done')
  }

  function tryClose() {
    if (!dirty || phase === 'done') return onClose()
    setConfirm({
      title: 'לצאת בלי לשמור את היום?',
      body: `השיבוצים שבחרתם ל${dayWord} עוד לא נשמרו. כדי לשמור, לחצו "אישור" בסיכום היום.`,
      confirmLabel: 'יציאה בלי לשמור',
      cancelLabel: 'חזרה לשיבוץ',
      danger: true,
      onYes: onClose,
    })
  }

  // ---- who can sit on the current seat -------------------------------------------------------
  const rows = (() => {
    if (!step || !target) return []
    const ws = weekStartOf(target.date)
    const outside = db.assignments.filter((a) => !draftIds.has(a.shiftId))
    const requested = new Set((target.shiftId ? (pendingRequestsByShift(db.requests).get(target.shiftId) ?? []) : []).map((r) => r.staffId))
    const availability = db.availability.filter((a) => a.weekStart === ws && a.status === 'submitted')
    const sitting = target.people[step.seat]?.staffId
    return db.roster
      .filter((r) => r.active && r.schedulable)
      .map((r) => {
        const clash = clashesFor(r.staffId, target, ws, db.shifts, outside, target.shiftId)[0]
        const block = draftBlock(draft, target.key, step.seat, r.staffId)
        const fit = fitFor(db.timeOff, r.staffId, target)
        const entry = availability.find((a) => a.staffId === r.staffId)?.entries.find((e) => e.date === target.date)
        const also = block ? [] : alsoToday(draft, target.key, r.staffId)
        const blocked = !!clash || !!block || fit.kind === 'day_off'
        return { row: r, clash, block, fit, also, blocked, current: sitting === r.staffId, requested: requested.has(r.staffId), unavailable: entry?.kind === 'unavailable', prefers: entry?.kind === 'prefer' }
      })
      .sort((a, b) => {
        const rank = (x: typeof a) => (x.current ? -1 : x.blocked ? 5 : x.fit.kind === 'day_off_pending' || x.fit.kind === 'avoids' || x.unavailable ? 3 : x.also.length ? 2 : x.requested || x.prefers ? 0 : 1)
        return rank(a) - rank(b) || a.row.displayName.localeCompare(b.row.displayName, 'he')
      })
  })()

  // ---- pieces ------------------------------------------------------------------------------
  const dayStrip = (
    <div className="dfs-strip" role="list" aria-label={`המשמרות של ${dayWord}`}>
      {draft.map((s) => {
        const full = s.people.length >= s.seats
        const isCurrent = phase === 'pick' && step?.key === s.key
        return (
          <button
            key={s.key}
            type="button"
            role="listitem"
            className={`dfs-strip__item press${isCurrent ? ' is-current' : ''}${full ? ' is-full' : ''}`}
            disabled={s.locked}
            aria-current={isCurrent ? 'step' : undefined}
            onClick={() => chooseShift(s)}
            aria-label={`${shiftName(s)} ${s.startTime}–${s.endTime}: ${s.people.length ? s.people.map((p) => nameOf(db, p.staffId)).join(', ') : 'ריק'}${s.locked ? ' (כבר התחילה)' : ''}`}
          >
            <span className="dfs-strip__time ltr-isolate">{s.startTime}–{s.endTime}</span>
            <span className="dfs-strip__name">{shiftName(s)}</span>
            <span className="dfs-strip__who">
              {full ? <Check size={13} aria-hidden="true" /> : null}
              {s.people.length ? s.people.map((p) => nameOf(db, p.staffId)).join(', ') : 'עוד ריק'}
            </span>
          </button>
        )
      })}
    </div>
  )

  const progress = (
    <div className="dfs-progress" aria-live="polite">
      <div className="dfs-progress__bar" aria-hidden="true">
        <span style={{ width: `${openSeats ? Math.round((filledSeats / openSeats) * 100) : 100}%` }} />
      </div>
      <span className="sch-sub">
        {openSeats === 0 ? 'אין משמרות לשבץ ביום הזה' : `${filledSeats} מתוך ${openSeats} מקומות מאוישים`}
      </span>
    </div>
  )

  let body: ReactNode = null
  let foot: ReactNode = null

  if (phase === 'pick' && step && target) {
    const sitting = target.people[step.seat]
    body = (
      <>
        {placed && (
          <p className="dfs-placed" role="status">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>
              {placed.who} ב{placed.what} <span className="ltr-isolate">{placed.hours}</span>
            </span>
          </p>
        )}
        <div className="dfs-ask">
          <span className="dfs-ask__shift">
            <Clock size={16} aria-hidden="true" /> {shiftName(target)} · <span className="ltr-isolate">{target.startTime}–{target.endTime}</span>
          </span>
          {target.note && target.note !== target.name && <span className="dfs-ask__note">{target.note}</span>}
          <h3 className="dfs-ask__q">{sitting ? 'מי במקום?' : 'מי עובד/ת במשמרת הזו?'}</h3>
          <p className="sch-sub">
            {target.seats > 1 ? `עובד/ת ${step.seat + 1} מתוך ${target.seats} במשמרת הזו. ` : ''}
            {sitting ? `כרגע: ${nameOf(db, sitting.staffId)}. לחצו על שם אחר כדי להחליף.` : 'לחצו על השם — וממשיכים לבד למשמרת הבאה.'}
          </p>
        </div>
        <div className="dfs-people" role="group" aria-label="בחירת עובד/ת">
          {rows.length === 0 && <p className="sch-sub" style={{ textAlign: 'center', padding: '16px 0' }}>אין אנשי צוות פעילים לשיבוץ. אפשר להוסיף אותם בלשונית הצוות.</p>}
          {rows.map(({ row, clash, block, fit, also, blocked, current, requested, unavailable, prefers }) => (
            <button
              key={row.staffId}
              type="button"
              className={`sch-pick dfs-person press${fit.kind === 'avoids' || fit.kind === 'day_off_pending' || unavailable ? ' sch-pick--avoid' : ''}`}
              aria-pressed={current}
              disabled={blocked}
              onClick={() => pick(row.staffId)}
            >
              <Avatar name={row.displayName} color={staffColor(row.staffId, db.roster)} emoji={row.avatarEmoji} large />
              <span className="sch-pick__main">
                <span className="sch-pick__name">{row.displayName}</span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {current && <Pill tone="ok">כבר כאן</Pill>}
                  {requested && <Pill tone="info">ביקש/ה את המשמרת</Pill>}
                  {prefers && <Pill tone="ok">מעדיף/ה את היום הזה</Pill>}
                  {also.length > 0 && <Pill tone="neutral">עובד/ת היום גם ב{shiftName(also[0]!)} <span className="ltr-isolate">{also[0]!.startTime}–{also[0]!.endTime}</span></Pill>}
                  {unavailable && <Pill tone="warn">סימן/ה שלא זמין/ה</Pill>}
                  {fit.kind === 'day_off_pending' && <Pill tone="warn">ביקש/ה יום חופש</Pill>}
                  {fit.kind === 'avoids' && <Pill tone="warn">ביקש/ה {avoidText(fit.avoids)}</Pill>}
                  {reachText(reachOf(row)) && <Pill tone="danger">לא יקבל/ת הודעה · {reachText(reachOf(row))}</Pill>}
                </span>
                {blocked && (
                  <span className="sch-pick__hint" style={{ color: 'var(--danger)' }}>
                    {block?.kind === 'same_shift'
                      ? 'כבר במשמרת הזו'
                      : block?.kind === 'overlap_today'
                        ? `כבר בחרתם אותו/ה ל${shiftName(block.with)} ${block.with.startTime}–${block.with.endTime} — השעות חופפות`
                        : fit.kind === 'day_off'
                          ? 'ביום חופש מאושר'
                          : clash
                            ? `כבר עובד/ת ב${formatShiftLabel(clash.date, clash.startTime, clash.endTime)}`
                            : ''}
                  </span>
                )}
              </span>
              <span className="dfs-person__go" aria-hidden="true">
                {current ? <Check size={18} /> : <Plus size={18} />}
              </span>
            </button>
          ))}
        </div>
      </>
    )
    foot = (
      <>
        <button type="button" className="sch-btn press" onClick={back} disabled={history.length === 0} aria-label="חזרה לשלב הקודם">
          <ArrowRight size={18} aria-hidden="true" /> חזרה
        </button>
        {sitting ? (
          <button type="button" className="sch-btn sch-btn--danger press" style={{ flex: 1 }} onClick={removeFromSeat}>
            <UserMinus size={18} aria-hidden="true" /> להוריד את {nameOf(db, sitting.staffId)}
          </button>
        ) : (
          <button type="button" className="sch-btn press" style={{ flex: 1 }} onClick={skip}>
            <SkipForward size={18} aria-hidden="true" /> לדלג — להשאיר ריק
          </button>
        )}
        <button type="button" className="sch-btn press" onClick={() => goTo(null)}>
          לסיכום
        </button>
      </>
    )
  } else if (phase === 'custom') {
    const valid = isValidShiftTimes(custom.start, custom.end)
    body = (
      <div className="sch-col" style={{ gap: 16 }}>
        <div className="dfs-ask">
          <h3 className="dfs-ask__q">עובד/ת בשעות אחרות</h3>
          <p className="sch-sub">למשל מישהו שמגיע רק לשעתיים של הכנות. בחרו שעות, תנו תווית — ואז את העובד/ת.</p>
        </div>
        <div className="sch-row" style={{ alignItems: 'stretch' }}>
          <button type="button" className="sch-timecell press" aria-expanded={custom.editing === 'start'} onClick={() => setCustom((c) => ({ ...c, editing: c.editing === 'start' ? null : 'start' }))} aria-label={`שעת התחלה ${custom.start} — לחצו לשינוי`}>
            <small>מתחיל/ה</small>
            <strong>{custom.start}</strong>
          </button>
          <span aria-hidden="true" style={{ alignSelf: 'center', color: 'var(--text-faint)' }}>←</span>
          <button type="button" className="sch-timecell press" aria-expanded={custom.editing === 'end'} onClick={() => setCustom((c) => ({ ...c, editing: c.editing === 'end' ? null : 'end' }))} aria-label={`שעת סיום ${custom.end} — לחצו לשינוי`}>
            <small>מסיים/ת</small>
            <strong>{custom.end}</strong>
          </button>
        </div>
        {custom.editing && (
          <div className="rise ltr-isolate" style={{ display: 'flex', justifyContent: 'center' }}>
            <TimeWheel
              value={custom.editing === 'start' ? custom.start : custom.end}
              onChange={(v) => setCustom((c) => (c.editing === 'start' ? { ...c, start: v } : { ...c, end: v }))}
              label={custom.editing === 'start' ? 'שעת התחלה' : 'שעת סיום'}
            />
          </div>
        )}
        {!valid && <InlineError>שעת הסיום חייבת להיות שונה משעת ההתחלה.</InlineError>}
        <label>
          <span className="sch-label">תווית (תופיע בסידור העבודה ליד השעות)</span>
          <input className="sch-input" value={custom.label} maxLength={60} onChange={(e) => setCustom((c) => ({ ...c, label: e.target.value }))} placeholder="למשל: הכנות" />
        </label>
        <div className="sch-wrapflex" role="group" aria-label="תוויות מוכנות">
          {LABEL_IDEAS.map((l) => (
            <button key={l} type="button" className="sch-chip press" aria-pressed={custom.label === l} onClick={() => setCustom((c) => ({ ...c, label: l }))}>
              {l}
            </button>
          ))}
        </div>
      </div>
    )
    foot = (
      <>
        <button type="button" className="sch-btn press" onClick={() => setPhase(step ? 'pick' : 'summary')}>
          ביטול
        </button>
        <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 1 }} disabled={!valid} onClick={confirmCustom}>
          <UserPlus size={18} aria-hidden="true" /> המשך — בחירת עובד/ת
        </button>
      </>
    )
  } else if (phase === 'summary') {
    const empty = emptySteps(draft).length
    body = (
      <>
        {placed && (
          <p className="dfs-placed" role="status">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>
              {placed.who} ב{placed.what} <span className="ltr-isolate">{placed.hours}</span>
            </span>
          </p>
        )}
        <div className="dfs-ask">
          <h3 className="dfs-ask__q">{draft.length === 0 ? `אין משמרות ב${dayWord}` : empty === 0 ? `${dayWord} מלא ✓` : `סיכום ${dayWord}`}</h3>
          <p className="sch-sub">
            {draft.length === 0
              ? 'אפשר להוסיף עובד/ת בשעות שתבחרו.'
              : empty === 0
                ? 'בדקו שהכול נכון ולחצו "אישור".'
                : `${empty === 1 ? 'נשאר מקום אחד ריק' : `נשארו ${empty} מקומות ריקים`}. אפשר למלא עכשיו או לאשר ככה.`}
          </p>
        </div>
        {!isWorkingDay && <Notice tone="info">לפי ההגדרות העסק סגור ב{dayWord}. אם בכל זאת עובדים — משבצים כרגיל.</Notice>}
        <div className="sch-col" style={{ gap: 10 }}>
          {draft.map((s) => (
            <div key={s.key} className={`sch-card dfs-sum${s.people.length >= s.seats ? ' dfs-sum--full' : ''}`}>
              <div className="sch-row">
                <strong className="ltr-isolate">{s.startTime}–{s.endTime}</strong>
                <span className="dfs-sum__name">{shiftName(s)}</span>
                {s.note && s.note !== s.name && <span className="sch-sub">· {s.note}</span>}
                {s.locked && <Pill tone="neutral">כבר התחילה</Pill>}
              </div>
              {Array.from({ length: s.seats }, (_, seat) => {
                const p = s.people[seat]
                return p ? (
                  <button key={seat} type="button" className="dfs-seat press" disabled={s.locked} onClick={() => editSeat(s.key, seat)} aria-label={`${nameOf(db, p.staffId)} — לחצו להחלפה`}>
                    <Avatar name={nameOf(db, p.staffId)} color={staffColor(p.staffId, db.roster)} emoji={db.roster.find((r) => r.staffId === p.staffId)?.avatarEmoji} />
                    <span style={{ flex: 1, fontWeight: 700 }}>{nameOf(db, p.staffId)}</span>
                    {!s.locked && <span className="sch-sub">החלפה</span>}
                  </button>
                ) : (
                  <button key={seat} type="button" className="dfs-seat dfs-seat--empty press" disabled={s.locked} onClick={() => editSeat(s.key, seat)}>
                    <UserPlus size={18} aria-hidden="true" />
                    <span style={{ flex: 1, fontWeight: 700 }}>ריק — לחצו כדי לבחור עובד/ת</span>
                  </button>
                )
              })}
              {!s.locked && s.people.length >= s.seats && (
                <button type="button" className="sch-note" style={{ alignSelf: 'flex-start' }} onClick={() => moreSeat(s.key)}>
                  + עוד עובד/ת למשמרת הזו
                </button>
              )}
            </div>
          ))}
          <button type="button" className="sch-add sch-add--block press" onClick={startCustom}>
            <Clock size={17} aria-hidden="true" /> עובד/ת בשעות אחרות (עם תווית)
          </button>
        </div>
        {error && <InlineError>{error}</InlineError>}
      </>
    )
    const nextWord = nextDay ? weekdayLongLabel(dowOf(nextDay)) : null
    foot = (
      <>
        {dirty && (
          <button type="button" className="sch-btn press" disabled={saving} onClick={() => void saveDay('finish')}>
            שמירה ויציאה
          </button>
        )}
        <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 1 }} disabled={saving} onClick={() => void saveDay('next')}>
          {saving ? 'שומר…' : nextWord ? (dirty ? `אישור ומעבר ל${nextWord}` : `מעבר ל${nextWord}`) : dirty ? 'אישור וסיום השבוע' : 'סיום'}
        </button>
      </>
    )
  } else if (phase === 'done') {
    body = (
      <div className="dfs-done">
        <PartyPopper size={40} aria-hidden="true" color="var(--ok)" />
        <h3 className="dfs-ask__q">{nextDay ? 'נשמר ✓' : 'סיימנו את השבוע ✓'}</h3>
        <p className="sch-sub">
          {canPublish || savedDays > 0
            ? 'העובדים עוד לא רואים את השינויים. כשהלוח מוכן — לחצו "פרסום לעובדים" והם יקבלו הודעה.'
            : 'הכול שמור. אפשר לסגור.'}
        </p>
      </div>
    )
    foot = (
      <>
        <button type="button" className="sch-btn press" onClick={onClose}>
          סגירה
        </button>
        {(canPublish || savedDays > 0) && (
          <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 1 }} onClick={onPublish}>
            <Send size={18} aria-hidden="true" /> פרסום לעובדים
          </button>
        )}
      </>
    )
  }

  return (
    <>
      <SheetShell open={open} onClose={tryClose} labelledBy={titleId} suspended={!!confirm} className="sch-sheet dfs-sheet">
        <div className="sch-sheet__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} className="sch-sheet__title">
              שיבוץ {formatDayLabel(date)}
            </h2>
            {phase !== 'done' && progress}
          </div>
          <button type="button" className="sch-iconbtn press" onClick={tryClose} aria-label="סגירה">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {phase !== 'done' && draft.length > 0 && dayStrip}
        <div className="sheet-scroll" ref={scrollRef} style={{ gap: 12 }}>
          {body}
        </div>
        {foot && <div className="sch-sheet__foot">{foot}</div>}
      </SheetShell>
      <ConfirmSheet
        request={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          c?.onYes()
        }}
      />
    </>
  )
}
