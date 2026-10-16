'use client'

import type { CSSProperties } from 'react'
import { CalendarOff, Sunrise, Sunset } from 'lucide-react'
import Switch from '@/components/Switch'
import { useSettingsDraft } from '@/components/shifts/SettingsDraft'
import { DEFAULT_MAX_DAYS_OFF, MAX_DAYS_OFF_CEILING, MAX_SHIFT_BLOCKS_CEILING, maxDaysOffOf, maxShiftBlocksOf } from '@/lib/shifts/constraints'

// The manager's two limits for what an employee may ask for in a week (אילוצים). Part of the settings draft: nothing is
// sent until the manager presses Save. The words are the owner's: a number of DAYS OFF (default 2) and a number of
// "cannot do the morning / evening" requests, which today has no limit — the switch says so in plain words.
export default function ConstraintLimits() {
  const { settings, patch } = useSettingsDraft()
  const days = maxDaysOffOf(settings.features)
  const blocks = maxShiftBlocksOf(settings.features)
  const unlimited = blocks === null
  const set = (next: Record<string, unknown>) => patch({ features: { ...settings.features, ...next } })

  return (
    <div className="sch-constraint-limits">
      <label style={{ display: 'block' }}>
        <span style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><CalendarOff size={15} aria-hidden="true" />ימי חופש שעובד/ת יכול/ה לבקש בשבוע</span>
          <strong className="ltr-isolate" style={{ color: 'var(--neon-soft)' }}>{days}</strong>
        </span>
        <input type="range" min={0} max={MAX_DAYS_OFF_CEILING} step={1} value={days} aria-label="ימי חופש לעובד בשבוע" onChange={(e) => set({ maxDaysOff: Number(e.target.value) })} style={{ width: '100%' }} />
        <span style={hintStyle}>ברירת המחדל {DEFAULT_MAX_DAYS_OFF}. יום חופש מחכה לאישור שלכם; אחרי שאושר, אי אפשר לשבץ את העובד/ת באף סניף באותו יום.</span>
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, ...labelStyle, margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Sunrise size={15} aria-hidden="true" /><Sunset size={15} aria-hidden="true" />
            להגביל את מספר המשמרות (בוקר / ערב) שעובד/ת יכול/ה לחסום בשבוע
          </span>
          <button
            type="button" role="switch" aria-checked={!unlimited} aria-label="הגבלת חסימות של משמרת בוקר או ערב" className="press"
            onClick={() => set({ maxShiftBlocks: unlimited ? 3 : null })}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <Switch on={!unlimited} />
          </button>
        </div>
        {unlimited ? (
          <span style={hintStyle}>כרגע בלי הגבלה: עובד/ת יכולים לסמן &quot;לא יכול/ה משמרת בוקר&quot; או &quot;לא יכול/ה משמרת ערב&quot; בכמה ימים שירצו. את/ה רואים את זה כשבונים את הסידור, ואפשר לשבץ בכל זאת.</span>
        ) : (
          <label style={{ display: 'block' }}>
            <span style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
              <span>מקסימום חסימות בשבוע</span>
              <strong className="ltr-isolate" style={{ color: 'var(--neon-soft)' }}>{blocks}</strong>
            </span>
            <input type="range" min={0} max={MAX_SHIFT_BLOCKS_CEILING} step={1} value={blocks ?? 0} aria-label="חסימות משמרת בשבוע" onChange={(e) => set({ maxShiftBlocks: Number(e.target.value) })} style={{ width: '100%' }} />
            <span style={hintStyle}>בכל יום עובד/ת בוחרים אחד: בוקר, ערב או יום חופש מלא. כל חסימה של בוקר או ערב נספרת פעם אחת, ויום חופש מלא לא נספר כאן.</span>
          </label>
        )}
      </div>
    </div>
  )
}

const labelStyle: CSSProperties = { display: 'block', marginBottom: 4, fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-dim)' }
const hintStyle: CSSProperties = { display: 'block', fontSize: '0.74rem', color: 'var(--text-faint)', lineHeight: 1.5 }
