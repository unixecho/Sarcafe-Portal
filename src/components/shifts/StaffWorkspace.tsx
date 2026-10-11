'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Share } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import AvailabilityPortal from '@/components/shifts/AvailabilityPortal'
import ShiftActionSheet from '@/components/shifts/ShiftActionSheet'
import MyRequests from '@/components/shifts/MyRequests'
import ScheduleShareSheet from '@/components/shifts/SchedulePoster'
import { EmployeeWeek, NextShiftHero, WeekStrip, buildWeek } from '@/components/shifts/EmployeeSchedule'
import NotificationsSheet, { NotificationsButton } from '@/components/shifts/NotificationsSheet'
import { InlineError, Notice } from '@/components/shifts/ui'
import { prefersReducedMotion } from '@/lib/nav/viewTransition'
import { addDays, durationMinutes, formatDateLabel, formatDayLabel, formatHours, weekDates } from '@/lib/shifts/time'
import { employeeInbox, rosterRow } from '@/lib/shifts/view'
import type { NotificationLink } from '@/lib/shifts/types'

type Tab = 'schedule' | 'mine' | 'availability'

// An employee's whole world, in three plain tabs:
//   הלוח        my next shift, the week at a glance, and every shift (mine, or everyone's)
//   הבקשות שלי  what colleagues asked me, what I asked, and how it turned out
//   זמינות      the days I cannot work next week
// The schedule reads published snapshots; a separate minimal planning menu
// offers shift choices before publication without draft assignments or notes.
export default function StaffWorkspace({ branchName }: { branchName: string }) {
  const { db, loading, error, weekStart, setWeekStart, goToToday, refresh } = useShifts()
  const [tab, setTab] = useState<Tab>('schedule')
  const [view, setView] = useState<'mine' | 'everyone'>('mine')
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

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
  const days = buildWeek(db, weekStart, weekShifts, weekAssignments)
  const myMinutes = days.flatMap((d) => d.mine).reduce((sum, s) => sum + durationMinutes(s), 0)
  const myCount = days.reduce((n, d) => n + d.mine.length, 0)
  const isCurrentWeek = weekDates(weekStart).includes(db.now.date)
  const inbox = employeeInbox(db)
  const published = currentWeek?.status === 'published'

  // The highlighted day: the one tapped, else today, else the first day that has one of my shifts.
  const fallbackDay = days.find((d) => d.date === db.now.date) ?? days.find((d) => d.mine.length > 0) ?? days[0]!
  const selected = picked && days.some((d) => d.date === picked) ? picked : fallbackDay.date

  function jumpTo(date: string) {
    setPicked(date)
    document.getElementById(`ew-day-${date}`)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  }

  function follow(link: NotificationLink) {
    setNotesOpen(false)
    if (link.weekStart) setWeekStart(link.weekStart)
    setTab(link.tab === 'requests' ? 'mine' : 'schedule')
  }

  return (
    <div className="sch-wrap ew-root">
      <header className="ew-top">
        <div className="ew-top__titles">
          <p className="ew-top__eyebrow">{formatDayLabel(db.now.date)}</p>
          <h2 className="ew-top__title">המשמרות שלי</h2>
        </div>
        <div className="ew-top__actions">
          {published && (
            <button type="button" className="sch-iconbtn press" onClick={() => setShareOpen(true)} aria-label="שיתוף הלוח כתמונה או PDF">
              <Share size={19} aria-hidden="true" />
            </button>
          )}
          <NotificationsButton onOpen={() => setNotesOpen(true)} />
        </div>
      </header>

      <div role="tablist" aria-label="הלוח שלי" className="ew-tabs">
        <button type="button" role="tab" aria-selected={tab === 'schedule'} className="ew-tab press" onClick={() => setTab('schedule')}>
          הלוח
        </button>
        <button type="button" role="tab" aria-selected={tab === 'mine'} className="ew-tab press" onClick={() => setTab('mine')}>
          הבקשות שלי
          {inbox.count > 0 && (
            <span className="sch-badge" aria-label={`${inbox.count} מחכים לתשובה שלכם`}>
              {inbox.count}
            </span>
          )}
        </button>
        {db.settings.features.availability && (
          <button type="button" role="tab" aria-selected={tab === 'availability'} className="ew-tab press" onClick={() => setTab('availability')}>
            בקשות לשבוע
          </button>
        )}
      </div>

      {loading && <div className="sch-loading" aria-hidden="true" />}

      {tab === 'schedule' && (
        <>
          <NextShiftHero
            db={db}
            onOpen={setShiftId}
            onShare={(date) => {
              setWeekStart(date)
              setShareOpen(true)
            }}
            onBrowse={() => {
              setView('everyone')
              document.getElementById('ew-week')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
            }}
          />

          {myRow && !myRow.schedulable && <Notice tone="warn">אתם מוגדרים כרגע כלא זמינים לשיבוץ בסניף הזה. לשינוי — פנו למנהל/ת.</Notice>}

          <div className="sch-weeknav" id="ew-week">
            <button type="button" className="sch-iconbtn press" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="השבוע הקודם">
              <ChevronRight size={20} aria-hidden="true" />
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
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
          </div>

          {!published ? (
            <Notice tone="info">הלוח של השבוע הזה עדיין לא פורסם. כשהמנהל/ת יפרסמו אותו — תקבלו הודעה והוא יופיע כאן.</Notice>
          ) : (
            <>
              <WeekStrip db={db} days={days} selected={selected} onSelect={jumpTo} />
              <div className="ew-controls">
                <div className="sch-segment" role="group" aria-label="תצוגה">
                  <button type="button" aria-pressed={view === 'mine'} className="press" onClick={() => setView('mine')}>
                    שלי
                  </button>
                  <button type="button" aria-pressed={view === 'everyone'} className="press" onClick={() => setView('everyone')}>
                    כולם
                  </button>
                </div>
                <span className="ew-controls__sum">{myCount > 0 ? `${myCount} משמרות · ${formatHours(myMinutes)}` : 'אין לכם משמרות השבוע'}</span>
              </div>
              {view === 'everyone' && <p className="sch-sub">לחצו על משמרת לפרטים. רק משמרות שסומנו ״פתוחה לבקשות״ מאפשרות בקשת הצטרפות — ומשמרת של עמית/ה אפשר תמיד לבקש ממנו/ה.</p>}
              <EmployeeWeek db={db} days={days} assignments={weekAssignments} view={view} dayNotes={currentWeek?.dayNotes} selected={selected} onOpenShift={setShiftId} />
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
      <ScheduleShareSheet open={shareOpen} onClose={() => setShareOpen(false)} weekStart={weekStart} branchName={branchName} scopes={['mine', 'everyone']} />
    </div>
  )
}
