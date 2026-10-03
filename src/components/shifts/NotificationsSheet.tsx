'use client'

import { useEffect, useId } from 'react'
import { Bell, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import type { NotificationLink } from '@/lib/shifts/types'

// The in-app inbox: what changed, in plain words, newest first. Nothing in the
// scheduling workflow depends on email — a person who never opens their mail
// still sees every request, answer and schedule change here. Opening it marks
// everything read.
export function NotificationsButton({ onOpen }: { onOpen: () => void }) {
  const { db } = useShifts()
  const unread = db?.unreadCount ?? 0
  return (
    <button type="button" className="sch-iconbtn press" data-dot={unread > 0} onClick={onOpen} aria-label={unread > 0 ? `עדכונים — ${unread} חדשים` : 'עדכונים'}>
      <Bell size={20} aria-hidden="true" />
    </button>
  )
}

export default function NotificationsSheet({
  open,
  onClose,
  onFollow,
}: {
  open: boolean
  onClose: () => void
  onFollow: (link: NotificationLink) => void
}) {
  const { db, dispatch } = useShifts()
  const titleId = useId()

  // Reading them is what clears them.
  const unread = db?.unreadCount ?? 0
  useEffect(() => {
    if (open && unread > 0) {
      const t = window.setTimeout(() => void dispatch({ type: 'markNotificationsRead' }, { quiet: true }), 700)
      return () => window.clearTimeout(t)
    }
  }, [open, unread, dispatch])

  if (!db) return null
  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId} className="sch-sheet">
      <div className="sch-sheet__head">
        <h2 id={titleId} className="sch-sheet__title">
          עדכונים
        </h2>
        <button type="button" className="sch-iconbtn press" onClick={onClose} aria-label="סגירה">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="sheet-scroll">
        {db.notifications.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-dim)' }}>
            <Bell size={28} aria-hidden="true" style={{ opacity: 0.5 }} />
            <p className="sch-sub" style={{ marginTop: 8 }}>
              אין עדכונים עדיין. כאן יופיעו בקשות, תשובות ושינויים בלוח.
            </p>
          </div>
        ) : (
          db.notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              className="sch-card press"
              style={{ textAlign: 'start', font: 'inherit', color: 'inherit', cursor: 'pointer', borderColor: n.readAt ? undefined : 'var(--neon)', gap: 4 }}
              onClick={() => onFollow(n.link)}
            >
              <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <strong style={{ flex: 1, fontSize: '0.92rem' }}>{n.title}</strong>
                <span className="sch-faint" style={{ fontSize: '0.72rem' }}>
                  {formatWhen(n.createdAt)}
                </span>
              </span>
              {n.body && <span className="sch-sub" style={{ whiteSpace: 'pre-line' }}>{n.body}</span>}
            </button>
          ))
        )}
      </div>
    </SheetShell>
  )
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return ''
  }
}
