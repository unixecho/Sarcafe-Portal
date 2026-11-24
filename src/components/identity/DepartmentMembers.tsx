'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input } from 'glisse'
import { Check, CircleAlert, Copy, Link2, RefreshCw, RotateCcw, UserRound, UserX, X } from 'lucide-react'
import { DECISIONS_FOR, DEFAULT_REGISTRATION_EXPIRY_HOURS, NEEDS_REASON, registrationLink, type MembershipState, type ReviewDecision } from '@/lib/identity/registration'
import type { DepartmentMember, DepartmentRegistrations } from '@/lib/identity/server/registration'
import Pill from '@/components/glass/Pill'
import Seg from '@/components/glass/Seg'
import { glassToast } from '@/components/glass/toast'
import { identityApi, refusalText, when } from './api'
import PrivatePhoto, { STATE_TEXT, StatePill } from './PrivatePhoto'

// A department's employees, for its reviewer (FABLE-003): the department head, or an administrator of the organization. Registration
// links (single use, copied by hand: nothing is sent), the applications and members by state, each person's details and private photo,
// and the decisions: approve, reject (with a reason), deactivate (with a reason), reactivate. Every decision carries the version the
// screen showed; a change since then is refused and the list reloads. Only one person's photo is on screen at a time, and it leaves
// with them. Glass pieces only.

const EXPIRY = [{ value: '72', label: '3 ימים' }, { value: '168', label: 'שבוע' }, { value: '336', label: 'שבועיים' }]
const FILTERS: Array<{ value: MembershipState; label: string }> = [
  { value: 'pending', label: 'ממתינים' }, { value: 'approved', label: 'מאושרים' }, { value: 'inactive', label: 'מושבתים' }, { value: 'rejected', label: 'נדחו' },
]
const DECISION_TEXT: Record<ReviewDecision, { label: string; done: string }> = {
  approve: { label: 'אישור', done: 'הבקשה אושרה.' },
  reject: { label: 'דחייה', done: 'הבקשה נדחתה.' },
  deactivate: { label: 'השבתה', done: 'החברות הושבתה.' },
  reactivate: { label: 'הפעלה מחדש', done: 'החברות הופעלה מחדש.' },
}
const ICON = { approve: <Check size={16} />, reject: <X size={16} />, deactivate: <UserX size={16} />, reactivate: <RotateCcw size={16} /> } as const

export default function DepartmentMembers({ organizationId, departmentId, departmentName }: { organizationId: string; departmentId: string; departmentName: string }) {
  const base = `/api/benefits/manage/organizations/${organizationId}/departments/${departmentId}`
  const [data, setData] = useState<DepartmentRegistrations | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [filter, setFilter] = useState<MembershipState>('pending')
  const [open, setOpen] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [hours, setHours] = useState(String(DEFAULT_REGISTRATION_EXPIRY_HOURS))
  const [fresh, setFresh] = useState<{ link: string; expiresAt: string } | null>(null)
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    const result = await identityApi<DepartmentRegistrations>(`${base}/registrations`)
    if (mine !== generation.current) return
    if (result.ok) { setData(result.data); setProblem(null) } else { setData(null); setProblem(refusalText(result)) }
  }, [base])
  useEffect(() => { void load() }, [load])

  const makeLink = async () => {
    setBusy(true)
    const result = await identityApi<{ token: string; expiresAt: string }>(`${base}/registrations`, { method: 'POST', body: { expiresInHours: Number(hours) } })
    setBusy(false)
    if (!result.ok) { glassToast(refusalText(result), 'bad'); return }
    setFresh({ link: registrationLink(window.location.origin, result.data.token), expiresAt: result.data.expiresAt })
    glassToast('נוצר קישור הרשמה. העתיקו אותו עכשיו.', 'ok')
    await load()
  }
  const copy = async () => {
    if (!fresh) return
    try { await navigator.clipboard.writeText(fresh.link); glassToast('הקישור הועתק.', 'ok') } catch { glassToast('ההעתקה לא הצליחה. סמנו את הקישור והעתיקו ידנית.', 'bad') }
  }
  const revokeLink = async (inviteId: string) => {
    setBusy(true)
    const result = await identityApi(`${base}/registrations/${inviteId}`, { method: 'DELETE' })
    setBusy(false)
    if (!result.ok) { glassToast(refusalText(result), 'bad'); return }
    glassToast('הקישור בוטל.', 'ok')
    await load()
  }
  const decide = async (member: DepartmentMember, decision: ReviewDecision) => {
    const why = reason.replace(/\s+/g, ' ').trim()
    if (NEEDS_REASON.includes(decision) && !why) { glassToast('כתבו סיבה קצרה.', 'bad'); return }
    setBusy(true)
    const result = await identityApi<{ state: MembershipState }>(`${base}/members/${member.membershipId}/review`, { method: 'POST', body: { decision, reason: why || null, version: member.version } })
    setBusy(false)
    if (!result.ok) {
      glassToast(refusalText(result), 'bad')
      if (result.code === 'stale' || result.code === 'conflict') { setOpen(null); await load() }
      return
    }
    glassToast(DECISION_TEXT[decision].done, 'ok')
    setOpen(null)
    setReason('')
    await load()
  }

  if (problem) {
    return (
      <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity="members-problem">
        <p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />{problem}</p>
        <div className="gl-card__actions"><Button icon={<RefreshCw size={16} />} onClick={() => { setProblem(null); void load() }}>לנסות שוב</Button></div>
      </section>
    )
  }
  if (!data) {
    return (
      <div className="gl-list" aria-busy="true" data-identity="members-loading">
        <p className="sr-only" role="status">טוען את עובדי המחלקה…</p>
        {[0, 1].map((i) => <div key={i} className="gl-inset"><span className="sk gl-sk-line gl-sk-line--title" /><span className="sk gl-sk-line gl-sk-line--short" /></div>)}
      </div>
    )
  }

  const shown = data.members.filter((m) => m.state === filter)
  return (
    <div className="gl-list" data-identity="members" data-department={departmentId}>
      <div className="gl-inset" data-identity="registration-links">
        <span className="gl-field__label" style={{ color: 'var(--text)' }}><Link2 size={15} aria-hidden="true" />קישורי הרשמה לעובדים{data.invites.length > 0 && <Pill tiny>{data.invites.length}</Pill>}</span>
        <p className="gl-note">כל קישור מיועד לעובד אחד ופועל פעם אחת. שום הודעה לא נשלחת: מעתיקים ושולחים בעצמכם. מי שנרשם עדיין לא מקבל דבר עד שתאשרו.</p>
        <Seg label="תוקף הקישור" fill items={EXPIRY} value={hours} onChange={setHours} />
        <div className="gl-card__actions"><Button variant="filled" icon={<Link2 size={16} />} disabled={busy} onClick={() => void makeLink()} data-identity="registration-link-create">יצירת קישור הרשמה</Button></div>
        {fresh && (
          <div className="gl-summary gl-tone-ok" role="status" data-identity="registration-fresh-link">
            <p className="gl-note">הקישור מוצג <strong>פעם אחת בלבד</strong>, בתוקף עד <bdi dir="ltr">{when(fresh.expiresAt)}</bdi>.</p>
            <Input aria-label="קישור ההרשמה" icon={<Link2 size={17} />} dir="ltr" readOnly value={fresh.link} onFocus={(event) => event.currentTarget.select()} />
            <div className="gl-card__actions">
              <Button variant="filled" icon={<Copy size={16} />} onClick={() => void copy()}>העתקת הקישור</Button>
              <Button onClick={() => setFresh(null)}>סיימתי</Button>
            </div>
          </div>
        )}
        {data.invites.length > 0 && (
          <ul className="gl-list">
            {data.invites.map((invite) => (
              <li key={invite.id} className="gl-row-card" data-identity="registration-link">
                <span className="gl-row-card__copy"><strong>קישור פתוח{invite.opened && <> · <small>נפתח</small></>}</strong><small>בתוקף עד <bdi dir="ltr">{when(invite.expiresAt)}</bdi></small></span>
                <Button disabled={busy} onClick={() => void revokeLink(invite.id)}>ביטול</Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* chips, not a segmented control: four states with their counts must wrap on a phone instead of pushing the page sideways */}
      <div className="gl-wrap" role="radiogroup" aria-label={`עובדי ${departmentName}`} data-identity="members-filter">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" role="radio" aria-checked={filter === f.value} className={`gl-chip${filter === f.value ? ' is-on' : ''}`}
            onClick={() => { setFilter(f.value); setOpen(null); setReason('') }}>{f.label}{data.counts[f.value] > 0 && <Pill tiny>{data.counts[f.value]}</Pill>}</button>
        ))}
      </div>

      {shown.length === 0 && <p className="gl-note" data-identity="members-empty">אין כרגע {STATE_TEXT[filter] === 'ממתין לאישור' ? 'בקשות שממתינות' : `עובדים במצב "${STATE_TEXT[filter]}"`}.</p>}
      <ul className="gl-list">
        {shown.map((member) => {
          const isOpen = open === member.membershipId
          const name = member.erased ? 'פרטים שנמחקו' : `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim()
          const photo = member.hasPendingPhoto ? 'pending' : member.hasApprovedPhoto ? 'approved' : null
          return (
            <li key={member.membershipId} className="gl-inset" data-identity="member" data-state={member.state}>
              <div className="gl-row-card" style={{ padding: 0 }}>
                <span className="gl-row-card__copy">
                  <strong style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><UserRound size={15} aria-hidden="true" />{name}{member.nickname && <small>({member.nickname})</small>}<StatePill state={member.state} /></strong>
                  <small>נשלח <bdi dir="ltr">{when(member.updatedAt)}</bdi>{member.reviewReason ? ` · ${member.reviewReason}` : ''}</small>
                </span>
                {!member.erased && <Button onClick={() => { setOpen(isOpen ? null : member.membershipId); setReason('') }} data-identity="member-open">{isOpen ? 'סגירה' : 'פתיחה'}</Button>}
              </div>
              {isOpen && (
                <div className="gl-list" data-identity="member-detail">
                  {photo
                    ? <PrivatePhoto key={`${member.membershipId}:${member.version}:${photo}`} url={`${base}/members/${member.membershipId}/photo?which=${photo}`} label={`התמונה של ${name}`} />
                    : <p className="gl-note gl-note--bad"><CircleAlert size={16} aria-hidden="true" />אין תמונה לבדיקה.</p>}
                  {member.hasPendingPhoto && member.hasApprovedPhoto && <p className="gl-note">מוצגת התמונה החדשה שממתינה. התמונה הקודמת נשארת עד שתאשרו.</p>}
                  <p className="gl-note">השוו בעצמכם את התמונה ואת השם לעובד שאתם מכירים. אין כאן זיהוי אוטומטי.</p>
                  {DECISIONS_FOR[member.state].some((d) => NEEDS_REASON.includes(d)) && (
                    <Input aria-label="סיבה (לדחייה או להשבתה)" maxLength={300} placeholder="סיבה קצרה (לדחייה או להשבתה)" value={reason} onValueChange={setReason} />
                  )}
                  <div className="gl-card__actions">
                    {DECISIONS_FOR[member.state].map((decision) => (
                      <Button key={decision} variant={decision === 'approve' || decision === 'reactivate' ? 'filled' : undefined} destructive={decision === 'reject' || decision === 'deactivate'}
                        icon={ICON[decision]} disabled={busy} onClick={() => void decide(member, decision)} data-identity={`decide-${decision}`}>{DECISION_TEXT[decision].label}</Button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
