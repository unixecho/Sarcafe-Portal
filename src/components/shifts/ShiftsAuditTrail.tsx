'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'

// Same collapsed-by-default pattern as the menu AuditTrail
// (components/AuditTrail.tsx) — summary always visible, raw detail one
// tap away. No field-level diff rows here (unlike the menu one): shift
// audit detail shapes vary a lot across action types (swap ids, week ids,
// member-patch before/after), so a generic diff renderer isn't as useful
// as it was for the menu's homogeneous add/remove/availability shape —
// the summary text (already localized server-side) carries the story.
const AUDIT_LABELS: Record<string, string> = {
  'schedule.publish': 'פרסום',
  'schedule.unpublish': 'ביטול פרסום',
  'schedule.clear': 'ניקוי שבוע',
  'schedule.copy': 'העתקת שבוע',
  'member.update': 'עדכון הגדרות צוות',
  'swap.request': 'בקשת החלפה',
  'swap.accept': 'הצעה להחלפה',
  'swap.approve': 'אישור החלפה',
  'swap.reject': 'דחיית החלפה',
  'swap.cancel': 'ביטול החלפה',
}

export default function ShiftsAuditTrail() {
  const { db } = useShifts()
  const [openId, setOpenId] = useState<string | null>(null)

  if (!db) return null
  if (db.audit.length === 0) {
    return <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '28px 0', fontSize: '0.85rem' }}>אין עדיין פעולות רשומות.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {db.audit.map((entry) => {
        const expanded = openId === entry.id
        const hasDetail = entry.detail && Object.keys(entry.detail).length > 0
        return (
          <div key={entry.id} style={{ padding: '11px 13px', borderRadius: 'var(--radius-md)', background: 'var(--bg-elev)', border: '1px solid var(--line)' }}>
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
                  {[entry.actorName, formatWhen(entry.createdAt)].filter(Boolean).join(' · ')}
                </span>
              </span>
              {hasDetail && (
                <span aria-hidden style={{ opacity: 0.5, paddingTop: 4 }}>
                  <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s var(--ease)' }} />
                </span>
              )}
            </button>

            {expanded && hasDetail && (
              <pre
                style={{
                  marginTop: 10,
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
        )
      })}
    </div>
  )
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return iso
  }
}
