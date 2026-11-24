'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from 'glisse'
import { Building2, CircleAlert, IdCard, Pencil, RefreshCw } from 'lucide-react'
import type { MyMembership, Notice } from '@/lib/identity/server/registration'
import { glassToast } from '@/components/glass/toast'
import { identityApi, refusalText, uploadPhoto, when } from './api'
import PrivatePhoto, { StatePill } from './PrivatePhoto'
import { DetailsForm, type Details } from './RegistrationFlow'

// "הבקשות שלי" (FABLE-003): the signed-in person's own applications, in every organization, and nothing of anyone else. They can see
// the state, their own photo (through the private proxy) and change their details; a changed name, nickname or photo goes back to
// review, and the screen says so before they send it. An inactive membership is changed only by a reviewer.
type Mine = { memberships: MyMembership[]; notice: Notice | null }

export default function MyMemberships({ onLoaded }: { onLoaded?: (count: number) => void }) {
  const [mine, setMine] = useState<Mine | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [photoOf, setPhotoOf] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await identityApi<Mine>('/api/benefits/me')
    if (result.ok) { setMine(result.data); setProblem(null); onLoaded?.(result.data.memberships.length) }
    else { setMine(null); setProblem(refusalText(result)); onLoaded?.(0) }
  }, [onLoaded])
  useEffect(() => { void load() }, [load])

  const change = async (membership: MyMembership, details: Details, photo: File | null) => {
    if (!mine?.notice) return
    setBusy(true)
    let photoId: string | null = null
    if (photo) {
      const uploaded = await uploadPhoto(`/api/benefits/me/${membership.membershipId}/photo`, photo)
      if (!uploaded.ok) { setBusy(false); glassToast(uploaded.message && uploaded.status >= 400 && uploaded.status < 500 && uploaded.status !== 403 ? uploaded.message : refusalText(uploaded), 'bad'); return }
      photoId = uploaded.data.photoId
    }
    const result = await identityApi<{ status: string }>(`/api/benefits/me/${membership.membershipId}`, {
      method: 'PATCH', body: { firstName: details.firstName, lastName: details.lastName, nickname: details.nickname, photoId, noticeId: mine.notice.id },
    })
    setBusy(false)
    if (!result.ok) { glassToast(refusalText(result), 'bad'); if (result.code === 'stale') void load(); return }
    glassToast(result.data.status === 'unchanged' ? 'לא שונה דבר.' : 'השינוי נשלח לאישור מחדש.', 'ok')
    setEditing(null)
    setPhotoOf(null)
    await load()
  }

  if (problem) {
    return (
      <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity="mine-problem">
        <p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />{problem}</p>
        <div className="gl-card__actions"><Button icon={<RefreshCw size={16} />} onClick={() => { setProblem(null); void load() }}>לנסות שוב</Button></div>
      </section>
    )
  }
  if (!mine) return <div className="gl-surf gl-card gl-sk-card" aria-busy="true" data-identity="mine-loading"><span className="sk gl-sk-line gl-sk-line--title" /><span className="sk gl-sk-line gl-sk-line--short" /></div>
  if (mine.memberships.length === 0) return null

  return (
    <section className="gl-field" aria-label="הבקשות שלי" data-identity="mine">
      <h2 className="gl-card__title"><IdCard size={18} aria-hidden="true" />הבקשות שלי</h2>
      <ul className="gl-list">
        {mine.memberships.map((m) => {
          const which = m.hasPendingPhoto ? 'pending' : 'approved'
          const canChange = m.open && m.state !== 'inactive' && !!mine.notice
          return (
            <li key={m.membershipId} className="gl-surf gl-card" data-identity="my-membership" data-state={m.state}>
              <h3 className="gl-card__title"><Building2 size={18} aria-hidden="true" /><span>{m.organizationName}</span><StatePill state={m.state} /></h3>
              <p className="gl-note">{m.departmentName} · {m.firstName} {m.lastName}{m.nickname ? ` (${m.nickname})` : ''} · עודכן <bdi dir="ltr">{when(m.updatedAt)}</bdi></p>
              {m.state === 'pending' && <p className="gl-note">הבקשה ממתינה לאישור ראש המחלקה. עד אז אין הטבה.</p>}
              {m.state === 'rejected' && <p className="gl-note gl-note--bad"><CircleAlert size={16} aria-hidden="true" />הבקשה נדחתה. אפשר לתקן פרטים ולשלוח שוב.</p>}
              {m.state === 'inactive' && <p className="gl-note">החברות הושבתה על ידי מקום העבודה.</p>}
              {(m.hasPendingPhoto || m.hasApprovedPhoto) && (
                photoOf === m.membershipId
                  ? <div className="gl-inset"><PrivatePhoto url={`/api/benefits/me/${m.membershipId}/photo?which=${which}`} label="התמונה שלי" /><div className="gl-card__actions"><Button onClick={() => setPhotoOf(null)}>הסתרת התמונה</Button></div></div>
                  : <div className="gl-card__actions"><Button onClick={() => setPhotoOf(m.membershipId)} data-identity="my-photo-show">הצגת התמונה שלי</Button></div>
              )}
              {editing === m.membershipId && mine.notice
                ? (
                  <div className="gl-inset">
                    {m.state === 'approved' && <p className="gl-note gl-note--bad"><CircleAlert size={16} aria-hidden="true" />שינוי של שם, כינוי או תמונה יחזיר את החברות לאישור, ועד שתאושר מחדש לא תהיה הטבה.</p>}
                    <DetailsForm notice={mine.notice} initial={{ firstName: m.firstName, lastName: m.lastName, nickname: m.nickname ?? '' }} requirePhoto={!m.hasApprovedPhoto && !m.hasPendingPhoto} busy={busy}
                      submitLabel="שליחת השינוי" onSubmit={(details, photo) => void change(m, details, photo)} onCancel={() => setEditing(null)} />
                  </div>
                )
                : canChange && <div className="gl-card__actions"><Button icon={<Pencil size={16} />} onClick={() => { setEditing(m.membershipId); setPhotoOf(null) }} data-identity="my-change">תיקון פרטים</Button></div>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
