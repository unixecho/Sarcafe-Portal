'use client'

import Switch from '@/components/Switch'
import SelectSheet from '@/components/SelectSheet'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { useSettingsDraft } from '@/components/shifts/SettingsDraft'

// "Who's on the schedule, who runs it" — a per-person schedulable toggle, a
// default role, a personal weekly-hours cap, and (separately) a delegate-manager
// toggle. Like every other control on the settings screen it edits the DRAFT
// (SettingsDraft.tsx): nothing is sent until Save, so typing a number or turning a
// switch never waits on, or races, the server.
export default function RosterPanel() {
  const { db } = useShifts()
  const { settings, roster, patch, patchMember } = useSettingsDraft()
  if (!db) return null

  // The cap is typed: an empty field clears it, anything that is not a whole number of hours in range is ignored.
  function setMaxHours(staffId: string, value: string) {
    const n = value.trim() === '' ? null : Number(value)
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 168)) return
    patchMember(staffId, { maxWeeklyHours: n })
  }
  function toggleDelegate(staffId: string, next: boolean) {
    patch({ scheduleManagers: next ? [...settings.scheduleManagers, staffId] : settings.scheduleManagers.filter((id) => id !== staffId) })
  }

  const active = roster.filter((r) => r.active)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {active.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem', padding: '20px 0' }}>אין עדיין אנשי צוות פעילים.</p>
      )}
      {active.map((row) => {
        const isDelegate = settings.scheduleManagers.includes(row.staffId)
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
                onClick={() => patchMember(row.staffId, { schedulable: !row.schedulable })}
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
                  options={settings.roles.map((r) => ({ value: r.id, label: r.name }))}
                  onChange={(v) => patchMember(row.staffId, { defaultRoleId: v || null })}
                  style={{ ...smallInputStyle, flex: 1, minWidth: 160 }}
                />
                <input
                  type="number"
                  min={0}
                  max={168}
                  inputMode="numeric"
                  aria-label={`מקסימום שעות שבועי — ${row.displayName}`}
                  placeholder="מקסימום שעות שבועי"
                  value={row.maxWeeklyHours ?? ''}
                  onChange={(e) => setMaxHours(row.staffId, e.target.value)}
                  className="ltr-isolate"
                  style={{ ...smallInputStyle, width: 170 }}
                />
              </div>
            )}

            {db.viewerCanDelegate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, fontSize: '0.78rem', color: 'var(--text-dim)' }}>אחראי/ת שיבוץ מוקצה/ית (יכול/ה לנהל את הלוח)</span>
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
            )}
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
