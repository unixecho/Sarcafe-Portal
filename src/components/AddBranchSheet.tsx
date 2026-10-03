'use client'

import { useEffect, useId, useState } from 'react'
import { MapPinPlus } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { SLUG_PATTERN, slugify, type Branch, type BranchKind } from '@/lib/branches'
import { useT } from '@/lib/pos/useT'
import '@/components/owner/pos/menu-mods.css'

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
 *
 * It also creates EVENTS (a one-off festival or stall): same sheet, same
 * endpoint, `kind: 'event'`. An event is hidden from the public portal, and
 * can start from a copy of an existing branch's PUBLISHED menu so nobody
 * retypes a menu for a Saturday stall.
 */
export default function AddBranchSheet({ open, onClose, onCreated }: AddBranchSheetProps) {
  const titleId = useId()
  const [nameHe, setNameHe] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useT()
  const [kind, setKind] = useState<BranchKind>('permanent')
  // Permanent branches only: the public list never includes events, and an event is
  // a poor template for another event. '' = start with an empty menu.
  const [sources, setSources] = useState<{ slug: string; label: string }[]>([])
  const [cloneFrom, setCloneFrom] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/branches')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { branches?: Branch[] } | null) => {
        if (cancelled || !payload?.branches) return
        const list = payload.branches.map((b) => ({ slug: b.slug, label: b.name.he || b.slug }))
        setSources(list)
        // An event usually reuses a real menu, so the first branch is the one-tap default.
        setCloneFrom((prev) => prev || list[0]?.slug || '')
      })
      .catch(() => {
        /* no list: the choice falls back to "empty", which is always safe */
      })
    return () => {
      cancelled = true
    }
  }, [open])

  function reset() {
    setKind('permanent')
    setNotice(null)
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
        body: JSON.stringify({
          slug,
          name: { he: nameHe.trim(), en: nameEn.trim() || undefined },
          ...(kind === 'event' ? { kind: 'event', ...(cloneFrom ? { cloneFromSlug: cloneFrom } : {}) } : {}),
        }),
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
        kind,
        links: { navGoogleMaps: null, navWaze: null, navAppleMaps: null, instagram: null, review: null, bit: null },
        reviews: null,
      })
      // The event exists either way; a failed menu copy is said out loud rather than
      // leaving someone to discover an empty menu on the day.
      if (payload?.cloneFailed) setNotice(t('owner.menu.branch.cloneFailed'))
      else close()
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
              {kind === 'event' ? t('owner.menu.branch.titleEvent') : 'סניף חדש'}
            </h2>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-faint)' }}>
              נוסיף אותו לרשימה מיד — אפשר לערוך פרטים בהמשך.
            </p>
          </div>
        </div>

        {notice ? (
          <>
            <p role="alert" style={{ margin: 0, fontSize: '0.88rem', color: 'var(--warn)' }}>
              {notice}
            </p>
            <button type="button" className="press" onClick={close} style={primaryButtonStyle}>
              {t('owner.menu.branch.understood')}
            </button>
          </>
        ) : (
          <>
        <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <legend style={{ fontSize: '0.82rem', color: 'var(--text-dim)', padding: 0, marginBottom: 6 }}>
            {t('owner.menu.branch.kind')}
          </legend>
          {(['permanent', 'event'] as const).map((k) => (
            <label key={k} className="mm-kind">
              <input type="radio" name={`${titleId}-kind`} checked={kind === k} onChange={() => setKind(k)} />
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>
                {k === 'permanent' ? t('owner.menu.branch.permanent') : t('owner.menu.branch.event')}
              </span>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>
                {k === 'permanent' ? t('owner.menu.branch.permanentHint') : t('owner.menu.branch.eventHint')}
              </span>
            </label>
          ))}
        </fieldset>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>
            {kind === 'event' ? t('owner.menu.branch.nameEvent') : 'שם הסניף (עברית)'}
          </span>
          <input
            autoFocus
            placeholder={kind === 'event' ? t('owner.menu.branch.nameEventPlaceholder') : 'למשל: כפר סבא'}
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

        {kind === 'event' && (
          <div role="radiogroup" aria-label={t('owner.menu.branch.clone')} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>{t('owner.menu.branch.clone')}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[...sources, { slug: '', label: t('owner.menu.branch.cloneEmpty') }].map((src) => (
                <button
                  key={src.slug || 'empty'}
                  type="button"
                  role="radio"
                  aria-checked={cloneFrom === src.slug}
                  className="press mm-chip"
                  style={{ minHeight: 44 }}
                  onClick={() => setCloneFrom(src.slug)}
                >
                  {src.label}
                </button>
              ))}
            </div>
          </div>
        )}

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
          {saving ? (kind === 'event' ? 'יוצר…' : 'יוצר סניף…') : kind === 'event' ? t('owner.menu.branch.createEvent') : 'יצירת סניף'}
        </button>
          </>
        )}
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
