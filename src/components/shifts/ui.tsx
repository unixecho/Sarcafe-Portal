'use client'

// Small shared pieces of the scheduling screens — kept here so a status or a
// person looks identical on the manager's board, the employee's schedule, the
// requests inbox and the staff list.

import type { ReactNode } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Clock, Hand, Info, XCircle } from 'lucide-react'
import { initialsOf } from '@/lib/shifts/names'
import type { RequestStatus, ShiftRole, SwapStatus } from '@/lib/shifts/types'

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'swap' | 'neutral' | 'mine'

export function Pill({ tone, icon, children, title }: { tone: Tone; icon?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span className={`sch-pill sch-pill--${tone}`} title={title}>
      {icon}
      {children}
    </span>
  )
}

const ICON = 13

// ---- the status vocabulary of requests and swaps — the same words everywhere ----------
const REQUEST_STATUS: Record<RequestStatus, { tone: Tone; label: string; icon: ReactNode }> = {
  pending: { tone: 'warn', label: 'ממתינה לאישור', icon: <Clock size={ICON} aria-hidden="true" /> },
  approved: { tone: 'ok', label: 'אושרה', icon: <CheckCircle2 size={ICON} aria-hidden="true" /> },
  rejected: { tone: 'danger', label: 'נדחתה', icon: <XCircle size={ICON} aria-hidden="true" /> },
  cancelled: { tone: 'neutral', label: 'בוטלה', icon: <Ban size={ICON} aria-hidden="true" /> },
}

const SWAP_STATUS: Record<SwapStatus, { tone: Tone; label: string; icon: ReactNode }> = {
  open: { tone: 'info', label: 'מחכה לתשובה', icon: <Hand size={ICON} aria-hidden="true" /> },
  peer_accepted: { tone: 'warn', label: 'ממתינה לאישור המנהל/ת', icon: <Clock size={ICON} aria-hidden="true" /> },
  approved: { tone: 'ok', label: 'אושרה', icon: <CheckCircle2 size={ICON} aria-hidden="true" /> },
  rejected: { tone: 'danger', label: 'נדחתה', icon: <XCircle size={ICON} aria-hidden="true" /> },
  declined: { tone: 'danger', label: 'סורבה', icon: <XCircle size={ICON} aria-hidden="true" /> },
  cancelled: { tone: 'neutral', label: 'בוטלה', icon: <Ban size={ICON} aria-hidden="true" /> },
}

export function RequestStatusPill({ status }: { status: RequestStatus }) {
  const s = REQUEST_STATUS[status]
  return (
    <Pill tone={s.tone} icon={s.icon}>
      {s.label}
    </Pill>
  )
}

export function SwapStatusPill({ status }: { status: SwapStatus }) {
  const s = SWAP_STATUS[status]
  return (
    <Pill tone={s.tone} icon={s.icon}>
      {s.label}
    </Pill>
  )
}

// ---- people --------------------------------------------------------------------------------
export function Avatar({ name, color, emoji, large }: { name: string; color?: string; emoji?: string | null; large?: boolean }) {
  return (
    <span className={`sch-avatar${large ? ' sch-avatar--lg' : ''}`} style={color ? { background: color } : undefined} aria-hidden="true">
      {emoji || initialsOf(name)}
    </span>
  )
}

export function Person({ name, role, color, emoji, faded, note }: { name: string; role?: ShiftRole | null; color?: string; emoji?: string | null; faded?: boolean; note?: string }) {
  return (
    <span className={`sch-person${faded ? ' sch-person--faded' : ''}`} title={note}>
      <Avatar name={name} color={color ?? role?.color} emoji={emoji} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      {role && <span className="sch-faint" style={{ fontSize: '0.74rem', fontWeight: 600 }}>· {role.name}</span>}
    </span>
  )
}

// ---- layout bits ------------------------------------------------------------------------------
export function EmptyState({ icon, title, hint, children }: { icon?: ReactNode; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="sch-card" style={{ alignItems: 'center', textAlign: 'center', padding: '26px 16px' }}>
      {icon && <div style={{ color: 'var(--text-faint)' }}>{icon}</div>}
      <p className="sch-h">{title}</p>
      {hint && <p className="sch-sub">{hint}</p>}
      {children}
    </div>
  )
}

export function Notice({ tone, children }: { tone: 'warn' | 'info' | 'danger'; children: ReactNode }) {
  const icon = tone === 'danger' ? <XCircle size={16} aria-hidden="true" /> : tone === 'warn' ? <AlertTriangle size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />
  const cls = tone === 'danger' ? 'sch-card--danger' : tone === 'warn' ? 'sch-card--warn' : ''
  return (
    <div className={`sch-card ${cls}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: '11px 13px' }} role={tone === 'danger' ? 'alert' : undefined}>
      <span style={{ flex: 'none', marginTop: 2, color: tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--neon-2)' }}>{icon}</span>
      <div className="sch-sub" style={{ color: 'var(--text)' }}>
        {children}
      </div>
    </div>
  )
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p className="sch-error" role="alert">
      <XCircle size={16} aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

