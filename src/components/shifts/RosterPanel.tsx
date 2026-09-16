'use client'

import Switch from '@/components/Switch'
import SelectSheet from '@/components/SelectSheet'
import { useShifts } from '@/components/shifts/ShiftsProvider'

// "Who's on the schedule, who runs it" — the direct answer to "staff
// window needs staff flags for scheduling": a per-person schedulable
// toggle, a default role, a personal weekly-hours cap, and (separately) a
// delegate-manager toggle. Ported from AyekaBar's RosterPanel.tsx.
export default function RosterPanel() {
  const { db, dispatch } = useShifts()
  if (!db) return null

  async function toggleSchedulable(staffId: string, next: boolean) {
    await dispatch({ type: 'setMember', branchId: db!.branchId, staffId, patch: { schedulable: next } })
  }
  async function setDefaultRole(staffId: string, roleId: string) {
    await dispatch({ type: 'setMember', branchId: db!.branchId, staffId, patch: { defaultRoleId: roleId || null } })
  }
  async function setMaxHours(staffId: string, value: string) {
    await dispatch({ type: 'setMember', branchId: db!.branchId, staffId, patch: { maxWeeklyHours: value ? Number(value) : null } })
  }
  async function toggleDelegate(staffId: string, next: boolean) {
    if (!db) return
    const nextList = next ? [...db.settings.scheduleManagers, staffId] : db.settings.scheduleManagers.filter((id) => id !== staffId)
    await dispatch({ type: 'updateSettings', branchId: db.branchId, patch: { scheduleManagers: nextList } })
  }

  const active = db.roster.filter((r) => r.active)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {active.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem', padding: '20px 0' }}>אין עדיין אנשי צוות פעילים.</p>
      )}
      {active.map((row) => {
        const isDelegate = db.settings.scheduleManagers.includes(row.staffId)
        return (
          <div
            key={row.staffId}
            style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg-elev)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontWeight: 700, fontSize: '0.9rem' }}>{row.displayName}</span>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>ניתן לשיבוץ</span>
              <button
                type="button"
                role="switch"
                aria-checked={row.schedulable}
                aria-label={`ניתן לשיבוץ — ${row.displayName}`}
                className="press"
                onClick={() => toggleSchedulable(row.staffId, !row.schedulable)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <Switch on={row.schedulable} />
              </button>
            </div>

            {row.schedulable && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <SelectSheet
                  label="תפקיד ברירת מחדל"
                  placeholder="ללא תפקיד ברירת מחדל"
                  value={row.defaultRoleId ?? ''}
                  options={db.settings.roles.map((r) => ({ value: r.id, label: r.name }))}
                  onChange={(v) => setDefaultRole(row.staffId, v)}
                  style={{ ...smallInputStyle, flex: 1, minWidth: 160 }}
                />
                <input
                  type="number"
                  min={0}
                  placeholder="מקסימום שעות שבועי"
                  value={row.maxWeeklyHours ?? ''}
                  onChange={(e) => setMaxHours(row.staffId, e.target.value)}
                  className="ltr-isolate"
                  style={{ ...smallInputStyle, width: 170 }}
                />
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: '0.78rem', color: 'var(--text-dim)' }}>אחראי/ת שיבוץ מוקצה/ית</span>
              <button
                type="button"
                role="switch"
                aria-checked={isDelegate}
                aria-label={`אחראי/ת שיבוץ מוקצה/ית — ${row.displayName}`}
                className="press"
                onClick={() => toggleDelegate(row.staffId, !isDelegate)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <Switch on={isDelegate} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const smallInputStyle: React.CSSProperties = {
  minHeight: 40,
  borderRadius: 10,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 10px',
  fontSize: '0.82rem',
}
