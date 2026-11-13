'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Input } from 'glisse'
import { Building2, ChevronLeft, CircleAlert, Plus, RefreshCw } from 'lucide-react'
import type { OrganizationSummary } from '@/lib/identity/server/organizations'
import Pill from '@/components/glass/Pill'
import { glassToast } from '@/components/glass/toast'
import { identityApi, refusalText } from './api'
import OrganizationManager from './OrganizationManager'

// /owner/members (FABLE-002): the organizations that have an agreement with Sarcafe. The owner creates one (it is born with a draft
// agreement), opens it, and sets it up while it has no administrator of its own. An organization that has its own administrator is
// listed, and is managed by that administrator from /benefits/manage: the server refuses the owner there, and this says why.

const API = '/api/owner/members'

export default function OwnerOrganizations() {
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const result = await identityApi<{ organizations: OrganizationSummary[] }>(`${API}/organizations`)
    if (result.ok) { setOrganizations(result.data.organizations); setProblem(null) }
    else { setOrganizations(null); setProblem(refusalText(result)) }
  }, [])
  useEffect(() => { void load() }, [load])

  const create = async () => {
    const wanted = name.trim()
    if (!wanted || busy) return
    setBusy(true)
    const result = await identityApi<{ organizationId: string }>(`${API}/organizations`, { method: 'POST', body: { name: wanted } })
    setBusy(false)
    if (!result.ok) { glassToast(refusalText(result), 'bad'); return }
    glassToast('הארגון נוצר.', 'ok')
    setName('')
    setOpen(result.data.organizationId)
    await load()
  }

  if (problem) {
    return (
      <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity="list-problem">
        <p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />{problem}</p>
        <div className="gl-card__actions"><Button icon={<RefreshCw size={16} />} onClick={() => { setProblem(null); void load() }}>לנסות שוב</Button></div>
      </section>
    )
  }
  if (!organizations) {
    return (
      <div className="gl-list" aria-busy="true" data-identity="list-loading">
        <p className="sr-only" role="status">טוען את הארגונים…</p>
        {[0, 1, 2].map((i) => <div key={i} className="gl-surf gl-card gl-sk-card"><span className="sk gl-sk-line gl-sk-line--title" /><span className="sk gl-sk-line gl-sk-line--short" /></div>)}
      </div>
    )
  }

  const current = organizations.find((organization) => organization.id === open)
  if (current) {
    return (
      <div className="gl-list" data-identity="owner-organization">
        <div className="gl-card__actions"><Button icon={<ChevronLeft size={16} style={{ transform: 'scaleX(-1)' }} />} onClick={() => { setOpen(null); void load() }}>כל הארגונים</Button></div>
        {current.canManage
          ? <OrganizationManager apiBase={API} organizationId={current.id} onChanged={() => void load()} />
          : (
            <section className="gl-surf gl-card" data-identity="self-managed">
              <h2 className="gl-card__title"><Building2 size={18} aria-hidden="true" /><span>{current.name}</span><Pill tone="quiet">מנוהל עצמאית</Pill></h2>
              <p className="gl-note">לארגון הזה יש מנהל משלו. מרגע שמונה מנהל, רק הוא מנהל את המחלקות, את ראשי המחלקות ואת ההזמנות.</p>
            </section>
          )}
      </div>
    )
  }

  return (
    <div className="gl-list" data-identity="owner-organizations">
      <section className="gl-surf gl-card" aria-label="ארגון חדש" data-identity="new-organization">
        <h2 className="gl-card__title"><Plus size={18} aria-hidden="true" />ארגון חדש</h2>
        <p className="gl-note">ארגון הוא מקום עבודה שעובדיו יקבלו הטבה. הוא נוצר עם הסכם בטיוטה מול סרקפה, ושום הטבה לא מופעלת.</p>
        <Input aria-label="שם הארגון החדש" icon={<Building2 size={17} />} maxLength={80} placeholder="שם הארגון" value={name} onValueChange={setName} onKeyDown={(event) => { if (event.key === 'Enter') void create() }} />
        <div className="gl-card__actions"><Button variant="filled" icon={<Plus size={16} />} disabled={busy || !name.trim()} onClick={() => void create()}>יצירת ארגון</Button></div>
      </section>

      {organizations.length === 0
        ? <p className="gl-summary" data-identity="no-organizations">עדיין אין ארגונים. צרו את הראשון למעלה.</p>
        : (
          <ul className="gl-list" aria-label="הארגונים">
            {organizations.map((organization) => (
              <li key={organization.id}>
                <button type="button" className="gl-surf gl-row-card" data-identity="organization-row" data-organization={organization.id} onClick={() => setOpen(organization.id)}>
                  <span className="gl-ico" aria-hidden="true"><Building2 size={18} /></span>
                  <span className="gl-row-card__copy">
                    <strong>{organization.name}</strong>
                    <small>{organization.departments === 0 ? 'אין מחלקות' : organization.departments === 1 ? 'מחלקה אחת' : `${organization.departments} מחלקות`}{organization.hasAdmin ? ' · מנוהל עצמאית' : ' · בשלב ההקמה'}</small>
                  </span>
                  <Pill tone={organization.state === 'active' ? 'ok' : 'quiet'}>{organization.state === 'active' ? 'פעיל' : 'כבוי'}</Pill>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
