'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, BadgeCheck, Bell, CalendarClock, CalendarDays, Check, ClipboardCheck, ExternalLink, FileText, History, KeyRound, LayoutDashboard, Mail, MessageCircle, Phone, ShieldCheck, Trash2, UserCheck, UserRound, UserX, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import SelectSheet from '@/components/SelectSheet'
import Switch from '@/components/Switch'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import HandleChip from '@/components/owner/pos/HandleChip'
import { Avatar, InlineError, Notice, Pill } from '@/components/shifts/ui'
import StaffInvitation from '@/components/staff/StaffInvitation'
import StaffRecordsView from '@/components/staff/StaffRecordsView'
import { BADGES, badgeLabel, type Badge } from '@/lib/staff/badges'
import { formatPhone } from '@/lib/pos/validate'
import { useT } from '@/lib/pos/useT'
import { messageOf, reasonOf, type BranchOption, type ScheduleMemberRow, type StaffDetail, type StaffRow } from '@/components/staff/types'
import type { StaffRecords } from '@/lib/staff/records-types'
import '@/components/shifts/schedule.css'
import '@/components/staff/staff-card.css'

// THE EMPLOYEE CARD (owner, 2026-10-17). One person, managed end to end, in a big card that opens ON the page you are on (the list stays
// behind it, blurred) instead of a small sheet. Six tabs, each one job:
//   סקירה      what is going on with this person, what is missing, what is next, one tap to the right place
//   פרטים      who they are (name, contact)
//   הרשאות     what they may do and where: the role (with what each role means), the branch, the schedule, notifications, sign-in, invitation
//   תיק        the employee file: shifts, checklists, events, payslips (upload and read)
//   היסטוריה   who changed what, and when
//   סיום עבודה deactivate / reactivate / delete, said in plain words
// Changes to details, role and branch wait for one visible save bar; switches apply at once; the dangerous things ask first.
// (Replaces StaffEditSheet, which crashed when a person was opened: it called hooks after an early return.)

type TabId = 'overview' | 'details' | 'access' | 'file' | 'history' | 'end'
const TABS: { id: TabId; label: string; Icon: typeof UserRound }[] = [
  { id: 'overview', label: 'סקירה', Icon: LayoutDashboard },
  { id: 'details', label: 'פרטים', Icon: UserRound },
  { id: 'access', label: 'הרשאות וגישה', Icon: ShieldCheck },
  { id: 'file', label: 'תיק עובד', Icon: FileText },
  { id: 'history', label: 'היסטוריה', Icon: History },
  { id: 'end', label: 'סיום עבודה', Icon: UserX },
]

/** What each role lets a person do — the real rule is lib/staff/access.ts (only owner and general manager grant anything). */
const ROLES: { value: Badge | ''; label: string; help: string; power: 'full' | 'manage' | 'title' | 'none' }[] = [
  { value: 'owner', label: BADGES.owner.he, help: 'גישה מלאה לכל דבר, בכל הסניפים: תפריט, קופה, צוות, לוח משמרות והגדרות.', power: 'full' },
  { value: 'developer', label: BADGES.developer.he, help: 'תצוגת מפתח/ת עם הרשאות מפעיל מלאות, בלי להופיע כבעלים. לא משובצ/ת כברירת מחדל.', power: 'full' },
  { value: 'general_manager', label: BADGES.general_manager.he, help: 'עורך/ת את התפריט, מנהל/ת את הקופה ואת לוח המשמרות של הסניף שלו/ה (או של כולם, בלי סניף בית).', power: 'manage' },
  { value: 'manager', label: BADGES.manager.he, help: 'תפקיד לתצוגה: מופיע/ה כמנהל/ת משמרת בצוות. בלי גישת ניהול. אפשר להאציל ניהול לוח משמרות בהגדרות הלוח.', power: 'title' },
  { value: 'barista', label: BADGES.barista.he, help: 'עובד/ת רגיל/ה. התפקיד לתצוגה בלבד.', power: 'none' },
  { value: 'cook', label: BADGES.cook.he, help: 'עובד/ת רגיל/ה. התפקיד לתצוגה בלבד.', power: 'none' },
  { value: 'cashier', label: BADGES.cashier.he, help: 'עובד/ת רגיל/ה. התפקיד לתצוגה בלבד.', power: 'none' },
  { value: '', label: 'ללא תפקיד', help: 'עובד/ת רגיל/ה בלי תווית תפקיד.', power: 'none' },
]
const POWER_LABEL = { full: 'גישה מלאה', manage: 'מנהל/ת', title: 'תווית בלבד', none: 'עובד/ת' } as const

const dayLabel = (iso: string) => new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
const todayJerusalem = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
/** Only the digits (and a leading +) matter when asking "did the phone change?". */
const digitsOf = (s: string) => s.replace(/[^\d+]/g, '')
/** A phone as WhatsApp wants it: country code, no zero, no signs. */
function whatsappNumber(phone: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length < 8) return null
  return d.startsWith('0') ? `972${d.slice(1)}` : d
}

export default function StaffCard({
  row,
  branches,
  scheduleMembers,
  colour,
  isSelf,
  quickBusy,
  onClose,
  onChanged,
  onToggleSchedulable,
  onEditHandle,
  onEditEmpNo,
  onGenerateCode,
  onSetCode,
  onClearCode,
}: {
  row: StaffRow | null
  branches: BranchOption[]
  scheduleMembers: ScheduleMemberRow[]
  colour: string
  isSelf: boolean
  quickBusy: boolean
  onClose: () => void
  /** A write succeeded: the parent reloads the list and shows `message`. The card stays open. */
  onChanged: (message: string) => void
  onToggleSchedulable: (row: StaffRow, branchId: string, next: boolean) => Promise<void>
  onEditHandle: (row: StaffRow) => void
  onEditEmpNo: (row: StaffRow) => void
  onGenerateCode: (row: StaffRow) => void
  onSetCode: (row: StaffRow) => void
  onClearCode: (row: StaffRow) => void
}) {
  // ---- every hook lives up here, above the one early return (a hook below it is what crashed the old sheet) ----
  const t = useT()
  const ids = useId()
  // Remember the last row so the card can finish its close animation after `row` goes null.
  const [shown, setShown] = useState<StaffRow | null>(row)
  useEffect(() => { if (row) setShown(row) }, [row])
  const r = row ?? shown

  const [tab, setTab] = useState<TabId>('overview')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [display, setDisplay] = useState('')
  const [displayAuto, setDisplayAuto] = useState(true)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [badge, setBadge] = useState<Badge | ''>('')
  const [branchId, setBranchId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<StaffDetail | null>(null)
  const [records, setRecords] = useState<StaffRecords | null>(null)
  const [recordsFailed, setRecordsFailed] = useState(false)
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [removeFuture, setRemoveFuture] = useState(true)
  const [busyDanger, setBusyDanger] = useState(false)
  const [exempt, setExempt] = useState(false)
  const [exemptBusy, setExemptBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const open = !!row
  const rowId = row?.id

  // Seed the form (and go back to the overview) whenever a different person is opened.
  useEffect(() => {
    if (!row) return
    const auto = [row.first_name ?? '', row.last_name ?? ''].filter(Boolean).join(' ')
    setFirst(row.first_name ?? '')
    setLast(row.last_name ?? '')
    setDisplay(row.display_name ?? '')
    setDisplayAuto(!row.display_name || row.display_name === auto)
    setPhone(formatPhone(row.phone))
    setEmail(row.email ?? '')
    setBadge((row.badge as Badge | null) ?? '')
    setBranchId(row.branch_id ?? '')
    setError(null)
    setDeactivateOpen(false)
    setDetail(null)
    setRecords(null)
    setRecordsFailed(false)
    setTab('overview')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId])

  // What the list does not carry: has history? future shifts? the trail.
  useEffect(() => {
    if (!rowId) return
    let cancelled = false
    fetch(`/api/owner/staff/${rowId}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => { if (!cancelled && d) setDetail(d as StaffDetail) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [rowId, row?.active])

  // The employee file (shifts, checklists, events, payslips): needed by the overview's numbers as well as by the file tab.
  const loadRecords = useCallback(() => {
    if (!rowId) return Promise.resolve()
    return fetch(`/api/owner/staff/${rowId}/records`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('records'))))
      .then((d) => { setRecords(d as StaffRecords); setRecordsFailed(false) })
      .catch(() => setRecordsFailed(true))
  }, [rowId])
  useEffect(() => { void loadRecords() }, [loadRecords])

  useEffect(() => { setExempt(r?.push_gate_exempt === true) }, [r?.id, r?.push_gate_exempt])
  // Each tab starts at its top.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [tab])

  const dirty = useMemo(() => {
    if (!row) return false
    return (
      first.trim() !== (row.first_name ?? '') ||
      last.trim() !== (row.last_name ?? '') ||
      display.trim() !== (row.display_name ?? '') ||
      digitsOf(phone) !== digitsOf(row.phone ?? '') ||
      email.trim() !== (row.email ?? '') ||
      badge !== ((row.badge as Badge | null) ?? '') ||
      branchId !== (row.branch_id ?? '')
    )
  }, [row, first, last, display, phone, email, badge, branchId])

  if (!r) return null
  const person = r
  const name = person.label
  const locked = !!person.has_google
  const nameEmpty = !first.trim() && !display.trim() && !last.trim()
  const targetBranches = person.branch_id ? branches.filter((b) => b.id === person.branch_id) : branches
  const operator = person.role === 'owner' || person.badge === 'owner' || person.badge === 'developer'
  const staffLike = !(person.role === 'owner' || person.badge === 'owner' || person.badge === 'developer' || person.badge === 'general_manager' || person.badge === 'manager')
  const wa = whatsappNumber(person.phone)
  const role = ROLES.find((item) => item.value === badge) ?? ROLES[ROLES.length - 1]!

  function editFirst(v: string) {
    setFirst(v)
    if (displayAuto) setDisplay([v.trim(), last.trim()].filter(Boolean).join(' '))
  }
  function editLast(v: string) {
    setLast(v)
    if (displayAuto) setDisplay([first.trim(), v.trim()].filter(Boolean).join(' '))
  }
  /** Closing with unsaved changes asks first (a tap outside the card, Escape or the X). */
  function requestClose() {
    if (!dirty) return onClose()
    setConfirm({ title: 'לצאת בלי לשמור?', body: 'עשיתם שינויים בפרטים, בתפקיד או בסניף ועוד לא שמרתם אותם. אם תצאו הם יימחקו.', confirmLabel: 'יציאה בלי לשמור', cancelLabel: 'להישאר', danger: true, onYes: onClose })
  }
  function resetForm() {
    const auto = [person.first_name ?? '', person.last_name ?? ''].filter(Boolean).join(' ')
    setFirst(person.first_name ?? '')
    setLast(person.last_name ?? '')
    setDisplay(person.display_name ?? '')
    setDisplayAuto(!person.display_name || person.display_name === auto)
    setPhone(formatPhone(person.phone))
    setEmail(person.email ?? '')
    setBadge((person.badge as Badge | null) ?? '')
    setBranchId(person.branch_id ?? '')
    setError(null)
  }

  async function patch(body: Record<string, unknown>): Promise<{ ok: boolean; payload: Record<string, unknown> | null; message: string }> {
    try {
      const res = await fetch('/api/owner/staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: person.id, ...body }) })
      const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) return { ok: false, payload, message: reasonOf(payload) === 'taken' ? t('owner.menu.staff.handleTaken') : messageOf(payload, 'לא הצלחנו לשמור. נסו שוב.') }
      return { ok: true, payload, message: '' }
    } catch {
      return { ok: false, payload: null, message: 'בעיית חיבור. בדקו את הרשת ונסו שוב.' }
    }
  }

  async function toggleExempt(next: boolean) {
    if (exemptBusy) return
    setExemptBusy(true)
    setExempt(next)
    const res = await patch({ pushGateExempt: next })
    setExemptBusy(false)
    if (!res.ok) { setExempt(!next); return setError(res.message) }
    onChanged(next ? `${name} יכול/ה להיכנס עכשיו בלי התראות ✓` : `${name} יצטרך/תצטרך להפעיל התראות כדי להיכנס ✓`)
  }

  async function save() {
    if (nameEmpty) { setTab('details'); return setError('יש להזין שם — לפחות שם פרטי.') }
    setSaving(true)
    setError(null)
    const body: Record<string, unknown> = {
      firstName: first.trim() || null,
      lastName: last.trim() || null,
      displayName: display.trim() || null,
      phone: phone.trim() || null,
      badge: badge || null,
      branchId: branchId || null,
    }
    // The address only travels if it changed (and can only change before the first sign-in).
    if (!locked && email.trim() !== (person.email ?? '')) body.email = email.trim() || null
    const res = await patch(body)
    setSaving(false)
    if (!res.ok) return setError(res.message)
    onChanged(`הפרטים של ${display.trim() || first.trim() || name} נשמרו ✓`)
  }

  async function reactivate() {
    setBusyDanger(true)
    const res = await patch({ active: true })
    setBusyDanger(false)
    if (!res.ok) return setError(res.message)
    onChanged(
      person.email
        ? `${name} הופעל/ה מחדש ✓ כדי להתחבר שוב — צריך להיכנס פעם אחת עם Google.`
        : `${name} הופעל/ה מחדש ✓ אפשר להיכנס עם מספר העובד והקוד האישי, ולקשר Google דרך הזמנה חדשה.`,
    )
  }

  async function deactivate() {
    setBusyDanger(true)
    const res = await patch({ active: false, removeFromFutureShifts: removeFuture && (detail?.futureShifts ?? 0) > 0 })
    setBusyDanger(false)
    setDeactivateOpen(false)
    if (!res.ok) return setError(res.message)
    const removed = Number(res.payload?.removedFuture ?? 0)
    const left = Number(res.payload?.futureLeft ?? 0)
    onChanged(
      `${name} הושבת/ה ✓ כל ההיסטוריה נשמרה.` +
        (removed > 0 ? ` הוסר/ה מ-${removed} משמרות עתידיות.` : '') +
        (left > 0 ? ` שימו לב: נשארו ${left} משמרות עתידיות — הלוח יסמן אותן כבעיה.` : ''),
    )
  }

  function askDelete() {
    setConfirm({
      title: `למחוק לצמיתות את ${name}?`,
      body: 'אפשר למחוק כי אין לאיש/אשת הצוות שום היסטוריה — לא משמרות, לא בקשות ולא הזמנות. אי אפשר לבטל את המחיקה.',
      confirmLabel: 'מחיקה לצמיתות',
      danger: true,
      onYes: async () => {
        setBusyDanger(true)
        try {
          const res = await fetch(`/api/owner/staff/${person.id}`, { method: 'DELETE' })
          const payload = await res.json().catch(() => null)
          if (!res.ok) return setError(messageOf(payload, 'לא הצלחנו למחוק. אפשר להשבית במקום.'))
          onChanged(`${name} נמחק/ה מהצוות.`)
        } catch {
          setError('בעיית חיבור. בדקו את הרשת ונסו שוב.')
        } finally {
          setBusyDanger(false)
        }
      },
    })
  }

  const upcoming = (records?.shifts ?? []).filter((s) => s.date >= todayJerusalem()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4)
  const submitted = records ? records.checklists.filter((c) => c.status === 'submitted').length : null
  const withIssues = records ? records.checklists.filter((c) => c.issue_count > 0).length : 0
  const scheduledEverywhere = targetBranches.length > 0 && targetBranches.every((b) => { const m = scheduleMembers.find((x) => x.branch_id === b.id && x.staff_id === person.id); return m ? m.schedulable : !operator })

  // What is still missing, each with the tab that fixes it.
  const todo: { done: boolean; label: string; detail: string; go: TabId; optional?: boolean }[] = [
    { done: !!person.phone, label: 'טלפון', detail: person.phone ? formatPhone(person.phone) : 'אין מספר: אי אפשר להתקשר או לשלוח הודעה', go: 'details' },
    { done: !!person.employee_no, label: 'מספר עובד', detail: person.employee_no ? `מספר ${person.employee_no}` : 'נדרש לכניסה עם קוד אישי', go: 'access' },
    { done: person.has_passcode === true, label: 'קוד כניסה אישי', detail: person.has_passcode ? 'קיים' : 'אין קוד: אי אפשר להיכנס עם מספר וקוד', go: 'access' },
    { done: !!person.claimed_at || !!person.has_google, label: 'נכנס/ה לאפליקציה', detail: person.claimed_at || person.has_google ? 'כבר נכנס/ה' : 'עוד לא נכנס/ה. אפשר לשלוח קישור הזמנה', go: 'access' },
    { done: !!person.has_google, label: 'חשבון Google מקושר', detail: person.has_google ? 'מקושר' : 'לא חובה: נדרש לצפייה בסידור ולתלושים', go: 'access', optional: true },
    ...(person.active && targetBranches.length > 0 ? [{ done: scheduledEverywhere, label: 'ניתן לשיבוץ בלוח', detail: scheduledEverywhere ? 'מופיע/ה ברשימות השיבוץ' : 'לא מופיע/ה ברשימות השיבוץ', go: 'access' as TabId }] : []),
  ]
  const missing = todo.filter((x) => !x.done && !x.optional).length

  const panel = (id: TabId, children: ReactNode) => (
    <div role="tabpanel" id={`${ids}-panel-${id}`} aria-labelledby={`${ids}-tab-${id}`} className="sc-panelbody" hidden={tab !== id}>
      {tab === id && children}
    </div>
  )

  return (
    <>
      <SheetShell open={open} onClose={requestClose} labelledBy={`${ids}-title`} suspended={!!confirm || deactivateOpen} className="sc-panel">
        {/* ============================================================ header */}
        <header className="sc-head">
          <Avatar name={name} emoji={person.avatar_emoji} large />
          <div className="sc-head__who">
            <h2 id={`${ids}-title`} className="sc-head__name">{name}</h2>
            <div className="sch-wrapflex">
              <Pill tone={person.active ? 'ok' : 'neutral'}>{person.active ? 'פעיל/ה' : 'לא פעיל/ה'}</Pill>
              {person.badge && <Pill tone="neutral">{badgeLabel(person.badge)}</Pill>}
              {person.has_google ? <Pill tone="ok">Google מקושר</Pill> : person.active && <Pill tone="warn">Google לא מקושר</Pill>}
              {person.employee_no && <Pill tone="neutral">עובד <bdi>#{person.employee_no}</bdi></Pill>}
            </div>
          </div>
          <div className="sc-head__actions">
            {person.phone && <a className="sc-chip press" href={`tel:${digitsOf(person.phone)}`} aria-label={`התקשרות ל${name}`}><Phone size={17} aria-hidden="true" /><span>התקשרות</span></a>}
            {wa && <a className="sc-chip press" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" aria-label={`וואטסאפ ל${name}`}><MessageCircle size={17} aria-hidden="true" /><span>וואטסאפ</span></a>}
            {person.email && <a className="sc-chip press" href={`mailto:${person.email}`} aria-label={`מייל ל${name}`}><Mail size={17} aria-hidden="true" /><span>מייל</span></a>}
            <button type="button" className="sc-close press" onClick={requestClose} aria-label="סגירה"><X size={22} aria-hidden="true" /></button>
          </div>
        </header>

        <nav className="sc-tabs" role="tablist" aria-label="חלקי כרטיס העובד/ת">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} type="button" role="tab" id={`${ids}-tab-${id}`} aria-selected={tab === id} aria-controls={`${ids}-panel-${id}`} className="sc-tab press" onClick={() => setTab(id)}>
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
              {id === 'overview' && missing > 0 && <span className="sc-tab__dot" aria-label={`${missing} דברים חסרים`}>{missing}</span>}
              {id === 'end' && !person.active && <span className="sc-tab__dot sc-tab__dot--quiet" aria-hidden="true" />}
            </button>
          ))}
        </nav>

        <div className="sc-body" ref={bodyRef}>
          {/* ============================================================ סקירה */}
          {panel('overview', (
            <div className="sc-grid">
              <section className="sc-stats sc-span" aria-label="במספרים">
                <Stat icon={<CalendarDays size={18} aria-hidden="true" />} value={records ? records.shifts.length : null} failed={recordsFailed} label="שיבוצים שפורסמו" />
                <Stat icon={<CalendarClock size={18} aria-hidden="true" />} value={detail ? detail.futureShifts : null} label="משמרות עתידיות" />
                <Stat icon={<ClipboardCheck size={18} aria-hidden="true" />} value={submitted} failed={recordsFailed} label="צ׳קליסטים שהוגשו" warn={withIssues > 0 ? `${withIssues} עם דיווחים` : undefined} />
                <Stat icon={<FileText size={18} aria-hidden="true" />} value={records ? records.payslips.length : null} failed={recordsFailed} label="תלושים בתיק" />
              </section>

              <section className="sch-card" aria-labelledby={`${ids}-todo`}>
                <div className="sch-row"><BadgeCheck size={19} aria-hidden="true" /><h3 id={`${ids}-todo`} className="sch-h" style={{ flex: 1 }}>מוכנות לעבודה</h3>{missing === 0 ? <Pill tone="ok" icon={<Check size={13} aria-hidden="true" />}>הכול מוכן</Pill> : <Pill tone="warn" icon={<AlertTriangle size={13} aria-hidden="true" />}>{missing} חסרים</Pill>}</div>
                <ul className="sc-todo">
                  {todo.map((item) => (
                    <li key={item.label} className={item.done ? 'sc-todo--done' : item.optional ? 'sc-todo--optional' : 'sc-todo--missing'}>
                      <span className="sc-todo__mark" aria-hidden="true">{item.done ? <Check size={15} /> : '!'}</span>
                      <span className="sc-todo__copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
                      {!item.done && <button type="button" className="sch-btn sch-btn--sm press" onClick={() => setTab(item.go)}>טיפול</button>}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="sch-card" aria-labelledby={`${ids}-next`}>
                <div className="sch-row"><CalendarDays size={19} aria-hidden="true" /><h3 id={`${ids}-next`} className="sch-h">המשמרות הקרובות</h3></div>
                {!records && !recordsFailed && <p className="sch-sub">טוען…</p>}
                {recordsFailed && <p className="sch-sub">לא הצלחנו לטעון את המשמרות. <button type="button" className="sch-btn sch-btn--sm press" onClick={() => void loadRecords()}>ניסיון נוסף</button></p>}
                {records && upcoming.length === 0 && <p className="sch-sub">אין משמרות קרובות בלוחות שפורסמו.</p>}
                {upcoming.length > 0 && (
                  <ul className="sc-next">
                    {upcoming.map((s) => <li key={`${s.id}-${s.date}`}><strong>{dayLabel(s.date)}</strong><span dir="ltr">{s.start}–{s.end}</span><small>{s.branch} · {s.label}</small></li>)}
                  </ul>
                )}
                <button type="button" className="sch-btn sch-btn--ghost sch-btn--sm press" onClick={() => setTab('file')}>לכל התיק: משמרות, צ׳קליסטים ותלושים</button>
              </section>

              <section className="sch-card" aria-labelledby={`${ids}-quick`}>
                <div className="sch-row"><KeyRound size={19} aria-hidden="true" /><h3 id={`${ids}-quick`} className="sch-h">פעולות מהירות</h3></div>
                <div className="sc-actions">
                  <button type="button" className="sch-btn press" onClick={() => setTab('details')}><UserRound size={17} aria-hidden="true" />עריכת פרטים</button>
                  <button type="button" className="sch-btn press" onClick={() => setTab('access')}><ShieldCheck size={17} aria-hidden="true" />הרשאות ותפקיד</button>
                  {person.active && <button type="button" className="sch-btn press" disabled={quickBusy} onClick={() => onGenerateCode(person)}><KeyRound size={17} aria-hidden="true" />{person.has_passcode ? 'קוד חדש' : 'יצירת קוד כניסה'}</button>}
                  {person.active && <button type="button" className="sch-btn press" onClick={() => setTab('access')}><Mail size={17} aria-hidden="true" />קישור הזמנה</button>}
                  <Link href={`/owner/staff/${person.id}`} className="sch-btn press" onClick={onClose}><ExternalLink size={17} aria-hidden="true" />תיק בעמוד מלא</Link>
                </div>
              </section>

              <section className="sch-card sc-span" aria-labelledby={`${ids}-recent`}>
                <div className="sch-row"><History size={19} aria-hidden="true" /><h3 id={`${ids}-recent`} className="sch-h" style={{ flex: 1 }}>שינויים אחרונים</h3><button type="button" className="sch-btn sch-btn--ghost sch-btn--sm press" onClick={() => setTab('history')}>הכול</button></div>
                {!detail && <p className="sch-sub">טוען…</p>}
                {detail && detail.audit.length === 0 && <p className="sch-sub">עוד אין שינויים רשומים.</p>}
                {detail && detail.audit.slice(0, 3).map((a) => <AuditLine key={a.id} item={a} />)}
              </section>
            </div>
          ))}

          {/* ============================================================ פרטים */}
          {panel('details', (
            <div className="sc-grid">
              <section className="sch-card" aria-labelledby={`${ids}-who`}>
                <h3 id={`${ids}-who`} className="sch-h">מי זה/זו</h3>
                <div className="sch-row" style={{ alignItems: 'flex-start' }}>
                  <label style={{ flex: 1, minWidth: 0 }}><span className="sch-label">שם פרטי</span><input className="sch-input" value={first} maxLength={60} onChange={(e) => editFirst(e.target.value)} /></label>
                  <label style={{ flex: 1, minWidth: 0 }}><span className="sch-label">שם משפחה</span><input className="sch-input" value={last} maxLength={60} onChange={(e) => editLast(e.target.value)} /></label>
                </div>
                <label>
                  <span className="sch-label">השם כפי שיופיע בלוח</span>
                  <input className="sch-input" value={display} maxLength={60} onChange={(e) => { setDisplay(e.target.value); setDisplayAuto(false) }} placeholder="אם ריק — שם פרטי ומשפחה" />
                </label>
              </section>
              <section className="sch-card" aria-labelledby={`${ids}-contact`}>
                <h3 id={`${ids}-contact`} className="sch-h">יצירת קשר</h3>
                <label>
                  <span className="sch-label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Phone size={14} aria-hidden="true" /> טלפון</span>
                  <input className="sch-input" type="tel" dir="ltr" inputMode="tel" value={phone} maxLength={32} onChange={(e) => setPhone(e.target.value)} placeholder="050-1234567" style={{ textAlign: 'start' }} />
                </label>
                <label>
                  <span className="sch-label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Mail size={14} aria-hidden="true" /> אימייל ליצירת קשר</span>
                  <input className="sch-input" type="email" dir="ltr" value={email} disabled={locked} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" style={{ textAlign: 'start', opacity: locked ? 0.7 : 1 }} />
                  <span className="sch-sub" style={{ display: 'block', marginTop: 6 }}>{locked ? 'מחובר/ת עם חשבון Google — אי אפשר לשנות את האימייל.' : 'כתובת ליצירת קשר בלבד. הרשאות Google נוצרות רק כשהעובד/ת מקשר/ת את החשבון דרך OAuth.'}</span>
                </label>
              </section>
              {error && <div className="sc-span"><InlineError>{error}</InlineError></div>}
            </div>
          ))}

          {/* ============================================================ הרשאות וגישה */}
          {panel('access', (
            <div className="sc-grid">
              <section className="sch-card sc-span" aria-labelledby={`${ids}-role`}>
                <div className="sch-row"><ShieldCheck size={19} aria-hidden="true" /><h3 id={`${ids}-role`} className="sch-h" style={{ flex: 1 }}>תפקיד והרשאות</h3><Pill tone={role.power === 'full' || role.power === 'manage' ? 'warn' : 'neutral'}>{POWER_LABEL[role.power]}</Pill></div>
                <p className="sch-sub">התפקיד קובע מה אפשר לעשות באפליקציה. רק בעלים ומנהל/ת כללי/ת נותנים הרשאות ניהול; שאר התפקידים הם תווית בצוות. השינוי נשמר בלחיצה על ״שמירה״ למטה.</p>
                <div className="sc-roles" role="radiogroup" aria-label="תפקיד">
                  {ROLES.map((item) => (
                    <button key={item.value || 'none'} type="button" role="radio" aria-checked={badge === item.value} className={`sc-role press sc-role--${item.power}`} onClick={() => setBadge(item.value)}>
                      <span className="sc-role__top"><strong>{item.label}</strong><span className="sc-role__tag">{POWER_LABEL[item.power]}</span></span>
                      <small>{item.help}</small>
                    </button>
                  ))}
                </div>
                {(badge === 'owner' || badge === 'developer' || badge === 'general_manager') && <Notice tone="warn">שימו לב: {role.label} מקבל/ת גישת ניהול. ודאו שזה האדם הנכון לפני השמירה.</Notice>}
                <div style={{ maxWidth: 360 }}>
                  <span className="sch-label">סניף בית</span>
                  <SelectSheet
                    label="סניף"
                    placeholder="כל הסניפים"
                    value={branchId}
                    options={branches.map((b) => ({ value: b.id, label: b.name.he ?? b.slug }))}
                    onChange={setBranchId}
                    style={{ minHeight: 'var(--tap-min)', borderRadius: 12, border: '1px solid var(--line-interactive)', background: 'var(--bg)', color: 'var(--text)', padding: '0 14px', width: '100%' }}
                  />
                  <span className="sch-sub" style={{ display: 'block', marginTop: 6 }}>ללא סניף בית: גישה לכל הסניפים (למנהל/ת כללי/ת) ושיבוץ בכולם.</span>
                </div>
                {error && <InlineError>{error}</InlineError>}
              </section>

              {person.active && (
                <section className="sch-card" aria-labelledby={`${ids}-sched`}>
                  <div className="sch-row"><CalendarClock size={19} aria-hidden="true" /><h3 id={`${ids}-sched`} className="sch-h">שיבוץ במשמרות</h3></div>
                  <p className="sch-sub">זה לא משנה את הפרטים — רק אם אפשר לשבץ אותו/ה בלוח. מתעדכן מיד. בעלי הרשאות מפעיל אינם ניתנים לשיבוץ כברירת מחדל.</p>
                  {targetBranches.map((b) => {
                    const member = scheduleMembers.find((m) => m.branch_id === b.id && m.staff_id === person.id)
                    const on = member ? member.schedulable : !operator
                    return (
                      <div key={b.id} className="sch-row">
                        <span style={{ flex: 1, fontWeight: 600 }}>{targetBranches.length > 1 ? `${b.name.he ?? b.slug}: ` : ''}ניתן לשיבוץ במשמרות</span>
                        <button type="button" role="switch" aria-checked={on} aria-label={`ניתן לשיבוץ במשמרות${targetBranches.length > 1 ? ` — ${b.name.he ?? b.slug}` : ''}`} className="press" onClick={() => void onToggleSchedulable(person, b.id, !on)} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', minHeight: 44, minWidth: 52 }}>
                          <Switch on={on} />
                        </button>
                      </div>
                    )
                  })}
                  <p className="sch-sub">תפקיד ברירת מחדל ומגבלת שעות שבועית נמצאים באזור ההגדרות בלוח המשמרות.</p>
                </section>
              )}

              {person.active && staffLike && (
                <section className="sch-card" aria-labelledby={`${ids}-push`}>
                  <div className="sch-row"><Bell size={19} aria-hidden="true" /><h3 id={`${ids}-push`} className="sch-h">התראות</h3></div>
                  <p className="sch-sub">עובדים נכנסים לדפי הצוות רק אחרי שהתקינו את האפליקציה במסך הבית והפעילו התראות. אם הטלפון של {name} פשוט לא יכול לקבל התראות, אפשר לאשר לו/לה להיכנס בלי. זה חריג: כדאי לכבות כשיש טלפון חדש.</p>
                  <div className="sch-row">
                    <span style={{ flex: 1, fontWeight: 600 }}>מותר להיכנס בלי התראות</span>
                    <button type="button" role="switch" aria-checked={exempt} aria-label="מותר להיכנס בלי התראות" className="press" disabled={exemptBusy} onClick={() => void toggleExempt(!exempt)} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', minHeight: 44, minWidth: 52 }}>
                      <Switch on={exempt} />
                    </button>
                  </div>
                </section>
              )}

              {person.active && (
                <section className="sch-card" aria-labelledby={`${ids}-login`}>
                  <div className="sch-row"><KeyRound size={19} aria-hidden="true" /><h3 id={`${ids}-login`} className="sch-h">חשבון וכניסה</h3></div>
                  <div className="sch-wrapflex" style={{ alignItems: 'center' }}>
                    {person.handle != null && <HandleChip handle={person.handle} colour={colour} unconfirmed={!person.handle_set_at} label={t('owner.menu.staff.handleEditChip', { name: person.handle })} onClick={() => onEditHandle(person)} />}
                    {person.employee_no != null && <button type="button" className="mm-pill press" aria-label={t('owner.menu.staff.empNoEditChip', { name })} onClick={() => onEditEmpNo(person)}>{t('owner.menu.staff.empNo', { n: person.employee_no })}</button>}
                  </div>
                  <span className="sch-sub">{person.has_passcode === true ? t('owner.menu.staff.quickHas') : person.has_passcode === false ? t('owner.menu.staff.quickNone') : t('owner.menu.staff.quick')}</span>
                  <div className="sch-wrapflex" style={{ alignItems: 'center' }}>
                    <button type="button" className="sch-btn sch-btn--sm press" disabled={quickBusy} onClick={() => onGenerateCode(person)}><KeyRound size={15} aria-hidden="true" /> {person.has_passcode ? t('owner.menu.staff.quickRegenerate') : t('owner.menu.staff.quickGenerate')}</button>
                    <button type="button" className="sch-btn sch-btn--sm press" disabled={quickBusy} onClick={() => onSetCode(person)}>בחירת קוד ידנית</button>
                    {person.has_passcode === true && <button type="button" className="sch-btn sch-btn--sm sch-btn--danger press" disabled={quickBusy} onClick={() => onClearCode(person)}>{t('owner.menu.staff.quickClear')}</button>}
                  </div>
                  {!person.claimed_at && <p className="sch-sub">אפשר להתחבר עכשיו עם מספר העובד והקוד. חשבון Google אפשר לקשר ולאמת מאוחר יותר.</p>}
                </section>
              )}

              {person.active && (
                <section className="sch-card sc-span" aria-labelledby={`${ids}-invite`}>
                  <div className="sch-row"><Mail size={19} aria-hidden="true" /><h3 id={`${ids}-invite`} className="sch-h">קישור הזמנה</h3></div>
                  <StaffInvitation staffId={person.id} completeProfile={!!person.first_name?.trim() && !!person.last_name?.trim() && !!person.employee_no} />
                </section>
              )}
            </div>
          ))}

          {/* ============================================================ תיק עובד */}
          {panel('file', (
            <div>
              {!records && !recordsFailed && <p className="sch-sub">טוען את התיק…</p>}
              {recordsFailed && <Notice tone="warn">לא הצלחנו לטעון את התיק. <button type="button" className="sch-btn sch-btn--sm press" onClick={() => void loadRecords()}>ניסיון נוסף</button></Notice>}
              {records && <StaffRecordsView key={records.employee.id} initial={records} owner embedded />}
            </div>
          ))}

          {/* ============================================================ היסטוריה */}
          {panel('history', (
            <section className="sch-card" aria-labelledby={`${ids}-hist`}>
              <div className="sch-row"><History size={19} aria-hidden="true" /><h3 id={`${ids}-hist`} className="sch-h">היסטוריית שינויים</h3></div>
              {!detail && <p className="sch-sub">טוען…</p>}
              {detail && detail.audit.length === 0 && <p className="sch-sub">עוד אין שינויים רשומים.</p>}
              {detail && detail.audit.map((a) => <AuditLine key={a.id} item={a} />)}
            </section>
          ))}

          {/* ============================================================ סיום עבודה */}
          {panel('end', (
            <section className="sch-card sch-card--danger" aria-labelledby={`${ids}-danger`} style={{ gap: 12 }}>
              <h3 id={`${ids}-danger`} className="sch-h">{person.active ? 'הפסקת עבודה' : 'העובד/ת לא פעיל/ה'}</h3>
              {person.active ? (
                <>
                  <p className="sch-sub" style={{ color: 'var(--text)' }}>השבתה: האדם לא יופיע ברשימות השיבוץ, לא יוכל להתחבר, ולא יוצע לו/ה כלום. <strong>שום דבר לא נמחק</strong> — משמרות שעברו, בקשות והזמנות נשארים כמו שהיו, ואפשר להפעיל מחדש בכל רגע.</p>
                  <button type="button" className="sch-btn sch-btn--danger press" disabled={busyDanger || isSelf} onClick={() => setDeactivateOpen(true)}><UserX size={18} aria-hidden="true" /> השבתת {name}</button>
                  {isSelf && <p className="sch-sub">אי אפשר להשבית את עצמכם.</p>}
                </>
              ) : (
                <>
                  <p className="sch-sub" style={{ color: 'var(--text)' }}>האדם הזה מושבת — לא ניתן לשבץ אותו/ה והוא/היא לא יכולים להתחבר. כל ההיסטוריה שלו/ה שמורה.</p>
                  <button type="button" className="sch-btn sch-btn--ok press" disabled={busyDanger} onClick={reactivate}><UserCheck size={18} aria-hidden="true" /> הפעלה מחדש</button>
                </>
              )}
              {error && <InlineError>{error}</InlineError>}
              {detail && !detail.hasHistory && !isSelf && person.role !== 'owner' && person.badge !== 'owner' && (
                <>
                  <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
                  <p className="sch-sub">נוצר/ה בטעות? מכיוון שאין לאיש/אשת הצוות הזה שום היסטוריה, אפשר גם למחוק לגמרי.</p>
                  <button type="button" className="sch-btn sch-btn--sm sch-btn--danger press" disabled={busyDanger} onClick={askDelete} style={{ alignSelf: 'flex-start' }}><Trash2 size={16} aria-hidden="true" /> מחיקה לצמיתות</button>
                </>
              )}
              {detail?.hasHistory && <p className="sch-sub">אי אפשר למחוק לצמיתות כי יש כאן היסטוריה (משמרות, בקשות או הזמנות). ההשבתה שומרת אותה.</p>}
            </section>
          ))}
        </div>

        {/* ============================================================ the one save bar */}
        {dirty && (
          <div className="sc-savebar" role="region" aria-label="שינויים שלא נשמרו">
            <span className="sc-savebar__text"><AlertTriangle size={17} aria-hidden="true" />יש שינויים שלא נשמרו</span>
            <button type="button" className="sch-btn press" disabled={saving} onClick={resetForm}>ביטול</button>
            <button type="button" className="sch-btn sch-btn--primary press" disabled={saving} onClick={() => void save()}>{saving ? 'שומר…' : 'שמירה'}</button>
          </div>
        )}
      </SheetShell>

      {/* ---- deactivate: say what happens to the future before doing it ---- */}
      <SheetShell open={deactivateOpen} onClose={() => setDeactivateOpen(false)} labelledBy={`${ids}-deact`} className="sch-sheet">
        <div className="sch-sheet__head"><h2 id={`${ids}-deact`} className="sch-sheet__title">להשבית את {name}?</h2></div>
        <div className="sheet-scroll" style={{ gap: 14 }}>
          <p className="sch-sub" style={{ color: 'var(--text)' }}>{name} לא יופיע/תופיע יותר ברשימות השיבוץ ולא יוכל/תוכל להתחבר. משמרות שעברו, בקשות והזמנות <strong>נשמרים</strong>.</p>
          {(detail?.futureShifts ?? 0) > 0 ? (
            <div className="sch-block">
              <Notice tone="warn">{name} משובץ/ת עדיין ב-{detail!.futureShifts} משמרות עתידיות. מה לעשות איתן?</Notice>
              <div role="radiogroup" aria-label="משמרות עתידיות" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button type="button" role="radio" aria-checked={removeFuture} className="sch-pick press" onClick={() => setRemoveFuture(true)}>
                  <span className="sch-pick__main"><span className="sch-pick__name">להסיר אותו/ה מכל המשמרות העתידיות</span><span className="sch-pick__hint">המשמרות יישארו בלוח בלי שיבוץ, כדי שתמצאו מישהו אחר. מומלץ.</span></span>
                  <span className="sch-check" aria-hidden="true">{removeFuture && '✓'}</span>
                </button>
                <button type="button" role="radio" aria-checked={!removeFuture} className="sch-pick press" onClick={() => setRemoveFuture(false)}>
                  <span className="sch-pick__main"><span className="sch-pick__name">להשאיר אותו/ה במשמרות</span><span className="sch-pick__hint">הלוח יסמן אותן כבעיה עד שתטפלו בהן.</span></span>
                  <span className="sch-check" aria-hidden="true">{!removeFuture && '✓'}</span>
                </button>
              </div>
            </div>
          ) : (
            <p className="sch-sub">אין לו/ה משמרות עתידיות.</p>
          )}
        </div>
        <div className="sch-sheet__foot">
          <button type="button" className="sch-btn press" style={{ flex: 1 }} onClick={() => setDeactivateOpen(false)}>ביטול</button>
          <button type="button" className="sch-btn sch-btn--danger press" style={{ flex: 2 }} disabled={busyDanger} onClick={deactivate}>{busyDanger ? 'משבית…' : 'השבתה'}</button>
        </div>
      </SheetShell>

      <ConfirmSheet request={confirm} onCancel={() => setConfirm(null)} onConfirm={() => { const c = confirm; setConfirm(null); c?.onYes() }} />
    </>
  )
}

function Stat({ icon, value, label, failed, warn }: { icon: ReactNode; value: number | null; label: string; failed?: boolean; warn?: string }) {
  return (
    <div className="sc-stat">
      <span className="sc-stat__icon">{icon}</span>
      <strong>{value === null ? (failed ? '–' : '…') : value}</strong>
      <span>{label}</span>
      {warn && <small className="sc-stat__warn">{warn}</small>}
    </div>
  )
}

function AuditLine({ item }: { item: StaffDetail['audit'][number] }) {
  return (
    <div className="sch-card" style={{ gap: 4, padding: 10 }}>
      <span style={{ fontSize: '0.88rem' }}>{item.summary}</span>
      <span className="sch-faint" style={{ fontSize: '0.74rem' }}>
        {[item.actorName, new Date(item.createdAt).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}
      </span>
    </div>
  )
}
