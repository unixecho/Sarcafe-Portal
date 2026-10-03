'use client'

import { History } from 'lucide-react'
import { EmptyState } from '@/components/shifts/ui'
import { useShifts } from '@/components/shifts/ShiftsProvider'

// Who did what, in plain sentences — newest first. Every change to the schedule
// is written by the database in the same transaction as the change itself
// (migration 018), so this list cannot miss one or disagree with what happened.
// No raw data is shown: the sentence already says what changed.
const AUDIT_LABELS: Record<string, string> = {
  'shift.create': 'משמרת חדשה',
  'shift.update': 'עריכת משמרת',
  'shift.delete': 'מחיקת משמרת',
  'shift.move': 'העברת שיבוץ',
  'schedule.publish': 'פרסום',
  'schedule.unpublish': 'ביטול פרסום',
  'schedule.clear': 'ניקוי שבוע',
  'schedule.copy': 'העתקת שבוע',
  'schedule.note': 'הערה ליום',
  'settings.update': 'שינוי הגדרות',
  'member.update': 'עדכון הגדרות צוות',
  'request.create': 'בקשה להצטרף',
  'request.approve': 'אישור בקשה',
  'request.reject': 'דחיית בקשה',
  'request.cancel': 'ביטול בקשה',
  'swap.request': 'בקשת החלפה',
  'swap.accept': 'הסכמה להחלפה',
  'swap.decline': 'סירוב להחלפה',
  'swap.approve': 'אישור החלפה',
  'swap.reject': 'דחיית החלפה',
  'swap.cancel': 'ביטול החלפה',
}

export default function ShiftsAuditTrail() {
  const { db } = useShifts()
  if (!db) return null
  if (db.audit.length === 0) {
    return <EmptyState icon={<History size={30} aria-hidden="true" />} title="עוד אין פעולות רשומות" hint="כל שינוי בלוח — שיבוץ, פרסום, אישור בקשה — יירשם כאן עם שם מי שעשה אותו." />
  }

  return (
    <div className="sch-wrap" style={{ gap: 8 }}>
      {db.audit.map((entry) => (
        <div key={entry.id} className="sch-card" style={{ gap: 6 }}>
          <span className="sch-pill sch-pill--neutral" style={{ alignSelf: 'flex-start' }}>
            {AUDIT_LABELS[entry.action] ?? 'פעולה'}
          </span>
          <span style={{ fontSize: '0.92rem', lineHeight: 1.55 }}>{entry.summary}</span>
          <span className="sch-faint" style={{ fontSize: '0.76rem' }}>
            {[entry.actorName, formatWhen(entry.createdAt)].filter(Boolean).join(' · ')}
          </span>
        </div>
      ))}
    </div>
  )
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return iso
  }
}
