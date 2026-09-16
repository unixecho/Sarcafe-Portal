'use client'

import { useState } from 'react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import WeekGrid from '@/components/shifts/WeekGrid'
import AvailabilityPortal from '@/components/shifts/AvailabilityPortal'
import { addDays, durationMinutes, formatDateLabel, formatHours, weekDates } from '@/lib/shifts/time'

type Tab = 'schedule' | 'availability'
type ViewMode = 'mine' | 'everyone'

// Staff self-service — reads ONLY db.published (never a draft week,
// enforced both here by only ever loading published_schedule server-side
// for a non-manager, and by RLS as the backstop). Two views ("only mine" /
// "everyone"), weekly hours, swap request/accept, and — on a separate
// tab — next week's availability submission.
export default function StaffWorkspace() {
  const { db, loading, error, weekStart, setWeekStart, dispatch } = useShifts()
  const [tab, setTab] = useState<Tab>('schedule')
  const [view, setView] = useState<ViewMode>('mine')
  const [busyId, setBusyId] = useState<string | null>(null)

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
  const weekAssignments = db.assignments.filter((a) => weekShifts.some((s) => s.id === a.shiftId))
  const myAssignments = weekAssignments.filter((a) => a.staffId === db.viewerStaffId)
  const myMinutes = myAssignments.reduce((sum, a) => {
    const shift = weekShifts.find((s) => s.id === a.shiftId)
    return shift ? sum + durationMinutes(shift) : sum
  }, 0)
  const visibleAssignments = view === 'mine' ? myAssignments : weekAssignments

  const mySwaps = db.swaps.filter((s) => s.fromStaffId === db.viewerStaffId && s.status !== 'rejected' && s.status !== 'cancelled')
  const openFromOthers = db.swaps.filter((s) => s.status === 'open' && s.fromStaffId !== db.viewerStaffId)

  function staffName(id: string | null) {
    return id ? db!.roster.find((r) => r.staffId === id)?.displayName ?? '—' : '—'
  }

  async function requestSwap(assignmentId: string) {
    setBusyId(assignmentId)
    await dispatch({ type: 'requestSwap', assignmentId, reason: null })
    setBusyId(null)
  }
  async function acceptSwap(swapId: string) {
    setBusyId(swapId)
    await dispatch({ type: 'acceptSwap', swapId })
    setBusyId(null)
  }
  async function cancelSwap(swapId: string) {
    setBusyId(swapId)
    await dispatch({ type: 'cancelSwap', swapId })
    setBusyId(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div role="tablist" aria-label="לוח משמרות" style={{ display: 'flex', gap: 6 }}>
        <button type="button" role="tab" aria-selected={tab === 'schedule'} className="press" onClick={() => setTab('schedule')} style={tabBtnStyle(tab === 'schedule')}>
          הלוח שלי
        </button>
        {db.settings.features.availability && (
          <button type="button" role="tab" aria-selected={tab === 'availability'} className="press" onClick={() => setTab('availability')} style={tabBtnStyle(tab === 'availability')}>
            זמינות
          </button>
        )}
      </div>

      {tab === 'schedule' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="press" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="שבוע קודם" style={navBtnStyle}>
              <span className="dir-flip" aria-hidden="true">‹</span>
            </button>
            <span style={{ flex: 1, textAlign: 'center', fontSize: '0.88rem', fontWeight: 700 }} className="ltr-isolate">
              {formatDateLabel(weekStart)} – {formatDateLabel(weekDates(weekStart)[6]!)}
            </span>
            <button type="button" className="press" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="שבוע הבא" style={navBtnStyle}>
              <span className="dir-flip" aria-hidden="true">›</span>
            </button>
          </div>

          {currentWeek?.status !== 'published' && (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-faint)', textAlign: 'center' }}>הלוח לשבוע הזה עדיין לא פורסם.</p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div role="group" aria-label="תצוגה" style={{ display: 'flex', gap: 3, background: 'var(--bg-elev-2)', borderRadius: 999, padding: 3 }}>
              <button type="button" className="press" aria-pressed={view === 'mine'} onClick={() => setView('mine')} style={toggleBtnStyle(view === 'mine')}>
                שלי
              </button>
              <button type="button" className="press" aria-pressed={view === 'everyone'} onClick={() => setView('everyone')} style={toggleBtnStyle(view === 'everyone')}>
                כולם
              </button>
            </div>
            <span style={{ flex: 1, textAlign: 'end', fontSize: '0.82rem', color: 'var(--text-dim)' }}>{formatHours(myMinutes)} השבוע</span>
          </div>

          <WeekGrid weekStart={weekStart} shifts={weekShifts} assignments={visibleAssignments} settings={db.settings} dayNotes={currentWeek?.dayNotes} />

          {db.settings.features.swaps && myAssignments.length > 0 && (
            <section>
              <h3 style={sectionTitleStyle}>המשמרות שלי — בקשת החלפה</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {myAssignments.map((a) => {
                  const shift = weekShifts.find((s) => s.id === a.shiftId)
                  const alreadyRequested = mySwaps.some((s) => s.assignmentId === a.id)
                  return (
                    <div key={a.id} style={rowCardStyle}>
                      <span className="ltr-isolate" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                        {shift ? `${formatDateLabel(shift.date)} · ${shift.startTime}–${shift.endTime}` : ''}
                      </span>
                      <span style={{ flex: 1 }} />
                      {a.status === 'swap_pending' || alreadyRequested ? (
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>ממתין</span>
                      ) : (
                        <button type="button" className="press" disabled={busyId === a.id} onClick={() => requestSwap(a.id)} style={smallBtnStyle}>
                          בקשת החלפה
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {db.settings.features.swaps && mySwaps.length > 0 && (
            <section>
              <h3 style={sectionTitleStyle}>הבקשות שלי</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {mySwaps.map((s) => (
                  <div key={s.id} style={rowCardStyle}>
                    <span style={{ fontSize: '0.8rem' }}>
                      {s.status === 'open' && 'פתוח להצעות'}
                      {s.status === 'peer_accepted' && `${staffName(s.toStaffId)} הציע/ה לקחת — ממתין לאישור`}
                      {s.status === 'approved' && 'אושר'}
                    </span>
                    <span style={{ flex: 1 }} />
                    {(s.status === 'open' || s.status === 'peer_accepted') && (
                      <button type="button" className="press" disabled={busyId === s.id} onClick={() => cancelSwap(s.id)} style={{ ...smallBtnStyle, color: '#ff6b6b' }}>
                        ביטול
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {db.settings.features.swaps && openFromOthers.length > 0 && (
            <section>
              <h3 style={sectionTitleStyle}>משמרות פתוחות להחלפה</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {openFromOthers.map((s) => (
                  <div key={s.id} style={rowCardStyle}>
                    <span style={{ fontSize: '0.8rem' }}>{staffName(s.fromStaffId)} מבקש/ת להחליף משמרת</span>
                    <span style={{ flex: 1 }} />
                    <button type="button" className="press" disabled={busyId === s.id} onClick={() => acceptSwap(s.id)} style={smallBtnStyle}>
                      אני אקח
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <AvailabilityPortal />
      )}
    </div>
  )
}

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    minHeight: 34,
    padding: '0 14px',
    borderRadius: 999,
    border: `1px solid ${active ? 'var(--neon)' : 'var(--line-strong)'}`,
    background: active ? 'rgba(255,122,69,0.14)' : 'var(--bg-elev)',
    color: active ? 'var(--neon-soft)' : 'var(--text-dim)',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  }
}
function toggleBtnStyle(active: boolean): React.CSSProperties {
  return {
    minHeight: 28,
    padding: '0 12px',
    borderRadius: 999,
    border: 'none',
    background: active ? 'var(--neon)' : 'transparent',
    color: active ? 'var(--bg)' : 'var(--text-dim)',
    fontSize: '0.74rem',
    fontWeight: 700,
    cursor: 'pointer',
  }
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
const sectionTitleStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: '0.86rem', fontWeight: 700 }
const rowCardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderRadius: 10,
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
}
const smallBtnStyle: React.CSSProperties = {
  minHeight: 30,
  padding: '0 10px',
  borderRadius: 8,
  border: '1px solid var(--line-strong)',
  background: 'transparent',
  color: 'var(--neon-soft)',
  fontSize: '0.76rem',
  fontWeight: 600,
  cursor: 'pointer',
}
