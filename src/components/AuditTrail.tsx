'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { auditRows } from '@/lib/menu/audit-view'
import type { BranchSlug } from '@/lib/branches'

type AuditEntry = {
  id: string
  actor_name: string | null
  actor_email: string | null
  action: string
  summary: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

// Ported from AyekaBar's components/shifts/AuditTrail.tsx: collapsed by
// default (a log where every entry is expanded is a wall nobody reads), the
// one-line summary answers "who did what and when" on its own, and the
// field-level diff plus raw JSON are one tap away for the rare time that's
// not enough.
const AUDIT_LABELS: Record<string, string> = {
  'menu.save': 'שמירת טיוטה',
  'menu.publish': 'פרסום',
  'menu.availability': 'עדכון זמינות',
  'variant.create': 'יצירת גרסה',
  'variant.update': 'עדכון גרסה',
  'variant.delete': 'מחיקת גרסה',
  'variant.activate': 'הפעלת גרסה',
}

export default function AuditTrail({ branch }: { branch: BranchSlug }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [rawId, setRawId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    setOpenId(null)
    setRawId(null)
    fetch(`/api/owner/audit?branch=${branch}`)
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((payload) => {
        if (!cancelled) setEntries(payload.entries ?? [])
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [branch])

  if (!entries) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk" style={{ height: 64 }} />
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
        אין עדיין פעולות רשומות עבור הסניף הזה.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map((entry) => {
        const expanded = openId === entry.id
        const rows = auditRows(entry)
        const hasDetail = rows.length > 0

        return (
          <div
            key={entry.id}
            style={{
              padding: '11px 13px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
            }}
          >
            <button
              type="button"
              onClick={() => hasDetail && setOpenId(expanded ? null : entry.id)}
              aria-expanded={hasDetail ? expanded : undefined}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                width: '100%',
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                textAlign: 'start',
                color: 'var(--text)',
                cursor: hasDetail ? 'pointer' : 'default',
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    marginBottom: 5,
                    background: 'rgba(255,122,69,0.14)',
                    color: 'var(--neon-soft)',
                  }}
                >
                  {AUDIT_LABELS[entry.action] ?? entry.action}
                </span>
                <span style={{ display: 'block', fontSize: '0.85rem', lineHeight: 1.5 }}>{entry.summary}</span>
                <span style={{ display: 'block', marginTop: 4, fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                  {[entry.actor_name, formatWhen(entry.created_at)].filter(Boolean).join(' · ')}
                </span>
              </span>
              {hasDetail && (
                <span aria-hidden style={{ opacity: 0.5, paddingTop: 4 }}>
                  <ChevronDown
                    size={14}
                    style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s var(--ease)' }}
                  />
                </span>
              )}
            </button>

            {expanded && (
              <div style={{ marginTop: 10 }}>
                {rows.length > 0 && (
                  <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {rows.map((row, i) => (
                      <div
                        key={`${row.label}-${i}`}
                        style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.8rem', margin: 0 }}
                      >
                        <dt style={{ color: 'var(--text-dim)' }}>{row.label}</dt>
                        <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {row.before !== undefined && (
                            <span style={{ color: 'var(--text-faint)', textDecoration: 'line-through' }}>{row.before}</span>
                          )}
                          {row.before !== undefined && row.after !== undefined && (
                            <span aria-hidden className="dir-flip">
                              →
                            </span>
                          )}
                          {row.after !== undefined && <span style={{ color: 'var(--neon-soft)', fontWeight: 600 }}>{row.after}</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                <button
                  type="button"
                  onClick={() => setRawId(rawId === entry.id ? null : entry.id)}
                  style={{
                    marginTop: 8,
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-faint)',
                    fontSize: '0.72rem',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {rawId === entry.id ? '▲' : '▼'} פרטים גולמיים
                </button>
                {rawId === entry.id && (
                  <pre
                    style={{
                      marginTop: 6,
                      fontSize: '0.7rem',
                      background: 'var(--bg)',
                      padding: 8,
                      borderRadius: 8,
                      overflowX: 'auto',
                      direction: 'ltr',
                      textAlign: 'left',
                    }}
                  >
                    {JSON.stringify(entry.detail, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso)
    )
  } catch {
    return iso
  }
}
