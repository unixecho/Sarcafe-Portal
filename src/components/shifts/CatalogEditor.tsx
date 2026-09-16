'use client'

import { useState, type CSSProperties } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { ACCENT_COLORS } from '@/lib/shifts/config'
import { randomId } from '@/lib/menu/id'
import type { ShiftPreset, ShiftRole, Station } from '@/lib/shifts/types'

// Three near-identical add/rename/delete editors (roles, stations,
// presets) — trimmed from AyekaBar's single CatalogEditor.tsx (which also
// handles reordering and delete-impact warnings) to a simpler always-append
// list, given Sarcafe's much smaller, fairly fixed vocabulary for a
// two-branch coffee truck vs. a full bar's role/station catalog.
export default function CatalogEditor() {
  const { db, dispatch } = useShifts()
  if (!db) return null

  async function saveRoles(roles: ShiftRole[]) {
    await dispatch({ type: 'updateSettings', branchId: db!.branchId, patch: { roles } })
  }
  async function saveStations(stations: Station[]) {
    await dispatch({ type: 'updateSettings', branchId: db!.branchId, patch: { stations } })
  }
  async function savePresets(presets: ShiftPreset[]) {
    await dispatch({ type: 'updateSettings', branchId: db!.branchId, patch: { presets } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <RoleList items={db.settings.roles} onSave={saveRoles} />
      <StationList items={db.settings.stations} onSave={saveStations} />
      <PresetList items={db.settings.presets} onSave={savePresets} />
    </div>
  )
}

function RoleList({ items, onSave }: { items: ShiftRole[]; onSave: (v: ShiftRole[]) => void }) {
  const [name, setName] = useState('')
  function add() {
    if (!name.trim()) return
    onSave([...items, { id: randomId('role'), name: name.trim(), color: ACCENT_COLORS[items.length % ACCENT_COLORS.length]! }])
    setName('')
  }
  return (
    <section>
      <h3 style={sectionTitleStyle}>תפקידים</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((role) => (
          <div key={role.id} style={rowStyle}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: role.color, flexShrink: 0 }} />
            <input value={role.name} onChange={(e) => onSave(items.map((i) => (i.id === role.id ? { ...i, name: e.target.value } : i)))} style={rowInputStyle} />
            <button type="button" className="press" onClick={() => onSave(items.filter((i) => i.id !== role.id))} aria-label="מחיקת תפקיד" style={deleteBtnStyle}>
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

function StationList({ items, onSave }: { items: Station[]; onSave: (v: Station[]) => void }) {
  const [name, setName] = useState('')
  function add() {
    if (!name.trim()) return
    onSave([...items, { id: randomId('station'), name: name.trim(), emoji: '📍' }])
    setName('')
  }
  return (
    <section>
      <h3 style={sectionTitleStyle}>עמדות</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((station) => (
          <div key={station.id} style={rowStyle}>
            <span aria-hidden="true" style={{ fontSize: '1rem' }}>
              {station.emoji}
            </span>
            <input
              value={station.name}
              onChange={(e) => onSave(items.map((i) => (i.id === station.id ? { ...i, name: e.target.value } : i)))}
              style={rowInputStyle}
            />
            <button type="button" className="press" onClick={() => onSave(items.filter((i) => i.id !== station.id))} aria-label="מחיקת עמדה" style={deleteBtnStyle}>
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

function PresetList({ items, onSave }: { items: ShiftPreset[]; onSave: (v: ShiftPreset[]) => void }) {
  const [name, setName] = useState('')
  function add() {
    if (!name.trim()) return
    onSave([...items, { id: randomId('preset'), name: name.trim(), startTime: '08:00', endTime: '16:00' }])
    setName('')
  }
  function update(id: string, patch: Partial<ShiftPreset>) {
    onSave(items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }
  return (
    <section>
      <h3 style={sectionTitleStyle}>תבניות משמרת</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((preset) => (
          <div key={preset.id} style={{ ...rowStyle, flexWrap: 'wrap' }}>
            <input value={preset.name} onChange={(e) => update(preset.id, { name: e.target.value })} style={{ ...rowInputStyle, flex: 1, minWidth: 100 }} />
            <input type="time" value={preset.startTime} onChange={(e) => update(preset.id, { startTime: e.target.value })} className="ltr-isolate" style={{ ...rowInputStyle, width: 90 }} />
            <input type="time" value={preset.endTime} onChange={(e) => update(preset.id, { endTime: e.target.value })} className="ltr-isolate" style={{ ...rowInputStyle, width: 90 }} />
            <button type="button" className="press" onClick={() => onSave(items.filter((i) => i.id !== preset.id))} aria-label="מחיקת תבנית" style={deleteBtnStyle}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
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
