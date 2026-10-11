'use client'

import { useState, type CSSProperties } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useSettingsDraft } from '@/components/shifts/SettingsDraft'
import { TimeWheel } from '@/components/WheelPicker'
import { ACCENT_COLORS } from '@/lib/shifts/config'
import { randomId } from '@/lib/menu/id'
import type { ShiftPreset } from '@/lib/shifts/types'

// Three near-identical add/rename/delete editors (roles, stations, shift
// templates) — a simple always-append list, given Sarcafe's small, fairly fixed
// vocabulary for a two-branch coffee truck.
//
// They edit the settings DRAFT (SettingsDraft.tsx): typing, adding, deleting or
// turning a wheel changes only what is on screen. Nothing is sent until the
// manager presses Save in the bar at the bottom of the screen.

export function RoleCatalog() {
  const { settings, patch } = useSettingsDraft()
  const roles = settings.roles
  const [name, setName] = useState('')
  function add() {
    if (!name.trim()) return
    patch({ roles: [...roles, { id: randomId('role'), name: name.trim(), color: ACCENT_COLORS[roles.length % ACCENT_COLORS.length]! }] })
    setName('')
  }
  return (
    <section>
      <h3 style={sectionTitleStyle}>תפקידים</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {roles.map((role) => (
          <div key={role.id} style={rowStyle}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: role.color, flexShrink: 0 }} />
            <input value={role.name} aria-label="שם התפקיד" onChange={(e) => patch({ roles: roles.map((i) => (i.id === role.id ? { ...i, name: e.target.value } : i)) })} style={rowInputStyle} />
            <button type="button" className="press" onClick={() => patch({ roles: roles.filter((i) => i.id !== role.id) })} aria-label="מחיקת תפקיד" style={deleteBtnStyle}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="תפקיד חדש" style={{ ...rowInputStyle, flex: 1 }} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" className="press" onClick={add} aria-label="הוספת תפקיד" style={addBtnStyle}>
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

export function StationCatalog() {
  const { settings, patch } = useSettingsDraft()
  const stations = settings.stations
  const [name, setName] = useState('')
  function add() {
    if (!name.trim()) return
    patch({ stations: [...stations, { id: randomId('station'), name: name.trim(), emoji: '📍' }] })
    setName('')
  }
  return (
    <section>
      <h3 style={sectionTitleStyle}>עמדות</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {stations.map((station) => (
          <div key={station.id} style={rowStyle}>
            <span aria-hidden="true" style={{ fontSize: '1rem' }}>
              {station.emoji}
            </span>
            <input value={station.name} aria-label="שם העמדה" onChange={(e) => patch({ stations: stations.map((i) => (i.id === station.id ? { ...i, name: e.target.value } : i)) })} style={rowInputStyle} />
            <button type="button" className="press" onClick={() => patch({ stations: stations.filter((i) => i.id !== station.id) })} aria-label="מחיקת עמדה" style={deleteBtnStyle}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="עמדה חדשה" style={{ ...rowInputStyle, flex: 1 }} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" className="press" onClick={add} aria-label="הוספת עמדה" style={addBtnStyle}>
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

export function PresetCatalog() {
  const { settings, patch } = useSettingsDraft()
  const presets = settings.presets
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  function add() {
    if (!name.trim()) return
    patch({ presets: [...presets, { id: randomId('preset'), name: name.trim(), startTime: settings.openTime, endTime: settings.closeTime }] })
    setName('')
  }
  function update(id: string, change: Partial<ShiftPreset>) {
    patch({ presets: presets.map((i) => (i.id === id ? { ...i, ...change } : i)) })
  }
  return (
    <section>
      <h3 style={sectionTitleStyle}>תבניות משמרת</h3>
      <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
        אלה השעות שיוצעו אוטומטית כשיוצרים משמרת חדשה (למשל &quot;בוקר <span className="ltr-isolate">07:00–13:00</span>&quot;). שינוי כאן משפיע רק על משמרות שתיצרו מעכשיו — משמרות שכבר קיימות
        בלוח שומרות את השעות שלהן.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {presets.map((preset) => {
          const open = openId === preset.id
          return (
            <div key={preset.id} style={{ borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--bg)', overflow: 'hidden' }}>
              <div style={{ ...rowStyle, padding: 6 }}>
                <input value={preset.name} aria-label="שם התבנית" onChange={(e) => update(preset.id, { name: e.target.value })} style={{ ...rowInputStyle, flex: 1, border: 'none', background: 'transparent' }} />
                <button
                  type="button"
                  className="press ltr-isolate"
                  aria-label={`שעות ${preset.name}: ${preset.startTime} עד ${preset.endTime} — לחצו לשינוי`}
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : preset.id)}
                  style={{ ...rowInputStyle, width: 'auto', padding: '0 10px', background: 'var(--bg-elev-2)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {preset.startTime}–{preset.endTime}
                </button>
                <button type="button" className="press" onClick={() => patch({ presets: presets.filter((i) => i.id !== preset.id) })} aria-label="מחיקת תבנית" style={deleteBtnStyle}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
              {open && (
                <div className="rise ltr-isolate" style={{ padding: '4px 10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <TimeWheel value={preset.startTime} onChange={(v) => update(preset.id, { startTime: v })} label="שעת התחלה" />
                  <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>—</span>
                  <TimeWheel value={preset.endTime} onChange={(v) => update(preset.id, { endTime: v })} label="שעת סיום" />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="תבנית חדשה" style={{ ...rowInputStyle, flex: 1 }} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" className="press" onClick={add} aria-label="הוספת תבנית" style={addBtnStyle}>
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

const sectionTitleStyle: CSSProperties = { margin: '0 0 8px', fontSize: '0.9rem', fontWeight: 700 }
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const rowInputStyle: CSSProperties = {
  minHeight: 38,
  borderRadius: 10,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 10px',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
}
const deleteBtnStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev-2)',
  color: '#ff6b6b',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  flexShrink: 0,
}
const addBtnStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 10,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  flexShrink: 0,
}
