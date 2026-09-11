'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AccessibilityStatement } from '@/lib/settings/keys'

// Every field has a properly associated <label htmlFor> via useId() — a
// real bug found in AyekaBar's own history was three contact fields with
// no accessible name at all, on the exact page whose job is producing the
// legally-required accessibility statement. Not repeating that here.
export default function AccessibilityStatementEditor({ initial }: { initial: AccessibilityStatement }) {
  const router = useRouter()
  const [values, setValues] = useState<AccessibilityStatement>(initial)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const ids = {
    browsers: useId(),
    entrance: useId(),
    restroom: useId(),
    general: useId(),
    exemption: useId(),
    name: useId(),
    phone: useId(),
    email: useId(),
  }

  function set<K extends keyof AccessibilityStatement>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    setStatus('saving')
    try {
      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'accessibility_statement', value: values }),
      })
      if (!res.ok) {
        setStatus('error')
        return
      }
      setStatus('saved')
      router.refresh()
    } catch {
      setStatus('error')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Field id={ids.browsers} label="דפדפנים שנבדקו" value={values.browsersTested} onChange={(v) => set('browsersTested', v)} />
      <Field id={ids.entrance} label="נגישות כניסה לדוכן" textarea value={values.entranceAccess} onChange={(v) => set('entranceAccess', v)} />
      <Field id={ids.restroom} label="נגישות שירותים" textarea value={values.restroomAccess} onChange={(v) => set('restroomAccess', v)} />
      <Field id={ids.general} label="הערה כללית" textarea value={values.generalNote} onChange={(v) => set('generalNote', v)} />
      <Field id={ids.exemption} label="פטור / חריגה (אם קיים)" value={values.exemptionNote} onChange={(v) => set('exemptionNote', v)} />
      <Field id={ids.name} label="שם איש קשר לנגישות" value={values.contactName} onChange={(v) => set('contactName', v)} />
      <Field id={ids.phone} label="טלפון" ltr value={values.contactPhone} onChange={(v) => set('contactPhone', v)} />
      <Field id={ids.email} label="אימייל" ltr value={values.contactEmail} onChange={(v) => set('contactEmail', v)} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          className="press"
          onClick={save}
          disabled={status === 'saving'}
          style={{
            minHeight: 'var(--tap-min)',
            padding: '0 20px',
            borderRadius: 999,
            border: 'none',
            background: 'var(--neon)',
            color: 'var(--bg)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {status === 'saving' ? 'שומר…' : 'שמירה'}
        </button>
        <span role="status" style={{ fontSize: '0.82rem', color: status === 'error' ? '#ff6b6b' : 'var(--text-faint)' }}>
          {status === 'saved' ? 'נשמר ✓' : status === 'error' ? 'שגיאה בשמירה' : ''}
        </span>
        <a href="/accessibility" target="_blank" rel="noopener noreferrer" style={{ marginInlineStart: 'auto', fontSize: '0.8rem', color: 'var(--neon-2)' }}>
          תצוגה חיה ↗
        </a>
      </div>
    </div>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  textarea,
  ltr,
}: {
  id: string
  label: string
  value?: string
  onChange: (v: string) => void
  textarea?: boolean
  ltr?: boolean
}) {
  const style: React.CSSProperties = {
    width: '100%',
    minHeight: textarea ? 64 : 'var(--tap-min)',
    borderRadius: 10,
    border: '1px solid var(--line-strong)',
    background: 'var(--bg-elev)',
    color: 'var(--text)',
    padding: '10px 12px',
    fontSize: '0.88rem',
    resize: 'vertical',
  }
  return (
    <label htmlFor={id} style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 6 }}>{label}</span>
      {textarea ? (
        <textarea id={id} value={value ?? ''} maxLength={600} onChange={(e) => onChange(e.target.value)} style={style} />
      ) : (
        <input id={id} dir={ltr ? 'ltr' : undefined} value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={style} />
      )}
    </label>
  )
}
