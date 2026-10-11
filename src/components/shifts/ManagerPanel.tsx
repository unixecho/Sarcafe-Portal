'use client'

import { useState, type CSSProperties } from 'react'
import { ExternalLink } from 'lucide-react'
import Switch from '@/components/Switch'
import { TimeWheel } from '@/components/WheelPicker'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { useSettingsDraft } from '@/components/shifts/SettingsDraft'
import { PresetCatalog, RoleCatalog, StationCatalog } from '@/components/shifts/CatalogEditor'
import RosterPanel from '@/components/shifts/RosterPanel'
import { hoursStatusLabel } from '@/lib/branches'
import { SAFETY_BOUNDS } from '@/lib/shifts/config'
import { effectiveWeek, openStatus, settingsFromWeek, usualHours, type DayHours, type HoursWeek } from '@/lib/shifts/hours-edit'
import { weekdayLongLabel } from '@/lib/shifts/time'
import type { SafetyRules } from '@/lib/shifts/types'

const SAFETY_LABELS: Record<keyof SafetyRules, string> = {
  maxWeeklyHours: 'מקסימום שעות שבועיות',
  minRestHours: 'מינימום שעות מנוחה בין משמרות',
  maxDailyHours: 'מקסימום שעות ביום אחד',
  maxConsecutiveDays: 'מקסימום ימים רצופים',
}

// The permanently-editable settings screen: opening hours, safety rules, feature
// flags, catalogs, and the roster (staff scheduling flags) — all in one place.
// Every control edits the settings DRAFT (SettingsDraft.tsx) and nothing is sent
// until the manager presses Save in the bar that appears at the bottom.
export default function ManagerPanel() {
  const { db } = useShifts()
  const { settings, patch } = useSettingsDraft()
  if (!db) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <p className="sch-sub">אפשר לשנות כאן כמה שרוצים — שום דבר לא נשמר עד שלוחצים ״שמירה״ בתחתית המסך. ההגדרות חלות על הסניף שבחרתם למעלה.</p>

      <HoursEditor />

      <section>
        <PresetCatalog />
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
          <FeatureRow label="הגשת זמינות עצמית" on={settings.features.availability} onToggle={(v) => patch({ features: { ...settings.features, availability: v } })} />
          <FeatureRow label="בקשות החלפת משמרות" on={settings.features.swaps} onToggle={(v) => patch({ features: { ...settings.features, swaps: v } })} />
        </div>
      </section>

      <section>
        <RoleCatalog />
      </section>

      <section>
        <StationCatalog />
      </section>

      <section>
        <h3 style={sectionTitleStyle}>צוות</h3>
        <RosterPanel />
      </section>
    </div>
  )
}

// One row per day, exactly what customers are shown. There is no separate
// "usual hours" with special exceptions hiding behind it (see lib/shifts/hours-edit.ts):
// every change is written back from the whole week.
function HoursEditor() {
  const { db, branchSlug } = useShifts()
  const { settings, patch } = useSettingsDraft()
  const [openDay, setOpenDay] = useState<number | null>(null)
  if (!db) return null

  const week = effectiveWeek(settings)
  const keep = usualHours(settings)
  const setWeek = (next: HoursWeek) => patch(settingsFromWeek(next, keep))
  const setDay = (day: number, hours: DayHours | null) => setWeek(week.map((h, d) => (d === day ? hours : h)))
  const status = openStatus(week, db.now)

  return (
    <section aria-labelledby="hours-title">
      <h3 id="hours-title" style={sectionTitleStyle}>
        שעות פעילות
      </h3>
      <p style={{ margin: '0 0 10px', fontSize: '0.78rem', color: 'var(--text-faint)' }}>
        השעות של כל יום, בדיוק כמו שהלקוחות רואים אותן בדף הסניף ובתפריט הדיגיטלי. יום שסגור לא מוצג כפתוח.
      </p>

      <ul className="sch-hours" aria-label="שעות הפעילות לפי יום">
        {week.map((hours, day) => {
          const editing = openDay === day && !!hours
          return (
            <li key={day} className="sch-hours__row">
              <div className="sch-hours__head">
                <span className="sch-hours__day">{weekdayLongLabel(day)}</span>
                {hours ? (
                  <button
                    type="button"
                    className="sch-hours__time ltr-isolate press"
                    aria-expanded={editing}
                    aria-label={`שעות ${weekdayLongLabel(day)}: ${hours.open} עד ${hours.close} — לחצו לשינוי`}
                    onClick={() => setOpenDay(editing ? null : day)}
                  >
                    {hours.open}–{hours.close}
                  </button>
                ) : (
                  <span className="sch-hours__closed">סגור</span>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!hours}
                  aria-label={`פתוח ב${weekdayLongLabel(day)}`}
                  className="press"
                  onClick={() => {
                    if (hours && openDay === day) setOpenDay(null)
                    setDay(day, hours ? null : keep)
                  }}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <Switch on={!!hours} />
                </button>
              </div>
              {editing && hours && (
                <div className="sch-hours__edit rise">
                  <div className="ltr-isolate" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                    <TimeWheel value={hours.open} onChange={(v) => setDay(day, { ...hours, open: v })} label="שעת פתיחה" />
                    <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>
                      —
                    </span>
                    <TimeWheel value={hours.close} onChange={(v) => setDay(day, { ...hours, close: v })} label="שעת סגירה" />
                  </div>
                  <button type="button" className="sch-btn sch-btn--sm press" onClick={() => setWeek(week.map((h) => (h ? hours : null)))}>
                    החלת השעות האלה על כל הימים הפתוחים
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className="sch-hours-preview" aria-label="כך הלקוחות רואים את השעות">
        <div className="sch-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span className="sch-label" style={{ margin: 0 }}>
            כך הלקוחות רואים את זה
          </span>
          <a className="sch-hours-preview__link" href={`/menu/${branchSlug}`} target="_blank" rel="noopener noreferrer">
            התפריט הדיגיטלי <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
        <p className="sch-hours-preview__status">
          <span aria-hidden="true" className={`sch-hours-preview__dot${status.openNow ? ' sch-hours-preview__dot--open' : ''}`} />
          {hoursStatusLabel({ hoursToday: status.today, openNow: status.openNow, hoursConfigured: true }, 'he')}
        </p>
        <dl className="portal-hours-list">
          {week.map((hours, day) => (
            <div key={day} className="portal-hours-row" data-closed={!hours}>
              <dt>{weekdayLongLabel(day)}</dt>
              <dd>{hours ? <bdi dir="ltr">{hours.open}–{hours.close}</bdi> : 'סגור'}</dd>
            </div>
          ))}
        </dl>
        <p className="sch-sub">מתעדכן אצל הלקוחות ברגע שלוחצים ״שמירה״ — אין צורך לפרסם בנפרד.</p>
      </div>
    </section>
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
