'use client'
import { useId, useState } from 'react'
import Link from 'next/link'
import { KeyRound, ShieldCheck, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import GoogleLinkButton from './GoogleLinkButton'

export default function StaffAccountActions({ linked, quick }: { linked: boolean; quick: boolean }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [currentCode, setCurrentCode] = useState('')
  const [newCode, setNewCode] = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function changeCode() {
    if (busy || newCode !== confirmCode) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/checklists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'change_passcode', currentPasscode: currentCode, newPasscode: newCode }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message || 'לא הצלחנו לשנות את הקוד')
      setCurrentCode(''); setNewCode(''); setConfirmCode('')
      await fetch('/api/auth/signout', { method: 'POST' })
      window.location.assign('/login?next=/staff&quick=1')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'לא הצלחנו לשמור'); setBusy(false) }
  }
  return <>
    <div className="sr-upload" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}><ShieldCheck size={20} color="var(--neon-soft)"/><h2 style={{ margin: 0 }}>כניסה לחשבון</h2></div>
      <p className="sr-note">הקוד האישי מיועד לצ׳קליסטים ולעמדות אירועים. Google מאפשר גישה ללוח המשמרות, להזמנות מהירות ולתלושים.</p>
      {!linked ? <GoogleLinkButton/> : <p className="sr-note">חשבון Google מקושר.{quick && <> <Link href="/login?next=/staff/profile" style={{ color: 'var(--neon-soft)' }}>כניסה עם Google</Link></>}</p>}
      <button type="button" className="sr-download press" style={{ background: 'none', border: 0, font: 'inherit', fontSize: '.85rem', marginTop: 14 }} onClick={() => { setError(''); setOpen(true) }}><KeyRound size={18}/>שינוי הקוד האישי</button>
    </div>
    <SheetShell open={open} onClose={() => { if (!busy) { setOpen(false); setCurrentCode(''); setNewCode(''); setConfirmCode('') } }} labelledBy={id}>
      <div className="sch-wrap">
        <div className="sch-row"><h2 id={id} className="sch-sheet-title">שינוי הקוד האישי</h2><button type="button" className="sch-icon-btn press" aria-label="סגירה" disabled={busy} onClick={() => { setOpen(false); setCurrentCode(''); setNewCode(''); setConfirmCode('') }}><X size={20}/></button></div>
        <p className="sch-sub">אחרי השמירה תתבקשו להיכנס מחדש עם הקוד החדש.</p>
        {[[currentCode, setCurrentCode, 'הקוד הנוכחי'], [newCode, setNewCode, 'קוד חדש בן 6 ספרות'], [confirmCode, setConfirmCode, 'הקוד החדש שוב']] .map(([value, change, label], i) => <label key={i} className="sch-label">{label as string}<input type="password" inputMode="numeric" className="sch-input" dir="ltr" autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={value as string} disabled={busy} onChange={(event) => (change as (value: string) => void)(event.target.value.replace(/\D/g, '').slice(0, 6))}/></label>)}
        {confirmCode.length === 6 && confirmCode !== newCode && <p role="alert" className="sr-attention">שני הקודים החדשים צריכים להיות זהים</p>}
        {error && <p role="alert" className="sr-attention">{error}</p>}
        <button className="sr-action press" disabled={busy || currentCode.length !== 6 || newCode.length !== 6 || confirmCode !== newCode} onClick={() => void changeCode()}>{busy ? 'שומר את הקוד…' : 'שמירת הקוד החדש'}</button>
      </div>
    </SheetShell>
  </>
}
