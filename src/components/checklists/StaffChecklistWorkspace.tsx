'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Beaker, CheckCircle2, ChevronLeft, ClipboardCheck, ShieldCheck, Save, X } from 'lucide-react'
import BranchSwitcher from '@/components/BranchSwitcher'
import type { Branch, BranchSlug } from '@/lib/branches'
import { flattenChecklistDefinition, type ChecklistAnswer, type ChecklistAssignment, type ChecklistItem, type ChecklistPreviewTemplate } from '@/lib/checklists/types'
import { messageOf } from '@/components/staff/types'
import './checklists.css'

type Payload = {
  profile: { id: string; label: string; email: string | null; employeeNo: string | null; via: 'google' | 'employee_code'; hasGoogle: boolean }
  assignments: ChecklistAssignment[]
  developerMode: boolean
  previews: ChecklistPreviewTemplate[]
}

const statusLabel = (status: ChecklistAssignment['status']) =>
  status === 'submitted' ? 'נשלח' : status === 'in_progress' ? 'התחלתם — אפשר להמשיך' : 'מחכה לביצוע'

function answerIsComplete(item: ChecklistItem, answer?: ChecklistAnswer) {
  if (item.required === false && !answer) return true
  if (!answer) return false
  if (item.kind === 'number' && !Number.isFinite(answer.value)) return false
  return answer.result !== 'issue' || Boolean(answer.reason?.trim())
}

export default function StaffChecklistWorkspace({ branches, initialBranch }: { branches: Branch[]; initialBranch: BranchSlug }) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>({})
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [attested, setAttested] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [currentCode, setCurrentCode] = useState('')
  const [newCode, setNewCode] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  async function load() {
    if (!branch) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/checklists?branch=${encodeURIComponent(branch)}`, { cache: 'no-store' })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(messageOf(payload, 'לא הצלחנו לטעון את הצ׳קליסטים.'))
      setData(payload as Payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לטעון את הצ׳קליסטים.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => void load(), [branch])

  const active = data?.assignments.find((assignment) => assignment.id === activeId) ?? null
  const categories = active?.template.categories ?? []
  const items = useMemo(() => (active ? flattenChecklistDefinition(active.template) : []), [active])
  const currentCategory = categories[step]
  const completeCount = items.filter((item) => answerIsComplete(item, answers[item.id])).length
  const issues = items.filter((item) => answers[item.id]?.result === 'issue')

  function open(assignment: ChecklistAssignment) {
    setActiveId(assignment.id)
    setAnswers(assignment.answers ?? {})
    const firstIncomplete = assignment.template.categories.findIndex((category) =>
      category.items.some((item) => !answerIsComplete(item, assignment.answers?.[item.id])),
    )
    setStep(firstIncomplete >= 0 ? firstIncomplete : 0)
    setAttested(false)
    setDirty(false)
    setError(null)
    setNotice(null)
  }

  function openPreview(template: ChecklistPreviewTemplate) {
    const now = new Date()
    open({
      id: `preview:${template.id}`,
      branchId: branch,
      branchName: branches.find((candidate) => candidate.slug === branch)?.name?.he ?? branch,
      shiftId: 'preview',
      shiftAssignmentId: 'preview',
      shiftDate: now.toISOString().slice(0, 10),
      startTime: now.toTimeString().slice(0, 5),
      endTime: now.toTimeString().slice(0, 5),
      kind: template.kind,
      kindLabel: template.kindLabel,
      templateVersion: template.version,
      template: template.definition,
      status: 'pending',
      answers: {},
      issueCount: 0,
      submittedAt: null,
      testMode: true,
    })
    setData((current) => current ? { ...current, assignments: [...current.assignments, {
      id: `preview:${template.id}`,
      branchId: branch,
      branchName: branches.find((candidate) => candidate.slug === branch)?.name?.he ?? branch,
      shiftId: 'preview', shiftAssignmentId: 'preview', shiftDate: now.toISOString().slice(0, 10),
      startTime: now.toTimeString().slice(0, 5), endTime: now.toTimeString().slice(0, 5),
      kind: template.kind, kindLabel: template.kindLabel, templateVersion: template.version,
      template: template.definition, status: 'pending', answers: {}, issueCount: 0, submittedAt: null, testMode: true,
    }] } : current)
  }

  async function persist(next: Record<string, ChecklistAnswer>, submit = false) {
    if (!active) return false
    if (active.testMode) {
      setDirty(false)
      return true
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/checklists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: submit ? 'submit' : 'save', assignmentId: active.id, answers: next, ...(submit ? { attested: true } : {}) }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(messageOf(payload, 'לא הצלחנו לשמור.'))
      setDirty(false)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לשמור.')
      return false
    } finally {
      setSaving(false)
    }
  }

  function updateAnswer(itemId: string, answer: ChecklistAnswer | null) {
    setAnswers((currentAnswers) => {
      if (!answer) {
        const next = { ...currentAnswers }
        delete next[itemId]
        return next
      }
      return { ...currentAnswers, [itemId]: answer }
    })
    setDirty(true)
    setError(null)
  }

  async function nextCategory() {
    if (!currentCategory) return
    const next = { ...answers }

    for (const item of currentCategory.items) {
      const answer = next[item.id]
      if (item.required === false && !answer) continue
      if (!answer || (item.kind === 'number' && !Number.isFinite(answer.value))) {
        setError(`כדי להמשיך צריך להשלים: ${item.label}`)
        return
      }
      const result = item.kind === 'number' && item.target !== undefined && answer.value !== item.target ? 'issue' : answer.result
      if (result === 'issue' && !answer.reason?.trim()) {
        setError(`צריך לכתוב מה קרה ולמה: ${item.label}`)
        return
      }
      next[item.id] = { ...answer, result, ...(answer.reason?.trim() ? { reason: answer.reason.trim() } : {}), answeredAt: new Date().toISOString() }
    }

    setAnswers(next)
    if (!(await persist(next))) return
    if (step < categories.length - 1) setStep((value) => value + 1)
    else setStep(categories.length)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submit() {
    if (!attested) return setError('צריך לאשר שהדיווח נכון לפני השליחה.')
    if (!(await persist(answers, true))) return
    if (active?.testMode) {
      setData((current) => current ? { ...current, assignments: current.assignments.filter((assignment) => assignment.id !== active.id) } : current)
      setActiveId(null)
      setNotice('בדיקת המפתח הושלמה בהצלחה. לא נוצר דיווח אמיתי ולא שויכה משמרת.')
      return
    }
    setActiveId(null)
    await load()
  }

  async function changeCode() {
    if (!/^\d{6}$/.test(currentCode) || !/^\d{6}$/.test(newCode)) return setError('הקוד הנוכחי והקוד החדש צריכים להכיל 6 ספרות.')
    try {
      const res = await fetch('/api/checklists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'change_passcode', currentPasscode: currentCode, newPasscode: newCode }) })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(messageOf(payload, 'לא הצלחנו לשנות את הקוד.'))
      await fetch('/api/auth/signout', { method: 'POST' })
      window.location.assign('/login?next=/staff/checklists&quick=1')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לשנות את הקוד.')
    }
  }

  if (active && currentCategory) {
    const categoryCompleteCount = currentCategory.items.filter((item) => answerIsComplete(item, answers[item.id])).length
    return (
      <div className="ck-runner">
        <header className="ck-runner__bar">
          <button className="ck-circle-button press" type="button" aria-label="סגירת הצ׳קליסט" onClick={() => setActiveId(null)}><X size={19} aria-hidden="true" /></button>
          <div className="ck-runner__identity">
            <strong>{active.kindLabel}</strong>
            <span>{active.branchName} · <span dir="ltr">{active.startTime}–{active.endTime}</span></span>
          </div>
          <div className={`ck-save-state${dirty ? ' ck-save-state--dirty' : ''}`} aria-live="polite">
            <Save size={15} aria-hidden="true" />
            <span>{saving ? 'שומר…' : dirty ? 'ממתין לשמירה' : 'נשמר'}</span>
          </div>
        </header>

        {active.testMode && (
          <div className="ck-test-strip">
            <Beaker size={15} aria-hidden="true" />
            <span><strong>תצוגת מפתח</strong> · הנתונים לא נשלחים</span>
          </div>
        )}

        <section className="ck-runner__progress" aria-label={`${completeCount} מתוך ${items.length} בדיקות הושלמו`}>
          <div className="ck-runner__progress-copy">
            <span>קטגוריה {step + 1} מתוך {categories.length}</span>
            <strong>{Math.round((completeCount / Math.max(items.length, 1)) * 100)}%</strong>
          </div>
          <div className="ck-progress"><span style={{ width: `${Math.round((completeCount / Math.max(items.length, 1)) * 100)}%` }} /></div>
          <div className="ck-progress-dots" style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }} aria-hidden="true">
            {categories.map((category, index) => (
              <span key={category.id} className={index < step ? 'is-complete' : index === step ? 'is-current' : ''} />
            ))}
          </div>
        </section>

        <section className="ck-category-panel">
          <div className="ck-category-panel__head">
            <div>
              <span className="ck-category-kicker">{categoryCompleteCount} מתוך {currentCategory.items.length} הושלמו</span>
              <h1>{currentCategory.title}</h1>
            </div>
            <span className="ck-category-number" aria-hidden="true">{String(step + 1).padStart(2, '0')}</span>
          </div>

          <div className="ck-check-list">
            {currentCategory.items.map((item, index) => {
              const answer = answers[item.id]
              const numberMismatch = item.kind === 'number' && item.target !== undefined && answer?.value !== undefined && answer.value !== item.target
              const isIssue = answer?.result === 'issue' || numberMismatch
              const okLabel = item.kind === 'action' ? 'בוצע' : 'תקין'
              const issueLabel = item.kind === 'action' ? 'לא בוצע' : 'לא תקין'
              return (
                <article key={item.id} className={`ck-check-row${answerIsComplete(item, answer) ? ' is-complete' : ''}${isIssue ? ' has-issue' : ''}`}>
                  <div className="ck-check-row__copy">
                    <span className="ck-check-index">{index + 1}</span>
                    <div>
                      <h2>{item.label}</h2>
                      {item.help && <p>{item.help}</p>}
                    </div>
                  </div>

                  {item.kind === 'number' ? (
                    <label className="ck-number-field">
                      <span>סכום בפועל {item.unit ? `(${item.unit})` : ''}</span>
                      <input
                        className="sch-input"
                        inputMode="decimal"
                        dir="ltr"
                        value={answer?.value === undefined ? '' : String(answer.value)}
                        onChange={(event) => {
                          const raw = event.target.value.replace(/\D/g, '')
                          if (!raw) return updateAnswer(item.id, null)
                          const value = Number(raw)
                          updateAnswer(item.id, { ...answer, value, result: item.target !== undefined && value !== item.target ? 'issue' : 'ok', answeredAt: new Date().toISOString() })
                        }}
                      />
                      {item.target !== undefined && <small>הסכום הצפוי: {item.target}{item.unit ? ` ${item.unit}` : ''}</small>}
                    </label>
                  ) : (
                    <div className="ck-segmented" role="group" aria-label={item.label}>
                      <button type="button" className="press" aria-pressed={answer?.result === 'ok'} onClick={() => updateAnswer(item.id, { result: 'ok', answeredAt: new Date().toISOString() })}>
                        <CheckCircle2 size={18} aria-hidden="true" />{okLabel}
                      </button>
                      <button type="button" className="press" aria-pressed={answer?.result === 'issue'} onClick={() => updateAnswer(item.id, { result: 'issue', reason: answer?.reason, answeredAt: new Date().toISOString() })}>
                        <AlertTriangle size={18} aria-hidden="true" />{issueLabel}
                      </button>
                    </div>
                  )}

                  {isIssue && (
                    <label className="ck-reason-field">
                      <span>מה קרה ולמה? <strong>חובה</strong></span>
                      <textarea
                        className="sch-input"
                        rows={3}
                        value={answer?.reason ?? ''}
                        onChange={(event) => updateAnswer(item.id, { ...(answer ?? { result: 'issue', answeredAt: new Date().toISOString() }), result: 'issue', reason: event.target.value, answeredAt: new Date().toISOString() })}
                        placeholder="כתבו בקצרה כדי שהמנהל ידע איך לעזור"
                      />
                    </label>
                  )}
                </article>
              )
            })}
          </div>
        </section>

        {error && <div className="sch-error ck-runner__error" role="alert">{error}</div>}
        <div className="ck-action-dock">
          <button type="button" className="sch-btn press" disabled={step === 0 || saving} onClick={() => { setStep((value) => Math.max(0, value - 1)); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>הקודם</button>
          <button type="button" className="sch-btn sch-btn--primary press" disabled={saving} onClick={() => void nextCategory()}>
            {step === categories.length - 1 ? 'מעבר לסיכום' : 'שמירה והמשך'} <ChevronLeft size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    )
  }

  if (active && step >= categories.length) {
    return (
      <div className="ck-wrap">
        <section className="ck-hero">
          <p className="sch-sub">סיכום לפני שליחה</p>
          <h1 style={{ margin: '4px 0' }}>{active.kindLabel}</h1>
          <p style={{ margin: 0 }}>{issues.length ? `נמצאו ${issues.length} ליקויים. המנהל/ת יקבלו אותם בתיבת הצ׳קליסטים.` : 'כל הבדיקות סומנו כתקינות.'}</p>
        </section>
        {issues.map((item) => <div key={item.id} className="ck-card ck-card--issue"><strong>{item.label}</strong><span className="sch-sub">{answers[item.id]?.reason}</span><button className="sch-btn sch-btn--sm press" onClick={() => setStep(categories.findIndex((category) => category.id === item.categoryId))}>עריכה</button></div>)}
        <label className="ck-card" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} style={{ width: 22, height: 22 }} />
          <span>אני מאשר/ת שכל הבדיקות, הליקויים והסיבות שציינתי נכונים.</span>
        </label>
        {error && <div className="sch-error" role="alert">{error}</div>}
        <div className="ck-sticky"><button className="sch-btn press" onClick={() => setStep(categories.length - 1)}>חזרה</button><button className="sch-btn sch-btn--primary press" disabled={!attested || saving} onClick={() => void submit()}>שליחת הצ׳קליסט</button></div>
      </div>
    )
  }

  return (
    <div className="ck-wrap">
      {branches.length > 1 && <BranchSwitcher branches={branches} value={branch} onChange={setBranch} />}
      <section className="ck-hero">
        <p className="sch-sub" style={{ margin: 0 }}>שלום {data?.profile.label || ''}</p>
        <h1 style={{ margin: '5px 0 8px' }}>הצ׳קליסטים של המשמרות שלכם</h1>
        <p style={{ margin: 0, color: 'var(--text-dim)' }}>המערכת מחברת כל טופס למשמרת שאליה שובצתם ושומרת כל שלב אוטומטית.</p>
      </section>
      {notice && <div className="ck-notice" role="status"><CheckCircle2 size={18} aria-hidden="true" />{notice}</div>}
      {data?.developerMode && data.previews.length > 0 && (
        <section className="ck-card ck-developer-card">
          <div className="sch-row"><Beaker size={21} color="var(--neon)" aria-hidden="true" /><div><strong>מצב בדיקה למפתח</strong><p className="sch-sub">אפשר לעבור על כל טופס גם בלי משמרת. הבדיקה לא נשמרת ולא נכנסת לדיווחי העסק.</p></div></div>
          <div className="ck-preview-grid">
            {data.previews.map((template) => <button key={template.id} type="button" className="sch-btn press" onClick={() => openPreview(template)}>{template.kindLabel}</button>)}
          </div>
        </section>
      )}
      {data?.profile.via === 'employee_code' && !data.profile.hasGoogle && (
        <section className="ck-card">
          <div className="sch-row"><ShieldCheck size={20} aria-hidden="true" /><strong>קישור Google נדרש לגישה מלאה</strong></div>
          <p className="sch-sub">כתובת האימייל מתקבלת ישירות מ-Google. אי אפשר להקליד כתובת ידנית ולהשתמש בה כהרשאת כניסה.</p>
          <Link className="sch-btn press" href="/staff/profile?setup=google">קישור חשבון Google מאובטח</Link>
        </section>
      )}
      {data?.profile.via === 'employee_code' && (
        <section className="ck-card">
          <button type="button" className="sch-btn sch-btn--ghost press" aria-expanded={codeOpen} onClick={() => setCodeOpen((open) => !open)}>החלפת קוד הכניסה שלי</button>
          {codeOpen && <div className="ck-wrap" style={{ gap: 10 }}>
            <p className="sch-sub">לאחר השינוי תיכנסו שוב עם הקוד החדש.</p>
            <label><span className="sch-label">הקוד הנוכחי</span><input className="sch-input" inputMode="numeric" type="password" maxLength={6} dir="ltr" value={currentCode} onChange={(event) => setCurrentCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
            <label><span className="sch-label">הקוד החדש</span><input className="sch-input" inputMode="numeric" type="password" maxLength={6} dir="ltr" value={newCode} onChange={(event) => setNewCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
            <button className="sch-btn press" disabled={currentCode.length !== 6 || newCode.length !== 6} onClick={() => void changeCode()}>שמירת הקוד החדש</button>
          </div>}
        </section>
      )}
      {error && <div className="sch-error" role="alert">{error}<button className="sch-btn sch-btn--sm press" onClick={() => void load()}>ניסיון נוסף</button></div>}
      {loading && !data ? <div className="sk" style={{ height: 160 }} /> : (
        <div className="ck-grid">
          {(data?.assignments ?? []).map((assignment) => (
            <button key={assignment.id} type="button" className={`ck-card press${assignment.issueCount ? ' ck-card--issue' : ''}`} disabled={assignment.status === 'submitted'} onClick={() => open(assignment)}>
              <div className="sch-row"><ClipboardCheck size={22} aria-hidden="true" color="var(--neon)" /><strong style={{ flex: 1 }}>{assignment.kindLabel}</strong><span className={`ck-status ck-status--${assignment.status === 'submitted' ? 'submitted' : 'pending'}`}>{statusLabel(assignment.status)}</span></div>
              <span>{new Date(`${assignment.shiftDate}T12:00:00`).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' })} · <span dir="ltr">{assignment.startTime}–{assignment.endTime}</span></span>
              {assignment.status === 'submitted' && <span className="sch-sub">נשלח {assignment.submittedAt ? new Date(assignment.submittedAt).toLocaleString('he-IL') : ''}{assignment.issueCount ? ` · ${assignment.issueCount} ליקויים דווחו` : ' · ללא ליקויים'}</span>}
            </button>
          ))}
        </div>
      )}
      {!loading && data?.assignments.filter((assignment) => !assignment.testMode).length === 0 && <section className="ck-card" style={{ alignItems: 'center', textAlign: 'center', padding: 28 }}><ClipboardCheck size={36} color="var(--text-faint)" /><strong>אין כרגע צ׳קליסט שמחכה לכם</strong><span className="sch-sub">לאחר פרסום השיבוץ, הטופס המתאים יופיע כאן לפי המשמרת.</span></section>}
    </div>
  )
}
