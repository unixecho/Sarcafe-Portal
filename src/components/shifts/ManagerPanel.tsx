'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Switch from '@/components/Switch'
import { TimeWheel } from '@/components/WheelPicker'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import CatalogEditor from '@/components/shifts/CatalogEditor'
import RosterPanel from '@/components/shifts/RosterPanel'
import { SAFETY_BOUNDS } from '@/lib/shifts/config'
import { weekdayLabel } from '@/lib/shifts/time'
import type { SafetyRules, ShiftSettings } from '@/lib/shifts/types'

const SAVE_DEBOUNCE_MS = 500

const SAFETY_LABELS: Record<keyof SafetyRules, string> = {
  maxWeeklyHours: 'מקסימום שעות שבועיות',
  minRestHours: 'מינימום שעות מנוחה בין משמרות',
  maxDailyHours: 'מקסימום שעות ביום אחד',
  maxConsecutiveDays: 'מקסימום ימים רצופים',
}

/**
 * Same fix as CatalogEditor.tsx's useOptimisticList, generalized to a
 * settings-shaped object with partial patches: every control here
 * (working-day chips, hours, safety sliders, feature switches) used to
 * read its displayed value straight from `db.settings` — the server's
 * last confirmed read — and call dispatch() synchronously on every click,
 * so a tap only visually registered once the round trip finished. Local
 * state now updates instantly; the patches merge and coalesce into one
 * dispatch after a short pause. Not an optimistic mirror of business
 * logic (lib/shifts/actions.ts's header) — a settings patch has none to
 * duplicate, it's just object merge.
 */
function useOptimisticSettings<T extends Record<string, unknown>>(remote: T, save: (patch: Partial<T>) => Promise<boolean>) {
  const [local, setLocal] = useState(remote)
  const confirmed = useRef(remote)
  const pending = useRef<Partial<T>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (timer.current) return
    confirmed.current = remote
    setLocal(remote)
  }, [remote])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function patch(partial: Partial<T>) {
    setLocal((prev) => ({ ...prev, ...partial }))
    pending.current = { ...pending.current, ...partial }
    setError(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const toSave = pending.current
      pending.current = {}
      timer.current = null
      const ok = await save(toSave)
      if (ok) {
        confirmed.current = { ...confirmed.current, ...toSave }
      } else {
        setLocal(confirmed.current)
        setError(true)
        window.setTimeout(() => setError(false), 3200)
      }
    }, SAVE_DEBOUNCE_MS)
  }

  return { settings: local, patch, error }
}

// The permanently-editable settings screen: working days/hours, safety
// rules, feature flags, catalogs, and the roster (staff scheduling flags)
// — all in one place, same shape as AyekaBar's own ManagerPanel.
export default function ManagerPanel() {
  const { db, dispatch } = useShifts()
  const { settings, patch, error } = useOptimisticSettings(
    db?.settings ?? EMPTY_SETTINGS,
    (p) => dispatch({ type: 'updateSettings', branchId: db!.branchId, patch: p }),
  )
  if (!db) return null

  function toggleWorkingDay(day: number) {
    const next = settings.workingDays.includes(day) ? settings.workingDays.filter((d) => d !== day) : [...settings.workingDays, day].sort()
    patch({ workingDays: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <h3 style={sectionTitleStyle}>ימי פעילות</h3>
        <div role="group" aria-label="ימי פעילות" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Array.from({ length: 7 }, (_, d) => d).map((day) => {
            const active = settings.workingDays.includes(day)
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
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <div>
            <span style={{ ...labelStyle, textAlign: 'center', display: 'block' }}>פתיחה</span>
            <TimeWheel value={settings.openTime} onChange={(v) => patch({ openTime: v })} label="שעת פתיחה" />
          </div>
          <div>
            <span style={{ ...labelStyle, textAlign: 'center', display: 'block' }}>סגירה</span>
            <TimeWheel value={settings.closeTime} onChange={(v) => patch({ closeTime: v })} label="שעת סגירה" />
          </div>
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
                    {settings.safety[key]}
                  </span>
                </span>
                <input
                  type="range"
                  min={bounds.min}
                  max={bounds.max}
                  step={bounds.step}
                  value={settings.safety[key]}
                  onChange={(e) => patch({ safety: { ...settings.safety, [key]: Number(e.target.value) } })}
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
          <FeatureRow
            label="הגשת זמינות עצמית"
            on={settings.features.availability}
            onToggle={(v) => patch({ features: { ...settings.features, availability: v } })}
          />
          <FeatureRow
            label="בקשות החלפת משמרות"
            on={settings.features.swaps}
            onToggle={(v) => patch({ features: { ...settings.features, swaps: v } })}
          />
        </div>
      </section>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: '0.78rem', color: '#ff6b6b' }}>
          השמירה נכשלה — השינוי הוחזר. אפשר לנסות שוב.
        </p>
      )}

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

// Placeholder shape fed to the hook before `db` loads — never rendered
// (the component returns null first), only keeps the hook's generic type
// stable across the loading -> loaded transition.
const EMPTY_SETTINGS: ShiftSettings = {
  branchId: '',
  workingDays: [],
  openTime: '00:00',
  closeTime: '00:00',
  dayHours: {},
  roles: [],
  stations: [],
  presets: [],
  safety: { maxWeeklyHours: 0, minRestHours: 0, maxDailyHours: 0, maxConsecutiveDays: 0 },
  ruleSeverity: {},
  features: { availability: false, swaps: false },
  scheduleManagers: [],
  onboardedAt: null,
}

const sectionTitleStyle: CSSProperties = { margin: '0 0 10px', fontSize: '0.9rem', fontWeight: 700 }
const labelStyle: CSSProperties = { display: 'block', marginBottom: 4, fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-dim)' }
