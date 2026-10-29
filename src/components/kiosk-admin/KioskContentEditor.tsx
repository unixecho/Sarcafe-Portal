'use client'

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import Switch from '@/components/Switch'
import type { OwnerKioskContent } from '@/lib/kiosk/content'
import { AD_ACTIONS, SETTINGS_BOUNDS, hoursText, imageAllowed, projectHours, type AdAction, type AdKind } from '@/lib/kiosk/content-project'
import { ACTION_LABELS, KIND_LABELS, MAX_ADS, MAX_OPTIONS, type ContentSave } from '@/lib/kiosk/content-schema'

// Everything the kiosk shows between customers, on one page with ONE Save (the owner's rule for settings: every
// control edits a draft in the browser; nothing is sent until Save; "ביטול שינויים" puts the saved values back). The
// draft also survives a reload in sessionStorage, like the schedule settings' draft. The server validates everything
// again and writes it all or nothing.

type DraftAd = {
  key: string
  id: string | null
  seeded: boolean
  kind: AdKind
  title: string
  body: string
  action: AdAction
  imageUrl: string
  menuItemIds: string[]
  enabled: boolean
}
type DraftOption = { key: string; id: string | null; label: string; enabled: boolean }
type DraftException = { key: string; date: string; closed: boolean; open: string; close: string; note: string }
type Draft = {
  idleSeconds: number
  graceSeconds: number
  slideSeconds: number
  exceptions: DraftException[]
  ads: DraftAd[]
  options: DraftOption[]
}

const STORAGE_KEY = 'sarcafe:kiosk-draft:v1'
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
let seq = 0
const newKey = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`

function toDraft(content: OwnerKioskContent): Draft {
  return {
    idleSeconds: content.settings.idleSeconds,
    graceSeconds: content.settings.graceSeconds,
    slideSeconds: content.settings.slideSeconds,
    exceptions: content.settings.exceptions.map((e) => ({
      key: `x${e.date}`, date: e.date, closed: e.closed, open: e.open ?? '', close: e.close ?? '', note: e.note ?? '',
    })),
    ads: content.ads.map((ad) => ({
      key: ad.id, id: ad.id, seeded: ad.seeded, kind: ad.kind as AdKind, title: ad.title, body: ad.body,
      action: (AD_ACTIONS as readonly string[]).includes(ad.action) ? (ad.action as AdAction) : 'none',
      imageUrl: ad.imageUrl ?? '', menuItemIds: ad.menuItemIds, enabled: ad.enabled,
    })),
    options: content.options.map((o) => ({ key: o.id, id: o.id, label: o.label, enabled: o.enabled })),
  }
}

function toRequest(draft: Draft): ContentSave {
  return {
    settings: {
      idleSeconds: draft.idleSeconds,
      graceSeconds: draft.graceSeconds,
      slideSeconds: draft.slideSeconds,
      exceptions: draft.exceptions.map((e) => ({
        date: e.date, closed: e.closed, open: e.closed ? null : e.open || null, close: e.closed ? null : e.close || null, note: e.note.trim() || null,
      })),
    },
    ads: draft.ads.map((ad) => ({
      id: ad.id, kind: ad.kind, title: ad.title, body: ad.kind === 'hours' ? '' : ad.body, action: ad.action,
      imageUrl: ad.imageUrl.trim() || null, menuItemIds: ad.kind === 'menu_highlight' ? ad.menuItemIds : [], enabled: ad.enabled,
    })),
    options: draft.options.map((o) => ({ id: o.id, label: o.label, enabled: o.enabled })),
  }
}

/** Comparing what would be SENT, so keys and other UI-only fields never make the page look unsaved. */
const fingerprint = (draft: Draft) => JSON.stringify(toRequest(draft))

function problems(draft: Draft, imagePrefix: string | null): string[] {
  const out: string[] = []
  const inRange = (v: number, b: { min: number; max: number }) => Number.isInteger(v) && v >= b.min && v <= b.max
  if (!inRange(draft.idleSeconds, SETTINGS_BOUNDS.idleSeconds)) out.push(`זמן ההמתנה צריך להיות בין ${SETTINGS_BOUNDS.idleSeconds.min} ל-${SETTINGS_BOUNDS.idleSeconds.max} שניות.`)
  if (!inRange(draft.graceSeconds, SETTINGS_BOUNDS.graceSeconds)) out.push(`זמן האזהרה צריך להיות בין ${SETTINGS_BOUNDS.graceSeconds.min} ל-${SETTINGS_BOUNDS.graceSeconds.max} שניות.`)
  if (!inRange(draft.slideSeconds, SETTINGS_BOUNDS.slideSeconds)) out.push(`זמן כל כרטיס צריך להיות בין ${SETTINGS_BOUNDS.slideSeconds.min} ל-${SETTINGS_BOUNDS.slideSeconds.max} שניות.`)
  draft.ads.forEach((ad, i) => {
    if (!ad.title.trim()) out.push(`לכרטיס ${i + 1} חסרה כותרת.`)
    if (ad.imageUrl.trim() && !imageAllowed(ad.imageUrl.trim(), imagePrefix)) out.push(`התמונה בכרטיס ${i + 1} חייבת להיות קישור ציבורי מהאחסון של שרקפה.`)
  })
  draft.options.forEach((o, i) => { if (!o.label.trim()) out.push(`לאפשרות הצבעה ${i + 1} חסר שם.`) })
  const dates = new Set<string>()
  draft.exceptions.forEach((e) => {
    if (!e.date) out.push('לאחד מימי החריגה חסר תאריך.')
    else if (dates.has(e.date)) out.push(`התאריך ${e.date} מופיע פעמיים.`)
    dates.add(e.date)
    if (!e.closed && (!e.open || !e.close)) out.push(`ביום ${e.date || 'החריגה'} חסרות שעות פתיחה וסגירה (או סמנו "סגור").`)
  })
  return out
}

export default function KioskContentEditor({ initial }: { initial: OwnerKioskContent }) {
  const [content, setContent] = useState(initial)
  const saved = useMemo(() => toDraft(content), [content])
  const [draft, setDraft] = useState<Draft>(saved)
  const [restored, setRestored] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)

  const dirty = fingerprint(draft) !== fingerprint(saved)
  const issues = problems(draft, content.imagePrefix)

  // restore an unsaved draft once (a reload or a stray tap on a link must not lose the owner's work)
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Draft | null
      if (stored && Array.isArray(stored.ads) && Array.isArray(stored.options) && Array.isArray(stored.exceptions)
          && fingerprint(stored) !== fingerprint(saved)) {
        setDraft(stored)
        setRestored(true)
      }
    } catch {
      // blocked or corrupt storage: the saved values are a correct start
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
      else sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // storage blocked: the draft still lives in memory
    }
  }, [draft, dirty])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const patch = (partial: Partial<Draft>) => { setNotice(null); setDraft((d) => ({ ...d, ...partial })) }
  const patchAd = (key: string, partial: Partial<DraftAd>) => patch({ ads: draft.ads.map((ad) => (ad.key === key ? { ...ad, ...partial } : ad)) })
  const patchOption = (key: string, partial: Partial<DraftOption>) => patch({ options: draft.options.map((o) => (o.key === key ? { ...o, ...partial } : o)) })
  const patchException = (key: string, partial: Partial<DraftException>) => patch({ exceptions: draft.exceptions.map((e) => (e.key === key ? { ...e, ...partial } : e)) })
  function move<T>(list: T[], index: number, delta: number): T[] {
    const target = index + delta
    if (target < 0 || target >= list.length) return list
    const next = list.slice()
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved as T)
    return next
  }

  async function save() {
    if (!dirty || saving || issues.length > 0) return
    setSaving(true)
    setNotice(null)
    try {
      const res = await fetch('/api/owner/kiosk/content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toRequest(draft)),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        setNotice({ type: 'error', text: payload?.error?.message && /[֐-׿]/.test(payload.error.message) ? payload.error.message : 'השמירה נכשלה. נסו שוב.' })
        return
      }
      const next = payload as OwnerKioskContent
      setContent(next)
      setDraft(toDraft(next))
      setRestored(false)
      setNotice({ type: 'ok', text: 'נשמר. הקיוסק יתעדכן תוך כדקה.' })
    } catch {
      setNotice({ type: 'error', text: 'השמירה נכשלה. בדקו את החיבור ונסו שוב.' })
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setDraft(saved)
    setRestored(false)
    setNotice(null)
  }

  const hoursPreview = hoursText(projectHours(
    content.weeklyHours,
    draft.exceptions.map((e) => ({ date: e.date, closed: e.closed, open: e.open || null, close: e.close || null, note: e.note || null })),
    content.timezone,
    new Intl.DateTimeFormat('en-CA', { timeZone: content.timezone }).format(new Date()),
  ))
  const menuById = new Map(content.menuItems.map((item) => [item.id, item]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 96 }}>
      <div>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
          מה הקיוסק בגבעת חביבה מציג כשאף אחד לא משתמש בו. שינויים נשמרים רק בלחיצה על &quot;שמירה&quot;.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <Link href="/owner/kiosk/feedback" className="press" style={{ ...btn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>תוצאות ההצבעה</Link>
          <a href="/feedback" target="_blank" rel="noopener" className="press" style={{ ...btn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>דף ההצבעה (תצוגה)</a>
        </div>
      </div>

      {restored && (
        <p role="status" style={{ ...note, color: 'var(--warn)', background: 'var(--warn-bg)' }}>
          שוחזרו שינויים שלא נשמרו. אפשר לשמור אותם או לבטל.
        </p>
      )}

      <Section title="זמנים">
        <NumberRow label="המתנה עד שהקיוסק חוזר למסך הפרסומות (שניות)" value={draft.idleSeconds} bounds={SETTINGS_BOUNDS.idleSeconds} onChange={(v) => patch({ idleSeconds: v })} />
        <NumberRow label="זמן ההתראה &quot;עוד כאן?&quot; לפני החזרה (שניות)" value={draft.graceSeconds} bounds={SETTINGS_BOUNDS.graceSeconds} onChange={(v) => patch({ graceSeconds: v })} />
        <NumberRow label="כמה זמן כל כרטיס מוצג (שניות)" value={draft.slideSeconds} bounds={SETTINGS_BOUNDS.slideSeconds} onChange={(v) => patch({ slideSeconds: v })} />
      </Section>

      <Section title="כרטיסים" hint="הסדר כאן הוא הסדר בקיוסק. כרטיס כבוי לא מוצג. את הכרטיסים הקבועים אפשר לכבות אבל לא למחוק.">
        {draft.ads.map((ad, index) => (
          <article key={ad.key} style={{ ...item, opacity: ad.enabled ? 1 : 0.72 }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={pill}>{KIND_LABELS[ad.kind]}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>{index + 1}</span>
              <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                <IconButton label="הזזה למעלה" disabled={index === 0} onClick={() => patch({ ads: move(draft.ads, index, -1) })}><ArrowUp size={16} /></IconButton>
                <IconButton label="הזזה למטה" disabled={index === draft.ads.length - 1} onClick={() => patch({ ads: move(draft.ads, index, 1) })}><ArrowDown size={16} /></IconButton>
                <button type="button" role="switch" aria-checked={ad.enabled} aria-label={`הצגת הכרטיס ${ad.title || index + 1}`} onClick={() => patchAd(ad.key, { enabled: !ad.enabled })} style={switchBtn}>
                  <Switch on={ad.enabled} />
                </button>
              </span>
            </header>

            <Field label="כותרת">
              <input value={ad.title} maxLength={80} onChange={(e) => patchAd(ad.key, { title: e.target.value })} style={input} />
            </Field>

            {ad.kind === 'hours' ? (
              <div>
                <span style={fieldLabel}>טקסט (נכתב אוטומטית מהשעות)</span>
                <p style={{ ...note, whiteSpace: 'pre-line' }}>{hoursPreview || 'אין שעות פעילות מוגדרות, ולכן הכרטיס לא יוצג.'}</p>
              </div>
            ) : (
              <Field label="טקסט">
                <textarea value={ad.body} maxLength={400} rows={3} onChange={(e) => patchAd(ad.key, { body: e.target.value })} style={{ ...input, resize: 'vertical', minHeight: 72 }} />
              </Field>
            )}

            {ad.kind === 'loyalty' && <p style={hintText}>ההטבות עדיין בתכנון ואינן פעילות; ההרשמה היא לרשימת המתעניינים בלבד.</p>}
            {ad.kind === 'feedback' && <p style={hintText}>הקיוסק מציג לצד הכרטיס קוד QR לדף ההצבעה.</p>}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="כפתור" grow>
                <select value={ad.action} onChange={(e) => patchAd(ad.key, { action: e.target.value as AdAction })} style={input}>
                  {AD_ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
                </select>
              </Field>
              <Field label="תמונה (לא חובה)" grow>
                <input value={ad.imageUrl} dir="ltr" inputMode="url" placeholder={content.imagePrefix ? `${content.imagePrefix}…` : ''} onChange={(e) => patchAd(ad.key, { imageUrl: e.target.value })} style={input} />
              </Field>
            </div>

            {ad.kind === 'menu_highlight' && (
              <div>
                <span style={fieldLabel}>פריטים מהתפריט המפורסם ({ad.menuItemIds.length}/12)</span>
                {ad.menuItemIds.length === 0 && <p style={hintText}>לא נבחרו פריטים, ולכן הכרטיס לא יוצג.</p>}
                <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ad.menuItemIds.map((id) => {
                    const menuItem = menuById.get(id)
                    return (
                      <li key={id} style={{ ...pill, gap: 6, color: menuItem?.available === false || !menuItem ? 'var(--warn)' : 'var(--text)' }}>
                        {menuItem ? menuItem.name : 'פריט שכבר לא בתפריט'}
                        {menuItem && !menuItem.available ? ' (אזל, לא יוצג)' : ''}
                        <button type="button" aria-label={`הסרת ${menuItem?.name ?? 'הפריט'}`} onClick={() => patchAd(ad.key, { menuItemIds: ad.menuItemIds.filter((x) => x !== id) })} style={{ ...linkBtn, color: 'var(--danger)' }}>×</button>
                      </li>
                    )
                  })}
                </ul>
                <button type="button" className="press" style={{ ...btn, marginTop: 8 }} onClick={() => setPickerFor(pickerFor === ad.key ? null : ad.key)} aria-expanded={pickerFor === ad.key}>
                  {pickerFor === ad.key ? 'סגירת הרשימה' : 'בחירת פריטים'}
                </button>
                {pickerFor === ad.key && (
                  <div style={{ maxHeight: 280, overflowY: 'auto', marginTop: 8, border: '1px solid var(--line)', borderRadius: 12, padding: 8 }}>
                    {content.menuItems.length === 0 && <p style={hintText}>אין תפריט מפורסם לסניף.</p>}
                    {content.menuItems.map((menuItem) => {
                      const on = ad.menuItemIds.includes(menuItem.id)
                      const full = !on && ad.menuItemIds.length >= 12
                      return (
                        <label key={menuItem.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', fontSize: '0.86rem', color: 'var(--text)', opacity: full ? 0.5 : 1 }}>
                          <input type="checkbox" checked={on} disabled={full} onChange={() => patchAd(ad.key, { menuItemIds: on ? ad.menuItemIds.filter((x) => x !== menuItem.id) : [...ad.menuItemIds, menuItem.id] })} />
                          <span style={{ flex: 1 }}>{menuItem.name}{menuItem.available ? '' : ' · אזל'}</span>
                          <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>{menuItem.category}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {!ad.seeded && (
              <button type="button" className="press" style={{ ...btn, color: 'var(--danger)', alignSelf: 'flex-start', display: 'inline-flex', gap: 6, alignItems: 'center' }}
                onClick={() => patch({ ads: draft.ads.filter((x) => x.key !== ad.key) })}>
                <Trash2 size={15} aria-hidden="true" /> מחיקת הכרטיס
              </button>
            )}
          </article>
        ))}
        <button type="button" className="press" disabled={draft.ads.length >= MAX_ADS} style={{ ...btn, display: 'inline-flex', gap: 6, alignItems: 'center', alignSelf: 'flex-start' }}
          onClick={() => patch({ ads: [...draft.ads, { key: newKey(), id: null, seeded: false, kind: 'custom', title: '', body: '', action: 'none', imageUrl: '', menuItemIds: [], enabled: true }] })}>
          <Plus size={16} aria-hidden="true" /> כרטיס חדש
        </button>
      </Section>

      <Section title="שעות פתיחה" hint="השעות הקבועות נלקחות מהגדרות סידור העבודה (שעות פעילות). כאן מוסיפים ימים חריגים: חג, סגירה או יום קצר.">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: '0.86rem' }}>
          {content.weeklyHours
            ? content.weeklyHours.map((h, day) => (
                <li key={day} style={{ display: 'contents' }}>
                  <span style={{ color: 'var(--text-dim)' }}>{DAY_NAMES[day]}</span>
                  <span dir="ltr" style={{ textAlign: 'end', color: 'var(--text)' }}>{h ? `${h.open}–${h.close}` : 'סגור'}</span>
                </li>
              ))
            : <li style={{ gridColumn: '1 / -1', color: 'var(--text-faint)' }}>לא הוגדרו שעות פעילות לסניף.</li>}
        </ul>
        <Link href="/owner/schedule" style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>לשינוי השעות הקבועות: סידור עבודה ← הגדרות</Link>

        {draft.exceptions.map((e) => (
          <article key={e.key} style={item}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="תאריך"><input type="date" value={e.date} onChange={(ev) => patchException(e.key, { date: ev.target.value })} style={input} /></Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem', color: 'var(--text)', minHeight: 40 }}>
                <input type="checkbox" checked={e.closed} onChange={(ev) => patchException(e.key, { closed: ev.target.checked })} /> סגור
              </label>
              {!e.closed && (
                <>
                  <Field label="פתיחה"><input type="time" value={e.open} onChange={(ev) => patchException(e.key, { open: ev.target.value })} style={input} /></Field>
                  <Field label="סגירה"><input type="time" value={e.close} onChange={(ev) => patchException(e.key, { close: ev.target.value })} style={input} /></Field>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <Field label="הערה (לא חובה)" grow><input value={e.note} maxLength={80} placeholder="למשל: ערב חג" onChange={(ev) => patchException(e.key, { note: ev.target.value })} style={input} /></Field>
              <IconButton label="הסרת היום החריג" onClick={() => patch({ exceptions: draft.exceptions.filter((x) => x.key !== e.key) })}><Trash2 size={16} /></IconButton>
            </div>
          </article>
        ))}
        <button type="button" className="press" disabled={draft.exceptions.length >= 60} style={{ ...btn, display: 'inline-flex', gap: 6, alignItems: 'center', alignSelf: 'flex-start' }}
          onClick={() => patch({ exceptions: [...draft.exceptions, { key: newKey(), date: '', closed: true, open: '', close: '', note: '' }] })}>
          <Plus size={16} aria-hidden="true" /> יום חריג
        </button>
      </Section>

      <Section title="אפשרויות ההצבעה" hint="מה הלקוחות יכולים לבחור בדף ההצבעה (עד 3 בחירות לאדם). אפשרות שכבר קיבלה קולות נשמרת כבויה כשמוחקים אותה, כדי שהתוצאות יישארו.">
        {draft.options.map((o, index) => (
          <div key={o.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={o.label} maxLength={60} aria-label={`אפשרות ${index + 1}`} onChange={(e) => patchOption(o.key, { label: e.target.value })} style={{ ...input, flex: 1, opacity: o.enabled ? 1 : 0.6 }} />
            <IconButton label="הזזה למעלה" disabled={index === 0} onClick={() => patch({ options: move(draft.options, index, -1) })}><ArrowUp size={16} /></IconButton>
            <IconButton label="הזזה למטה" disabled={index === draft.options.length - 1} onClick={() => patch({ options: move(draft.options, index, 1) })}><ArrowDown size={16} /></IconButton>
            <button type="button" role="switch" aria-checked={o.enabled} aria-label={`הצגת ${o.label || `אפשרות ${index + 1}`}`} onClick={() => patchOption(o.key, { enabled: !o.enabled })} style={switchBtn}>
              <Switch on={o.enabled} />
            </button>
            <IconButton label={`מחיקת ${o.label || `אפשרות ${index + 1}`}`} onClick={() => patch({ options: draft.options.filter((x) => x.key !== o.key) })}><Trash2 size={16} /></IconButton>
          </div>
        ))}
        <button type="button" className="press" disabled={draft.options.length >= MAX_OPTIONS} style={{ ...btn, display: 'inline-flex', gap: 6, alignItems: 'center', alignSelf: 'flex-start' }}
          onClick={() => patch({ options: [...draft.options, { key: newKey(), id: null, label: '', enabled: true }] })}>
          <Plus size={16} aria-hidden="true" /> אפשרות חדשה
        </button>
      </Section>

      <div role="region" aria-label="שמירה" style={saveBar}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {notice ? (
            <p role={notice.type === 'error' ? 'alert' : 'status'} style={{ margin: 0, fontSize: '0.82rem', color: notice.type === 'error' ? 'var(--danger)' : 'var(--ok)' }}>{notice.text}</p>
          ) : issues.length > 0 && dirty ? (
            <p role="alert" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--danger)', lineHeight: 1.4 }}>{issues[0]}{issues.length > 1 ? ` (ועוד ${issues.length - 1})` : ''}</p>
          ) : (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-dim)' }}>{dirty ? 'יש שינויים שלא נשמרו' : 'הכול שמור'}</p>
          )}
        </div>
        <button type="button" className="press" onClick={discard} disabled={!dirty || saving} style={{ ...btn, opacity: !dirty || saving ? 0.5 : 1 }}>ביטול שינויים</button>
        <button type="button" className="press" onClick={save} disabled={!dirty || saving || issues.length > 0}
          style={{ ...btn, background: 'var(--neon)', color: 'var(--bg)', border: 0, fontWeight: 800, opacity: !dirty || saving || issues.length > 0 ? 0.5 : 1 }}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)' }}>{title}</h2>
        {hint && <p style={{ ...hintText, marginTop: 4 }}>{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, grow, children }: { label: string; grow?: boolean; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: grow ? '1 1 180px' : undefined, minWidth: 0 }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  )
}

function NumberRow({ label, value, bounds, onChange }: { label: string; value: number; bounds: { min: number; max: number }; onChange: (v: number) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
      <span style={{ fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.4 }}>{label.replace(/&quot;/g, '"')}</span>
      <input type="number" inputMode="numeric" min={bounds.min} max={bounds.max} step={1} value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} style={{ ...input, width: 84, textAlign: 'center' }} />
    </label>
  )
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="press" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      style={{ ...btn, padding: 0, width: 40, height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>{children}</span>
    </button>
  )
}

const item: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 13px',
}
const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: 40, padding: '8px 10px', borderRadius: 10, fontFamily: 'inherit', fontSize: '0.92rem',
  color: 'var(--text)', background: 'var(--bg-elev-2)', border: '1px solid var(--line-interactive)',
}
const fieldLabel: CSSProperties = { fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-dim)' }
const hintText: CSSProperties = { margin: 0, fontSize: '0.78rem', color: 'var(--text-faint)', lineHeight: 1.5 }
const note: CSSProperties = { margin: 0, fontSize: '0.84rem', color: 'var(--text)', background: 'var(--bg-elev-2)', borderRadius: 10, padding: '8px 10px', lineHeight: 1.5 }
const pill: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-dim)',
  background: 'var(--bg-elev-2)', border: '1px solid var(--line)', borderRadius: 999, padding: '2px 9px',
}
const btn: CSSProperties = {
  fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', background: 'var(--bg-elev-2)', border: '1px solid var(--line-strong)',
  borderRadius: 11, padding: '8px 12px', fontFamily: 'inherit', cursor: 'pointer', minHeight: 40,
}
const linkBtn: CSSProperties = { background: 'none', border: 0, padding: '0 2px', fontSize: '1rem', cursor: 'pointer', fontFamily: 'inherit', minWidth: 24, minHeight: 24 }
const switchBtn: CSSProperties = { background: 'none', border: 0, padding: 4, cursor: 'pointer', minHeight: 40, display: 'inline-flex', alignItems: 'center' }
const saveBar: CSSProperties = {
  position: 'sticky', bottom: 'calc(12px + env(safe-area-inset-bottom))', zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  background: 'var(--glass-strong)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid var(--line-strong)',
  borderRadius: 16, padding: '10px 12px', marginTop: 4,
}
