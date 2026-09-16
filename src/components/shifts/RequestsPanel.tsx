'use client'

import { useState, type CSSProperties } from 'react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { formatDateLabel } from '@/lib/shifts/time'

// Manager inbox for swap approvals and submitted availability — renders
// even with both features off (says the capability exists rather than
// vanishing, matching AyekaBar's own RequestsPanel).
export default function RequestsPanel() {
  const { db, dispatch, weekStart } = useShifts()
  const [busyId, setBusyId] = useState<string | null>(null)
  if (!db) return null

  const pendingSwaps = db.swaps.filter((s) => s.status === 'open' || s.status === 'peer_accepted')
  const submittedAvailability = db.availability.filter((a) => a.status === 'submitted' && a.weekStart === weekStart)

  function staffName(id: string | null) {
    return id ? db!.roster.find((r) => r.staffId === id)?.displayName ?? '—' : '—'
  }

  async function decide(swapId: string, approve: boolean) {
    setBusyId(swapId)
    await dispatch({ type: 'decideSwap', swapId, approve })
    setBusyId(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section>
        <h3 style={sectionTitleStyle}>בקשות החלפה</h3>
        {!db.settings.features.swaps ? (
          <p style={emptyStyle}>החלפות משמרות כבויות בהגדרות.</p>
        ) : pendingSwaps.length === 0 ? (
          <p style={emptyStyle}>אין בקשות החלפה ממתינות.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingSwaps.map((s) => (
              <div key={s.id} style={cardStyle}>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>
                  <strong>{staffName(s.fromStaffId)}</strong> מבקש/ת להחליף משמרת
                  {s.toStaffId && (
                    <>
                      {' '}
                      · <strong>{staffName(s.toStaffId)}</strong> הציע/ה לקחת
                    </>
                  )}
                </p>
                {s.reason && <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-faint)' }}>{s.reason}</p>}
                {s.status === 'peer_accepted' ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="press" disabled={busyId === s.id} onClick={() => decide(s.id, true)} style={approveBtnStyle}>
                      אישור
                    </button>
                    <button type="button" className="press" disabled={busyId === s.id} onClick={() => decide(s.id, false)} style={rejectBtnStyle}>
                      דחייה
                    </button>
                  </div>
                ) : (
                  <p style={{ margin: '8px 0 0', fontSize: '0.76rem', color: 'var(--text-faint)' }}>ממתין להצעה מאיש/אשת צוות אחר/ת</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 style={sectionTitleStyle}>זמינות שהוגשה לשבוע הנוכחי</h3>
        {!db.settings.features.availability ? (
          <p style={emptyStyle}>הגשת זמינות כבויה בהגדרות.</p>
        ) : submittedAvailability.length === 0 ? (
          <p style={emptyStyle}>אין עדיין הגשות זמינות לשבוע הזה.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {submittedAvailability.map((a) => (
              <div key={a.id} style={cardStyle}>
                <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700 }}>{staffName(a.staffId)}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {a.entries.map((e, i) => (
                    <span key={i} style={pillStyle}>
                      {formatDateLabel(e.date)} ·{' '}
                      {e.kind === 'unavailable' ? 'לא זמין/ה' : e.kind === 'partial' ? `חלקי ${e.from ?? ''}–${e.to ?? ''}` : 'מעדיף/ה'}
                    </span>
                  ))}
                </div>
                {a.note && <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--text-faint)' }}>{a.note}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

const sectionTitleStyle: CSSProperties = { margin: '0 0 8px', fontSize: '0.9rem', fontWeight: 700 }
const emptyStyle: CSSProperties = { margin: 0, fontSize: '0.82rem', color: 'var(--text-faint)' }
const cardStyle: CSSProperties = { padding: '10px 12px', borderRadius: 12, background: 'var(--bg-elev)', border: '1px solid var(--line)' }
const pillStyle: CSSProperties = {
  fontSize: '0.74rem',
  padding: '2px 9px',
  borderRadius: 999,
  background: 'var(--bg-elev-2)',
  border: '1px solid var(--line)',
  color: 'var(--text-dim)',
}
const approveBtnStyle: CSSProperties = {
  flex: 1,
  minHeight: 36,
  borderRadius: 10,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 700,
  fontSize: '0.8rem',
  cursor: 'pointer',
}
const rejectBtnStyle: CSSProperties = {
  flex: 1,
  minHeight: 36,
  borderRadius: 10,
  border: '1px solid rgba(255,107,107,0.35)',
  background: 'transparent',
  color: '#ff6b6b',
  fontWeight: 700,
  fontSize: '0.8rem',
  cursor: 'pointer',
}
