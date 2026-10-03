'use client'

import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import WeekGrid from '@/components/shifts/WeekGrid'
import AvailabilityPortal from '@/components/shifts/AvailabilityPortal'
import ShiftActionSheet from '@/components/shifts/ShiftActionSheet'
import MyRequests from '@/components/shifts/MyRequests'
import NotificationsSheet, { NotificationsButton } from '@/components/shifts/NotificationsSheet'
import { InlineError, Notice, Pill } from '@/components/shifts/ui'
import { addDays, durationMinutes, formatDateLabel, formatHours, formatShiftLabel, hasStarted, relativeDayLabel, weekDates } from '@/lib/shifts/time'
import { employeeInbox, indexByShift, rosterRow } from '@/lib/shifts/view'
import type { NotificationLink } from '@/lib/shifts/types'

type Tab = 'schedule' | 'mine' | 'availability'

// An employee's whole world, in three plain tabs:
//   הלוח        my shifts (and, on "כולם", everyone's — where I can ask to join)
//   הבקשות שלי  what colleagues asked me, what I asked, and how it turned out
//   זמינות      the days I cannot work next week
// Reads ONLY the published schedule (never a draft week — enforced by the server,
// which sends nothing else), and every action explains itself before it is taken.
export default function StaffWorkspace() {
  const { db, loading, error, weekStart, setWeekStart, goToToday, refresh } = useShifts()
  const [tab, setTab] = useState<Tab>('schedule')
  const [view, setView] = useState<'mine' | 'everyone'>('mine')
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)

  if (loading && !db) {
    return (
      <div className="sch-wrap" aria-busy="true" aria-label="טוען את הלוח">
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk" style={{ height: 80 }} />
        ))}
      </div>
    )
  }
  if (error && !db) {
    return (
      <div className="sch-col">
        <InlineError>{error}</InlineError>
        <button type="button" className="sch-btn press" onClick={() => void refresh()}>
          ניסיון נוסף
        </button>
      </div>
    )
  }
  if (!db) return null

  const me = db.viewerStaffId
  const myRow = rosterRow(db, me)
  const currentWeek = db.weeks.find((w) => w.weekStart === weekStart)
  const weekShifts = currentWeek ? db.shifts.filter((s) => s.weekId === currentWeek.id) : []
  const weekIds = new Set(weekShifts.map((s) => s.id))
  const weekAssignments = db.assignments.filter((a) => weekIds.has(a.shiftId))
  const myMinutes = weekAssignments
    .filter((a) => a.staffId === me)
    .reduce((sum, a) => {
      const shift = weekShifts.find((s) => s.id === a.shiftId)
      return shift ? sum + durationMinutes(shift) : sum
    }, 0)
  const isCurrentWeek = weekDates(weekStart).includes(db.now.date)
  const inbox = employeeInbox(db)

  // The next shift that has not started yet, anywhere in the loaded window.
  const byShift = indexByShift(db.assignments)
  const next = db.shifts
    .filter((s) => !hasStarted(s, db.now) && (byShift.get(s.id) ?? []).some((a) => a.staffId === me))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))[0]

  function follow(link: NotificationLink) {
    setNotesOpen(false)
    if (link.weekStart) setWeekStart(link.weekStart)
    setTab(link.tab === 'requests' ? 'mine' : 'schedule')
  }

  return (
    <div className="sch-wrap">
      <div className="sch-row">
        <div role="tablist" aria-label="הלוח שלי" className="sch-tabs" style={{ flex: 1 }}>
          <button type="button" role="tab" aria-selected={tab === 'schedule'} className="sch-tab press" onClick={() => setTab('schedule')}>
            הלוח
          </button>
          <button type="button" role="tab" aria-selected={tab === 'mine'} className="sch-tab press" onClick={() => setTab('mine')}>
            הבקשות שלי
            {inbox.count > 0 && (
              <span className="sch-badge" aria-label={`${inbox.count} מחכים לתשובה שלכם`}>
                {inbox.count}
              </span>
            )}
          </button>
          {db.settings.features.availability && (
            <button type="button" role="tab" aria-selected={tab === 'availability'} className="sch-tab press" onClick={() => setTab('availability')}>
              זמינות
            </button>
          )}
        </div>
        <NotificationsButton onOpen={() => setNotesOpen(true)} />
      </div>

      {loading && <div className="sch-loading" aria-hidden="true" />}

      {tab === 'schedule' && (
        <>
          {next ? (
            <div className="sch-card sch-card--attention">
              <div className="sch-row">
                <CalendarClock size={20} aria-hidden="true" color="var(--neon)" />
                <span className="sch-label" style={{ margin: 0 }}>
                  המשמרת הבאה שלכם
                </span>
                {relativeDayLabel(next.date, db.now) && <Pill tone="mine">{relativeDayLabel(next.date, db.now)}</Pill>}
              </div>
              <button type="button" className="press" onClick={() => setShiftId(next.id)} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', textAlign: 'start', cursor: 'pointer' }}>
                <span style={{ fontWeight: 800, fontSize: '1.15rem' }}>{formatShiftLabel(next.date, next.startTime, next.endTime)}</span>
              </button>
            </div>
          ) : (
            <p className="sch-sub" style={{ textAlign: 'center' }}>
              אין לכם משמרות קרובות בלוח שפורסם.
            </p>
          )}

          {myRow && !myRow.schedulable && <Notice tone="warn">אתם מוגדרים כרגע כלא זמינים לשיבוץ בסניף הזה. לשינוי — פנו למנהל/ת.</Notice>}

          <div className="sch-weeknav">
            <button type="button" className="sch-iconbtn press" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="השבוע הקודם">
              <span className="dir-flip" aria-hidden="true" style={{ fontSize: '1.3rem' }}>
                ‹
              </span>
            </button>
            <div className="sch-weeknav__label">
              <strong className="ltr-isolate">
                {formatDateLabel(weekStart)} – {formatDateLabel(weekDates(weekStart)[6]!)}
              </strong>
              <span>{isCurrentWeek ? 'השבוע' : weekStart > db.now.date ? 'שבוע עתידי' : 'שבוע שעבר'}</span>
            </div>
            {!isCurrentWeek && (
              <button type="button" className="sch-btn sch-btn--sm press" onClick={goToToday}>
                להיום
              </button>
            )}
            <button type="button" className="sch-iconbtn press" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="השבוע הבא">
              <span className="dir-flip" aria-hidden="true" style={{ fontSize: '1.3rem' }}>
                ›
              </span>
            </button>
          </div>

          {currentWeek?.status !== 'published' ? (
            <Notice tone="info">הלוח של השבוע הזה עדיין לא פורסם. כשהמנהל/ת יפרסמו אותו — תקבלו הודעה והוא יופיע כאן.</Notice>
          ) : (
            <div className="sch-row" style={{ flexWrap: 'wrap' }}>
              <div className="sch-segment" role="group" aria-label="תצוגה">
                <button type="button" aria-pressed={view === 'mine'} className="press" onClick={() => setView('mine')}>
                  שלי
                </button>
                <button type="button" aria-pressed={view === 'everyone'} className="press" onClick={() => setView('everyone')}>
                  כולם
                </button>
              </div>
              <span className="sch-sub" style={{ flex: 1, textAlign: 'end' }}>
                {myMinutes > 0 ? `${formatHours(myMinutes)} השבוע` : 'אין לכם משמרות השבוע'}
              </span>
            </div>
          )}

          {currentWeek?.status === 'published' && (
            <>
              {view === 'everyone' && <p className="sch-sub">לחצו על משמרת כדי לראות פרטים — ואם חסרים בה אנשים, אפשר לבקש להצטרף.</p>}
              {view === 'mine' && weekAssignments.every((a) => a.staffId !== me) && <p className="sch-sub">אין לכם משמרות בשבוע הזה. כדי לראות משמרות של אחרים ולבקש להצטרף — עברו ל״כולם״.</p>}
              <WeekGrid
                weekStart={weekStart}
                db={db}
                shifts={weekShifts}
                assignments={weekAssignments}
                mode="staff"
                onlyMine={view === 'mine'}
                dayNotes={currentWeek?.dayNotes}
                onShiftClick={(s) => setShiftId(s.id)}
              />
            </>
          )}
        </>
      )}

      {tab === 'mine' && (
        <div className="sch-col">
          <MyRequests />
        </div>
      )}
      {tab === 'availability' && (
        <div className="sch-col">
          <AvailabilityPortal />
        </div>
      )}

      <ShiftActionSheet shiftId={shiftId} onClose={() => setShiftId(null)} />
      <NotificationsSheet open={notesOpen} onClose={() => setNotesOpen(false)} onFollow={follow} />
    </div>
  )
}
