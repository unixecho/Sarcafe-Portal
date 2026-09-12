'use client'

import { useId, useState } from 'react'
import { MapPinPlus } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { SLUG_PATTERN, slugify, type Branch } from '@/lib/branches'

type AddBranchSheetProps = {
  open: boolean
  onClose: () => void
  onCreated: (branch: Branch) => void
}

/**
 * Owner-only ("she branches out with another branch"). One short step —
 * this is meant to feel fast, not like a form. Slug is derived from the
 * English name live, editable if the owner wants a different one; server
 * still validates it (SLUG_PATTERN, uniqueness) since this is the only
 * client-side check.
 */
export default function AddBranchSheet({ open, onClose, onCreated }: AddBranchSheetProps) {
  const titleId = useId()
  const [nameHe, setNameHe] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setNameHe('')
    setNameEn('')
    setSlug('')
    setSlugTouched(false)
    setError(null)
  }

  function close() {
    reset()
    onClose()
  }

  function onNameEnChange(value: string) {
    setNameEn(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  const validSlug = SLUG_PATTERN.test(slug)
  const canSubmit = nameHe.trim().length > 0 && validSlug

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/owner/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name: { he: nameHe.trim(), en: nameEn.trim() || undefined } }),
      })
      const payload = await res.json()
      if (!res.ok) {
        setError(payload?.error?.message ?? 'שגיאה ביצירת הסניף')
        return
      }
      onCreated({
        id: payload.branchId,
        slug: payload.slug,
        name: { he: nameHe.trim(), en: nameEn.trim() },
        links: { navGoogleMaps: null, navWaze: null, navAppleMaps: null, instagram: null, review: null, bit: null },
      })
      close()
    } catch {
      setError('שגיאה ביצירת הסניף')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SheetShell open={open} onClose={close} labelledBy={titleId}>
      <div style={{ padding: '4px 4px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden="true"
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: 'rgba(255,122,69,0.14)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--neon)',
              flexShrink: 0,
            }}
          >
            <MapPinPlus size={20} strokeWidth={2} />
          </span>
          <div>
            <h2 id={titleId} style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
              סניף חדש
            </h2>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-faint)' }}>
              נוסיף אותו לרשימה מיד — אפשר לערוך פרטים בהמשך.
            </p>
          </div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>שם הסניף (עברית)</span>
          <input
            autoFocus
            placeholder="למשל: כפר סבא"
            value={nameHe}
            onChange={(event) => setNameHe(event.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>שם באנגלית (לכתובת התפריט)</span>
          <input
            dir="ltr"
            placeholder="e.g. Kfar Saba"
            value={nameEn}
            onChange={(event) => onNameEnChange(event.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>כתובת (אנגלית בלבד, ניתן לשינוי)</span>
          <input
            dir="ltr"
            className="ltr-isolate"
            value={slug}
            onChange={(event) => {
              setSlugTouched(true)
              setSlug(slugify(event.target.value))
            }}
            style={inputStyle}
          />
          {slug && !validSlug && (
            <span style={{ fontSize: '0.74rem', color: '#ff8a5c' }}>אותיות אנגליות, מספרים ומקף בלבד.</span>
          )}
        </label>

        {error && (
          <p role="alert" style={{ margin: 0, color: '#ff6b6b', fontSize: '0.82rem' }}>
            {error}
          </p>
        )}

        <button
          type="button"
          className="press"
          disabled={!canSubmit || saving}
          onClick={submit}
          style={{ ...primaryButtonStyle, opacity: canSubmit ? 1 : 0.5 }}
        >
          {saving ? 'יוצר סניף…' : 'יצירת סניף'}
        </button>
      </div>
    </SheetShell>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 'var(--tap-min)',
  borderRadius: 12,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 12px',
  fontSize: '0.9rem',
}

const primaryButtonStyle: React.CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 700,
  cursor: 'pointer',
}
