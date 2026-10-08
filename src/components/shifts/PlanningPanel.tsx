'use client'

import { CalendarCheck, Clock3, Scale } from 'lucide-react'
import { useShifts } from './ShiftsProvider'
import RequestsPanel from './RequestsPanel'
import { Pill } from './ui'
import { formatDateLabel, formatHours, requestDeadline, requestsOpen, weekdayLabel, parseISODate } from '@/lib/shifts/time'
import { nameOf } from '@/lib/shifts/view'

export default function PlanningPanel() {
  const { db, weekStart } = useShifts()
  if (!db) return null
  const open = requestsOpen(weekStart, db.now)
  const eligible = db.roster.filter((r) => r.active && r.schedulable)
  const submissions = db.availability.filter((a) => a.weekStart === weekStart && a.status === 'submitted')
  const submitted = new Set(submissions.map((a) => a.staffId))
  const waiting = eligible.filter((r) => !submitted.has(r.staffId))
  const balance = new Map(db.saturdayBalance.map((r) => [r.staffId, r]))

  return (
    <aside className="sch-planning-pane" aria-label="בקשות העובדים ושיבוץ הוגן">
      <div className="sch-planning-pane__head">
        <div className="sch-row"><Clock3 size={18} aria-hidden="true" /><h2 className="sch-h">בקשות לשבוע הזה</h2></div>
        <Pill tone={open ? 'info' : 'neutral'}>{open ? 'ההגשה פתוחה' : 'ההגשה נסגרה'}</Pill>
        <p className="sch-sub">עד יום שלישי {formatDateLabel(requestDeadline(weekStart))} בחצות · שעון ישראל</p>
        <p className="sch-sub">אשרו בקשות ושבצו בלוח. לאחר מכן אפשר להשלים את החוסרים ולפרסם לצוות.</p>
      </div>

      <details className="sch-planning-detail">
        <summary><CalendarCheck size={17} aria-hidden="true" /><span>זמינות הוגשה · {submissions.length}/{eligible.length}</span></summary>
        <div className="sch-wrap">
          {submissions.map((a) => (
            <div className="sch-planning-person" key={a.id}>
              <strong>{nameOf(db, a.staffId)}</strong>
              <p className="sch-sub">{a.entries.length ? a.entries.map((e) => `${weekdayLabel(parseISODate(e.date).getUTCDay())}: ${e.kind === 'unavailable' ? 'לא זמין/ה' : e.kind === 'prefer' ? 'מעדיף/ה לעבוד' : `${e.from}–${e.to}`}`).join(' · ') : 'זמין/ה כל השבוע'}</p>
              {a.note && <p className="sch-sub">{a.note}</p>}
            </div>
          ))}
          {waiting.length > 0 && <p className="sch-sub">טרם הגישו: {waiting.map((r) => r.displayName).join(', ')}. ללא הגשה, המערכת מניחה זמינות.</p>}
        </div>
      </details>

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
