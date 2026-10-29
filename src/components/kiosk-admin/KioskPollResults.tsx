'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { PollSuggestion, PollSummary } from '@/app/api/owner/kiosk/feedback/route'

// The poll's results: votes per option, answers per day and the rating for 7 / 30 days or all time, and the written
// suggestions newest first. Every value is rendered as React text (never HTML): the suggestions are the public's free
// text. Hiding an answer takes it out of the counts and the list (it can be shown again); nothing is deleted here.

const PERIODS = [
  { days: 7, label: '7 ימים' },
  { days: 30, label: '30 ימים' },
  { days: 0, label: 'הכול' },
] as const

const when = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function KioskPollResults() {
  const [days, setDays] = useState<number>(30)
  const [showHidden, setShowHidden] = useState(false)
  const [summary, setSummary] = useState<PollSummary | null>(null)
  const [items, setItems] = useState<PollSuggestion[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async (offset = 0) => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/owner/kiosk/feedback?days=${days}&offset=${offset}${showHidden ? '&hidden=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { summary: PollSummary; suggestions: { items: PollSuggestion[]; total: number } }
      setSummary(data.summary)
      setItems((prev) => (offset === 0 ? data.suggestions.items : [...prev, ...data.suggestions.items]))
      setTotal(data.suggestions.total)
    } catch {
      setErr('טעינת התוצאות נכשלה.')
    } finally {
      setLoading(false)
    }
  }, [days, showHidden])

  useEffect(() => { void load(0) }, [load])

  async function setHidden(row: PollSuggestion, hidden: boolean) {
    setBusyId(row.id)
    setErr(null)
    try {
      const res = await fetch('/api/owner/kiosk/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, hidden }),
      })
      if (!res.ok) throw new Error()
      await load(0)
    } catch {
      setErr('העדכון נכשל.')
    } finally {
      setBusyId(null)
    }
  }

  const maxVotes = Math.max(1, ...(summary?.options.map((o) => o.votes) ?? [0]))
  const perDay = summary?.perDay ?? []
  const maxDay = Math.max(1, ...perDay.map((d) => d.count))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div role="group" aria-label="תקופה" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PERIODS.map((p) => (
          <button key={p.days} type="button" className="press" aria-pressed={days === p.days} onClick={() => setDays(p.days)}
            style={{ ...btn, ...(days === p.days ? { background: 'var(--neon-soft)', borderColor: 'var(--neon)' } : null) }}>
            {p.label}
          </button>
        ))}
        <a href="/api/owner/kiosk/feedback/export" download className="press" style={{ ...btn, marginInlineStart: 'auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>ייצוא לאקסל</a>
      </div>

      {err && <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.84rem', margin: 0 }}>{err}</p>}

      {summary && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Stat label="תשובות" value={String(summary.total)} />
          <Stat label="עם הצעה כתובה" value={String(summary.withSuggestion)} />
          <Stat label={`דירוג ממוצע (${summary.ratingCount})`} value={summary.ratingAverage === null ? '—' : summary.ratingAverage.toFixed(1)} />
        </div>
      )}

      <section>
        <h2 style={h2}>הצבעות</h2>
        {summary && summary.options.length === 0 && <p style={dim}>אין אפשרויות הצבעה.</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {summary?.options.map((o) => (
            <li key={o.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: 'var(--text)', marginBottom: 4 }}>
                <span>{o.label}{o.enabled ? '' : ' (כבויה)'}</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{o.votes}</strong>
              </div>
              <div aria-hidden="true" style={{ height: 8, borderRadius: 999, background: 'var(--bg-elev-2)', overflow: 'hidden' }}>
                <div style={{ width: `${(o.votes / maxVotes) * 100}%`, height: '100%', background: 'var(--neon)', borderRadius: 999 }} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 style={h2}>תשובות ליום</h2>
        {perDay.length > 0 && (
          <>
            <div role="img" aria-label={`תשובות ליום ב-${perDay.length} הימים האחרונים, סה״כ ${perDay.reduce((s, d) => s + d.count, 0)}`}
              style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, direction: 'ltr' }}>
              {perDay.map((d) => (
                <div key={d.day} title={`${d.day}: ${d.count}`} style={{ flex: 1, minWidth: 2, height: `${Math.max(d.count ? 6 : 2, (d.count / maxDay) * 100)}%`, background: d.count ? 'var(--neon)' : 'var(--line)', borderRadius: '3px 3px 0 0' }} />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: 4, direction: 'ltr' }}>
              <span>{perDay[0]?.day}</span><span>{perDay[perDay.length - 1]?.day}</span>
            </div>
          </>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ ...h2, margin: 0 }}>הצעות ({total})</h2>
          <label style={{ marginInlineStart: 'auto', display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.82rem', color: 'var(--text-dim)' }}>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> להציג גם מוסתרות
          </label>
        </div>
        {items.length === 0 && !loading && <p style={dim}>אין הצעות בתקופה הזו.</p>}
        {items.map((row) => (
          <article key={row.id} style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 13px', opacity: busyId === row.id ? 0.55 : row.hidden ? 0.6 : 1 }}>
            <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.suggestion}</p>
            <p style={{ margin: '6px 0 0', fontSize: '0.74rem', color: 'var(--text-faint)' }}>
              {when(row.createdAt)}
              {row.rating !== null ? ` · דירוג ${row.rating}/5` : ''}
              {row.options.length > 0 ? ` · הצביעו: ${row.options.join(', ')}` : ''}
              {row.hidden ? ' · מוסתרת' : ''}
            </p>
            <button type="button" className="press" style={{ ...btn, marginTop: 8 }} disabled={busyId === row.id} onClick={() => setHidden(row, !row.hidden)}>
              {row.hidden ? 'החזרה' : 'הסתרה (ספאם)'}
            </button>
          </article>
        ))}
        {loading && <p style={dim}>טוען…</p>}
        {items.length > 0 && items.length < total && !loading && (
          <button type="button" className="press" onClick={() => load(items.length)} style={{ ...btn, width: '100%' }}>טעינת עוד</button>
        )}
      </section>
      <p style={{ ...dim, fontSize: '0.74rem' }}>התשובות אנונימיות: לא נאסף שם, טלפון או כתובת.</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: '10px 14px', minWidth: 100 }}>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>{label}</div>
    </div>
  )
}

const h2: CSSProperties = { margin: '0 0 10px', fontSize: '1.02rem', fontWeight: 800, color: 'var(--text)' }
const dim: CSSProperties = { margin: 0, fontSize: '0.84rem', color: 'var(--text-faint)' }
const btn: CSSProperties = {
  fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)', background: 'var(--bg-elev-2)', border: '1px solid var(--line-strong)',
  borderRadius: 11, padding: '8px 12px', fontFamily: 'inherit', cursor: 'pointer', minHeight: 40,
}
