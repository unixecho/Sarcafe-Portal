'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarClock, CalendarPlus, Receipt, CheckCircle2, ChevronLeft, CircleDashed, ClipboardCheck, Clock3, Link2, MapPin, Pencil, Users } from 'lucide-react'
import Switch from '@/components/Switch'
import ScheduleSettings from '@/components/branches/ScheduleSettings'
import BranchLinksEditor from '@/components/BranchLinksEditor'
import BranchSlider from '@/components/branches/BranchSlider'
import EventSheet from '@/components/owner/pos/EventSheet'
import { setCurrentBranchCookie } from '@/lib/branches/current'
import { messageOf } from '@/components/staff/types'
import { badgeLabel } from '@/lib/staff/badges'
import type { BranchChecklistState, BranchOverview, PosEvent, ReadinessItem } from '@/lib/branches/manager'
import type { BranchLinks } from '@/lib/branches'
import '@/components/shifts/schedule.css'
import '@/components/owner/pos/ops.css'
import './branches.css'

type TabId = ReadinessItem['tab']
const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'סקירה' },
  { id: 'checklists', label: 'צ׳קליסטים' },
  { id: 'schedule', label: 'סידור' },
  { id: 'details', label: 'פרטים' },
  { id: 'team', label: 'צוות' },
  { id: 'pos', label: 'קופה ואירועים' },
]

const clockText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit', timeZone: 'Asia/Jerusalem' }) : '')

// The branch manager (2026-10-16): everything about ONE branch in one place, for an owner who is not technical.
// Five tabs, each a plain sentence of what it is for. The first is a readiness list that tells a new branch exactly what
// is still missing and jumps to where it is fixed. Checklists switch on and off here (the owner's request), and the
// scheduler's own settings are embedded, with their usual draft + one Save, so nothing is edited in two places.
export default function BranchManager({ overview, links, initialTab }: { overview: BranchOverview; links: BranchLinks; initialTab: TabId }) {
  const [tab, setTab] = useState<TabId>(initialTab)
  const [state, setState] = useState(overview)
  const [scheduleSeen, setScheduleSeen] = useState(initialTab === 'schedule')
  const panelRef = useRef<HTMLDivElement>(null)

  const go = useCallback((next: TabId) => {
    setTab(next)
    if (next === 'schedule') setScheduleSeen(true)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', next)
      window.history.replaceState(null, '', url)
    } catch { /* the tab still switches; only "refresh keeps it" is lost */ }
  }, [])
  useEffect(() => { panelRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [tab])

  const done = state.readiness.filter((r) => r.ok).length
  const total = state.readiness.length

  return (
    <div className="bm">
      <BranchSlider trucks={state.trucks} current={state.slug} tab={tab} />
      <section className="bm-hero" aria-label="הסניף">
        <div className="bm-hero__icon" aria-hidden="true"><MapPin size={22} /></div>
        <div className="bm-hero__copy">
          <h2>{state.name}</h2>
          <p>
            <span className={`bm-dot${state.openNow ? ' bm-dot--on' : ''}`} aria-hidden="true" />
            {!state.hoursConfigured ? 'שעות הפעילות עדיין לא הוגדרו' : state.openNow ? 'פתוח עכשיו' : 'סגור כרגע'}
            {state.hoursToday && <> · <bdi dir="ltr">{state.hoursToday.open}–{state.hoursToday.close}</bdi> היום</>}
            {state.kind === 'event' && ' · אירוע'}
          </p>
        </div>
        {state.shortages !== null && state.shortages > 0 && (
          <Link href={`/owner/issues?branch=${state.slug}`} className="bm-hero__alert press">
            <AlertTriangle size={15} aria-hidden="true" />{state.shortages === 1 ? 'דבר אחד לטיפול' : `${state.shortages} דברים לטיפול`}
          </Link>
        )}
      </section>

      <div className="bm-tabs" role="tablist" aria-label="חלקי ניהול הסניף">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`bm-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`bm-panel-${t.id}`} className="bm-tab press" onClick={() => go(t.id)}>
            {t.label}
            {t.id === 'overview' && done < total && <span className="bm-tab__badge" aria-label={`${total - done} דברים חסרים`}>{total - done}</span>}
          </button>
        ))}
      </div>

      <div ref={panelRef} role="tabpanel" id={`bm-panel-${tab}`} aria-labelledby={`bm-tab-${tab}`} className="bm-panel rise" key={tab}>
        {tab === 'overview' && <Overview state={state} done={done} total={total} go={go} />}
        {tab === 'checklists' && <Checklists state={state} setState={setState} />}
        {tab === 'schedule' && scheduleSeen && (
          <div className="bm-card">
            <p className="sch-sub">שעות הפעילות, המשמרות הקבועות, כללי הבטיחות, מה שעובדים יכולים לבקש, התפקידים והעמדות של הסניף. שום דבר לא נשמר עד שלוחצים ״שמירה״ בתחתית המסך.</p>
            <ScheduleSettings branchSlug={state.slug} />
            <Link href={`/owner/schedule`} className="bm-link press"><CalendarClock size={17} aria-hidden="true" />לסידור העבודה של הסניף<ChevronLeft size={16} aria-hidden="true" /></Link>
          </div>
        )}
        {tab === 'details' && (
          <div className="bm-card">
            <p className="sch-sub">הקישורים שמופיעים בדף הסניף ללקוחות: ניווט, אינסטגרם וביקורות.</p>
            <BranchLinksEditor branchId={state.id} initialLinks={links} />
            <Link href="/owner/reviews" className="bm-link press"><Pencil size={17} aria-hidden="true" />עריכת הביקורות שמוצגות בדף<ChevronLeft size={16} aria-hidden="true" /></Link>
          </div>
        )}
        {tab === 'team' && <Team state={state} />}
        {tab === 'pos' && <PosSubsystem state={state} setState={setState} />}
      </div>
    </div>
  )
}

function Overview({ state, done, total, go }: { state: BranchOverview; done: number; total: number; go: (t: TabId) => void }) {
  const active = state.checklists.filter((c) => c.enabled).length
  const ready = done === total
  return (
    <>
      <section className="bm-card" aria-labelledby="bm-ready">
        <div className="bm-card__head">
          <h3 id="bm-ready">{ready ? 'הסניף מוכן לעבודה' : 'מה עוד חסר כדי שהסניף יעבוד'}</h3>
          <span className={`bm-pill${ready ? ' bm-pill--ok' : ''}`}>{done}/{total}</span>
        </div>
        <div className="bm-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="התקדמות ההכנה"><span style={{ width: `${(done / total) * 100}%` }} /></div>
        <ul className="bm-ready">
          {state.readiness.map((item) => (
            <li key={item.id}>
              <button type="button" className="bm-ready__row press" onClick={() => go(item.tab)}>
                <span className={`bm-ready__mark${item.ok ? ' bm-ready__mark--ok' : ''}`} aria-hidden="true">{item.ok ? <CheckCircle2 size={20} /> : <CircleDashed size={20} />}</span>
                <span className="bm-ready__copy"><strong>{item.label}</strong>{!item.ok && <small>{item.hint}</small>}</span>
                <span className="bm-ready__state">{item.ok ? 'מוכן' : 'להשלים'}</span>
                <ChevronLeft size={16} aria-hidden="true" className="bm-ready__chev" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="bm-stats" aria-label="במספרים">
        <button type="button" className="bm-stat press" onClick={() => go('team')}><Users size={18} aria-hidden="true" /><strong>{state.people.filter((p) => p.schedulable).length}</strong><span>עובדים בסידור</span></button>
        <button type="button" className="bm-stat press" onClick={() => go('checklists')}><ClipboardCheck size={18} aria-hidden="true" /><strong>{active}/3</strong><span>צ׳קליסטים פעילים</span></button>
        <button type="button" className="bm-stat press" onClick={() => go('schedule')}><CalendarClock size={18} aria-hidden="true" /><strong>{state.schedule.limits.maxDaysOff}</strong><span>ימי חופש בשבוע</span></button>
        <Link href={`/owner/issues?branch=${state.slug}`} className="bm-stat press"><AlertTriangle size={18} aria-hidden="true" /><strong>{state.shortages ?? '–'}</strong><span>חוסרים ופערים</span></Link>
      </section>
    </>
  )
}

function Checklists({ state, setState }: { state: BranchOverview; setState: (next: BranchOverview) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: string; text: string; tone: 'ok' | 'error' } | null>(null)

  async function toggle(item: BranchChecklistState) {
    if (busy) return
    const next = !item.enabled
    setBusy(item.kind)
    setMessage(null)
    // Immediately on screen; put back with a sentence if the server says no.
    const before = state
    setState({ ...state, checklists: state.checklists.map((c) => (c.kind === item.kind ? { ...c, enabled: next, disabledFrom: next ? null : new Date().toISOString().slice(0, 10) } : c)) })
    try {
      const res = await fetch('/api/owner/branches/checklists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branchId: state.id, kind: item.kind, enabled: next }) })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(messageOf(payload, 'לא הצלחנו לשנות את הצ׳קליסט. נסו שוב.'))
      const removed = Number(payload?.removed ?? 0) + Number(payload?.closed ?? 0)
      setMessage({
        kind: item.kind, tone: 'ok',
        text: next ? `${item.label} הופעל בסניף. הוא יופיע לעובדים במשמרות שעוד לא התחילו.` : removed > 0 ? `${item.label} כבוי בסניף. הוסרו ${removed} טפסים שעוד לא מולאו, ואף אחד לא יקבל עליהם התראות.` : `${item.label} כבוי בסניף. משמרות חדשות לא יקבלו אותו.`,
      })
    } catch (err) {
      setState(before)
      setMessage({ kind: item.kind, tone: 'error', text: err instanceof Error ? err.message : 'לא הצלחנו לשנות את הצ׳קליסט. נסו שוב.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="bm-card" aria-labelledby="bm-ck">
      <h3 id="bm-ck">צ׳קליסטים של הסניף</h3>
      <p className="sch-sub">אפשר להפעיל או לכבות כל צ׳קליסט בנפרד לסניף הזה. צ׳קליסט שכבוי לא מופיע לעובדים, לא נספר כפער, ולא שולחים עליו התראות. מה שכבר נשלח נשמר.</p>
      <ul className="bm-list">
        {state.checklists.map((item) => (
          <li key={item.kind} className={`bm-ck${item.enabled ? '' : ' bm-ck--off'}`}>
            <div className="bm-ck__row">
              <span className="bm-ck__copy">
                <strong>{item.label}</strong>
                <small>{item.explain}</small>
                <small className="bm-ck__meta">
                  {!item.hasTemplate ? 'הטופס ייווצר אוטומטית' : `גרסה ${item.version ?? 1}${item.publishedAt ? ` · עודכן ${clockText(item.publishedAt)}` : ''}`}
                  {!item.enabled && item.disabledFrom ? ` · כבוי מ־${clockText(item.disabledFrom)}` : ''}
                </small>
              </span>
              <button type="button" role="switch" aria-checked={item.enabled} aria-label={`${item.label} בסניף ${state.name}`} className="bm-switch press" disabled={busy !== null} onClick={() => void toggle(item)}>
                <Switch on={item.enabled} />
                <span>{item.enabled ? 'פעיל' : 'כבוי'}</span>
              </button>
            </div>
            <Link href={`/owner/checklists?branch=${state.slug}`} className="bm-link bm-link--sm press"><Pencil size={15} aria-hidden="true" />עריכת הטופס ומעקב<ChevronLeft size={15} aria-hidden="true" /></Link>
            {message?.kind === item.kind && <p className={`bm-note bm-note--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Team({ state }: { state: BranchOverview }) {
  return (
    <section className="bm-card" aria-labelledby="bm-team">
      <h3 id="bm-team">הצוות של {state.name}</h3>
      <p className="sch-sub">מי יכול לעבוד בסניף. הוספה, הסרה, קודים וקישורי הצטרפות נעשים במסך העובדים.</p>
      <ul className="bm-people">
        {state.people.map((person) => {
          return (
            <li key={person.id}>
              <span className="bm-people__avatar" aria-hidden="true">{person.name.slice(0, 1)}</span>
              <span className="bm-people__copy"><strong>{person.name}</strong><small>{badgeLabel(person.badge) || 'עובד/ת'}</small></span>
              <span className={`bm-pill${person.schedulable ? ' bm-pill--ok' : ''}`}>{person.schedulable ? 'בסידור' : 'לא בסידור'}</span>
            </li>
          )
        })}
        {state.people.length === 0 && <li className="bm-empty"><Clock3 size={18} aria-hidden="true" />עוד אין עובדים בסניף הזה.</li>}
      </ul>
      <Link href="/owner/staff" className="bm-link press"><Users size={17} aria-hidden="true" />לניהול העובדים<ChevronLeft size={16} aria-hidden="true" /></Link>
    </section>
  )
}

// The POS is a subsystem of a branch, not a branch of its own: every event a truck trades at has its own register, and they
// live here, inside the truck. Events made before trucks owned them show up as "unassigned" until the owner claims them.
function PosSubsystem({ state, setState }: { state: BranchOverview; setState: (next: BranchOverview) => void }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  function open(event: PosEvent, where: '/owner/pos' | '/owner/pos/setup') {
    // The POS pages read the branch from the shared cookie: choosing the event here is choosing it there.
    setCurrentBranchCookie(event.slug)
    router.push(where)
  }

  async function claim(event: PosEvent) {
    if (busy) return
    setBusy(event.id); setMessage(null)
    try {
      const res = await fetch('/api/owner/branches/parent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: event.id, parentId: state.id }) })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(messageOf(payload, 'לא הצלחנו לשייך את האירוע. נסו שוב.'))
      setState({ ...state, events: [...state.events, { ...event, parentId: state.id }], unassignedEvents: state.unassignedEvents.filter((item) => item.id !== event.id) })
      setMessage({ tone: 'ok', text: `${event.name} שייך עכשיו ל${state.name}.` })
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'לא הצלחנו לשייך את האירוע. נסו שוב.' })
    } finally {
      setBusy(null)
    }
  }

  async function createEvent(name: string, cloneSlug: string | null): Promise<string | null> {
    // The web address of a one-off event is made for the owner; nobody should invent an English code for a festival.
    const slug = `ev-${Date.now().toString(36)}`
    try {
      const res = await fetch('/api/owner/branches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, name: { he: name }, kind: 'event', parentSlug: state.slug, ...(cloneSlug ? { cloneFromSlug: cloneSlug } : {}) }) })
      const payload = await res.json().catch(() => null)
      if (!res.ok) return messageOf(payload, 'לא הצלחנו ליצור את האירוע. נסו שוב.')
      // Switch the register on straight away (best effort: a failure just leaves it off, and the setup screen says so).
      const enabled = await fetch('/api/owner/pos/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch: payload.slug ?? slug, enabled: true }) }).then((r) => r.ok, () => false)
      setState({ ...state, events: [...state.events, { id: payload.branchId, slug: payload.slug ?? slug, name, parentId: state.id, posEnabled: enabled }] })
      setMessage({ tone: 'ok', text: `האירוע ״${name}״ נוצר ב${state.name}.${enabled ? ' הקופה שלו פעילה.' : ' הקופה שלו עדיין כבויה: מפעילים אותה בהגדרות הקופה.'}` })
      return null
    } catch {
      return 'בעיית חיבור. נסו שוב.'
    }
  }

  return (
    <>
      <section className="bm-card" aria-labelledby="bm-pos">
        <div className="bm-card__head">
          <h3 id="bm-pos">קופה ואירועים של {state.name}</h3>
          <span className="bm-pill">{state.events.length}</span>
        </div>
        <p className="sch-sub">הקופה היא חלק מהסניף, לא סניף בפני עצמה: לכל אירוע של {state.name} יש קופה משלו, עמדות משלו ותפריט משלו. מה שנמכר באירוע לא מתערבב עם הדוכן הקבוע.</p>
        {message && <p className={`bm-note bm-note--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
        <ul className="bm-list">
          {state.events.map((event) => (
            <li key={event.id} className="bm-ck">
              <div className="bm-ck__row">
                <span className="bm-ck__copy">
                  <strong>{event.name}</strong>
                  <small>{event.posEnabled === null ? 'מצב הקופה לא זמין כרגע' : event.posEnabled ? 'הקופה פעילה' : 'הקופה כבויה'}</small>
                </span>
                <span className={`bm-pill${event.posEnabled ? ' bm-pill--ok' : ''}`}>{event.posEnabled ? 'פעילה' : 'כבויה'}</span>
              </div>
              <div className="sch-wrapflex">
                <button type="button" className="bm-link bm-link--sm press" onClick={() => open(event, '/owner/pos')}><Receipt size={15} aria-hidden="true" />ניהול הקופה<ChevronLeft size={15} aria-hidden="true" /></button>
                <button type="button" className="bm-link bm-link--sm press" onClick={() => open(event, '/owner/pos/setup')}><Pencil size={15} aria-hidden="true" />הגדרות הקופה<ChevronLeft size={15} aria-hidden="true" /></button>
              </div>
            </li>
          ))}
          {state.events.length === 0 && <li className="bm-empty"><Clock3 size={18} aria-hidden="true" />עוד אין אירועים ב{state.name}. אירוע חדש מקבל קופה משלו.</li>}
        </ul>
        <button type="button" className="bm-link press" onClick={() => setCreating(true)}><CalendarPlus size={17} aria-hidden="true" />אירוע חדש ב{state.name}<ChevronLeft size={16} aria-hidden="true" /></button>
      </section>

      {state.unassignedEvents.length > 0 && (
        <section className="bm-card" aria-labelledby="bm-unassigned">
          <h3 id="bm-unassigned">אירועים שעוד לא שייכים לסניף</h3>
          <p className="sch-sub">אירועים שנוצרו לפני שהקופה הפכה לחלק מהסניף. שייכו כל אחד לסניף שלו.</p>
          <ul className="bm-list">
            {state.unassignedEvents.map((event) => (
              <li key={event.id} className="bm-ck">
                <div className="bm-ck__row"><span className="bm-ck__copy"><strong>{event.name}</strong></span></div>
                <button type="button" className="bm-link bm-link--sm press" disabled={busy !== null} onClick={() => void claim(event)}>{busy === event.id ? 'משייך…' : `שייכו ל${state.name}`}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EventSheet open={creating} onClose={() => setCreating(false)} sources={state.trucks.map((truck) => ({ slug: truck.slug, label: truck.name }))} onCreate={createEvent} />
    </>
  )
}
