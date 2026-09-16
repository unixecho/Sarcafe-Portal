'use client'

import { useMemo, useState } from 'react'
import { Copy, Eraser, Printer, Send, Undo2 } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import WeekGrid from '@/components/shifts/WeekGrid'
import ShiftSheet from '@/components/shifts/ShiftSheet'
import WarningsPanel from '@/components/shifts/WarningsPanel'
import RequestsPanel from '@/components/shifts/RequestsPanel'
import ManagerPanel from '@/components/shifts/ManagerPanel'
import ShiftsAuditTrail from '@/components/shifts/ShiftsAuditTrail'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { evaluate } from '@/lib/shifts/rules'
import { addDays, formatDateLabel, weekDates } from '@/lib/shifts/time'
import type { Shift } from '@/lib/shifts/types'

type Tab = 'week' | 'warnings' | 'requests' | 'settings' | 'log'

const TABS: { id: Tab; label: string }[] = [
  { id: 'week', label: 'שבוע' },
  { id: 'warnings', label: 'התראות' },
  { id: 'requests', label: 'בקשות' },
  { id: 'settings', label: 'הגדרות' },
  { id: 'log', label: 'יומן' },
]

export default function ScheduleWorkspace() {
  const { branchSlug, db, loading, error, weekStart, setWeekStart, dispatch } = useShifts()
  const [tab, setTab] = useState<Tab>('week')
  const [openShift, setOpenShift] = useState<Shift | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [newShiftDate, setNewShiftDate] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)

  const warnings = useMemo(() => {
    if (!db) return []
    return evaluate({ weekStart, settings: db.settings, roster: db.roster, shifts: db.shifts, assignments: db.assignments, availability: db.availability })
  }, [db, weekStart])

  if (loading && !db) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk" style={{ height: 70 }} />
        ))}
      </div>
    )
  }
  if (error && !db) return <p role="alert" style={{ color: '#ff6b6b', fontSize: '0.85rem' }}>{error}</p>
  if (!db) return null

  const currentWeek = db.weeks.find((w) => w.weekStart === weekStart)
  const weekShifts = currentWeek ? db.shifts.filter((s) => s.weekId === currentWeek.id) : []
  const weekAssignmentIds = new Set(weekShifts.map((s) => s.id))
  const weekAssignments = db.assignments.filter((a) => weekAssignmentIds.has(a.shiftId))
  const errorCount = warnings.filter((w) => w.severity === 'error').length

  function openExistingShift(shift: Shift) {
    setOpenShift(shift)
    setSheetOpen(true)
  }
  function openNewShift(date: string) {
    setOpenShift(null)
    setNewShiftDate(date)
    setSheetOpen(true)
  }

  async function publish() {
    if (!currentWeek) return
    const go = () => dispatch({ type: 'publishWeek', weekId: currentWeek.id })
    if (errorCount > 0) {
      setConfirmRequest({
        title: 'לפרסם למרות ההתראות?',
        body: `יש ${errorCount} התראות חמורות בשבוע הזה (חפיפות, שיבוץ כפול, חוסר איוש). לפרסם בכל זאת?`,
        confirmLabel: 'פרסום',
        danger: true,
        onYes: go,
      })
      return
    }
    await go()
  }

  async function unpublish() {
    if (!currentWeek) return
    await dispatch({ type: 'unpublishWeek', weekId: currentWeek.id })
  }

  function clearWeek() {
    if (!currentWeek) return
    setConfirmRequest({
      title: 'לנקות את כל משמרות השבוע?',
      body: 'כל המשמרות והשיבוצים בשבוע הזה יימחקו. הפעולה בלתי הפיכה.',
      confirmLabel: 'ניקוי',
      danger: true,
      onYes: () => dispatch({ type: 'clearWeek', weekId: currentWeek.id }),
    })
  }

  async function copyFromPreviousWeek() {
    if (!db) return
    const fromWeekStart = addDays(weekStart, -7)
    await dispatch({ type: 'copyWeek', branchId: db.branchId, fromWeekStart, toWeekStart: weekStart })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div role="tablist" aria-label="ניהול לוח משמרות" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="press"
            onClick={() => setTab(t.id)}
            style={{
              minHeight: 34,
              padding: '0 14px',
              borderRadius: 999,
              border: `1px solid ${tab === t.id ? 'var(--neon)' : 'var(--line-strong)'}`,
              background: tab === t.id ? 'rgba(255,122,69,0.14)' : 'var(--bg-elev)',
              color: tab === t.id ? 'var(--neon-soft)' : 'var(--text-dim)',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t.label}
            {t.id === 'warnings' && warnings.length > 0 && <span style={countBadgeStyle(errorCount > 0)}> {warnings.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'week' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="press" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="שבוע קודם" style={navBtnStyle}>
              <span className="dir-flip" aria-hidden="true">
                ‹
              </span>
            </button>
            <span style={{ flex: 1, textAlign: 'center', fontSize: '0.88rem', fontWeight: 700 }} className="ltr-isolate">
              {formatDateLabel(weekStart)} – {formatDateLabel(weekDates(weekStart)[6]!)}
            </span>
            <button type="button" className="press" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="שבוע הבא" style={navBtnStyle}>
              <span className="dir-flip" aria-hidden="true">
                ›
              </span>
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 12,
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
            }}
          >
            <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 700, color: currentWeek?.status === 'published' ? 'var(--neon-soft)' : 'var(--text-dim)' }}>
              {currentWeek?.status === 'published' ? `פורסם (גרסה ${currentWeek.version})` : 'טיוטה'}
            </span>
            <a
              href={`/owner/schedule/print?branch=${branchSlug}&week=${weekStart}`}
              target="_blank"
              rel="noopener noreferrer"
              className="press"
              aria-label="הדפסת שבוע"
              title="הדפסת שבוע"
              style={{ ...iconBtnStyle, textDecoration: 'none' }}
            >
              <Printer size={15} aria-hidden="true" />
            </a>
            {weekShifts.length === 0 && (
              <button type="button" className="press" onClick={copyFromPreviousWeek} aria-label="העתקה משבוע קודם" title="העתקה משבוע קודם" style={iconBtnStyle}>
                <Copy size={15} aria-hidden="true" />
              </button>
            )}
            {weekShifts.length > 0 && (
              <button type="button" className="press" onClick={clearWeek} aria-label="ניקוי שבוע" title="ניקוי שבוע" style={iconBtnStyle}>
                <Eraser size={15} aria-hidden="true" />
              </button>
            )}
            {currentWeek?.status === 'published' ? (
              <button type="button" className="press" onClick={unpublish} aria-label="ביטול פרסום" title="ביטול פרסום" style={iconBtnStyle}>
                <Undo2 size={15} aria-hidden="true" />
              </button>
            ) : (
              <button type="button" className="press" onClick={publish} style={publishBtnStyle}>
                <Send size={14} aria-hidden="true" /> פרסום
              </button>
            )}
          </div>

          <WeekGrid weekStart={weekStart} shifts={weekShifts} assignments={weekAssignments} settings={db.settings} warnings={warnings} dayNotes={currentWeek?.dayNotes} onShiftClick={openExistingShift} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {weekDates(weekStart).map((date) => (
              <button key={date} type="button" className="press" onClick={() => openNewShift(date)} style={addShiftChipStyle}>
                + {formatDateLabel(date)}
              </button>
            ))}
          </div>
        </>
      )}

      {tab === 'warnings' && <WarningsPanel onJump={(shiftId) => {
        const shift = weekShifts.find((s) => s.id === shiftId)
        if (shift) openExistingShift(shift)
      }} />}

      {tab === 'requests' && <RequestsPanel />}
      {tab === 'settings' && <ManagerPanel />}
      {tab === 'log' && <ShiftsAuditTrail />}

      {currentWeek && (
        <ShiftSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          weekId={currentWeek.id}
          date={openShift?.date ?? newShiftDate ?? weekStart}
          shift={openShift}
        />
      )}

      <ConfirmSheet
        request={confirmRequest}
        onCancel={() => setConfirmRequest(null)}
        onConfirm={() => {
          confirmRequest?.onYes()
          setConfirmRequest(null)
        }}
      />
    </div>
  )
}

function countBadgeStyle(hasError: boolean): React.CSSProperties {
  return { color: hasError ? '#ff6b6b' : '#ffb240', fontVariantNumeric: 'tabular-nums' }
}

const navBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: '50%',
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev-2)',
  color: 'var(--text)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  fontSize: '1.1rem',
}
const iconBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev-2)',
  color: 'var(--text-dim)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
}
const publishBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 32,
  padding: '0 14px',
  borderRadius: 999,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 700,
  fontSize: '0.8rem',
  cursor: 'pointer',
}
const addShiftChipStyle: React.CSSProperties = {
  minHeight: 32,
  padding: '0 12px',
  borderRadius: 999,
  border: '1px dashed var(--line-strong)',
  background: 'transparent',
  color: 'var(--text-dim)',
  fontSize: '0.76rem',
  cursor: 'pointer',
}
