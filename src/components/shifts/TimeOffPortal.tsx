'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarOff, CheckCircle2, Clock3, MessageSquareText, Sunrise, Sunset, XCircle } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { InlineError, Pill } from '@/components/shifts/ui'
import { blocksLeftText, canAdd, chooseKind, countWanted, daysOffLeftText, leftOf, limitsOf, type Wanted } from '@/lib/shifts/constraints'
import { formatDateLabel, requestsOpen, weekDates, weekdayLongLabel } from '@/lib/shifts/time'
import { isLiveTimeOff, TIME_OFF_KINDS } from '@/lib/shifts/time-off'
import type { TimeOffEntry, TimeOffKind } from '@/lib/shifts/types'

// The three things a person can ask for on a day, in the owner's words (2026-10-16).
const CHOICES: Record<TimeOffKind, { label: string; short: string }> = {
  no_morning: { label: 'לא יכול/ה משמרת בוקר', short: 'בוקר' },
  no_evening: { label: 'לא יכול/ה משמרת ערב', short: 'ערב' },
  day_off: { label: 'יום חופש כל היום', short: 'יום חופש' },
}
const ORDER: TimeOffKind[] = ['no_morning', 'no_evening', 'day_off']

/** What this person asked for in that week, as the form's state: { '2031-03-02': ['day_off'], ... }. */
function wantedFrom(entries: TimeOffEntry[], dates: string[]): Wanted {
  const out: Record<string, TimeOffKind[]> = {}
  for (const date of dates) {
    const kinds = TIME_OFF_KINDS.filter((kind) => entries.some((entry) => entry.date === date && entry.kind === kind && isLiveTimeOff(entry)))
    if (kinds.length > 0) out[date] = [...kinds]
  }
  return out
}

const sameWanted = (a: Wanted, b: Wanted) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

// "מה לא מתאים לי השבוע?" — the employee's constraints for one week (אילוצים). Per day: cannot do the morning shift,
// cannot do the evening shift, or a whole day off. The manager sets how many days off (default 2) and, if they want,
// how many morning/evening blocks a week; the counters and the disabled chips say what is left, and the server checks
// again. Everything is sent with ONE button, so a person picking three things sends the owner one message, and a note
// for the manager travels with it. Days that already started cannot be changed.
export default function TimeOffPortal({ target }: { target: string }) {
  const { db, dispatch } = useShifts()
  const dates = useMemo(() => weekDates(target), [target])
  const mine = useMemo(() => (db ? db.timeOff.filter((entry) => entry.staffId === db.viewerStaffId) : []), [db])
  const saved = useMemo(() => wantedFrom(mine, dates), [mine, dates])
  const existing = db?.availability.find((a) => a.weekStart === target && a.staffId === db.viewerStaffId)
  const savedNote = existing?.note ?? ''

  const [wanted, setWanted] = useState<Wanted>(saved)
  const [note, setNote] = useState(savedNote)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seeds when the week changes (and after a save, when the server's copy becomes the new "saved"), but never in
  // the middle of an edit: a background refresh must not stomp what the person is choosing.
  useEffect(() => {
    setWanted(saved)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, JSON.stringify(saved)])
  useEffect(() => { setNote(savedNote) }, [target, savedNote])

  if (!db) return null
  const today = db.now.date
  const limits = limitsOf(db.settings.features)
  const counts = countWanted(wanted)
  const left = leftOf(counts, limits)
  const dirty = !sameWanted(wanted, saved) || note.trim() !== savedNote.trim()
  const late = !requestsOpen(target, db.now)

  function toggle(date: string, kind: TimeOffKind) {
    setWanted((prev) => {
      // One choice per day: tapping the chosen one clears it, tapping another replaces it.
      const next = chooseKind(prev[date] ?? [], kind)
      const rest = { ...prev }
      if (next.length === 0) delete rest[date]
      else rest[date] = next
      return rest
    })
    setError(null)
  }

  async function submit() {
    setSaving(true)
    setError(null)
    const entries = Object.entries(wanted).map(([date, kinds]) => ({ date, kinds: [...kinds] }))
    const wishesChanged = !sameWanted(wanted, saved)
    const addsDayOff = entries.some((e) => e.kinds.includes('day_off') && !(saved[e.date] ?? []).includes('day_off'))
    if (wishesChanged) {
      const res = await dispatch(
        { type: 'submitTimeOff', branchId: db!.branchId, weekStart: target, entries },
        { quiet: true, success: addsDayOff ? 'האילוצים נשלחו ✓ יום חופש מחכה לאישור המנהל/ת, ותקבלו הודעה כשיהיה מענה.' : 'האילוצים נשלחו ✓ המנהל/ת יראו אותם כשיבנו את הסידור.' }
      )
      if (!res.ok) { setSaving(false); setError(res.message); return }
    }
    if (note.trim() !== savedNote.trim()) {
      const res = await dispatch(
        { type: 'submitAvailability', branchId: db!.branchId, weekStart: target, entries: existing?.entries ?? [], note: note.trim() || null, status: 'submitted' },
        { quiet: true, success: 'ההערה נשלחה למנהל/ת ✓' }
      )
      if (!res.ok) { setSaving(false); setError(res.message); return }
    }
    setSaving(false)
  }

  const blocksText = blocksLeftText(left.blocks)

  return (
    <section className="sch-wrap" aria-label="אילוצים לשבוע">
      <div className="sch-row"><CalendarOff size={19} aria-hidden="true" /><h3 className="sch-h">אילוצים</h3></div>
      <p className="sch-sub">
        בכל יום בוחרים אחד: <strong>לא יכול/ה משמרת בוקר</strong>, <strong>לא יכול/ה משמרת ערב</strong> או <strong>יום חופש כל היום</strong>.
        יום חופש מחכה לאישור המנהל/ת, ואחרי שאושר לא משבצים אתכם באף סניף באותו יום. חסימת בוקר או ערב המנהל/ת רואים בזמן בניית הסידור.
      </p>

      <div className="sch-limit-bar" role="status" aria-live="polite">
        <span className={`sch-limit-chip${left.daysOff === 0 ? ' sch-limit-chip--used' : ''}`}><CalendarOff size={14} aria-hidden="true" />{daysOffLeftText(left.daysOff)} <small>({counts.daysOff}/{limits.maxDaysOff})</small></span>
        {blocksText && <span className={`sch-limit-chip${left.blocks === 0 ? ' sch-limit-chip--used' : ''}`}><Sunrise size={14} aria-hidden="true" />{blocksText}</span>}
      </div>
      {late && <p className="sch-sub sch-faint">הסידור של השבוע הזה כבר בבנייה, אז בקשה חדשה עלולה לא להיכנס אליו. המנהל/ת יקבלו אותה בכל זאת.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dates.map((date, dow) => {
          const past = date < today
          const picked = wanted[date] ?? []
          const dayEntries = mine.filter((entry) => entry.date === date)
          const dayOff = dayEntries.find((entry) => entry.kind === 'day_off' && isLiveTimeOff(entry))
          const declined = dayEntries.find((entry) => entry.kind === 'day_off' && entry.status === 'declined')
          return (
            <div key={date} className="sch-card sch-constraint-day" style={{ opacity: past ? 0.55 : 1 }}>
              <span className="sch-constraint-day__name">
                {weekdayLongLabel(dow)} <span className="sch-faint ltr-isolate" style={{ fontSize: '0.8rem', fontWeight: 600 }}>{formatDateLabel(date)}</span>
              </span>
              <div className="sch-constraint-day__chips" role="group" aria-label={`אילוצים ל${weekdayLongLabel(dow)} ${formatDateLabel(date)}`}>
                {ORDER.map((kind) => {
                  const active = picked.includes(kind)
                  const overCap = !active && !canAdd(wanted, date, kind, limits)
                  const Icon = kind === 'no_morning' ? Sunrise : kind === 'no_evening' ? Sunset : CalendarOff
                  const why = overCap ? (kind === 'day_off' ? 'הגעתם למספר ימי החופש שהמנהל/ת קבעו לשבוע' : 'הגעתם למספר החסימות שהמנהל/ת קבעו לשבוע') : undefined
                  return (
                    <button
                      key={kind}
                      type="button"
                      className="sch-chip sch-chip--wide press"
                      aria-pressed={active}
                      disabled={past || overCap}
                      title={why}
                      onClick={() => toggle(date, kind)}
                    >
                      <Icon size={14} aria-hidden="true" />{CHOICES[kind].label}
                    </button>
                  )
                })}
              </div>
              {dayOff && (
                <span style={{ width: '100%' }}>
                  {dayOff.status === 'approved'
                    ? <Pill tone="ok" icon={<CheckCircle2 size={13} aria-hidden="true" />}>יום החופש אושר</Pill>
                    : <Pill tone="warn" icon={<Clock3 size={13} aria-hidden="true" />}>ממתין לאישור המנהל/ת</Pill>}
                  {dayOff.decisionNote && <span className="sch-sub"> · {dayOff.decisionNote}</span>}
                </span>
              )}
              {!dayOff && declined && (
                <span style={{ width: '100%' }}>
                  <Pill tone="danger" icon={<XCircle size={13} aria-hidden="true" />}>הבקשה ליום חופש נדחתה</Pill>
                  {declined.decisionNote && <span className="sch-sub"> · {declined.decisionNote}</span>}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <label>
        <span className="sch-label"><MessageSquareText size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> הערה למנהל/ת (לא חובה)</span>
        <input className="sch-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="משהו שחשוב למנהל/ת לדעת על השבוע שלכם" />
      </label>

      {error && <InlineError>{error}</InlineError>}
      <button type="button" className="sch-btn sch-btn--primary press" disabled={saving || !dirty} onClick={submit}>
        {saving ? 'שולח…' : dirty ? 'שליחת האילוצים' : 'הכול נשלח'}
      </button>
    </section>
  )
}
