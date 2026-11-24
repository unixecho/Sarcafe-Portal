'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from 'glisse'
import { CircleAlert, RefreshCw, ScanLine, UserRound } from 'lucide-react'
import type { ScannerList } from '@/lib/identity/server/verification'
import Pill from '@/components/glass/Pill'
import Seg from '@/components/glass/Seg'
import { glassToast } from '@/components/glass/toast'
import { identityApi, refusalText, when } from './api'

// /owner/members, "הרשאות סריקה" (FABLE-004): which staff members may verify an organization employee's card, at every branch or at
// one. Nothing is given by being staff, a manager or the owner: each grant is explicit, audited and can be taken back (taking it back
// also ends that person's open verification). The list and every change go through /api/owner/members/scanners, which asks the
// database again.
const API = '/api/owner/members/scanners'
const ALL = 'all'

export default function OwnerScanners() {
  const [data, setData] = useState<ScannerList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [where, setWhere] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const result = await identityApi<ScannerList>(API)
    if (result.ok) { setData(result.data); setProblem(null) } else { setData(null); setProblem(refusalText(result)) }
  }, [])
  useEffect(() => { void load() }, [load])

  const grant = async (staffId: string) => {
    const choice = where[staffId] ?? ALL
    setBusy(true)
    const result = await identityApi(API, { method: 'POST', body: { staffId, branchId: choice === ALL ? null : choice } })
    setBusy(false)
    if (!result.ok) { glassToast(refusalText(result), 'bad'); return }
    glassToast('ניתנה הרשאת סריקה.', 'ok')
    await load()
  }
  const revoke = async (grantId: string) => {
    setBusy(true)
    const result = await identityApi(`${API}/${grantId}`, { method: 'DELETE' })
    setBusy(false)
    if (!result.ok) { glassToast(refusalText(result), 'bad'); return }
    glassToast('ההרשאה הוסרה.', 'ok')
    await load()
  }

  if (problem) {
    return (
      <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity="scanners-problem">
        <p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />{problem}</p>
        <div className="gl-card__actions"><Button icon={<RefreshCw size={16} />} onClick={() => { setProblem(null); void load() }}>לנסות שוב</Button></div>
      </section>
    )
  }
  if (!data) return <div className="gl-surf gl-card gl-sk-card" aria-busy="true" data-identity="scanners-loading"><span className="sk gl-sk-line gl-sk-line--title" /><span className="sk gl-sk-line" /></div>

  const branchName = (id: string | null) => (id ? data.branches.find((b) => b.branchId === id)?.name ?? 'סניף' : 'כל הסניפים')
  const choices = [{ value: ALL, label: 'כל הסניפים' }, ...data.branches.map((b) => ({ value: b.branchId, label: b.name }))]
  const holders = data.staff.filter((s) => s.grants.length > 0).length
  return (
    <section className="gl-surf gl-card" aria-label="הרשאות סריקה" data-identity="scanners">
      <h2 className="gl-card__title"><ScanLine size={18} aria-hidden="true" /><span>הרשאות סריקה</span>{holders > 0 && <Pill tiny>{holders}</Pill>}</h2>
      <p className="gl-note">מי מהצוות רשאי לסרוק כרטיס של עובד ארגון ולאשר שהוא האדם שבתמונה. ההרשאה ניתנת במפורש, לכל הסניפים או לסניף אחד, ואפשר להסיר אותה בכל רגע.</p>
      <ul className="gl-list">
        {data.staff.map((person) => (
          <li key={person.staffId} className="gl-inset" data-identity="scanner-staff" data-staff={person.staffId}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UserRound size={15} aria-hidden="true" />{person.name}</strong>
            {person.grants.map((g) => (
              <div key={g.grantId} className="gl-row-card" style={{ padding: 0 }} data-identity="scanner-grant">
                <span className="gl-row-card__copy"><strong>{branchName(g.branchId)}</strong><small>מאז <bdi dir="ltr">{when(g.grantedAt)}</bdi></small></span>
                <Button disabled={busy} onClick={() => void revoke(g.grantId)}>הסרה</Button>
              </div>
            ))}
            {data.branches.length > 1 && <Seg label={`היכן ${person.name} יסרקו`} fill items={choices} value={where[person.staffId] ?? ALL} onChange={(value) => setWhere((w) => ({ ...w, [person.staffId]: value }))} />}
            <div className="gl-card__actions"><Button disabled={busy} onClick={() => void grant(person.staffId)} data-identity="scanner-grant-add">מתן הרשאת סריקה</Button></div>
          </li>
        ))}
      </ul>
    </section>
  )
}
