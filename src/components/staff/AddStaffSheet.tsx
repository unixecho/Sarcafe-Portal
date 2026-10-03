'use client'

import { useId, useState } from 'react'
import { X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import SelectSheet from '@/components/SelectSheet'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { InlineError, Notice } from '@/components/shifts/ui'
import { BADGES, type Badge } from '@/lib/staff/badges'
import { handleProblem } from '@/lib/pos/validate'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import { messageOf, reasonOf, type BranchOption } from '@/components/staff/types'

// "Add a person" with the fewest possible questions. Only a NAME is needed —
// email, phone, role and branch can all be filled in later. A person without an
// email is a full employee: they can be put on the schedule right away; they just
// cannot sign in to see it until an email is added.
//
// The POS nickname is required by the system (it is what the register and the
// Ready board show), so it is PRE-FILLED from the first name — usually nothing to
// type — and only needs attention when the name does not fit the nickname rules.

/** A nickname suggestion from the first name: one word, only allowed characters, 2–16 long. */
export function suggestHandle(firstName: string): string {
  const word = firstName.trim().split(/\s+/)[0] ?? ''
  const cleaned = Array.from(word).filter((c) => /[A-Za-z0-9֐-׿؀-ۿ_.-]/.test(c)).join('')
  return handleProblem(cleaned) === null ? cleaned : ''
}

export default function AddStaffSheet({
  open,
  onClose,
  branches,
  defaultBranchId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  branches: BranchOption[]
  defaultBranchId: string
  onCreated: (label: string) => void
}) {
  const t = useT()
  const ids = useId()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [badge, setBadge] = useState<Badge | ''>('')
  const [branchId, setBranchId] = useState<string>(defaultBranchId)
  const [handle, setHandle] = useState('')
  const [handleTouched, setHandleTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)

  const effectiveHandle = handleTouched ? handle : suggestHandle(firstName)
  const hint = effectiveHandle.trim() ? handleProblem(effectiveHandle) : null
  const handleOk = effectiveHandle.trim().length > 0 && handleProblem(effectiveHandle) === null
  const canSubmit = firstName.trim().length > 0 && handleOk && !busy

  function reset() {
    setFirstName('')
    setLastName('')
    setPhone('')
    setEmail('')
    setBadge('')
    setBranchId(defaultBranchId)
    setHandle('')
    setHandleTouched(false)
    setError(null)
  }
  function close() {
    reset()
    onClose()
  }

  async function submit(allowDuplicateName = false) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/owner/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          badge: badge || null,
          branchId: branchId || null,
          handle: effectiveHandle.trim(),
          allowDuplicateName,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        const reason = reasonOf(payload)
        if (reason === 'duplicate_name') {
          setConfirm({
            title: 'כבר יש מישהו בשם הזה',
            body: `${messageOf(payload, 'כבר יש מישהו בשם הזה בצוות.')}\nאם זה אדם אחר באמת — אפשר להוסיף.`,
            confirmLabel: 'להוסיף בכל זאת',
            cancelLabel: 'חזרה',
            onYes: () => void submit(true),
          })
          return
        }
        setError(
          reason === 'taken'
            ? t('owner.menu.staff.handleTaken')
            : reason === 'invalid'
              ? t('owner.menu.staff.handleProblem.bad_chars')
              : reason === 'handle_required'
                ? t('owner.menu.staff.handleRequired')
                : messageOf(payload, 'לא הצלחנו להוסיף. בדקו את הפרטים ונסו שוב.')
        )
        return
      }
      const label = firstName.trim() + (lastName.trim() ? ` ${lastName.trim()}` : '')
      reset()
      onCreated(label)
    } catch {
      setError('בעיית חיבור. בדקו את הרשת ונסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetShell open={open} onClose={close} labelledBy={`${ids}-title`} suspended={!!confirm} className="sch-sheet">
        <div className="sch-sheet__head">
          <h2 id={`${ids}-title`} className="sch-sheet__title">
            הוספת איש/אשת צוות
          </h2>
          <button type="button" className="sch-iconbtn press" onClick={close} aria-label="סגירה">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <form
          className="sheet-scroll"
          style={{ gap: 14 }}
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) void submit()
          }}
        >
          <div className="sch-row" style={{ alignItems: 'flex-start' }}>
            <label style={{ flex: 1, minWidth: 0 }}>
              <span className="sch-label">שם פרטי (חובה)</span>
              <input className="sch-input" value={firstName} maxLength={60} autoComplete="off" onChange={(e) => setFirstName(e.target.value)} placeholder="למשל: דנה" />
            </label>
            <label style={{ flex: 1, minWidth: 0 }}>
              <span className="sch-label">שם משפחה</span>
              <input className="sch-input" value={lastName} maxLength={60} autoComplete="off" onChange={(e) => setLastName(e.target.value)} />
            </label>
          </div>

          <label>
            <span className="sch-label">טלפון (לא חובה)</span>
            <input className="sch-input" type="tel" dir="ltr" inputMode="tel" value={phone} maxLength={32} onChange={(e) => setPhone(e.target.value)} placeholder="050-1234567" style={{ textAlign: 'start' }} />
          </label>

          <label>
            <span className="sch-label">אימייל Google (לא חובה)</span>
            <input className="sch-input" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" style={{ textAlign: 'start' }} />
            <span className="sch-sub" style={{ display: 'block', marginTop: 6 }}>
              בלי אימייל אפשר לשבץ את האדם בלוח כרגיל, אבל הוא/היא לא יוכלו להתחבר ולראות את הלוח בעצמם. אפשר להוסיף אימייל בכל רגע.
            </span>
          </label>

          <div className="sch-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="sch-label">תפקיד</span>
              <SelectSheet
                label="תפקיד"
                placeholder="בחרו תפקיד"
                value={badge}
                options={(Object.keys(BADGES) as Badge[]).map((b) => ({ value: b, label: BADGES[b].he }))}
                onChange={(v) => setBadge(v as Badge | '')}
                style={{ minHeight: 'var(--tap-min)', borderRadius: 12, border: '1px solid var(--line-interactive)', background: 'var(--bg)', color: 'var(--text)', padding: '0 14px', width: '100%' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="sch-label">סניף</span>
              <SelectSheet
                label="סניף"
                placeholder="כל הסניפים"
                value={branchId}
                options={branches.map((b) => ({ value: b.id, label: b.name.he ?? b.slug }))}
                onChange={setBranchId}
                style={{ minHeight: 'var(--tap-min)', borderRadius: 12, border: '1px solid var(--line-interactive)', background: 'var(--bg)', color: 'var(--text)', padding: '0 14px', width: '100%' }}
              />
            </div>
          </div>
          {(badge === 'owner' || badge === 'general_manager') && (
            <Notice tone="warn">{badge === 'owner' ? 'בעלים: גישה מלאה לכל המערכת ולכל הסניפים.' : 'מנהל/ת כללי/ת: עורך/ת את התפריט, מנהל/ת את הקופה ואת לוח המשמרות של הסניף.'}</Notice>
          )}

          <div>
            <label htmlFor={`${ids}-handle`} className="sch-label">
              {t('owner.menu.staff.handle')} (השם שיופיע בקופה)
            </label>
            <input
              id={`${ids}-handle`}
              className="sch-input"
              value={effectiveHandle}
              maxLength={40}
              autoComplete="off"
              aria-invalid={hint !== null || (!!firstName.trim() && !handleOk)}
              aria-describedby={`${ids}-hint`}
              onChange={(e) => {
                setHandle(e.target.value)
                setHandleTouched(true)
              }}
              placeholder={t('owner.menu.staff.handlePlaceholder')}
            />
            <span id={`${ids}-hint`} className="sch-sub" role={hint ? 'alert' : undefined} style={{ display: 'block', marginTop: 6, color: hint ? 'var(--danger)' : undefined }}>
              {hint ? t(`owner.menu.staff.handleProblem.${hint}` as StrKey) : !effectiveHandle.trim() && firstName.trim() ? t('owner.menu.staff.handleRequired') : t('owner.menu.staff.handleHint')}
            </span>
          </div>

          {error && <InlineError>{error}</InlineError>}
          <button type="submit" hidden />
        </form>

        <div className="sch-sheet__foot">
          <button type="button" className="sch-btn press" style={{ flex: 1 }} onClick={close}>
            ביטול
          </button>
          <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 2 }} disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? 'מוסיף…' : 'הוספה לצוות'}
          </button>
        </div>
      </SheetShell>

      <ConfirmSheet
        request={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          c?.onYes()
        }}
      />
    </>
  )
}
