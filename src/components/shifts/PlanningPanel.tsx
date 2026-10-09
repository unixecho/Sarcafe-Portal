'use client'

import { CalendarCheck, ChevronDown, Clock3, MessageSquareText, Scale } from 'lucide-react'
import { useShifts } from './ShiftsProvider'
import RequestsPanel from './RequestsPanel'
import { Pill } from './ui'
import { formatDateLabel, formatHours, requestDeadline, requestsOpen, weekDates, weekdayLongLabel, parseISODate } from '@/lib/shifts/time'

export default function PlanningPanel() {
  const { db, weekStart } = useShifts()
  if (!db) return null
  const open = requestsOpen(weekStart, db.now)
  const eligible = db.roster.filter((r) => r.active && r.schedulable)
  const submissions = db.availability.filter((a) => a.weekStart === weekStart && a.status === 'submitted')
  const submitted = new Set(submissions.map((a) => a.staffId))
  const waiting = eligible.filter((r) => !submitted.has(r.staffId))
  const balance = new Map(db.saturdayBalance.map((r) => [r.staffId, r]))
  const availabilityByStaff = new Map(submissions.map((submission) => [submission.staffId, submission]))

  return (
    <aside className="sch-planning-pane" aria-label="בקשות העובדים ושיבוץ הוגן">
      <div className="sch-planning-pane__head">
        <div className="sch-row"><Clock3 size={18} aria-hidden="true" /><h2 className="sch-h">בקשות לשבוע הזה</h2></div>
        <Pill tone={open ? 'info' : 'neutral'}>{open ? 'ההגשה פתוחה' : 'ההגשה נסגרה'}</Pill>
        <p className="sch-sub">עד יום שלישי {formatDateLabel(requestDeadline(weekStart))} בחצות · שעון ישראל</p>
        <p className="sch-sub">אשרו בקשות ושבצו בלוח. לאחר מכן אפשר להשלים את החוסרים ולפרסם לצוות.</p>
      </div>

      <section className="sch-availability-board" aria-labelledby="availability-heading">
        <header className="sch-availability-board__head">
          <div className="sch-row"><CalendarCheck size={18} aria-hidden="true" /><h3 id="availability-heading" className="sch-h">זמינות עובדים</h3></div>
          <Pill tone={waiting.length ? 'warn' : 'ok'}>{submissions.length}/{eligible.length} הגישו</Pill>
        </header>
        <p className="sch-sub">כל עובד/ת מוצג/ת בכרטיס סגור. פתחו רק את מי שצריך לבדוק; ירוק זמין, אדום לא זמין, וכתום מציין שעות מוגבלות.</p>
        <div className="sch-availability-people">
          {eligible.map((person) => {
            const submission = availabilityByStaff.get(person.staffId)
            const unavailable = submission?.entries.filter((entry) => entry.kind === 'unavailable').length ?? 0
            const partial = submission?.entries.filter((entry) => entry.kind === 'partial').length ?? 0
            const preferred = submission?.entries.filter((entry) => entry.kind === 'prefer').length ?? 0
            return <details key={person.staffId} className="sch-availability-person">
              <summary>
                <span><strong>{person.displayName}</strong><small>{submission ? `${7 - unavailable - partial} ימים זמינים${preferred ? ` · ${preferred} מועדפים` : ''}` : 'טרם הוגש'}</small></span>
                <Pill tone={submission ? 'ok' : 'neutral'}>{submission ? 'הוגש' : 'ממתין'}</Pill>
                <ChevronDown size={17} className="sch-disclosure-chevron" aria-hidden="true" />
              </summary>
              <div className="sch-availability-days">
                {weekDates(weekStart).map((date) => {
                  const entry = submission?.entries.find((candidate) => candidate.date === date)
                  const tone = !submission ? 'unset' : entry?.kind === 'unavailable' ? 'unavailable' : entry?.kind === 'partial' ? 'partial' : entry?.kind === 'prefer' ? 'prefer' : 'available'
                  const label = !submission ? 'לא הוגש' : entry?.kind === 'unavailable' ? 'לא זמין/ה' : entry?.kind === 'partial' ? `${entry.from ?? ''}–${entry.to ?? ''}` : entry?.kind === 'prefer' ? 'רוצה לעבוד' : 'זמין/ה'
                  return <div key={date} className={`sch-availability-day sch-availability-day--${tone}`}><strong>{weekdayLongLabel(parseISODate(date).getUTCDay())}</strong><span dir={entry?.kind === 'partial' ? 'ltr' : undefined}>{label}</span></div>
                })}
              </div>
              {submission?.note && <div className="sch-availability-note"><MessageSquareText size={16} aria-hidden="true" /><span>{submission.note}</span></div>}
              {!submission && <p className="sch-sub">לא התקבלה הגשה. המערכת עדיין מניחה זמינות, אבל הכרטיס נשאר מסומן כדי שלא תפספסו.</p>}
            </details>
          })}
        </div>
      </section>

      <RequestsPanel planning />

      <details className="sch-planning-detail">
        <summary><Scale size={17} aria-hidden="true" /><span>חלוקת שבת · 150%</span></summary>
        <p className="sch-sub">הזדמנויות שיבוץ ב־12 השבועות הקודמים. השלמה אוטומטית מעדיפה פחות שעות שבת, ואז פחות שעות בשבוע. כל שיבוץ ידני נשמר.</p>
        {eligible.sort((a, b) => (balance.get(a.staffId)?.minutes ?? 0) - (balance.get(b.staffId)?.minutes ?? 0)).map((r) => (
          <div key={r.staffId} className="sch-balance-row"><span>{r.displayName}</span><strong>{formatHours(balance.get(r.staffId)?.minutes ?? 0)}</strong></div>
        ))}
      </details>
    </aside>
  )
}
