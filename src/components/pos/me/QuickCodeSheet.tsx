'use client'

// The person's own quick-login code (blueprint §1a.5): see the employee number, set or
// change the 6-digit code, or remove it. Opened from the Me sheet.
//
// A code is typed TWICE: there is no "show" toggle (a shared tablet is a bad place to
// reveal digits), so the second entry is what catches a typo. The server decides what is
// too easy to guess and the person is told in plain words. A quick-login session cannot
// change its own code (a stolen tablet session must not lock the owner out) — the route
// refuses it, and that refusal is explained here rather than shown as an error code.

import { useCallback, useEffect, useRef, useState } from 'react'
import SheetShell from '@/components/SheetShell'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { PasscodeEntry } from '@/components/auth/QuickLogin'
import { usePosActions } from '@/components/pos/PosProvider'
import { usePosToast } from '@/components/pos/shell/Toast'
import { errorText } from '@/components/pos/shell/errorText'
import { interpretResponse } from '@/lib/pos/client'
import { useT } from '@/lib/pos/useT'

type Step = 'idle' | 'first' | 'again'

type Props = {
  open: boolean
  onClose: () => void
  employeeNo: number | null
  hasPasscode: boolean
}

async function callPasscode(method: 'POST' | 'DELETE', body: Record<string, string>) {
  try {
    const res = await fetch('/api/pos/passcode', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return interpretResponse<{ ok: true }>(res.status, await res.text(), res.redirected && new URL(res.url).pathname.startsWith('/login'))
  } catch {
    return interpretResponse<{ ok: true }>(0, '')
  }
}

export default function QuickCodeSheet({ open, onClose, employeeNo, hasPasscode }: Props) {
  const t = useT()
  const { patchMe } = usePosActions()
  const { toast } = usePosToast()
  const titleId = 'pos-quick-code-title'

  const [step, setStep] = useState<Step>('idle')
  const [code, setCode] = useState('')
  const [first, setFirst] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Closing the sheet drops whatever was half-typed: a code must not wait in memory.
  useEffect(() => {
    if (open) return
    setStep('idle')
    setCode('')
    setFirst('')
    setError(null)
    setBusy(false)
    setConfirm(null)
  }, [open])

  const restart = useCallback((message: string) => {
    setFirst('')
    setCode('')
    setStep('first')
    setError(message)
    setShake((n) => n + 1)
  }, [])

  const complete = useCallback(
    async (typed: string) => {
      if (step === 'first') {
        setFirst(typed)
        setCode('')
        setError(null)
        setStep('again')
        return
      }
      if (step !== 'again') return
      if (typed !== first) {
        restart(t('me.quick.sheet.mismatch'))
        return
      }
      setBusy(true)
      setError(null)
      const result = await callPasscode('POST', { passcode: typed })
      if (!aliveRef.current) return
      setBusy(false)
      if (result.ok) {
        patchMe({ hasPasscode: true })
        toast(t('me.quick.sheet.saved'))
        setStep('idle')
        setCode('')
        setFirst('')
        return
      }
      if (result.details?.reason === 'weak') restart(t('me.quick.sheet.weak'))
      else if (result.details?.reason === 'quick_session') {
        setStep('idle')
        setCode('')
        setFirst('')
        setError(t('me.quick.sheet.needGoogle'))
      } else restart(errorText(t, result.code))
    },
    [step, first, restart, patchMe, toast, t]
  )

  const remove = useCallback(async () => {
    setConfirm(null)
    setBusy(true)
    setError(null)
    const result = await callPasscode('DELETE', {})
    if (!aliveRef.current) return
    setBusy(false)
    if (result.ok) {
      patchMe({ hasPasscode: false })
      toast(t('me.quick.sheet.removed'))
      return
    }
    setError(result.details?.reason === 'quick_session' ? t('me.quick.sheet.needGoogle') : errorText(t, result.code))
  }, [patchMe, toast, t])

  const entering = step !== 'idle'

  return (
    <>
      <SheetShell open={open} onClose={onClose} labelledBy={titleId} suspended={confirm !== null}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 4px 8px' }}>
          <div>
            <h2 id={titleId} className="pos-sheet-title">
              {t('me.quick.sheet.title')}
            </h2>
            <p className="pos-sheet-sub">{t('me.quick.sheet.explain')}</p>
          </div>

          <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
            {employeeNo !== null ? (
              t('me.quick.sheet.yourNumber', { n: employeeNo }).split(String(employeeNo)).flatMap((part, i, arr) =>
                i < arr.length - 1
                  ? [part, <span key={i} className="ltr-isolate">{employeeNo}</span>]
                  : [part]
              )
            ) : (
              <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-dim)' }}>{t('me.quick.sheet.noNumber')}</span>
            )}
          </p>

          {entering ? (
            <>
              <PasscodeEntry
                label={step === 'first' ? t('me.quick.sheet.new') : t('me.quick.sheet.again')}
                value={code}
                onChange={setCode}
                onComplete={(typed) => void complete(typed)}
                disabled={busy}
                invalid={error !== null}
                shakeKey={shake}
              />
              <button
                type="button"
                className="pos-btn press"
                disabled={busy}
                onClick={() => {
                  setStep('idle')
                  setCode('')
                  setFirst('')
                  setError(null)
                }}
              >
                {t('me.quick.sheet.back')}
              </button>
            </>
          ) : (
            <>
              <p className="pos-sheet-sub" style={{ margin: 0 }}>
                {hasPasscode ? t('me.quick.sheet.has') : t('me.quick.sheet.none')}
              </p>
              <button
                type="button"
                className="pos-btn pos-btn--primary press"
                disabled={busy}
                onClick={() => {
                  setError(null)
                  setStep('first')
                }}
              >
                {hasPasscode ? t('me.quick.sheet.change') : t('me.quick.sheet.set')}
              </button>
              {hasPasscode && (
                <button
                  type="button"
                  className="pos-btn press"
                  disabled={busy}
                  style={{ color: 'var(--danger)' }}
                  onClick={() =>
                    setConfirm({
                      title: t('me.quick.sheet.removeTitle'),
                      body: t('me.quick.sheet.removeBody'),
                      confirmLabel: t('me.quick.sheet.remove'),
                      cancelLabel: t('me.quick.sheet.back'),
                      danger: true,
                    })
                  }
                >
                  {t('me.quick.sheet.remove')}
                </button>
              )}
              <button type="button" className="pos-btn press" onClick={onClose}>
                {t('me.quick.sheet.close')}
              </button>
            </>
          )}

          <p role="alert" className="pos-hint pos-hint--bad" style={{ margin: 0, textAlign: 'center' }}>
            {error}
          </p>
        </div>
      </SheetShell>
      <ConfirmSheet request={confirm} onConfirm={() => void remove()} onCancel={() => setConfirm(null)} />
    </>
  )
}
