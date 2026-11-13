'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input } from 'glisse'
import { Building2, CircleAlert, Copy, Link2, Mail, Plus, RefreshCw, UserRound, Users } from 'lucide-react'
import { DEFAULT_INVITATION_EXPIRY_HOURS, invitationLink } from '@/lib/identity/invitations'
import type { OrganizationDetail } from '@/lib/identity/server/organizations'
import Pill from '@/components/glass/Pill'
import Seg from '@/components/glass/Seg'
import { glassToast } from '@/components/glass/toast'
import { identityApi, refusalText, when, type ApiResult } from './api'

// One organization for someone who may manage it (FABLE-002): its departments, each department's heads and open invitations, and
// the invitation form. The same screen serves the owner (apiBase /api/owner/members) and an organization's own administrator
// (apiBase /api/benefits/manage); the server decides again on every call, so nothing here is more than a view of its answers.
// Glass pieces only (docs/SARCAFE_GLASS_UI.md): .gl-surf cards, glisse Button / Input, Seg, Pill, glassToast.

/** An icon beside its words, on one line. */
const ICON_ROW = { display: 'flex', alignItems: 'center', gap: 6 } as const
const EXPIRY = [{ value: '24', label: '24 שעות' }, { value: '72', label: '3 ימים' }, { value: '168', label: 'שבוע' }]
type Fresh = { departmentId: string; link: string; hint: string; expiresAt: string }

/** A button that asks once more before it does something that takes access away. */
function Confirm({ label, sure, busy, onConfirm }: { label: string; sure: string; busy: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), 5000)
    return () => window.clearTimeout(timer)
  }, [armed])
  return armed
    ? <Button destructive disabled={busy} onClick={() => { setArmed(false); onConfirm() }}>{sure}</Button>
    : <Button disabled={busy} onClick={() => setArmed(true)}>{label}</Button>
}

export default function OrganizationManager({ apiBase, organizationId, onChanged }: { apiBase: string; organizationId: string; onChanged?: () => void }) {
  const base = `${apiBase}/organizations/${organizationId}`
  const [detail, setDetail] = useState<OrganizationDetail | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [newDepartment, setNewDepartment] = useState('')
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [hours, setHours] = useState<Record<string, string>>({})
  const [fresh, setFresh] = useState<Fresh | null>(null)
  const [copied, setCopied] = useState(false)
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    const result = await identityApi<OrganizationDetail>(base)
    if (mine !== generation.current) return
    if (result.ok) { setDetail(result.data); setOrgName(result.data.organization.name); setProblem(null) }
    else { setDetail(null); setProblem(refusalText(result)) }
  }, [base])
  useEffect(() => { setDetail(null); setFresh(null); setProblem(null); void load() }, [load])

  /** Runs one write, says what happened in the right colour, and reloads the server's truth. */
  const act = useCallback(async <T,>(run: () => Promise<ApiResult<T>>, done: string): Promise<T | null> => {
    setBusy(true)
    const result = await run()
    setBusy(false)
    if (!result.ok) { glassToast(refusalText(result), 'bad'); return null }
    glassToast(done, 'ok')
    await load()
    onChanged?.()
    return result.data
  }, [load, onChanged])

  if (problem) {
    return (
      <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity="org-problem">
        <p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />{problem}</p>
        <div className="gl-card__actions"><Button icon={<RefreshCw size={16} />} onClick={() => { setProblem(null); void load() }}>לנסות שוב</Button></div>
      </section>
    )
  }
  if (!detail) {
    return (
      <div className="gl-list" aria-busy="true" data-identity="org-loading">
        <p className="sr-only" role="status">טוען את הארגון…</p>
        {[0, 1].map((i) => <div key={i} className="gl-surf gl-card gl-sk-card"><span className="sk gl-sk-line gl-sk-line--title" /><span className="sk gl-sk-line" /><span className="sk gl-sk-line gl-sk-line--short" /></div>)}
      </div>
    )
  }

  const org = detail.organization
  const active = org.state === 'active'
  const invite = async (departmentId: string) => {
    const email = (emails[departmentId] ?? '').trim()
    if (!email) { glassToast('הזינו את כתובת ה־Google של ראש המחלקה.', 'bad'); return }
    const created = await act<{ token: string; hint: string; expiresAt: string }>(
      () => identityApi(`${base}/invitations`, { method: 'POST', body: { departmentId, email, expiresInHours: Number(hours[departmentId] ?? DEFAULT_INVITATION_EXPIRY_HOURS) } }),
      'נוצר קישור הזמנה. העתיקו אותו עכשיו.')
    if (!created) return
    setEmails((all) => ({ ...all, [departmentId]: '' }))
    setCopied(false)
    setFresh({ departmentId, link: invitationLink(window.location.origin, created.token), hint: created.hint, expiresAt: created.expiresAt })
  }
  const copy = async () => {
    if (!fresh) return
    try { await navigator.clipboard.writeText(fresh.link); setCopied(true); glassToast('הקישור הועתק.', 'ok') }
    catch { glassToast('ההעתקה לא הצליחה. סמנו את הקישור והעתיקו ידנית.', 'bad') }
  }

  return (
    <div className="gl-list" data-identity="org" data-organization={org.id}>
      <section className="gl-surf gl-card" aria-label={`הארגון ${org.name}`}>
        <h2 className="gl-card__title"><Building2 size={18} aria-hidden="true" /><span>{org.name}</span><Pill tone={active ? 'ok' : 'quiet'}>{active ? 'פעיל' : 'כבוי'}</Pill></h2>
        {detail.via === 'setup' && <p className="gl-note" data-identity="setup-note">לארגון הזה עדיין אין מנהל משלו, ולכן אתם מנהלים אותו בשלב ההקמה.</p>}
        <div className="gl-field">
          <span className="gl-field__label" id={`org-name-${org.id}`}>שם הארגון</span>
          <Input aria-labelledby={`org-name-${org.id}`} icon={<Building2 size={17} />} maxLength={80} value={orgName} onValueChange={setOrgName} />
        </div>
        <div className="gl-card__actions">
          <Button variant="filled" disabled={busy || !orgName.trim() || orgName.trim() === org.name} onClick={() => void act(() => identityApi(base, { method: 'PATCH', body: { name: orgName.trim() } }), 'השם עודכן.')}>שמירת השם</Button>
          {active
            ? <Confirm label="כיבוי הארגון" sure="לכבות? ההזמנות הפתוחות יבוטלו" busy={busy} onConfirm={() => void act(() => identityApi(base, { method: 'PATCH', body: { state: 'inactive' } }), 'הארגון כובה.')} />
            : <Button disabled={busy} onClick={() => void act(() => identityApi(base, { method: 'PATCH', body: { state: 'active' } }), 'הארגון הופעל.')}>הפעלת הארגון</Button>}
        </div>
      </section>

      {detail.departments.length === 0 && <p className="gl-summary" data-identity="no-departments">עדיין אין מחלקות. הוסיפו את הראשונה למטה.</p>}

      {detail.departments.map((department) => {
        const on = department.state === 'active'
        const heads = detail.heads.filter((head) => head.departmentId === department.id)
        const pending = detail.invitations.filter((invitation) => invitation.departmentId === department.id && invitation.status === 'pending')
        return (
          <section key={department.id} className="gl-surf gl-card" aria-label={`המחלקה ${department.name}`} data-identity="department" data-department={department.id}>
            <h3 className="gl-card__title"><Users size={18} aria-hidden="true" /><span>{department.name}</span><Pill tone={on ? 'ok' : 'quiet'}>{on ? 'פעילה' : 'כבויה'}</Pill></h3>

            <div className="gl-field">
              <span className="gl-field__label">ראשי המחלקה{heads.length > 0 && <Pill tiny>{heads.length}</Pill>}</span>
              {heads.length === 0 && <p className="gl-note">אין עדיין ראש מחלקה. הזמינו אחד למטה.</p>}
              {heads.length > 0 && (
                <ul className="gl-list">
                  {heads.map((head) => (
                    <li key={head.grantId} className="gl-inset" data-identity="head">
                      <span className="gl-row-card__copy"><strong style={ICON_ROW}><UserRound size={15} aria-hidden="true" /><bdi dir="ltr">{head.hint ?? 'ראש מחלקה'}</bdi></strong><small>מאז <bdi dir="ltr">{when(head.grantedAt)}</bdi></small></span>
                      <div className="gl-card__actions"><Confirm label="הסרה" sure="להסיר את ההרשאה?" busy={busy} onConfirm={() => void act(() => identityApi(`${base}/heads/${head.grantId}`, { method: 'DELETE' }), 'ההרשאה הוסרה.')} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {pending.length > 0 && (
              <div className="gl-field">
                <span className="gl-field__label">הזמנות שממתינות<Pill tiny>{pending.length}</Pill></span>
                <ul className="gl-list">
                  {pending.map((invitation) => (
                    <li key={invitation.id} className="gl-inset" data-identity="pending">
                      <span className="gl-row-card__copy"><strong style={ICON_ROW}><Mail size={15} aria-hidden="true" /><bdi dir="ltr">{invitation.hint}</bdi></strong><small>בתוקף עד <bdi dir="ltr">{when(invitation.expiresAt)}</bdi></small></span>
                      <div className="gl-card__actions"><Confirm label="ביטול ההזמנה" sure="לבטל את ההזמנה?" busy={busy} onConfirm={() => void act(() => identityApi(`${base}/invitations/${invitation.id}`, { method: 'DELETE' }), 'ההזמנה בוטלה.')} /></div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {fresh?.departmentId === department.id && (
              <div className="gl-summary gl-tone-ok" role="status" data-identity="fresh-link">
                <p className="gl-note">הקישור מוצג <strong>פעם אחת בלבד</strong>. העתיקו ושלחו אותו בעצמכם ל־<bdi dir="ltr">{fresh.hint}</bdi>. רק מי שיתחבר עם כתובת ה־Google הזו יוכל לאשר, פעם אחת, עד <bdi dir="ltr">{when(fresh.expiresAt)}</bdi>.</p>
                <Input aria-label="קישור ההזמנה" icon={<Link2 size={17} />} dir="ltr" readOnly value={fresh.link} onFocus={(event) => event.currentTarget.select()} />
                <div className="gl-card__actions">
                  <Button variant="filled" icon={<Copy size={16} />} onClick={() => void copy()}>{copied ? 'הועתק' : 'העתקת הקישור'}</Button>
                  <Button onClick={() => setFresh(null)}>סיימתי</Button>
                </div>
              </div>
            )}

            {on && active && (
              <div className="gl-inset">
                <span className="gl-field__label" id={`invite-${department.id}`}>הזמנת ראש מחלקה</span>
                <Input aria-labelledby={`invite-${department.id}`} icon={<Mail size={17} />} type="email" inputMode="email" autoComplete="off" dir="ltr" maxLength={254} placeholder="name@example.org" value={emails[department.id] ?? ''} onValueChange={(value) => setEmails((all) => ({ ...all, [department.id]: value }))} />
                <Seg label="תוקף ההזמנה" fill items={EXPIRY} value={hours[department.id] ?? String(DEFAULT_INVITATION_EXPIRY_HOURS)} onChange={(value) => setHours((all) => ({ ...all, [department.id]: value }))} />
                <p className="gl-note">שום הודעה לא נשלחת. מקבלים קישור פרטי להעתקה, והוא יפעל רק לבעל כתובת ה־Google הזו.</p>
                <div className="gl-card__actions"><Button variant="filled" icon={<Link2 size={16} />} disabled={busy} onClick={() => void invite(department.id)}>יצירת קישור הזמנה</Button></div>
              </div>
            )}

            <div className="gl-card__actions">
              {on
                ? <Confirm label="כיבוי המחלקה" sure="לכבות? ראשי המחלקה יאבדו גישה" busy={busy} onConfirm={() => void act(() => identityApi(`${base}/departments/${department.id}`, { method: 'PATCH', body: { state: 'inactive' } }), 'המחלקה כובתה.')} />
                : <Button disabled={busy || !active} onClick={() => void act(() => identityApi(`${base}/departments/${department.id}`, { method: 'PATCH', body: { state: 'active' } }), 'המחלקה הופעלה.')}>הפעלת המחלקה</Button>}
            </div>
          </section>
        )
      })}

      {active && (
        <section className="gl-surf gl-card" aria-label="מחלקה חדשה" data-identity="new-department">
          <h3 className="gl-card__title"><Plus size={18} aria-hidden="true" />מחלקה חדשה</h3>
          <Input aria-label="שם המחלקה החדשה" icon={<Users size={17} />} maxLength={80} placeholder="למשל: הנהלת חשבונות" value={newDepartment} onValueChange={setNewDepartment}
            onKeyDown={(event) => { if (event.key === 'Enter' && newDepartment.trim() && !busy) void act(() => identityApi(`${base}/departments`, { method: 'POST', body: { name: newDepartment.trim() } }), 'המחלקה נוספה.').then((ok) => { if (ok) setNewDepartment('') }) }} />
          <div className="gl-card__actions">
            <Button variant="filled" icon={<Plus size={16} />} disabled={busy || !newDepartment.trim()} onClick={() => void act(() => identityApi(`${base}/departments`, { method: 'POST', body: { name: newDepartment.trim() } }), 'המחלקה נוספה.').then((ok) => { if (ok) setNewDepartment('') })}>הוספת מחלקה</Button>
          </div>
        </section>
      )}
    </div>
  )
}
