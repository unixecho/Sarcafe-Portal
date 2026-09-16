'use client'

import { useState } from 'react'
import { MapPin, Car, Compass, Camera, Star, Zap } from 'lucide-react'
import type { BranchLinks } from '@/lib/branches'

// Ported from AyekaBar's PortalLinksEditor.tsx pattern (labelled https://
// inputs, dirty-tracking, save/notice) — adapted to PATCH a branch row
// instead of a single app_settings key, since Sarcafe already stores links
// as real columns on `branches` (migration 005), one branch at a time
// rather than one shared blob.

const FIELDS: { key: keyof BranchLinks; label: string; icon: typeof MapPin }[] = [
  { key: 'navGoogleMaps', label: 'Google Maps', icon: MapPin },
  { key: 'navWaze', label: 'Waze', icon: Car },
  { key: 'navAppleMaps', label: 'Apple Maps', icon: Compass },
  { key: 'instagram', label: 'אינסטגרם', icon: Camera },
  { key: 'review', label: 'ביקורת בגוגל', icon: Star },
  { key: 'bit', label: 'Bit', icon: Zap },
]

export default function BranchLinksEditor({ branchId, initialLinks }: { branchId: string; initialLinks: BranchLinks }) {
  const [values, setValues] = useState(initialLinks)
  const [saved, setSaved] = useState(initialLinks)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const dirty = FIELDS.some((f) => (values[f.key] ?? '') !== (saved[f.key] ?? ''))

  async function save() {
    setSaving(true)
    setNotice(null)
    try {
      const res = await fetch('/api/owner/branches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          links: Object.fromEntries(FIELDS.map((f) => [f.key, values[f.key]?.trim() || null])),
        }),
      })
      const payload = await res.json()
      if (!res.ok) {
        setNotice({ type: 'error', text: payload?.error?.message ?? 'שגיאה בשמירה' })
        return
      }
      setValues(payload.links)
      setSaved(payload.links)
      setNotice({ type: 'ok', text: 'נשמר ✓' })
    } catch {
      setNotice({ type: 'error', text: 'שגיאה בשמירה' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {FIELDS.map(({ key, label, icon: Icon }) => (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label htmlFor={`link-${key}`} style={labelStyle}>
            <Icon size={14} aria-hidden="true" /> {label}
          </label>
          <input
            id={`link-${key}`}
            type="url"
            dir="ltr"
            placeholder="https://…"
            value={values[key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            style={inputStyle}
          />
        </div>
      ))}

      {notice && (
        <p
          role={notice.type === 'error' ? 'alert' : 'status'}
          style={{ margin: 0, fontSize: '0.8rem', color: notice.type === 'error' ? '#ff6b6b' : 'var(--neon-2)' }}
        >
          {notice.text}
        </p>
      )}

      <button
        type="button"
        className="press"
        onClick={save}
        disabled={!dirty || saving}
        style={{ ...saveButtonStyle, opacity: !dirty || saving ? 0.6 : 1 }}
      >
        {saving ? 'שומר…' : 'שמירת קישורים'}
      </button>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--text-dim)',
}

const inputStyle: React.CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 10,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 12px',
  fontSize: '0.85rem',
}

const saveButtonStyle: React.CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 999,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 700,
  fontSize: '0.9rem',
  cursor: 'pointer',
}
