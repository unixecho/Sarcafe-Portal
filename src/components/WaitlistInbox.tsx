'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { WaitlistContact } from '@/app/api/owner/waitlist/route'

// The loyalty-club sign-ups collected on the kiosk. Everything is rendered as React text (never HTML). The phone is
// a tel: link and the e-mail a mailto: link; both come from values the server already validated (digits only / one
// plain address), and the e-mail is re-checked here before it becomes a link.

const T = {
  title: 'נרשמים למועדון הלקוחות',
  subtitle: 'מי השאיר פרטים בקיוסק כדי לשמוע כשהמועדון ייפתח. כל אחד אישר את הודעת הפרטיות; שיווק רק למי שאישר בנפרד.',
  total: 'סה״כ נרשמים',
  marketing: 'אישרו שיווק',
  export: 'ייצוא לאקסל',
  empty: 'עדיין אין נרשמים.',
  loadErr: 'טעינת הרשימה נכשלה.',
  saveErr: 'העדכון נכשל.',
  more: 'טעינת עוד',
  loading: 'טוען…',
  yes: 'אישר/ה שיווק',
  no: 'בלי שיווק',
  withdraw: 'ביטול הסכמה לשיווק',
  grant: 'סימון הסכמה לשיווק',
  erase: 'מחיקה מהרשימה',
  confirmErase: 'למחוק את הפרטים לצמיתות? אי אפשר לשחזר.',
  registered: 'נרשם/ה',
  last: 'התעניינות אחרונה',
  privacy: 'הפרטים האלה שייכים ללקוחות. אפשר לשמור אותם רק למטרה שבשבילה נמסרו, ויש להסיר מי שביקש.',
}

const SAFE_EMAIL = /^[^\s@"'<>(),;:\\]+@[^\s@"'<>(),;:\\]+\.[^\s@"'<>(),;:\\]+$/

function when(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const showPhone = (digits: string) => `${digits.slice(0, 3)}-${digits.slice(3)}`

export default function WaitlistInbox() {
  const [items, setItems] = useState<WaitlistContact[]>([])
  const [total, setTotal] = useState(0)
  const [marketing, setMarketing] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async (offset = 0) => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/owner/waitlist?offset=${offset}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(T.loadErr)
      const data = (await res.json()) as { items: WaitlistContact[]; total: number; marketing: number }
      setItems((prev) => (offset === 0 ? data.items : [...prev, ...data.items]))
      setTotal(data.total)
      setMarketing(data.marketing)
    } catch (e) {
      setErr(e instanceof Error ? e.message : T.loadErr)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(0) }, [load])

  async function act(row: WaitlistContact, action: 'grant_marketing' | 'withdraw_marketing' | 'erase') {
    if (action === 'erase' && !window.confirm(T.confirmErase)) return
    setBusyId(row.id)
    setErr(null)
    try {
      const res = await fetch('/api/owner/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, action }),
      })
      if (!res.ok) throw new Error(T.saveErr)
      await load(0)
    } catch (e) {
      setErr(e instanceof Error ? e.message : T.saveErr)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)' }}>{T.title}</h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.83rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>{T.subtitle}</p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Stat label={T.total} value={total} />
        <Stat label={T.marketing} value={marketing} />
        <a href="/api/owner/waitlist/export" download className="press" style={{ ...btn, marginInlineStart: 'auto', alignSelf: 'stretch', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
          {T.export}
        </a>
      </div>

      {err && <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.82rem', margin: 0, lineHeight: 1.5 }}>{err}</p>}
      {items.length === 0 && !loading && !err && <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', margin: '6px 0' }}>{T.empty}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((row) => (
          <article key={row.id} style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 13px', opacity: busyId === row.id ? 0.55 : 1 }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>{row.firstName}</strong>
              <span style={{ ...pill, color: row.marketing ? 'var(--ok)' : 'var(--text-dim)' }}>{row.marketing ? T.yes : T.no}</span>
            </header>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.88rem', color: 'var(--text)' }}>
              <a href={`tel:${row.phone}`} dir="ltr" style={{ color: 'inherit', textAlign: 'start', width: 'fit-content' }}>{showPhone(row.phone)}</a>
              {row.email && SAFE_EMAIL.test(row.email) && (
                <a href={`mailto:${row.email}`} dir="ltr" style={{ color: 'var(--text-dim)', textAlign: 'start', width: 'fit-content', overflowWrap: 'anywhere' }}>{row.email}</a>
              )}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '0.74rem', color: 'var(--text-faint)' }}>
              {T.registered} {when(row.createdAt)} · {T.last} {when(row.lastInterestAt)}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" className="press" style={btn} disabled={busyId === row.id} onClick={() => act(row, row.marketing ? 'withdraw_marketing' : 'grant_marketing')}>
                {row.marketing ? T.withdraw : T.grant}
              </button>
              <button type="button" className="press" style={{ ...btn, color: 'var(--danger)' }} disabled={busyId === row.id} onClick={() => act(row, 'erase')}>
                {T.erase}
              </button>
            </div>
          </article>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--text-faint)', fontSize: '0.82rem', margin: 0 }}>{T.loading}</p>}
      {items.length > 0 && items.length < total && !loading && (
        <button type="button" className="press" onClick={() => load(items.length)} style={{ ...btn, width: '100%', minHeight: 'var(--tap-min)' }}>{T.more}</button>
      )}
      <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>{T.privacy}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: '10px 14px', minWidth: 110 }}>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>{label}</div>
    </div>
  )
}

const pill: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-dim)',
  background: 'var(--bg-elev-2)', border: '1px solid var(--line)', borderRadius: 999, padding: '2px 9px',
}
const btn: CSSProperties = {
  fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)', background: 'var(--bg-elev-2)', border: '1px solid var(--line-strong)',
  borderRadius: 11, padding: '8px 12px', fontFamily: 'inherit', cursor: 'pointer', minHeight: 40,
}
