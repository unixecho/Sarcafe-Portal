'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { TimeWheel } from '@/components/WheelPicker'
import { ACCENT_COLORS } from '@/lib/shifts/config'
import { randomId } from '@/lib/menu/id'
import type { ShiftPreset, ShiftRole, Station } from '@/lib/shifts/types'

const SAVE_DEBOUNCE_MS = 500

/**
 * Buffers local edits and coalesces them into ONE dispatch call after a
 * short pause, instead of firing on every keystroke/click. This is
 * deliberately NOT the "optimistic reducer mirroring server logic" that
 * lib/shifts/actions.ts's header explains this module avoids elsewhere —
 * these three lists (role/station names, preset times) carry no safety
 * rules to duplicate; the fix here only changes WHEN the existing
 * dispatch() fires, never what it does. dispatch() itself still owns the
 * real state (a fresh server read replaces `local` on success).
 *
 * Root cause of "it doesn't let me type — every keystroke waits on
 * Supabase": the input's value used to be bound straight to the
 * server-round-tripped prop, with `onSave` (async) called on every
 * change. Typing a second character before the first request resolved
 * had nothing to display it against.
 */
function useOptimisticList<T>(remote: T[], save: (next: T[]) => Promise<boolean>) {
  const [local, setLocal] = useState(remote)
  const confirmed = useRef(remote)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState(false)

  // Adopt a change that came from elsewhere (another tab, a refresh after
  // a DIFFERENT action) only while nothing is buffered locally — never
  // clobber an edit that hasn't saved yet.
  useEffect(() => {
    if (timer.current) return
    confirmed.current = remote
    setLocal(remote)
  }, [remote])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function mutate(updater: (prev: T[]) => T[]) {
    const next = updater(local)
    setLocal(next)
    setError(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      timer.current = null
      const ok = await save(next)
      if (ok) {
        confirmed.current = next
      } else {
        setLocal(confirmed.current)
        setError(true)
        window.setTimeout(() => setError(false), 3200)
      }
    }, SAVE_DEBOUNCE_MS)
  }

  return { list: local, mutate, error }
}

// Three near-identical add/rename/delete editors (roles, stations,
// presets) — trimmed from AyekaBar's single CatalogEditor.tsx (which also
// handles reordering and delete-impact warnings) to a simpler always-append
// list, given Sarcafe's much smaller, fairly fixed vocabulary for a
// two-branch coffee truck vs. a full bar's role/station catalog.
export default function CatalogEditor() {
  const { db, dispatch } = useShifts()
  if (!db) return null

  async function saveRoles(roles: ShiftRole[]) {
    return dispatch({ type: 'updateSettings', branchId: db!.branchId, patch: { roles } })
  }
  async function saveStations(stations: Station[]) {
    return dispatch({ type: 'updateSettings', branchId: db!.branchId, patch: { stations } })
  }
  async function savePresets(presets: ShiftPreset[]) {
    return dispatch({ type: 'updateSettings', branchId: db!.branchId, patch: { presets } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <RoleList items={db.settings.roles} onSave={saveRoles} />
      <StationList items={db.settings.stations} onSave={saveStations} />
      <PresetList items={db.settings.presets} onSave={savePresets} />
    </div>
  )
}

function SaveWarning() {
  return (
    <p role="alert" style={{ margin: '6px 0 0', fontSize: '0.76rem', color: '#ff6b6b' }}>
      השמירה נכשלה — השינוי הוחזר. אפשר לנסות שוב.
    </p>
  )
}

function RoleList({ items, onSave }: { items: ShiftRole[]; onSave: (v: ShiftRole[]) => Promise<boolean> }) {
  const { list, mutate, error } = useOptimisticList(items, onSave)
  const [name, setName] = useState('')
  function add() {
    if (!name.trim()) return
    mutate((prev) => [...prev, { id: randomId('role'), name: name.trim(), color: ACCENT_COLORS[prev.length % ACCENT_COLORS.length]! }])
    setName('')
  }
  return (
    <section>
      <h3 style={sectionTitleStyle}>תפקידים</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {list.map((role) => (
          <div key={role.id} style={rowStyle}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: role.color, flexShrink: 0 }} />
            <input
              value={role.name}
              onChange={(e) => {
                const value = e.target.value
                mutate((prev) => prev.map((i) => (i.id === role.id ? { ...i, name: value } : i)))
              }}
              style={rowInputStyle}
            />
            <button
              type="button"
              className="press"
              onClick={() => mutate((prev) => prev.filter((i) => i.id !== role.id))}
              aria-label="מחיקת תפקיד"
              style={deleteBtnStyle}
            >
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
      {error && <SaveWarning />}
    </section>
  )
}

function StationList({ items, onSave }: { items: Station[]; onSave: (v: Station[]) => Promise<boolean> }) {
  const { list, mutate, error } = useOptimisticList(items, onSave)
  const [name, setName] = useState('')
  function add() {
    if (!name.trim()) return
    mutate((prev) => [...prev, { id: randomId('station'), name: name.trim(), emoji: '📍' }])
    setName('')
  }
  return (
    <section>
      <h3 style={sectionTitleStyle}>עמדות</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {list.map((station) => (
          <div key={station.id} style={rowStyle}>
            <span aria-hidden="true" style={{ fontSize: '1rem' }}>
              {station.emoji}
            </span>
            <input
              value={station.name}
              onChange={(e) => {
                const value = e.target.value
                mutate((prev) => prev.map((i) => (i.id === station.id ? { ...i, name: value } : i)))
              }}
              style={rowInputStyle}
            />
            <button
              type="button"
              className="press"
              onClick={() => mutate((prev) => prev.filter((i) => i.id !== station.id))}
              aria-label="מחיקת עמדה"
              style={deleteBtnStyle}
            >
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
      {error && <SaveWarning />}
    </section>
  )
}

function PresetList({ items, onSave }: { items: ShiftPreset[]; onSave: (v: ShiftPreset[]) => Promise<boolean> }) {
  const { list, mutate, error } = useOptimisticList(items, onSave)
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  function add() {
    if (!name.trim()) return
    mutate((prev) => [...prev, { id: randomId('preset'), name: name.trim(), startTime: '08:00', endTime: '16:00' }])
    setName('')
  }
  function update(id: string, patch: Partial<ShiftPreset>) {
    mutate((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }
  return (
    <section>
      <h3 style={sectionTitleStyle}>תבניות משמרת</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((preset) => {
          const open = openId === preset.id
          return (
            <div key={preset.id} style={{ borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--bg)', overflow: 'hidden' }}>
              <div style={{ ...rowStyle, padding: 6 }}>
                <input
                  value={preset.name}
                  onChange={(e) => update(preset.id, { name: e.target.value })}
                  style={{ ...rowInputStyle, flex: 1, border: 'none', background: 'transparent' }}
                />
                <button
                  type="button"
                  className="press"
                  onClick={() => setOpenId(open ? null : preset.id)}
                  style={{ ...rowInputStyle, width: 'auto', padding: '0 10px', background: 'var(--bg-elev-2)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {preset.startTime}–{preset.endTime}
                </button>
                <button type="button" className="press" onClick={() => mutate((prev) => prev.filter((i) => i.id !== preset.id))} aria-label="מחיקת תבנית" style={deleteBtnStyle}>
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
      {error && <SaveWarning />}
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
