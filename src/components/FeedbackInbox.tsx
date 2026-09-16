'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import Switch from '@/components/Switch'
import { normalizePagePath } from '@/lib/feedback/validate'
import type { FeedbackCategory, FeedbackRow, FeedbackStatus } from '@/lib/feedback/types'
import type { Branch } from '@/lib/branches'

// The owner's feedback queue — ported from AyekaBar's FeedbackInbox.tsx,
// with one real addition: a branch filter (Sarcafe has two locations and
// the owner wants feedback "divided by branches"). Everything else keeps
// AyekaBar's own reasoning:
//   • The message renders as React TEXT (white-space: pre-wrap), never
//     HTML — no dangerouslySetInnerHTML, ever.
//   • The page link is re-normalized through the SAME function the API
//     used, immediately before becoming an <a> — already guaranteed by the
//     route's validator and the migration's CHECK constraint, checked a
//     third time here anyway because this is the one place a wrong value
//     becomes the owner clicking an attacker's destination from inside
//     their own admin panel.
//   • The contact address becomes a mailto: — safe because the validator's
//     pattern excludes whitespace/quotes/separators a header injection needs.

const T = {
  title: 'משוב מלקוחות',
  subtitle: 'מה לקוחות כתבו לנו מהפורטל ומהתפריט — על העגלה ועל האתר.',
  boxOpen: 'תיבת המשוב פתוחה',
  boxClosed: 'תיבת המשוב סגורה',
  boxLabel: 'תיבת המשוב מלקוחות',
  boxHint: 'כשהתיבה סגורה, הכפתור נעלם מהאתר וגם שליחה ישירה נדחית.',
  all: 'הכל',
  allBranches: 'כל הסניפים',
  new: 'חדשים',
  read: 'נקראו',
  resolved: 'טופלו',
  business: 'על העגלה',
  technical: 'על האתר',
  empty: 'אין כאן משובים.',
  emptyFiltered: 'אין משובים בסינון הזה.',
  loadErr: 'טעינת המשובים נכשלה.',
  saveErr: 'העדכון נכשל.',
  more: 'טעינת עוד',
  loading: 'טוען…',
  markRead: 'סימון כנקרא',
  markResolved: 'סימון כטופל',
  reopen: 'החזרה לחדשים',
  onPage: 'נשלח מהעמוד',
  reply: 'מענה במייל',
  resolvedAt: 'טופל',
  unknownBranch: 'סניף לא ידוע',
}

const PAGE = 30

const CATEGORY_META: Record<FeedbackCategory, { label: string; emoji: string; color: string }> = {
  business: { label: T.business, emoji: '☕', color: '#ff8a5c' },
  technical: { label: T.technical, emoji: '🛠️', color: '#57d9c0' },
}

const STATUS_META: Record<FeedbackStatus, { label: string; color: string }> = {
  new: { label: T.new, color: '#ffb240' },
  read: { label: T.read, color: '#a8a5b0' },
  resolved: { label: T.resolved, color: '#4ade80' },
}

function when(iso: string): string {
  const d = new Date(iso)
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} דק׳`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `לפני ${hours} שע׳`
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
}

type StatusFilter = FeedbackStatus | 'all'
type CategoryFilter = FeedbackCategory | 'all'

export default function FeedbackInbox({ branches, initialBranch }: { branches: Branch[]; initialBranch: string }) {
  const [items, setItems] = useState<FeedbackRow[]>([])
  const [counts, setCounts] = useState<Record<FeedbackStatus, number>>({ new: 0, read: 0, resolved: 0 })
  const [total, setTotal] = useState(0)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [status, setStatus] = useState<StatusFilter>('new')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [branch, setBranch] = useState<string>(initialBranch) // '' = all branches
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const branchName = useCallback(
    (slug: string | null) => (slug ? branches.find((b) => b.slug === slug)?.name.he ?? slug : T.unknownBranch),
    [branches]
  )

  const load = useCallback(
    async (offset = 0) => {
      setLoading(true)
      setErr(null)
      try {
        const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
        if (status !== 'all') params.set('status', status)
        if (category !== 'all') params.set('category', category)
        if (branch) params.set('branch', branch)
        const res = await fetch(`/api/owner/feedback?${params}`, { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error?.message ?? T.loadErr)
        setItems((prev) => (offset === 0 ? json.items : [...prev, ...json.items]))
        setCounts(json.counts)
        setTotal(json.total)
        setEnabled(json.enabled === true)
      } catch (e) {
        setErr(e instanceof Error ? e.message : T.loadErr)
      } finally {
        setLoading(false)
      }
    },
    [status, category, branch]
  )

  useEffect(() => {
    void load(0)
  }, [load])

  async function setRowStatus(row: FeedbackRow, next: FeedbackStatus) {
    setBusyId(row.id)
    setErr(null)
    try {
      const res = await fetch('/api/owner/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, status: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message ?? T.saveErr)
      // Re-read rather than patching in place: the row may no longer belong
      // in the current filter, and all three counts have moved.
      await load(0)
    } catch (e) {
      setErr(e instanceof Error ? e.message : T.saveErr)
    } finally {
      setBusyId(null)
    }
  }

  async function toggleBox() {
    if (enabled === null) return
    const next = !enabled
    setEnabled(next) // optimistic
    try {
      const res = await fetch('/api/owner/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message ?? T.saveErr)
      setEnabled(json.enabled === true)
    } catch (e) {
      setEnabled(!next)
      setErr(e instanceof Error ? e.message : T.saveErr)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)' }}>{T.title}</h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.83rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>{T.subtitle}</p>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: '12px 14px',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)' }}>
            {enabled === false ? T.boxClosed : T.boxOpen}
          </div>
          <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>{T.boxHint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled === true}
          aria-label={T.boxLabel}
          onClick={toggleBox}
          disabled={enabled === null}
          className="press"
          style={{ background: 'none', border: 'none', padding: 0, cursor: enabled === null ? 'default' : 'pointer', opacity: enabled === null ? 0.6 : 1, flexShrink: 0 }}
        >
          <Switch on={enabled === true} />
        </button>
      </div>

      {branches.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[{ slug: '', label: T.allBranches }, ...branches.map((b) => ({ slug: b.slug, label: b.name.he }))].map((b) => (
            <button
              key={b.slug || 'all'}
              type="button"
              className="press"
              aria-pressed={branch === b.slug}
              onClick={() => {
                setBranch(b.slug)
                setItems([])
              }}
              style={chip(branch === b.slug)}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(['new', 'read', 'resolved', 'all'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            className="press"
            aria-pressed={status === s}
            onClick={() => {
              setStatus(s)
              setItems([])
            }}
            style={chip(status === s, s === 'all' ? undefined : STATUS_META[s].color)}
          >
            {s === 'all' ? T.all : STATUS_META[s].label}
            {s !== 'all' && <span style={{ marginInlineStart: 6, fontVariantNumeric: 'tabular-nums', opacity: 0.75 }}>{counts[s]}</span>}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: -6 }}>
        {(['all', 'business', 'technical'] as CategoryFilter[]).map((c) => (
          <button
            key={c}
            type="button"
            className="press"
            aria-pressed={category === c}
            onClick={() => {
              setCategory(c)
              setItems([])
            }}
            style={chip(category === c, c === 'all' ? undefined : CATEGORY_META[c].color)}
          >
            {c === 'all' ? T.all : `${CATEGORY_META[c].emoji} ${CATEGORY_META[c].label}`}
          </button>
        ))}
      </div>

      {err && (
        <p role="alert" style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: 0, lineHeight: 1.5 }}>
          {err}
        </p>
      )}

      {items.length === 0 && !loading && !err && (
        <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', margin: '6px 0' }}>
          {status === 'all' && category === 'all' && !branch ? T.empty : T.emptyFiltered}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((row) => (
          <FeedbackCard key={row.id} row={row} busy={busyId === row.id} branchLabel={branchName(row.branch_slug)} onSetStatus={(next) => setRowStatus(row, next)} />
        ))}
      </div>

      {loading && <p style={{ color: 'var(--text-faint)', fontSize: '0.82rem', margin: 0 }}>{T.loading}</p>}

      {items.length > 0 && items.length < total && !loading && (
        <button type="button" className="press" onClick={() => load(items.length)} style={moreBtn}>
          {T.more}
        </button>
      )}
    </div>
  )
}

function FeedbackCard({
  row,
  busy,
  branchLabel,
  onSetStatus,
}: {
  row: FeedbackRow
  busy: boolean
  branchLabel: string
  onSetStatus: (next: FeedbackStatus) => void
}) {
  const cat = CATEGORY_META[row.category] ?? CATEGORY_META.business
  const st = STATUS_META[row.status] ?? STATUS_META.new
  // Third and final check — see this file's header for why it's here, not
  // just on the server.
  const path = normalizePagePath(row.page_url)

  return (
    <article
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderInlineStartWidth: 3,
        borderInlineStartStyle: 'solid',
        borderInlineStartColor: row.status === 'new' ? st.color : 'var(--line-strong)',
        borderRadius: 14,
        padding: '12px 13px',
        opacity: busy ? 0.55 : 1,
        transition: 'opacity .2s var(--ease), border-inline-start-color .3s var(--ease)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ ...pill, color: cat.color, borderColor: `${cat.color}55`, background: `${cat.color}18` }}>
          <span aria-hidden="true">{cat.emoji}</span> {cat.label}
        </span>
        <span style={{ ...pill, color: st.color, borderColor: `${st.color}44` }}>{st.label}</span>
        <span style={pill}>{branchLabel}</span>
        <span style={{ marginInlineStart: 'auto', fontSize: '0.74rem', color: 'var(--text-faint)' }}>{when(row.created_at)}</span>
      </header>

      <p
        style={{
          margin: 0,
          fontSize: '0.9rem',
          color: 'var(--text)',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {row.message}
      </p>

      {(path || row.contact_email) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 9, fontSize: '0.76rem' }}>
          {path && (
            <span style={{ color: 'var(--text-faint)' }}>
              {T.onPage}{' '}
              <a href={path} style={{ color: 'var(--neon-soft)', textDecoration: 'underline' }}>
                {path}
              </a>
            </span>
          )}
          {row.contact_email && (
            <a href={`mailto:${row.contact_email}`} style={{ color: 'var(--neon-2)', textDecoration: 'underline' }}>
              {T.reply}: {row.contact_email}
            </a>
          )}
        </div>
      )}

      <footer style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 11 }}>
        {row.status !== 'read' && row.status !== 'resolved' && (
          <button type="button" className="press" disabled={busy} onClick={() => onSetStatus('read')} style={actionBtn}>
            {T.markRead}
          </button>
        )}
        {row.status !== 'resolved' && (
          <button
            type="button"
            className="press"
            disabled={busy}
            onClick={() => onSetStatus('resolved')}
            style={{ ...actionBtn, color: '#4ade80', borderColor: 'rgba(74,222,128,0.35)' }}
          >
            {T.markResolved}
          </button>
        )}
        {row.status !== 'new' && (
          <button type="button" className="press" disabled={busy} onClick={() => onSetStatus('new')} style={{ ...actionBtn, color: 'var(--text-faint)' }}>
            {T.reopen}
          </button>
        )}
        {row.status === 'resolved' && row.resolved_at && (
          <span style={{ marginInlineStart: 'auto', alignSelf: 'center', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
            {T.resolvedAt} {when(row.resolved_at)}
          </span>
        )}
      </footer>
    </article>
  )
}

function chip(active: boolean, color?: string): CSSProperties {
  const tint = color ?? 'var(--neon-soft)'
  return {
    borderRadius: 999,
    minHeight: 32,
    padding: '6px 12px',
    fontSize: '0.78rem',
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
    color: active ? tint : 'var(--text-dim)',
    background: active ? `${color ?? '#ff7a45'}1a` : 'var(--bg-elev)',
    border: `1px solid ${active ? `${color ?? '#ff7a45'}55` : 'var(--line)'}`,
    transition: 'color .2s var(--ease), background .2s var(--ease), border-color .2s var(--ease)',
  }
}

const pill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: '0.72rem',
  fontWeight: 700,
  color: 'var(--text-dim)',
  background: 'var(--bg-elev-2)',
  border: '1px solid var(--line)',
  borderRadius: 999,
  padding: '2px 9px',
}

const actionBtn: CSSProperties = {
  fontSize: '0.76rem',
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
  color: 'var(--neon-soft)',
  background: 'transparent',
  border: '1px solid rgba(255,122,69,0.3)',
  borderRadius: 9,
  padding: '6px 10px',
}

const moreBtn: CSSProperties = {
  width: '100%',
  minHeight: 'var(--tap-min)',
  padding: '12px 0',
  borderRadius: 13,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontSize: '0.9rem',
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
