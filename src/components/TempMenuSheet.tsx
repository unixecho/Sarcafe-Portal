'use client'

import { useId, useState } from 'react'
import SheetShell from '@/components/SheetShell'
import Switch from '@/components/Switch'

type TempMenuSheetProps = {
  open: boolean
  onClose: () => void
  initialUntil?: string | null
  initialExpireAction?: 'revert' | 'delete'
  onSave: (untilIso: string | null, expireAction: 'revert' | 'delete') => void
}

const QUICK_PICKS_HOURS = [2, 4, 6, 8]

/**
 * Sets/clears a variant's active_until + expire_action — "the cook isn't in
 * tonight, put the short menu up until 4am." Two entry points converge on
 * one absolute ISO instant: quick-pick hours-from-now chips, or a
 * datetime-local input for a specific time.
 *
 * Simplification vs. AyekaBar's WheelPicker-based original: this uses a
 * native `<input type="datetime-local">` rather than a custom iOS wheel —
 * accessible and correct out of the box, at the cost of the wheel's feel.
 * Also assumes the device setting the timer is physically at the branch
 * (true for on-site staff), rather than doing timezone-safe "bar clock"
 * math independent of the browser's local time — worth revisiting if this
 * is ever set remotely.
 */
export default function TempMenuSheet({ open, onClose, initialUntil, initialExpireAction, onSave }: TempMenuSheetProps) {
  const titleId = useId()
  const [customValue, setCustomValue] = useState(() => toLocalInputValue(initialUntil))
  const [expireAction, setExpireAction] = useState<'revert' | 'delete'>(initialExpireAction ?? 'revert')

  function pickHours(hours: number) {
    const until = new Date(Date.now() + hours * 60 * 60 * 1000)
    onSave(until.toISOString(), expireAction)
    onClose()
  }

  function saveCustom() {
    if (!customValue) return
    const until = new Date(customValue)
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return
    onSave(until.toISOString(), expireAction)
    onClose()
  }

  function clearTimer() {
    onSave(null, 'revert')
    onClose()
  }

  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId}>
      <div style={{ padding: '4px 4px 8px' }}>
        <h2 id={titleId} style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 700 }}>
          קביעת טיימר לתפריט זמני
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--text-dim)' }}>
          התפריט יחזור אוטומטית למצב הרגיל בזמן שנקבע — אין צורך לחזור ולסגור אותו ידנית.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 16 }}>
          {QUICK_PICKS_HOURS.map((hours) => (
            <button
              key={hours}
              type="button"
              className="press"
              onClick={() => pickHours(hours)}
              style={{
                minHeight: 'var(--tap-min)',
                borderRadius: 12,
                border: '1px solid var(--line-strong)',
                background: 'var(--bg-elev)',
                color: 'var(--text)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {hours} שעות
            </button>
          ))}
        </div>

        <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: 6 }}>
          או עד שעה מסוימת
        </label>
        <input
          type="datetime-local"
          value={customValue}
          onChange={(event) => setCustomValue(event.target.value)}
          className="ltr-isolate"
          style={{
            width: '100%',
            minHeight: 'var(--tap-min)',
            borderRadius: 12,
            border: '1px solid var(--line-strong)',
            background: 'var(--bg)',
            color: 'var(--text)',
            padding: '0 12px',
            marginBottom: 16,
          }}
        />

        <button
          type="button"
          role="switch"
          aria-checked={expireAction === 'delete'}
          onClick={() => setExpireAction((prev) => (prev === 'delete' ? 'revert' : 'delete'))}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'none',
            border: 'none',
            padding: '10px 0',
            cursor: 'pointer',
            color: 'var(--text)',
          }}
        >
          <span style={{ textAlign: 'start', fontSize: '0.85rem' }}>
            <strong style={{ display: 'block' }}>למחוק בתום הזמן</strong>
            <span style={{ color: 'var(--text-faint)', fontSize: '0.78rem' }}>
              במקום לחזור למצב הרגיל — לתפריט חד-פעמי שלא צריך להישאר ברשימה
            </span>
          </span>
          <Switch on={expireAction === 'delete'} />
        </button>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            className="press"
            onClick={saveCustom}
            disabled={!customValue}
            style={{
              flex: 1,
              minHeight: 'var(--tap-min)',
              borderRadius: 14,
              border: 'none',
              background: 'var(--neon)',
              color: 'var(--bg)',
              fontWeight: 700,
              cursor: customValue ? 'pointer' : 'not-allowed',
              opacity: customValue ? 1 : 0.5,
            }}
          >
            שמירה
          </button>
          {initialUntil && (
            <button
              type="button"
              className="press"
              onClick={clearTimer}
              style={{
                minHeight: 'var(--tap-min)',
                padding: '0 16px',
                borderRadius: 14,
                border: '1px solid var(--line-strong)',
                background: 'var(--bg-elev)',
                color: '#ff6b6b',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ביטול טיימר
            </button>
          )}
        </div>
      </div>
    </SheetShell>
  )
}

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
