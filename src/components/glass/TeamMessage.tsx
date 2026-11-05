'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input } from 'glisse'
import { BellOff, CircleAlert, Megaphone, RefreshCw, Send, Users } from 'lucide-react'
import { MAX_TEXT, summaryLine } from '@/lib/team-message/rules'
import type { MessagePlan, PlanShift } from '@/lib/team-message/server'
import Seg from './Seg'
import { useGlassBranch } from './BranchContext'
import { glassToast } from './toast'

// "הודעה מהירה לצוות" (owner, 2026-11-05). To everyone at the branch, to one shift (the real published shifts, with their real hours),
// or to one person on that shift when more than one is scheduled. Only people who turned notifications on receive it; the others are
// shown greyed out so the sender knows to tell them in person. The server decides everything again (docs/SARCAFE_TEAM_MESSAGE.md).

const TEMPLATES = ['מגיע משלוח חלב בבוקר', 'נא להגיע 10 דקות מוקדם', 'ישיבה קצרה בתחילת המשמרת', 'תזכורת: למלא צ׳קליסט סגירה']
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16).padStart(12, '0')}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`.replace(/^(.{8})(.{4})/, '$1-$2'))
type Sent = { id: string; text: string; to: string; sent: number; skipped: number }

export default function TeamMessage({ branches }: { branches: { slug: string; name: string }[] }) {
  const shared = useGlassBranch()
  const [ownSlug, setOwnSlug] = useState(branches[0]?.slug ?? '')
  const slug = shared && branches.some((b) => b.slug === shared.slug) ? shared.slug : ownSlug
  const [plan, setPlan] = useState<MessagePlan | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [audience, setAudience] = useState<'all' | 'shift'>('shift')
  const [day, setDay] = useState(0)
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [person, setPerson] = useState<string>('*')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [log, setLog] = useState<Sent[]>([])
  const requestId = useRef<string>(newId())

  const load = useCallback(async (forSlug: string) => {
    if (!forSlug) return
    setState('loading')
    try {
      const response = await fetch(`/api/owner/team-message?branch=${encodeURIComponent(forSlug)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = (await response.json()) as MessagePlan
      setPlan(data)
      const first = data.days.findIndex((d) => d.shifts.some((s) => s.people.length > 0))
      setDay(first >= 0 ? first : 0)
      setState('ready')
    } catch { setState('error') }
  }, [])
  useEffect(() => { void load(slug) }, [slug, load])

  const today = plan?.days[day]
  const shifts = today?.shifts ?? []
  useEffect(() => { setShiftId(shifts[0]?.id ?? null); setPerson('*') }, [plan, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const shift: PlanShift | undefined = shifts.find((s) => s.id === shiftId) ?? shifts[0]
  useEffect(() => { setPerson('*') }, [shiftId, audience])

  const others = shift?.people.filter((p) => !p.self) ?? []
  const several = others.length > 1
  const chosen = person !== '*' ? others.find((p) => p.key === person) : undefined
  const shiftName = today && shift ? `משמרת ${today.label} ${today.dm}, ${shift.start}–${shift.end}` : ''
  const reachableNames = others.filter((p) => p.reachable).map((p) => p.name)
  const counts = audience === 'all'
    ? { reachable: plan?.team.reachable ?? 0, total: plan?.team.total ?? 0 }
    : chosen ? { reachable: chosen.reachable ? 1 : 0, total: 1 } : { reachable: reachableNames.length, total: others.length }
  const summary = !plan ? '' : audience === 'shift' && !shift ? 'אין משמרות מפורסמות ביום הזה. בחרו יום אחר.' : summaryLine({
    audience: chosen ? 'one' : audience, branchName: plan.branch.name, reachable: counts.reachable, total: counts.total, shiftName, names: reachableNames, person: chosen?.name,
  })
  const canSend = !sending && state === 'ready' && text.trim().length > 0 && text.length <= MAX_TEXT && counts.reachable > 0 && (audience === 'all' || !!shift)

  async function send() {
    if (!canSend || !plan) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { glassToast('אין חיבור לאינטרנט. ההודעה לא נשלחה והיא נשארה כאן.', 'bad'); return }
    setSending(true)
    const body = { branch: plan.branch.slug, audience, ...(audience === 'shift' && shift ? { shiftId: shift.id } : {}), ...(chosen ? { assignmentId: chosen.key } : {}), text, requestId: requestId.current }
    try {
      const response = await fetch('/api/owner/team-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await response.json().catch(() => null)) as { sent?: number; skipped?: number; error?: { code?: string; message?: string } } | null
      if (!response.ok) {
        // A refusal that will not change on retry gets a new id; a server hiccup keeps it, so a retry can never send twice.
        if (response.status < 500) requestId.current = newId()
        glassToast(data?.error?.message && /[֐-׿]/.test(data.error.message) ? data.error.message : 'ההודעה לא נשלחה. נסו שוב בעוד רגע.', 'bad')
        return
      }
      const sent = data?.sent ?? 0
      const skipped = data?.skipped ?? 0
      glassToast(`ההודעה נשלחה ${sent === 1 ? 'לעובד אחד' : `ל־${sent} עובדים`}${skipped ? ` · ${skipped} בלי התראות לא קיבלו` : ''}`, 'ok')
      setLog((list) => [{ id: requestId.current, text, to: audience === 'all' ? `כל הצוות ב${plan.branch.name}` : chosen ? `${chosen.name} · ${shiftName}` : shiftName, sent, skipped }, ...list].slice(0, 3))
      setText('')
      requestId.current = newId()
    } catch {
      glassToast('אין חיבור לשרת. ההודעה לא נשלחה והיא נשארה כאן.', 'bad')
    } finally { setSending(false) }
  }

  const ownSwitch = !shared && branches.length > 1
  const label = useMemo(() => (audience === 'all' ? 'שליחה לכל הצוות' : 'שליחה'), [audience])
  return (
    <section className="gl-surf gl-card" id="team-message" aria-labelledby="team-message-title" style={{ scrollMarginTop: 84 }}>
      <h2 className="gl-card__title" id="team-message-title"><Megaphone size={17} aria-hidden="true" />הודעה מהירה לצוות</h2>
      {ownSwitch && <Seg fill label="סניף" value={slug} onChange={setOwnSlug} items={branches.map((b) => ({ value: b.slug, label: b.name }))} />}
      <Seg fill label="למי לשלוח" value={audience} onChange={(v) => setAudience(v as 'all' | 'shift')} items={[{ value: 'all', label: 'כל הצוות' }, { value: 'shift', label: 'משמרת מסוימת' }]} />

      {state === 'error' && (
        <p className="gl-note gl-note--bad" role="alert"><CircleAlert size={16} aria-hidden="true" />לא הצלחנו לטעון את המשמרות. <button type="button" className="gl-chip gl-chip--soft" onClick={() => void load(slug)}><RefreshCw size={14} aria-hidden="true" />לנסות שוב</button></p>
      )}

      {audience === 'shift' && plan && state === 'ready' && (
        <div className="gl-inset">
          <div className="gl-field">
            <span className="gl-field__label" id="tm-day">יום</span>
            <div className="gl-strip" role="radiogroup" aria-labelledby="tm-day">
              {plan.days.map((d, i) => (
                <button key={d.date} type="button" role="radio" aria-checked={i === day} className={`gl-chip gl-chip--day${i === day ? ' is-on' : ''}`} onClick={() => setDay(i)}>
                  <b>{d.label}</b><small dir="ltr">{d.dm}</small>{d.shifts.length === 0 && <span className="gl-chip__off">אין</span>}
                </button>
              ))}
            </div>
          </div>
          {shifts.length > 1 && (
            <div className="gl-field">
              <span className="gl-field__label" id="tm-shift">משמרת</span>
              <div className="gl-wrap" role="radiogroup" aria-labelledby="tm-shift">
                {shifts.map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={s.id === shift?.id} className={`gl-chip${s.id === shift?.id ? ' is-on' : ''}`} onClick={() => setShiftId(s.id)}>
                    <bdi dir="ltr">{s.start}–{s.end}</bdi> · {s.people.length}
                  </button>
                ))}
              </div>
            </div>
          )}
          {shift ? (
            <div className="gl-field">
              <span className="gl-field__label" id="tm-who"><Users size={14} aria-hidden="true" />מי במשמרת{shifts.length === 1 && <bdi dir="ltr">&nbsp;{shift.start}–{shift.end}</bdi>}</span>
              {others.length === 0 && <p className="gl-note">אין עובדים משובצים במשמרת הזו.</p>}
              {others.length === 1 && <p className="gl-note">במשמרת הזו משובץ/ת רק <strong>{others[0]!.name}</strong>{others[0]!.reachable ? ', ולכן ההודעה תישלח אליו/ה.' : ', ועדיין לא הפעיל/ה התראות.'}</p>}
              {several && (
                <div className="gl-wrap" role="radiogroup" aria-labelledby="tm-who">
                  <button type="button" role="radio" aria-checked={person === '*'} className={`gl-chip${person === '*' ? ' is-on' : ''}`} onClick={() => setPerson('*')}>כל המשמרת · {others.length}</button>
                  {others.map((p) => (
                    <button key={p.key} type="button" role="radio" aria-checked={person === p.key} disabled={!p.reachable} className={`gl-chip${person === p.key ? ' is-on' : ''}`} onClick={() => setPerson(p.key)} title={p.reachable ? undefined : 'עדיין לא הפעיל/ה התראות'}>
                      {p.name}{!p.reachable && <span className="gl-chip__off"><BellOff size={12} aria-hidden="true" /> ללא התראות</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : <p className="gl-note">אין משמרות מפורסמות ביום הזה.</p>}
        </div>
      )}

      <Input id="team-message-text" aria-label="תוכן ההודעה" icon={<Megaphone size={17} />} maxLength={MAX_TEXT} placeholder="למשל: מגיע משלוח חלב בבוקר" value={text} onValueChange={setText} onKeyDown={(e) => { if (e.key === 'Enter') void send() }} />
      <div className="gl-wrap" aria-label="תבניות">
        {TEMPLATES.map((t) => <button key={t} type="button" className="gl-chip gl-chip--soft" onClick={() => setText(t)}>{t}</button>)}
      </div>
      {state === 'loading' ? <p className="gl-summary" aria-live="polite">טוען את הצוות והמשמרות…</p> : summary && <p className="gl-summary" aria-live="polite">{summary}</p>}
      <div className="gl-card__actions">
        <Button variant="filled" icon={<Send size={16} />} disabled={!canSend} onClick={() => void send()}>{sending ? 'שולח…' : counts.reachable > 0 ? `${label} · ${counts.reachable}` : label}</Button>
        <span className="gl-count" dir="ltr">{text.length}/{MAX_TEXT}</span>
      </div>
      {log.length > 0 && (
        <ul className="gl-list" aria-label="נשלחו עכשיו">
          {log.map((s) => (
            <li key={s.id} className="gl-surf gl-surf--ok gl-row-card" style={{ borderRadius: 16 }}>
              <span className="gl-row-card__copy"><strong>{s.text}</strong><small>{s.to} · נשלח ל־{s.sent}{s.skipped ? ` · ${s.skipped} בלי התראות` : ''}</small></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
