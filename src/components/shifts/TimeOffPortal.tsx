'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarOff, CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { InlineError, Pill } from '@/components/shifts/ui'
import { formatDateLabel, requestsOpen, weekDates, weekdayLongLabel } from '@/lib/shifts/time'
import { isLiveTimeOff, KIND_LABEL, TIME_OFF_KINDS } from '@/lib/shifts/time-off'
import type { TimeOffEntry, TimeOffKind } from '@/lib/shifts/types'

type Wanted = Record<string, TimeOffKind[]>

const CHIP_LABEL: Record<TimeOffKind, string> = { day_off: 'יום חופש', no_morning: 'בלי בוקר', no_evening: 'בלי ערב' }

/** What this person asked for in that week, as the form's state: { '2031-03-02': ['day_off'], ... }. */
function wantedFrom(entries: TimeOffEntry[], dates: string[]): Wanted {
  const out: Wanted = {}
  for (const date of dates) {
    const kinds = TIME_OFF_KINDS.filter((kind) => entries.some((entry) => entry.date === date && entry.kind === kind && isLiveTimeOff(entry)))
    if (kinds.length > 0) out[date] = [...kinds]
  }
  return out
}

const sameWanted = (a: Wanted, b: Wanted) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

// "Which days do I not want to work?" — days off (the owner has to say yes; once approved nobody can schedule the
// person anywhere) and a softer "not the morning / not the evening" that the owner sees while building the schedule.
// Only the days that have not started can be changed. Nothing is sent until "שליחת הבקשות", so a person picking
// three days sends ONE message to the owner, not three.
export default function TimeOffPortal({ target }: { target: string }) {
  const { db, dispatch } = useShifts()
  const dates = useMemo(() => weekDates(target), [target])
  const mine = useMemo(() => (db ? db.timeOff.filter((entry) => entry.staffId === db.viewerStaffId) : []), [db])
  const saved = useMemo(() => wantedFrom(mine, dates), [mine, dates])

  const [wanted, setWanted] = useState<Wanted>(saved)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seeds when the week changes (and after a save, when the server's copy becomes the new "saved"), but never in
  // the middle of an edit: a background refresh must not stomp what the person is choosing.
  useEffect(() => {
    setWanted(saved)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, JSON.stringify(saved)])

  if (!db) return null
  const today = db.now.date
  const dirty = !sameWanted(wanted, saved)
  const late = !requestsOpen(target, db.now)

  function toggle(date: string, kind: TimeOffKind) {
    setWanted((prev) => {
      const current = prev[date] ?? []
      const has = current.includes(kind)
      let next: TimeOffKind[]
      if (kind === 'day_off') next = has ? [] : ['day_off']
      else next = has ? current.filter((k) => k !== kind) : [...current.filter((k) => k !== 'day_off'), kind]
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
    const entries = Object.entries(wanted).map(([date, kinds]) => ({ date, kinds }))
    const addsDayOff = entries.some((e) => e.kinds.includes('day_off') && !(saved[e.date] ?? []).includes('day_off'))
    const res = await dispatch(
      { type: 'submitTimeOff', branchId: db!.branchId, weekStart: target, entries },
      { quiet: true, success: addsDayOff ? 'הבקשות נשלחו ✓ ימי חופש מחכים לאישור המנהל/ת, ותקבלו הודעה כשיהיה מענה.' : 'נשמר ✓ המנהל/ת יראו את ההעדפות שלכם כשיבנו את הלוח.' }
    )
    setSaving(false)
    if (!res.ok) setError(res.message)
  }

  return (
    <section className="sch-wrap" aria-label="ימי חופש והעדפות משמרת">
      <div className="sch-row"><CalendarOff size={19} aria-hidden="true" /><h3 className="sch-h">ימי חופש והעדפות משמרת</h3></div>
      <p className="sch-sub">
        <strong>יום חופש</strong> מחכה לאישור של המנהל/ת. אחרי שאושר לא ישבצו אתכם באף סניף באותו יום.
        {' '}<strong>בלי בוקר / בלי ערב</strong> היא בקשה שהמנהל/ת רואים כשהם בונים את הלוח — הם יכולים לשבץ אתכם בכל זאת.
      </p>
      {late && <p className="sch-sub sch-faint">הלוח של השבוע הזה כבר בבנייה, אז בקשה חדשה עלולה לא להיכנס אליו. המנהל/ת יקבלו אותה בכל זאת.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dates.map((date, dow) => {
          const past = date < today
          const picked = wanted[date] ?? []
          const dayEntries = mine.filter((entry) => entry.date === date)
          const dayOff = dayEntries.find((entry) => entry.kind === 'day_off' && isLiveTimeOff(entry))
          const declined = dayEntries.find((entry) => entry.kind === 'day_off' && entry.status === 'declined')
          return (
            <div key={date} className="sch-card" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', opacity: past ? 0.55 : 1 }}>
              <span style={{ flex: '1 1 110px', fontWeight: 700 }}>
                {weekdayLongLabel(dow)} <span className="sch-faint ltr-isolate" style={{ fontSize: '0.8rem', fontWeight: 600 }}>{formatDateLabel(date)}</span>
              </span>
              {TIME_OFF_KINDS.map((kind) => {
                const active = picked.includes(kind)
                const softBlocked = kind !== 'day_off' && picked.includes('day_off')
                return (
                  <button
                    key={kind}
                    type="button"
                    className="sch-chip press"
                    aria-pressed={active}
                    aria-label={`${KIND_LABEL[kind]} · ${weekdayLongLabel(dow)} ${formatDateLabel(date)}`}
                    disabled={past || softBlocked}
                    title={softBlocked ? 'יום חופש מלא כבר כולל גם את הבוקר וגם את הערב' : undefined}
                    onClick={() => toggle(date, kind)}
                  >
                    {CHIP_LABEL[kind]}
                  </button>
                )
              })}
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

      {error && <InlineError>{error}</InlineError>}
      <button type="button" className="sch-btn sch-btn--primary press" disabled={saving || !dirty} onClick={submit}>
        {saving ? 'שולח…' : dirty ? 'שליחת הבקשות' : 'הכול נשלח'}
      </button>
    </section>
  )
}
