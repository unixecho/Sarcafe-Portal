'use client'

// SessionPill — "is the event open?" as one glanceable pill, and the one door to
// opening it, closing it, practising, and wiping the practice.
//
//   פתוח · מ־14:02     the event is live
//   מצב אימון · מ־14:02  practice: nothing recorded here counts
//   סגור                nobody can start an order
//   —                   we could not tell (never a confident "closed")
//
// The actions are the server's (POST /api/owner/pos/session) and its refusals are
// normal answers worded for a person ("עדיין יש פריטים שמחכים…"). Closing and wiping
// ask first, in a ConfirmSheet, in plain words; opening is one tap.

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Circle, GraduationCap, Play, Square } from 'lucide-react'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import SheetShell from '@/components/SheetShell'
import { haptic } from '@/lib/haptics'
import type {
  Known, SessionActionOk, SessionActionRefused, SessionAction, SessionLite, SessionsPayload,
} from '@/lib/pos/owner-api'
import { usePosLang, useT } from '@/lib/pos/useT'
import { Banner, clock, opsGet, useFailureText } from './FilterBar'

type Outcome = SessionActionOk | SessionActionRefused

async function postSession(branch: string, action: SessionAction): Promise<{ result: Outcome } | { code: string }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 15_000)
  try {
    const res = await fetch('/api/owner/pos/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch, action }),
      cache: 'no-store',
      credentials: 'same-origin',
      signal: ctl.signal,
    })
    const body: unknown = await res.json().catch(() => null)
    if (body && typeof body === 'object' && 'ok' in body) return { result: body as Outcome }
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code
    return { code: typeof code === 'string' ? code : res.status === 401 ? 'unauthorized' : 'internal_error' }
  } catch {
    return { code: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

export default function SessionPill({
  branchSlug, active, enabled, tz, onChanged,
}: {
  branchSlug: string
  active: Known<SessionLite | null>
  enabled: Known<boolean>
  tz?: string
  /** called after an action that changed the event — the hub refetches and says so */
  onChanged: (message: string) => void
}) {
  const t = useT()
  const [lang] = usePosLang()
  const failureText = useFailureText()
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<SessionAction | null>(null)
  const [problem, setProblem] = useState<{ text: string; setup?: boolean } | null>(null)
  const [confirm, setConfirm] = useState<(ConfirmRequest & { run: () => void }) | null>(null)
  const [payload, setPayload] = useState<SessionsPayload | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // Practice counts and recent sessions are only needed when the sheet opens.
  useEffect(() => {
    if (!open) return
    let live = true
    void opsGet<SessionsPayload>('session', { branch: branchSlug }).then((r) => {
      if (live && r.ok) setPayload(r.data)
    })
    return () => { live = false }
  }, [open, branchSlug])

  const s = active.known ? active.value : null
  const training = s?.kind === 'training'
  const state: 'unknown' | 'live' | 'training' | 'closed' = !active.known ? 'unknown' : !s ? 'closed' : training ? 'training' : 'live'

  const label =
    state === 'unknown' ? '—'
    : state === 'closed' ? t('owner.ops.session.closed')
    : t(training ? 'owner.ops.session.training' : 'owner.ops.session.open', { t: clock(s?.started_at, tz) })

  async function run(action: SessionAction) {
    setBusy(action)
    setProblem(null)
    const r = await postSession(branchSlug, action)
    if (!alive.current) return
    setBusy(null)
    if ('code' in r) {
      setProblem({ text: failureText(r.code) })
      return
    }
    const res = r.result
    if (res.ok) {
      const msg =
        action === 'open' ? t('owner.ops.session.did.open')
        : action === 'open_training' ? t('owner.ops.session.did.training')
        : action === 'wipe_training' ? t('owner.ops.session.did.wipe', { n: res.wipedOrders ?? 0 })
        : res.voidedUncollected ? t('owner.ops.session.did.closedVoid', { n: res.voidedUncollected })
        : t('owner.ops.session.did.close')
      setOpen(false)
      onChanged(msg)
      return
    }
    if (res.reason === 'uncollected' && action === 'close') {
      // Not an error: ask whether to cancel what nobody collected and close anyway.
      setConfirm({
        title: t('owner.ops.session.voidAsk.title'),
        body: t('owner.ops.session.voidAsk.body', { n: res.uncollected ?? 0 }),
        confirmLabel: t('owner.ops.session.voidAsk.go'),
        danger: true,
        run: () => void run('close_void_uncollected'),
      })
      return
    }
    setProblem({ text: res.message[lang], setup: res.reason === 'not_enabled' })
  }

  const ask = (req: ConfirmRequest & { run: () => void }) => setConfirm(req)
  const pending = busy !== null
  const trainingWaiting = payload?.training.known ? payload.training.orders : 0

  return (
    <>
      <button
        type="button"
        className={`ops-pill ops-pill--${state} press`}
        onClick={() => {
          haptic()
          setProblem(null)
          setOpen(true)
        }}
        aria-haspopup="dialog"
        title={enabled.known && !enabled.value ? t('owner.ops.session.off') : undefined}
      >
        {state === 'training' ? <GraduationCap size={16} aria-hidden="true" />
          : state === 'live' ? <Play size={16} aria-hidden="true" />
          : state === 'closed' ? <Square size={16} aria-hidden="true" />
          : <Circle size={16} aria-hidden="true" />}
        <span>{label}</span>
      </button>

      <SheetShell open={open} onClose={() => setOpen(false)} labelledBy={titleId} suspended={!!confirm} className="ops-sheet ops-sheet--narrow">
        <h2 id={titleId} className="ops-sheet-title">{t('owner.ops.session.title')}</h2>
        <div className="sheet-scroll">
          <p className="ops-sheet-lead">
            {state === 'live' ? t('owner.ops.session.lead.live', { t: clock(s?.started_at, tz) })
              : state === 'training' ? t('owner.ops.session.lead.training')
              : state === 'closed' ? t('owner.ops.session.lead.closed')
              : t('owner.ops.session.lead.unknown')}
          </p>

          {problem && (
            <Banner tone="danger" action={problem.setup ? <Link className="ops-link-btn press" href="/owner/pos/setup">{t('owner.ops.session.toSetup')}</Link> : undefined}>
              {problem.text}
            </Banner>
          )}

          <div className="ops-sheet-actions">
            {state === 'closed' && (
              <>
                <button type="button" className="ops-btn ops-btn--primary press" disabled={pending} onClick={() => void run('open')}>
                  <Play size={18} aria-hidden="true" />{t('owner.ops.session.act.open')}
                </button>
                <button type="button" className="ops-btn press" disabled={pending} onClick={() => void run('open_training')}>
                  <GraduationCap size={18} aria-hidden="true" />{t('owner.ops.session.act.training')}
                </button>
              </>
            )}
            {(state === 'live' || state === 'training') && (
              <button
                type="button"
                className="ops-btn ops-btn--danger press"
                disabled={pending}
                onClick={() =>
                  ask({
                    title: t(training ? 'owner.ops.session.askEnd.title' : 'owner.ops.session.askClose.title'),
                    body: t(training ? 'owner.ops.session.askEnd.body' : 'owner.ops.session.askClose.body'),
                    confirmLabel: t(training ? 'owner.ops.session.act.endTraining' : 'owner.ops.session.act.close'),
                    danger: !training,
                    run: () => void run('close'),
                  })
                }
              >
                <Square size={18} aria-hidden="true" />
                {t(training ? 'owner.ops.session.act.endTraining' : 'owner.ops.session.act.close')}
              </button>
            )}
            {state === 'closed' && trainingWaiting > 0 && (
              <button
                type="button"
                className="ops-btn press"
                disabled={pending}
                onClick={() =>
                  ask({
                    title: t('owner.ops.session.askWipe.title'),
                    body: t('owner.ops.session.askWipe.body', { n: trainingWaiting }),
                    confirmLabel: t('owner.ops.session.act.wipe'),
                    danger: true,
                    run: () => void run('wipe_training'),
                  })
                }
              >
                {t('owner.ops.session.act.wipeN', { n: trainingWaiting })}
              </button>
            )}
          </div>
          {pending && <p className="ops-muted" role="status">{t('owner.ops.session.working')}</p>}

          <button type="button" className="ops-link-btn ops-link-btn--block press" onClick={() => setOpen(false)}>
            {t('owner.ops.close')}
          </button>
        </div>
      </SheetShell>

      <ConfirmSheet
        request={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          c?.run()
        }}
      />
    </>
  )
}
