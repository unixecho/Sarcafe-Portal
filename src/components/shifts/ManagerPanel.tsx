'use client'

import type { CSSProperties } from 'react'
import Switch from '@/components/Switch'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import CatalogEditor from '@/components/shifts/CatalogEditor'
import RosterPanel from '@/components/shifts/RosterPanel'
import { SAFETY_BOUNDS } from '@/lib/shifts/config'
import { weekdayLabel } from '@/lib/shifts/time'
import type { SafetyRules } from '@/lib/shifts/types'

const SAFETY_LABELS: Record<keyof SafetyRules, string> = {
  maxWeeklyHours: 'מקסימום שעות שבועיות',
  minRestHours: 'מינימום שעות מנוחה בין משמרות',
  maxDailyHours: 'מקסימום שעות ביום אחד',
  maxConsecutiveDays: 'מקסימום ימים רצופים',
}

// The permanently-editable settings screen: working days/hours, safety
// rules, feature flags, catalogs, and the roster (staff scheduling flags)
// — all in one place, same shape as AyekaBar's own ManagerPanel.
export default function ManagerPanel() {
  const { db, dispatch } = useShifts()
  if (!db) return null

  function toggleWorkingDay(day: number) {
    const next = db!.settings.workingDays.includes(day)
      ? db!.settings.workingDays.filter((d) => d !== day)
      : [...db!.settings.workingDays, day].sort()
    dispatch({ type: 'updateSettings', branchId: db!.branchId, patch: { workingDays: next } })
  }

  function updateHours(patch: Partial<{ openTime: string; closeTime: string }>) {
    dispatch({ type: 'updateSettings', branchId: db!.branchId, patch })
  }

  function updateSafety(key: keyof SafetyRules, value: number) {
    dispatch({ type: 'updateSettings', branchId: db!.branchId, patch: { safety: { ...db!.settings.safety, [key]: value } } })
  }

  function toggleFeature(key: 'availability' | 'swaps', value: boolean) {
    dispatch({ type: 'updateSettings', branchId: db!.branchId, patch: { features: { ...db!.settings.features, [key]: value } } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <h3 style={sectionTitleStyle}>ימי פעילות</h3>
        <div role="group" aria-label="ימי פעילות" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Array.from({ length: 7 }, (_, d) => d).map((day) => {
            const active = db.settings.workingDays.includes(day)
            return (
              <button
                key={day}
                type="button"
                className="press"
                aria-pressed={active}
                onClick={() => toggleWorkingDay(day)}
                style={{
                  minHeight: 36,
                  padding: '0 12px',
                  borderRadius: 999,
                  border: `1px solid ${active ? 'var(--neon)' : 'var(--line-strong)'}`,
                  background: active ? 'rgba(255,122,69,0.14)' : 'var(--bg-elev)',
                  color: active ? 'var(--neon-soft)' : 'var(--text-dim)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {weekdayLabel(day)}
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <h3 style={sectionTitleStyle}>שעות פעילות</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>פתיחה</span>
            <input type="time" value={db.settings.openTime} onChange={(e) => updateHours({ openTime: e.target.value })} className="ltr-isolate" style={inputStyle} />
          </label>
          <label style={{ flex: 1 }}>
            <span style={labelStyle}>סגירה</span>
            <input type="time" value={db.settings.closeTime} onChange={(e) => updateHours({ closeTime: e.target.value })} className="ltr-isolate" style={inputStyle} />
          </label>
        </div>
      </section>

      <section>
        <h3 style={sectionTitleStyle}>כללי בטיחות</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(Object.keys(SAFETY_LABELS) as (keyof SafetyRules)[]).map((key) => {
            const bounds = SAFETY_BOUNDS[key]
            return (
              <label key={key}>
                <span style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{SAFETY_LABELS[key]}</span>
                  <span className="ltr-isolate" style={{ color: 'var(--neon-soft)', fontWeight: 700 }}>
                    {db.settings.safety[key]}
                  </span>
                </span>
                <input
                  type="range"
                  min={bounds.min}
                  max={bounds.max}
                  step={bounds.step}
                  value={db.settings.safety[key]}
                  onChange={(e) => updateSafety(key, Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </label>
            )
          })}
        </div>
      </section>

      <section>
        <h3 style={sectionTitleStyle}>יכולות</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FeatureRow label="הגשת זמינות עצמית" on={db.settings.features.availability} onToggle={(v) => toggleFeature('availability', v)} />
          <FeatureRow label="בקשות החלפת משמרות" on={db.settings.features.swaps} onToggle={(v) => toggleFeature('swaps', v)} />
        </div>
      </section>

      <section>
        <h3 style={sectionTitleStyle}>קטלוגים</h3>
        <CatalogEditor />
      </section>

      <section>
        <h3 style={sectionTitleStyle}>צוות</h3>
        <RosterPanel />
      </section>
    </div>
  )
}

function FeatureRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ flex: 1, fontSize: '0.85rem' }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className="press"
        onClick={() => onToggle(!on)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <Switch on={on} />
      </button>
    </div>
  )
}

const sectionTitleStyle: CSSProperties = { margin: '0 0 10px', fontSize: '0.9rem', fontWeight: 700 }
const labelStyle: CSSProperties = { display: 'block', marginBottom: 4, fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-dim)' }
const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: 'var(--tap-min)',
  borderRadius: 10,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 10px',
  fontSize: '0.88rem',
}
