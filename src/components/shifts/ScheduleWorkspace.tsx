'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, Copy, Eraser, Inbox, MoreHorizontal, Printer, Send, Undo2, WandSparkles, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import WeekGrid from '@/components/shifts/WeekGrid'
import ShiftSheet from '@/components/shifts/ShiftSheet'
import WarningsPanel from '@/components/shifts/WarningsPanel'
import RequestsPanel from '@/components/shifts/RequestsPanel'
import PlanningPanel from '@/components/shifts/PlanningPanel'
import ManagerPanel from '@/components/shifts/ManagerPanel'
import ShiftsAuditTrail from '@/components/shifts/ShiftsAuditTrail'
import NotificationsSheet, { NotificationsButton } from '@/components/shifts/NotificationsSheet'
import { EmptyState, InlineError } from '@/components/shifts/ui'
import { evaluate } from '@/lib/shifts/rules'
import { coverageOf } from '@/lib/shifts/coverage'
import { unpublishedChanges } from '@/lib/shifts/snapshot-diff'
import { indexByShift, managerInbox } from '@/lib/shifts/view'
import { addDays, formatDateLabel, requestsOpen, weekDates } from '@/lib/shifts/time'
import type { NotificationLink } from '@/lib/shifts/types'

type Tab = 'week' | 'requests' | 'problems' | 'settings' | 'log'

type SheetState = { shiftId: string | null; date: string; weekId: string }

export default function ScheduleWorkspace() {
  const { branchSlug, db, loading, error, weekStart, setWeekStart, goToToday, dispatch, refresh } = useShifts()
  const [tab, setTab] = useState<Tab>('week')
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const lastSheet = useRef<SheetState | null>(null)
  if (sheet) lastSheet.current = sheet
  const [moreOpen, setMoreOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)
  const [prompt, setPrompt] = useState<(PromptRequest & { date: string }) | null>(null)
  const [busy, setBusy] = useState(false)

  const warnings = useMemo(() => {
    if (!db) return []
    return evaluate({ weekStart, settings: db.settings, roster: db.roster, shifts: db.shifts, assignments: db.assignments, availability: db.availability })
  }, [db, weekStart])

  if (loading && !db) {
    return (
      <div className="sch-wrap" aria-busy="true" aria-label="טוען את הלוח">
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk" style={{ height: 90 }} />
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

  const currentWeek = db.weeks.find((w) => w.weekStart === weekStart)
  const weekShifts = currentWeek ? db.shifts.filter((s) => s.weekId === currentWeek.id) : []
  const weekShiftIds = new Set(weekShifts.map((s) => s.id))
  const weekAssignments = db.assignments.filter((a) => weekShiftIds.has(a.shiftId))
  const byShift = indexByShift(weekAssignments)
  const inbox = managerInbox(db)
  const weekWarnings = warnings.filter((w) => !w.shiftId || weekShiftIds.has(w.shiftId))
  const errorCount = weekWarnings.filter((w) => w.severity === 'error').length
  const changes = unpublishedChanges(currentWeek, weekShifts, weekAssignments)
  const published = currentWeek?.status === 'published'
  const isCurrentWeek = weekDates(weekStart).includes(db.now.date)
  const prevWeekShifts = db.weeks.find((w) => w.weekStart === addDays(weekStart, -7))
  const prevHasShifts = !!prevWeekShifts && db.shifts.some((s) => s.weekId === prevWeekShifts.id)
  const pendingForWeek = db.requests.filter((r) => r.status === 'pending' && !!r.terms.date && r.terms.date >= weekStart && r.terms.date <= addDays(weekStart, 6)).length
  const planningOpen = requestsOpen(weekStart, db.now)

  let unassigned = 0
  let short = 0
  for (const s of weekShifts) {
    const c = coverageOf(s, byShift.get(s.id) ?? [])
    if (c.state === 'unassigned') unassigned++
    else if (c.state === 'partial') short++
  }

  const openShift = (shiftId: string | null, date: string) => currentWeek && setSheet({ shiftId, date, weekId: currentWeek.id })

  function follow(link: NotificationLink) {
    setNotesOpen(false)
    if (link.weekStart) setWeekStart(link.weekStart)
    if (link.tab === 'requests') setTab('requests')
    else {
      setTab('week')
      if (link.shiftId) {
        const s = db!.shifts.find((x) => x.id === link.shiftId)
        if (s) openShift(s.id, s.date)
      }
    }
  }

  async function publish() {
    if (!currentWeek) return
    const go = async () => {
      setBusy(true)
      await dispatch(
        { type: 'publishWeek', weekId: currentWeek.id },
        {
          success: (d) => {
            const n = typeof d.notified === 'number' ? d.notified : 0
            return published ? `העדכון פורסם — ${n > 0 ? `${n} עובדים קיבלו הודעה על מה שהשתנה` : 'העובדים רואים את הלוח המעודכן'}` : `הלוח פורסם — ${n > 0 ? `${n} עובדים קיבלו הודעה` : 'העובדים רואים אותו עכשיו'}`
          },
        }
      )
      setBusy(false)
    }
    const problems: string[] = []
    if (unassigned > 0) problems.push(`${unassigned} משמרות בלי אף אחד משובץ`)
    if (short > 0) problems.push(`${short} משמרות שחסרים בהן אנשים`)
    if (errorCount > 0) problems.push(`${errorCount} בעיות שמופיעות בלשונית "בעיות בלוח"`)
    if (problems.length > 0) {
      setConfirm({
        title: 'לפרסם למרות הבעיות?',
        body: `בשבוע הזה יש: ${problems.join(', ')}.\nהעובדים יראו את הלוח כמו שהוא עכשיו.`,
        confirmLabel: published ? 'פרסום העדכון' : 'פרסום בכל זאת',
        cancelLabel: 'חזרה לתיקון',
        onYes: () => void go(),
      })
      return
    }
    await go()
  }

  async function fillRemaining() {
    if (!currentWeek) return
    setBusy(true)
    await dispatch({ type: 'fillWeek', weekId: currentWeek.id }, { success: (d) => {
      const left = Array.isArray(d.remaining) ? d.remaining.length : 0
      return `נוספו ${d.added ?? 0} שיבוצים. כל הבחירות הידניות נשמרו.${left ? ` נותרו ${left} חוסרים ללא עובד/ת מתאים/ה — אפשר לשבץ ידנית.` : ' בדקו את הלוח ופרסמו לצוות.'}`
    } })
    setBusy(false)
  }

  async function prepareWeek() {
    if (!currentWeek) return
    setBusy(true)
    await dispatch({ type: 'prepareWeek', weekId: currentWeek.id }, { success: (d) => `נוספו ${d.added ?? 0} משמרות ללא שיבוץ. ${planningOpen ? 'העובדים יכולים לבחור בקשות עד יום שלישי.' : 'אפשר להמשיך לשיבוץ ידני ולהשלמת החוסרים.'}` })
    setBusy(false)
  }

  function unpublish() {
    if (!currentWeek) return
    setMoreOpen(false)
    setConfirm({
      title: 'להחזיר את הלוח לטיוטה?',
      body: 'העובדים יפסיקו לראות את הלוח של השבוע הזה. בקשות להצטרף והחלפות שממתינות על המשמרות שלו יבוטלו, והעובדים יקבלו על כך הודעה.',
      confirmLabel: 'החזרה לטיוטה',
      danger: true,
      onYes: () => void dispatch({ type: 'unpublishWeek', weekId: currentWeek.id }, { success: 'הלוח הוחזר לטיוטה — העובדים לא רואים אותו' }),
    })
  }

  function clearWeek() {
    if (!currentWeek) return
    setMoreOpen(false)
    setConfirm({
      title: 'לנקות את כל משמרות השבוע?',
      body: `${weekShifts.length} משמרות והשיבוצים שלהן יימחקו. בקשות והחלפות שממתינות עליהן יבוטלו (נשארות בהיסטוריה). אי אפשר לבטל את הניקוי.`,
      confirmLabel: 'ניקוי השבוע',
      danger: true,
      onYes: () => void dispatch({ type: 'clearWeek', weekId: currentWeek.id }, { success: 'השבוע נוקה' }),
    })
  }

  function copyFromPreviousWeek() {
    setMoreOpen(false)
    const run = () =>
      void dispatch(
        { type: 'copyWeek', branchId: db!.branchId, fromWeekStart: addDays(weekStart, -7), toWeekStart: weekStart },
        {
          success: (d) => {
            const skipped = Array.isArray(d.skipped) ? (d.skipped as { name: string; why: string }[]) : []
            const base = `הועתקו ${d.shifts ?? 0} משמרות עם ${d.people ?? 0} שיבוצים`
            return skipped.length > 0
              ? `${base}. לא שובצו: ${skipped.map((s) => `${s.name} (${s.why === 'busy' ? 'כבר עובד/ת בשעות האלה' : 'לא פעיל/ה'})`).join(', ')}`
              : base
          },
        }
      )
    if (weekShifts.length > 0) {
      setConfirm({
        title: 'להחליף את הלוח של השבוע הזה?',
        body: 'המשמרות שכבר קיימות בשבוע הזה יימחקו ויוחלפו במשמרות של השבוע הקודם.',
        confirmLabel: 'העתקה והחלפה',
        danger: true,
        onYes: run,
      })
    } else run()
  }

  const tabs: { id: Tab; label: string; badge?: { n: number; tone?: 'warn' | 'danger' } }[] = [
    { id: 'week', label: 'לוח' },
    { id: 'requests', label: 'בקשות', badge: inbox.count > 0 ? { n: inbox.count } : undefined },
    { id: 'problems', label: 'בעיות', badge: weekWarnings.length > 0 ? { n: weekWarnings.length, tone: errorCount > 0 ? 'danger' : 'warn' } : undefined },
    { id: 'settings', label: 'הגדרות' },
    { id: 'log', label: 'היסטוריה' },
  ]

  return (
    <div className="sch-wrap">
      <div className="sch-row">
        <div role="tablist" aria-label="ניהול לוח משמרות" className="sch-tabs" style={{ flex: 1 }}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="sch-tab press" onClick={() => setTab(t.id)}>
              {t.label}
              {t.badge && (
                <span className={`sch-badge${t.badge.tone ? ` sch-badge--${t.badge.tone}` : ''}`} aria-label={`${t.badge.n} ממתינים`}>
                  {t.badge.n}
                </span>
              )}
            </button>
          ))}
        </div>
        <NotificationsButton onOpen={() => setNotesOpen(true)} />
      </div>

      {loading && <div className="sch-loading" aria-hidden="true" />}

      {tab === 'week' && (
        <>
          <div className="sch-weeknav">
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

          {/* ---- is this week visible to the team? ---- */}
          <div className={`sch-card ${!published ? 'sch-card--warn' : changes.total > 0 ? 'sch-card--attention' : 'sch-card--ok'}`}>
            <div className="sch-row" style={{ alignItems: 'flex-start' }}>
              <span style={{ marginTop: 2, display: 'inline-flex' }} aria-hidden="true">
                {published && changes.total === 0 ? <CheckCircle2 size={20} color="var(--ok)" /> : <AlertTriangle size={20} color={published ? 'var(--neon)' : 'var(--warn)'} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="sch-h" style={{ fontSize: '0.95rem' }}>
                  {!published ? 'הלוח הזה עדיין לא פורסם' : changes.total > 0 ? `יש ${changes.total} שינויים שעוד לא פורסמו` : `הלוח פורסם · גרסה ${currentWeek?.version}`}
                </p>
                <p className="sch-sub">
                  {!published
                    ? 'העובדים לא רואים אותו עדיין. כשהוא מוכן — פרסמו אותו והם יקבלו הודעה.'
                    : changes.total > 0
                      ? 'העובדים עדיין רואים את הגרסה הקודמת. פרסמו כדי שיראו את מה ששיניתם.'
                      : 'העובדים רואים את הלוח כמו שהוא מופיע כאן.'}
                </p>
              </div>
            </div>
            <div className="sch-row" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="sch-btn press" disabled={busy || weekShifts.length === 0 || planningOpen || pendingForWeek > 0} onClick={fillRemaining} title={planningOpen ? 'זמין לאחר סגירת ההגשה ביום שלישי' : pendingForWeek ? 'טפלו קודם בבקשות לשבוע הזה' : 'שומר את הבחירות הידניות ומשלים חוסרים'}>
                <WandSparkles size={18} aria-hidden="true" /> {busy ? 'מעדכן…' : 'השלמת חוסרים הוגנת'}
              </button>
              {(!published || changes.total > 0) && (
                <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: '1 1 200px' }} disabled={busy || weekShifts.length === 0} onClick={publish}>
                  <Send size={18} aria-hidden="true" /> {published ? 'פרסום העדכון לעובדים' : 'פרסום לעובדים'}
                </button>
              )}
              <button type="button" className="sch-btn press" onClick={() => setMoreOpen(true)} aria-label="עוד פעולות: הדפסה, העתקה, ניקוי">
                <MoreHorizontal size={20} aria-hidden="true" /> עוד
              </button>
            </div>
          </div>

          <p className="sch-sub">{planningOpen ? 'בקשות העובדים פתוחות עד יום שלישי בחצות. אפשר להתחיל לשבץ ידנית.' : pendingForWeek > 0 ? `${pendingForWeek} בקשות ממתינות לשבוע הזה. טפלו בהן לפני ההשלמה האוטומטית.` : 'השלמה אוטומטית מאזנת שעות ושבתות, מכבדת זמינות ושומרת כל שיבוץ שכבר בחרתם.'}</p>

          {inbox.count > 0 && (
            <button type="button" className="sch-card sch-card--attention press" style={{ flexDirection: 'row', alignItems: 'center', font: 'inherit', color: 'inherit', textAlign: 'start', cursor: 'pointer' }} onClick={() => setTab('requests')}>
              <Inbox size={22} aria-hidden="true" color="var(--neon)" />
              <span style={{ flex: 1 }}>
                <strong>{inbox.count === 1 ? 'בקשה אחת מחכה לאישור שלך' : `${inbox.count} בקשות מחכות לאישור שלך`}</strong>
                <span className="sch-sub" style={{ display: 'block' }}>
                  לחצו כדי לאשר או לדחות
                </span>
              </span>
              <span className="sch-badge">{inbox.count}</span>
            </button>
          )}

          {weekShifts.length > 0 && (
            <p className="sch-sub" aria-live="polite">
              {weekShifts.length} משמרות בשבוע
              {unassigned > 0 && <strong style={{ color: 'var(--warn)' }}> · {unassigned} ללא שיבוץ</strong>}
              {short > 0 && <strong style={{ color: 'var(--warn)' }}> · {short} עם חוסר</strong>}
              {unassigned === 0 && short === 0 && <span style={{ color: 'var(--ok)' }}> · כולן מאוישות</span>}
            </p>
          )}

          {weekShifts.length === 0 && (
            <EmptyState
              icon={<CalendarPlus size={30} aria-hidden="true" />}
              title="עוד אין משמרות בשבוע הזה"
              hint="לחצו על ״משמרת״ בכל יום כדי להוסיף. השעות יתמלאו לבד לפי התבניות שהגדרתם בהגדרות."
            >
              <button type="button" className="sch-btn sch-btn--primary press" disabled={busy} onClick={prepareWeek}>
                <CalendarPlus size={18} aria-hidden="true" /> הכנת שבוע מהתבניות
              </button>
              <p className="sch-sub">יוצר משמרות פנויות בימי הפעילות. בדקו את השעות והצרכים לפני השיבוץ.</p>
              {prevHasShifts && (
                <button type="button" className="sch-btn press" onClick={copyFromPreviousWeek}>
                  <Copy size={18} aria-hidden="true" /> העתקה מהשבוע הקודם
                </button>
              )}
            </EmptyState>
          )}

          <div className="sch-planning-layout">
          <div className="sch-board-scroll" tabIndex={0} role="region" aria-label="לוח שבועי מלא; גללו בין הימים">
          <WeekGrid
            weekStart={weekStart}
            db={db}
            shifts={weekShifts}
            assignments={weekAssignments}
            mode="manager"
            warnings={weekWarnings}
            dayNotes={currentWeek?.dayNotes}
            onShiftClick={(s) => openShift(s.id, s.date)}
            onAdd={(date) => openShift(null, date)}
            onEditNote={(date) =>
              setPrompt({ date, title: `הערה ל${formatDateLabel(date)}`, label: 'הערה ליום (תוצג לעובדים)', initialValue: currentWeek?.dayNotes[date] ?? '', submitLabel: 'שמירה', allowEmpty: true })
            }
          />
          </div>
          <PlanningPanel />
          </div>
        </>
      )}

      {tab === 'requests' && (
        <div className="sch-col">
          <RequestsPanel />
        </div>
      )}
      {tab === 'problems' && (
        <div className="sch-col">
          <WarningsPanel
            onJump={(shiftId) => {
              const s = weekShifts.find((x) => x.id === shiftId)
              if (s) {
                setTab('week')
                openShift(s.id, s.date)
              }
            }}
          />
        </div>
      )}
      {tab === 'settings' && (
        <div className="sch-col">
          <ManagerPanel />
        </div>
      )}
      {tab === 'log' && (
        <div className="sch-col">
          <ShiftsAuditTrail />
        </div>
      )}

      <ShiftSheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        weekId={(sheet ?? lastSheet.current)?.weekId ?? ''}
        date={(sheet ?? lastSheet.current)?.date ?? weekStart}
        shiftId={(sheet ?? lastSheet.current)?.shiftId ?? null}
      />

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)}>
        <MoreRow icon={<Printer size={20} aria-hidden="true" />} title="הדפסת השבוע" hint="נפתח בחלון חדש — אפשר להדפיס או לשמור כ-PDF" href={`/owner/schedule/print?branch=${branchSlug}&week=${weekStart}`} />
        <MoreRow
          icon={<Copy size={20} aria-hidden="true" />}
          title="העתקה מהשבוע הקודם"
          hint={prevHasShifts ? (weekShifts.length > 0 ? 'מחליף את המשמרות של השבוע הזה' : 'מעתיק משמרות ושיבוצים') : 'בשבוע הקודם אין משמרות להעתיק'}
          disabled={!prevHasShifts}
          onClick={copyFromPreviousWeek}
        />
        {published && <MoreRow icon={<Undo2 size={20} aria-hidden="true" />} title="החזרה לטיוטה" hint="העובדים יפסיקו לראות את הלוח" onClick={unpublish} danger />}
        {weekShifts.length > 0 && <MoreRow icon={<Eraser size={20} aria-hidden="true" />} title="ניקוי כל השבוע" hint="מוחק את כל המשמרות של השבוע" onClick={clearWeek} danger />}
      </MoreSheet>

      <NotificationsSheet open={notesOpen} onClose={() => setNotesOpen(false)} onFollow={follow} />

      <PromptSheet
        request={prompt}
        onCancel={() => setPrompt(null)}
        onSubmit={(value) => {
          const p = prompt
          setPrompt(null)
          if (p && currentWeek) void dispatch({ type: 'setDayNote', weekId: currentWeek.id, date: p.date, note: value }, { success: value ? 'ההערה נשמרה' : 'ההערה הוסרה' })
        }}
      />
      <ConfirmSheet
        request={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          c?.onYes()
        }}
      />
    </div>
  )
}

// ---- the "more actions" sheet --------------------------------------------------------------
function MoreSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <SheetShell open={open} onClose={onClose} labelledBy="sch-more-title" className="sch-sheet">
      <div className="sch-sheet__head">
        <h2 id="sch-more-title" className="sch-sheet__title">
          עוד פעולות
        </h2>
        <button type="button" className="sch-iconbtn press" onClick={onClose} aria-label="סגירה">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="sheet-scroll">{children}</div>
    </SheetShell>
  )
}

function MoreRow({ icon, title, hint, onClick, href, danger, disabled }: { icon: ReactNode; title: string; hint: string; onClick?: () => void; href?: string; danger?: boolean; disabled?: boolean }) {
  const inner = (
    <>
      <span style={{ color: danger ? 'var(--danger)' : 'var(--text-dim)', flex: 'none' }}>{icon}</span>
      <span className="sch-pick__main">
        <span className="sch-pick__name" style={{ color: danger ? 'var(--danger)' : undefined }}>
          {title}
        </span>
        <span className="sch-pick__hint">{hint}</span>
      </span>
    </>
  )
  return href ? (
    <a className="sch-pick press" href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
      {inner}
    </a>
  ) : (
    <button type="button" className="sch-pick press" disabled={disabled} onClick={onClick}>
      {inner}
    </button>
  )
}
