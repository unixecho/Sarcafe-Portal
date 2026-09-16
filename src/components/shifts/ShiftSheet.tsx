'use client'

import { useEffect, useId, useState, type CSSProperties } from 'react'
import SheetShell from '@/components/SheetShell'
import SelectSheet from '@/components/SelectSheet'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import type { RoleRequirement, ScheduleStaffRow, Shift } from '@/lib/shifts/types'

// Create/edit sheet for one shift — the same component for both, matching
// AyekaBar's own ShiftSheet. Time/station/requirements editing is
// Save-gated; assignment add/remove dispatches immediately (high-frequency,
// no confirm needed); deletion is a tap-to-arm confirm.
export default function ShiftSheet({
  open,
  onClose,
  weekId,
  date,
  shift,
}: {
  open: boolean
  onClose: () => void
  weekId: string
  date: string
  shift: Shift | null
}) {
  const { db, dispatch } = useShifts()
  const ids = useId()
  const titleId = `${ids}-title`

  const [startTime, setStartTime] = useState(shift?.startTime ?? '08:00')
  const [endTime, setEndTime] = useState(shift?.endTime ?? '16:00')
  const [stationId, setStationId] = useState(shift?.stationId ?? '')
  const [requirements, setRequirements] = useState<RoleRequirement[]>(shift?.requirements ?? [])
  const [note, setNote] = useState(shift?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setStartTime(shift?.startTime ?? '08:00')
    setEndTime(shift?.endTime ?? '16:00')
    setStationId(shift?.stationId ?? '')
    setRequirements(shift?.requirements ?? [])
    setNote(shift?.note ?? '')
    setConfirmDelete(false)
  }, [open, shift])

  if (!db) return null
  const assignments = shift ? db.assignments.filter((a) => a.shiftId === shift.id) : []

  async function save() {
    setSaving(true)
    const ok = shift
      ? await dispatch({
          type: 'updateShift',
          shiftId: shift.id,
          startTime,
          endTime,
          stationId: stationId || null,
          requirements,
          note: note || null,
        })
      : await dispatch({ type: 'createShift', weekId, date, startTime, endTime, stationId: stationId || null, requirements, note: note || null })
    setSaving(false)
    if (ok) onClose()
  }

  async function remove() {
    if (!shift) return
    setSaving(true)
    const ok = await dispatch({ type: 'deleteShift', shiftId: shift.id })
    setSaving(false)
    if (ok) onClose()
  }

  function updateRequirement(roleId: string, min: number) {
    setRequirements((prev) => {
      if (min <= 0) return prev.filter((r) => r.roleId !== roleId)
      if (prev.some((r) => r.roleId === roleId)) return prev.map((r) => (r.roleId === roleId ? { ...r, min } : r))
      return [...prev, { roleId, min }]
    })
  }

  async function assign(staffId: string) {
    if (!shift || !db) return
    const staffRow = db.roster.find((r) => r.staffId === staffId)
    const roleId = staffRow?.defaultRoleId ?? requirements[0]?.roleId ?? null
    await dispatch({ type: 'assign', shiftId: shift.id, staffId, roleId })
  }

  async function unassign(assignmentId: string) {
    await dispatch({ type: 'unassign', assignmentId })
  }

  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId}>
      <h2 id={titleId} style={{ margin: '0 0 10px', fontSize: '1.05rem', fontWeight: 800 }}>
        {shift ? 'עריכת משמרת' : 'משמרת חדשה'}
      </h2>

      <div className="sheet-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>התחלה</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="ltr-isolate" style={inputStyle} />
          </label>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>סיום</span>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="ltr-isolate" style={inputStyle} />
          </label>
        </div>

        {db.settings.stations.length > 0 && (
          <div>
            <span style={labelStyle}>עמדה</span>
            <SelectSheet
              label="עמדה"
              placeholder="ללא"
              value={stationId}
              options={db.settings.stations.map((s) => ({ value: s.id, label: `${s.emoji} ${s.name}` }))}
              onChange={setStationId}
              style={inputStyle}
            />
          </div>
        )}

        <div>
          <span style={labelStyle}>דרישות תפקיד</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {db.settings.roles.map((role) => {
              const req = requirements.find((r) => r.roleId === role.id)
              return (
                <div key={role.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: '0.85rem' }}>{role.name}</span>
                  <button type="button" className="press" onClick={() => updateRequirement(role.id, Math.max(0, (req?.min ?? 0) - 1))} style={stepBtnStyle}>
                    −
                  </button>
                  <span style={{ minWidth: 16, textAlign: 'center', fontSize: '0.85rem' }}>{req?.min ?? 0}</span>
                  <button type="button" className="press" onClick={() => updateRequirement(role.id, (req?.min ?? 0) + 1)} style={stepBtnStyle}>
                    +
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <label>
          <span style={labelStyle}>הערה</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
        </label>

        {shift && (
          <div>
            <span style={labelStyle}>שיבוצים</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {assignments.map((a) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 10, background: 'var(--bg-elev)' }}>
                  <span style={{ flex: 1, fontSize: '0.85rem' }}>
                    {a.staffName}
                    {a.roleId && ` · ${db.settings.roles.find((r) => r.id === a.roleId)?.name ?? a.roleId}`}
                    {a.status === 'swap_pending' && ' · ממתין להחלפה'}
                  </span>
                  <button type="button" className="press" onClick={() => unassign(a.id)} aria-label="הסרת שיבוץ" style={{ ...stepBtnStyle, color: '#ff6b6b' }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <AddAssigneePicker roster={db.roster} excludeStaffIds={assignments.map((a) => a.staffId).filter((v): v is string => !!v)} onPick={assign} />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 14 }}>
        {shift &&
          (confirmDelete ? (
            <button
              type="button"
              className="press"
              onClick={remove}
              disabled={saving}
              style={{ ...secondaryBtnStyle, flex: 1, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.4)' }}
            >
              אישור מחיקה
            </button>
          ) : (
            <button type="button" className="press" onClick={() => setConfirmDelete(true)} style={{ ...secondaryBtnStyle, flex: 1 }}>
              מחיקה
            </button>
          ))}
        <button type="button" className="press" onClick={save} disabled={saving} style={{ ...primaryBtnStyle, flex: 2 }}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </SheetShell>
  )
}

function AddAssigneePicker({
  roster,
  excludeStaffIds,
  onPick,
}: {
  roster: ScheduleStaffRow[]
  excludeStaffIds: string[]
  onPick: (staffId: string) => void
}) {
  const [value, setValue] = useState('')
  const options = roster.filter((r) => r.schedulable && r.active && !excludeStaffIds.includes(r.staffId))

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <SelectSheet
        label="הוספת איש/אשת צוות"
        placeholder="הוספת איש/אשת צוות…"
        value={value}
        options={options.map((o) => ({ value: o.staffId, label: o.displayName }))}
        onChange={setValue}
        style={{ ...inputStyle, flex: 1 }}
      />
      <button
        type="button"
        className="press"
        disabled={!value}
        onClick={() => {
          onPick(value)
          setValue('')
        }}
        style={stepBtnStyle}
      >
        +
      </button>
    </div>
  )
}

const labelStyle: CSSProperties = { display: 'block', marginBottom: 4, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dim)' }
const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: 'var(--tap-min)',
  borderRadius: 10,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 10px',
  fontSize: '0.88rem',
  fontFamily: 'inherit',
}
const stepBtnStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev-2)',
  color: 'var(--text)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  flexShrink: 0,
}
const primaryBtnStyle: CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 800,
  fontSize: '0.92rem',
  cursor: 'pointer',
}
const secondaryBtnStyle: CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontWeight: 700,
  fontSize: '0.92rem',
  cursor: 'pointer',
}
