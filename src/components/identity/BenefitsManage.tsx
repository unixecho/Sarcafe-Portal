'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from 'glisse'
import { Building2, CircleAlert, RefreshCw, ShieldOff, Users } from 'lucide-react'
import type { ManageScopes } from '@/lib/identity/server/organizations'
import Pill from '@/components/glass/Pill'
import { identityApi, refusalText } from './api'
import OrganizationManager from './OrganizationManager'

// /benefits/manage (FABLE-002): what the signed-in person holds, and nothing else. An organization's administrator manages that
// organization here (the same screen the owner uses during setup); a department head sees their department, only theirs. Someone
// who holds nothing is told so and is offered nothing. The lists come from the person's own live grants on every load.
export default function BenefitsManage() {
  const [scopes, setScopes] = useState<ManageScopes | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await identityApi<ManageScopes>('/api/benefits/manage/scopes')
    if (result.ok) { setScopes(result.data); setProblem(null); setOpen((current) => current ?? result.data.organizations[0]?.organizationId ?? null) }
    else { setScopes(null); setProblem(refusalText(result)) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (problem) {
    return (
      <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity="scopes-problem">
        <p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />{problem}</p>
        <div className="gl-card__actions"><Button icon={<RefreshCw size={16} />} onClick={() => { setProblem(null); void load() }}>לנסות שוב</Button></div>
      </section>
    )
  }
  if (!scopes) {
    return (
      <div className="gl-list" aria-busy="true" data-identity="scopes-loading">
        <p className="sr-only" role="status">טוען את ההרשאות שלכם…</p>
        {[0, 1].map((i) => <div key={i} className="gl-surf gl-card gl-sk-card"><span className="sk gl-sk-line gl-sk-line--title" /><span className="sk gl-sk-line gl-sk-line--short" /></div>)}
      </div>
    )
  }

  if (scopes.organizations.length === 0 && scopes.departments.length === 0) {
    return (
      <section className="gl-surf gl-card" data-identity="no-access">
        <h2 className="gl-card__title"><ShieldOff size={18} aria-hidden="true" />אין לחשבון הזה הרשאות ניהול</h2>
        <p className="gl-note">החשבון שאיתו התחברתם אינו מנהל ארגון ואינו ראש מחלקה. אם קיבלתם קישור הזמנה, פתחו אותו והתחברו עם כתובת ה־Google שאליה נשלח. אפשר גם להתנתק מהתפריט שלמעלה ולהתחבר עם חשבון אחר.</p>
      </section>
    )
  }

  return (
    <div className="gl-list" data-identity="benefits-manage">
      {scopes.departments.length > 0 && (
        <section className="gl-field" aria-label="המחלקות שלי">
          <h2 className="sr-only">המחלקות שלי</h2>
          <ul className="gl-list">
            {scopes.departments.map((department) => (
              <li key={department.departmentId} className="gl-surf gl-card" data-identity="my-department" data-department={department.departmentId}>
                <h3 className="gl-card__title"><Users size={18} aria-hidden="true" /><span>{department.departmentName}</span><Pill tone="ok">ראש מחלקה</Pill></h3>
                <p className="gl-note" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Building2 size={15} aria-hidden="true" /><span>{department.organizationName}</span></p>
                <p className="gl-note">אתם ראש המחלקה הזו. רישום העובדים ואישורם ייפתחו כאן בשלב הבא; כרגע אין פעולות נוספות.</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {scopes.organizations.length > 0 && (
        <section className="gl-field" aria-label="הארגונים שאני מנהל">
          <h2 className="sr-only">הארגונים שאני מנהל</h2>
          {scopes.organizations.length > 1 && (
            <div className="gl-surf gl-card"><span className="gl-field__label" id="benefits-organization">הארגון שמוצג</span><div className="gl-wrap" role="radiogroup" aria-labelledby="benefits-organization">
              {scopes.organizations.map((organization) => (
                <button key={organization.organizationId} type="button" role="radio" aria-checked={open === organization.organizationId} className={`gl-chip${open === organization.organizationId ? ' is-on' : ''}`} onClick={() => setOpen(organization.organizationId)}>{organization.name}</button>
              ))}
            </div></div>
          )}
          {open && scopes.organizations.some((organization) => organization.organizationId === open) && (
            <OrganizationManager apiBase="/api/benefits/manage" organizationId={open} onChanged={() => void load()} />
          )}
        </section>
      )}
    </div>
  )
}
