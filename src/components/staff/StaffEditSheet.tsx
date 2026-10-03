'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { ChevronDown, KeyRound, Mail, Phone, Trash2, UserCheck, UserX, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import SelectSheet from '@/components/SelectSheet'
import Switch from '@/components/Switch'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import HandleChip from '@/components/owner/pos/HandleChip'
import { Avatar, InlineError, Notice, Pill } from '@/components/shifts/ui'
import { BADGES, badgeLabel, type Badge } from '@/lib/staff/badges'
import { formatPhone } from '@/lib/pos/validate'
import { useT } from '@/lib/pos/useT'
import { messageOf, reasonOf, type BranchOption, type ScheduleMemberRow, type StaffDetail, type StaffRow } from '@/components/staff/types'

// One person, everything about them, in ONE place — with the three different
// kinds of change kept visibly apart so nobody mixes them up:
//   1. WHO THEY ARE      name, contact, job title, home branch      -> "שמירה" button
//   2. WHETHER THEY ARE ON THE SCHEDULE   (a switch per branch)     -> applies at once
//   3. WHETHER THEY WORK HERE AT ALL      deactivate / delete       -> asks first
// Deactivating never deletes anything: past shifts, requests and orders stay.

const BADGE_HELP: Record<string, string> = {
  owner: 'גישה מלאה לכל דבר — בכל הסניפים.',
  general_manager: 'עורך/ת את התפריט, מנהל/ת את הקופה ואת לוח המשמרות של הסניף.',
}

export default function StaffEditSheet({
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
  onClearCode,
}: {
  row: StaffRow | null
  branches: BranchOption[]
  scheduleMembers: ScheduleMemberRow[]
  colour: string
  isSelf: boolean
  quickBusy: boolean
  onClose: () => void
  /** A write succeeded: the parent reloads the list and shows `message`. */
  onChanged: (message: string) => void
  onToggleSchedulable: (row: StaffRow, branchId: string, next: boolean) => Promise<void>
  onEditHandle: (row: StaffRow) => void
  onEditEmpNo: (row: StaffRow) => void
  onGenerateCode: (row: StaffRow) => void
  onClearCode: (row: StaffRow) => void
}) {
  const t = useT()
  const ids = useId()
  // Remember the last row so the sheet can finish its close animation after `row` goes null.
  const [shown, setShown] = useState<StaffRow | null>(row)
  useEffect(() => {
    if (row) setShown(row)
  }, [row])
  const r = row ?? shown

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
  const [historyOpen, setHistoryOpen] = useState(false)
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [removeFuture, setRemoveFuture] = useState(true)
  const [busyDanger, setBusyDanger] = useState(false)

  const open = !!row
  const rowId = row?.id

  // Seed the form whenever a (different) person is opened.
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
    setHistoryOpen(false)
    setDeactivateOpen(false)
    setDetail(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId])

  // What the list does not carry: has history? future shifts? the trail.
  useEffect(() => {
    if (!rowId) return
    let cancelled = false
    fetch(`/api/owner/staff/${rowId}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!cancelled && d) setDetail(d as StaffDetail)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [rowId, row?.active])

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
  const name = r.label
  const locked = !!r.has_google
  const targetBranches = r.branch_id ? branches.filter((b) => b.id === r.branch_id) : branches
  const nameEmpty = !first.trim() && !display.trim() && !last.trim()

  function editFirst(v: string) {
    setFirst(v)
    if (displayAuto) setDisplay([v.trim(), last.trim()].filter(Boolean).join(' '))
  }
  function editLast(v: string) {
    setLast(v)
    if (displayAuto) setDisplay([first.trim(), v.trim()].filter(Boolean).join(' '))
  }

  async function patch(body: Record<string, unknown>): Promise<{ ok: boolean; payload: Record<string, unknown> | null; message: string }> {
    try {
      const res = await fetch('/api/owner/staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r!.id, ...body }) })
      const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) return { ok: false, payload, message: reasonOf(payload) === 'taken' ? t('owner.menu.staff.handleTaken') : messageOf(payload, 'לא הצלחנו לשמור. נסו שוב.') }
      return { ok: true, payload, message: '' }
    } catch {
      return { ok: false, payload: null, message: 'בעיית חיבור. בדקו את הרשת ונסו שוב.' }
    }
  }

  async function saveIdentity() {
    if (!r) return
    if (nameEmpty) return setError('יש להזין שם — לפחות שם פרטי.')
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
    if (!locked && email.trim() !== (r.email ?? '')) body.email = email.trim() || null
    const res = await patch(body)
    setSaving(false)
    if (!res.ok) return setError(res.message)
    onChanged(`הפרטים של ${display.trim() || first.trim() || name} נשמרו ✓`)
  }

  async function reactivate() {
    if (!r) return
    setBusyDanger(true)
    const res = await patch({ active: true })
    setBusyDanger(false)
    if (!res.ok) return setError(res.message)
    onChanged(
      r.email
        ? `${name} הופעל/ה מחדש ✓ כדי להתחבר שוב — צריך להיכנס פעם אחת עם Google.`
        : `${name} הופעל/ה מחדש ✓ (אין אימייל, ולכן אי אפשר להתחבר — אפשר להוסיף אימייל למעלה.)`
    )
  }

  async function deactivate() {
    if (!r) return
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
        (left > 0 ? ` שימו לב: נשארו ${left} משמרות עתידיות — הלוח יסמן אותן כבעיה.` : '')
    )
  }

  function askDelete() {
    if (!r) return
    setConfirm({
      title: `למחוק לצמיתות את ${name}?`,
      body: 'אפשר למחוק כי אין לאיש/אשת הצוות שום היסטוריה — לא משמרות, לא בקשות ולא הזמנות. אי אפשר לבטל את המחיקה.',
      confirmLabel: 'מחיקה לצמיתות',
      danger: true,
      onYes: async () => {
        setBusyDanger(true)
        try {
          const res = await fetch(`/api/owner/staff/${r.id}`, { method: 'DELETE' })
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

  const noLogin = !r.has_google
  const emailNote = locked ? 'מחובר/ת עם חשבון Google — אי אפשר לשנות את האימייל.' : r.email ? 'עוד לא התחבר/ה. אחרי שייכנסו עם החשבון הזה, הם יראו את הלוח שלהם.' : 'בלי אימייל אפשר לשבץ אותו/ה בלוח, אבל הם לא יוכלו להתחבר ולראות אותו.'

  return (
    <>
      <SheetShell open={open} onClose={onClose} labelledBy={`${ids}-title`} suspended={!!confirm || deactivateOpen} className="sch-sheet">
        <div className="sch-sheet__head">
          <Avatar name={name} large />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={`${ids}-title`} className="sch-sheet__title">
              {name}
            </h2>
            <div className="sch-wrapflex" style={{ marginTop: 4 }}>
              <Pill tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'פעיל/ה' : 'לא פעיל/ה'}</Pill>
              {r.badge && <Pill tone="neutral">{badgeLabel(r.badge)}</Pill>}
              {r.active && noLogin && <Pill tone="neutral">{r.email ? 'עוד לא התחבר/ה' : 'ללא אימייל'}</Pill>}
            </div>
          </div>
          <button type="button" className="sch-iconbtn press" onClick={onClose} aria-label="סגירה">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="sheet-scroll" style={{ gap: 16 }}>
          {/* ============================================================ 1. who they are */}
          <section className="sch-card" aria-labelledby={`${ids}-who`}>
            <h3 id={`${ids}-who`} className="sch-h">
              פרטי העובד/ת
            </h3>
            <div className="sch-row" style={{ alignItems: 'flex-start' }}>
              <label style={{ flex: 1, minWidth: 0 }}>
                <span className="sch-label">שם פרטי</span>
                <input className="sch-input" value={first} maxLength={60} onChange={(e) => editFirst(e.target.value)} />
              </label>
              <label style={{ flex: 1, minWidth: 0 }}>
                <span className="sch-label">שם משפחה</span>
                <input className="sch-input" value={last} maxLength={60} onChange={(e) => editLast(e.target.value)} />
              </label>
            </div>
            <label>
              <span className="sch-label">השם כפי שיופיע בלוח</span>
              <input
                className="sch-input"
                value={display}
                maxLength={60}
                onChange={(e) => {
                  setDisplay(e.target.value)
                  setDisplayAuto(false)
                }}
                placeholder="אם ריק — שם פרטי ומשפחה"
              />
            </label>
            <label>
              <span className="sch-label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Phone size={14} aria-hidden="true" /> טלפון
              </span>
              <input className="sch-input" type="tel" dir="ltr" inputMode="tel" value={phone} maxLength={32} onChange={(e) => setPhone(e.target.value)} placeholder="050-1234567" style={{ textAlign: 'start' }} />
            </label>
            <label>
              <span className="sch-label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Mail size={14} aria-hidden="true" /> אימייל Google
              </span>
              <input
                className="sch-input"
                type="email"
                dir="ltr"
                value={email}
                disabled={locked}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@gmail.com"
                style={{ textAlign: 'start', opacity: locked ? 0.7 : 1 }}
              />
              <span className="sch-sub" style={{ display: 'block', marginTop: 6 }}>
                {emailNote}
              </span>
            </label>
            <div className="sch-row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="sch-label">תפקיד</span>
                <SelectSheet
                  label="תפקיד"
                  placeholder="ללא תפקיד"
                  value={badge}
                  options={(Object.keys(BADGES) as Badge[]).map((b) => ({ value: b, label: BADGES[b].he }))}
                  onChange={(v) => setBadge(v as Badge | '')}
                  style={{ minHeight: 'var(--tap-min)', borderRadius: 12, border: '1px solid var(--line-interactive)', background: 'var(--bg)', color: 'var(--text)', padding: '0 14px', width: '100%' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="sch-label">סניף</span>
                <SelectSheet
                  label="סניף"
                  placeholder="כל הסניפים"
                  value={branchId}
                  options={branches.map((b) => ({ value: b.id, label: b.name.he ?? b.slug }))}
                  onChange={setBranchId}
                  style={{ minHeight: 'var(--tap-min)', borderRadius: 12, border: '1px solid var(--line-interactive)', background: 'var(--bg)', color: 'var(--text)', padding: '0 14px', width: '100%' }}
                />
              </div>
            </div>
            {badge && BADGE_HELP[badge] && <Notice tone="warn">{BADGE_HELP[badge]}</Notice>}
            {error && <InlineError>{error}</InlineError>}
            <button type="button" className="sch-btn sch-btn--primary press" disabled={saving || !dirty} onClick={saveIdentity}>
              {saving ? 'שומר…' : dirty ? 'שמירת הפרטים' : 'אין שינויים לשמור'}
            </button>
          </section>

          {/* ============================================================ 2. on the schedule? */}
          {r.active && (
            <section className="sch-card" aria-labelledby={`${ids}-sched`}>
              <h3 id={`${ids}-sched`} className="sch-h">
                שיבוץ במשמרות
              </h3>
              <p className="sch-sub">זה לא משנה את הפרטים של העובד/ת — רק אם אפשר לשבץ אותו/ה בלוח. נשמר מיד.</p>
              {targetBranches.map((b) => {
                const member = scheduleMembers.find((m) => m.branch_id === b.id && m.staff_id === r.id)
                // No row = never configured = schedulable (the same default the scheduler itself uses).
                const on = member ? member.schedulable : true
                return (
                  <div key={b.id} className="sch-row">
                    <span style={{ flex: 1, fontWeight: 600 }}>{targetBranches.length > 1 ? `${b.name.he ?? b.slug}: ` : ''}ניתן לשיבוץ במשמרות</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`ניתן לשיבוץ במשמרות${targetBranches.length > 1 ? ` — ${b.name.he ?? b.slug}` : ''}`}
                      className="press"
                      onClick={() => void onToggleSchedulable(r, b.id, !on)}
                      style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', minHeight: 44, minWidth: 52 }}
                    >
                      <Switch on={on} />
                    </button>
                  </div>
                )
              })}
              <p className="sch-sub">תפקיד ברירת מחדל ומגבלת שעות שבועית — בלוח המשמרות › הגדרות.</p>
            </section>
          )}

          {/* ============================================================ POS access */}
          {r.active && (
            <section className="sch-card" aria-labelledby={`${ids}-pos`}>
              <h3 id={`${ids}-pos`} className="sch-h">
                כניסה לקופה
              </h3>
              <div className="sch-wrapflex" style={{ alignItems: 'center' }}>
                {r.handle != null && (
                  <HandleChip
                    handle={r.handle}
                    colour={colour}
                    unconfirmed={!r.handle_set_at}
                    label={t('owner.menu.staff.handleEditChip', { name: r.handle })}
                    onClick={() => onEditHandle(r)}
                  />
                )}
                {r.employee_no != null && (
                  <button type="button" className="mm-pill press" aria-label={t('owner.menu.staff.empNoEditChip', { name })} onClick={() => onEditEmpNo(r)}>
                    {t('owner.menu.staff.empNo', { n: r.employee_no })}
                  </button>
                )}
              </div>
              <div className="sch-wrapflex" style={{ alignItems: 'center' }}>
                <span className="sch-sub">{r.has_passcode === true ? t('owner.menu.staff.quickHas') : r.has_passcode === false ? t('owner.menu.staff.quickNone') : t('owner.menu.staff.quick')}</span>
                <button type="button" className="sch-btn sch-btn--sm press" disabled={!r.claimed_at || quickBusy} onClick={() => onGenerateCode(r)}>
                  <KeyRound size={15} aria-hidden="true" /> {r.has_passcode ? t('owner.menu.staff.quickRegenerate') : t('owner.menu.staff.quickGenerate')}
                </button>
                {r.has_passcode === true && (
                  <button type="button" className="sch-btn sch-btn--sm sch-btn--danger press" disabled={quickBusy} onClick={() => onClearCode(r)}>
                    {t('owner.menu.staff.quickClear')}
                  </button>
                )}
              </div>
              {!r.claimed_at && <p className="sch-sub">{t('owner.menu.staff.quickNeedsGoogle')}</p>}
            </section>
          )}

          {/* ============================================================ history */}
          <section className="sch-wrap">
            <button type="button" className="sch-btn sch-btn--ghost sch-btn--sm press" aria-expanded={historyOpen} onClick={() => setHistoryOpen((o) => !o)} style={{ justifyContent: 'space-between' }}>
              <span>היסטוריית שינויים</span>
              <ChevronDown size={16} aria-hidden="true" style={{ transform: historyOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s var(--ease)' }} />
            </button>
            {historyOpen &&
              (detail && detail.audit.length > 0 ? (
                detail.audit.map((a) => (
                  <div key={a.id} className="sch-card" style={{ gap: 4, padding: 10 }}>
                    <span style={{ fontSize: '0.88rem' }}>{a.summary}</span>
                    <span className="sch-faint" style={{ fontSize: '0.74rem' }}>
                      {[a.actorName, new Date(a.createdAt).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                ))
              ) : (
                <p className="sch-sub">עוד אין שינויים רשומים.</p>
              ))}
          </section>

          {/* ============================================================ 3. works here at all? */}
          <section className="sch-card sch-card--danger" aria-labelledby={`${ids}-danger`} style={{ gap: 12 }}>
            <h3 id={`${ids}-danger`} className="sch-h">
              {r.active ? 'הפסקת עבודה' : 'העובד/ת לא פעיל/ה'}
            </h3>
            {r.active ? (
              <>
                <p className="sch-sub" style={{ color: 'var(--text)' }}>
                  השבתה: האדם לא יופיע ברשימות השיבוץ, לא יוכל להתחבר, ולא יוצע לו/ה כלום. <strong>שום דבר לא נמחק</strong> — משמרות שעברו, בקשות והזמנות נשארים כמו שהיו, ואפשר להפעיל מחדש בכל רגע.
                </p>
                <button type="button" className="sch-btn sch-btn--danger press" disabled={busyDanger || isSelf} onClick={() => setDeactivateOpen(true)}>
                  <UserX size={18} aria-hidden="true" /> השבתת {name}
                </button>
                {isSelf && <p className="sch-sub">אי אפשר להשבית את עצמכם.</p>}
              </>
            ) : (
              <>
                <p className="sch-sub" style={{ color: 'var(--text)' }}>
                  האדם הזה מושבת — לא ניתן לשבץ אותו/ה והוא/היא לא יכולים להתחבר. כל ההיסטוריה שלו/ה שמורה.
                </p>
                <button type="button" className="sch-btn sch-btn--ok press" disabled={busyDanger} onClick={reactivate}>
                  <UserCheck size={18} aria-hidden="true" /> הפעלה מחדש
                </button>
              </>
            )}
            {detail && !detail.hasHistory && !isSelf && r.role !== 'owner' && r.badge !== 'owner' && (
              <>
                <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
                <p className="sch-sub">נוצר/ה בטעות? מכיוון שאין לאיש/אשת הצוות הזה שום היסטוריה, אפשר גם למחוק לגמרי.</p>
                <button type="button" className="sch-btn sch-btn--sm sch-btn--danger press" disabled={busyDanger} onClick={askDelete} style={{ alignSelf: 'flex-start' }}>
                  <Trash2 size={16} aria-hidden="true" /> מחיקה לצמיתות
                </button>
              </>
            )}
            {detail?.hasHistory && <p className="sch-sub">אי אפשר למחוק לצמיתות כי יש כאן היסטוריה (משמרות, בקשות או הזמנות). ההשבתה שומרת אותה.</p>}
          </section>
        </div>
      </SheetShell>

      {/* ---- deactivate: say what happens to the future before doing it ---- */}
      <SheetShell open={deactivateOpen} onClose={() => setDeactivateOpen(false)} labelledBy={`${ids}-deact`} className="sch-sheet">
        <div className="sch-sheet__head">
          <h2 id={`${ids}-deact`} className="sch-sheet__title">
            להשבית את {name}?
          </h2>
        </div>
        <div className="sheet-scroll" style={{ gap: 14 }}>
          <p className="sch-sub" style={{ color: 'var(--text)' }}>
            {name} לא יופיע/תופיע יותר ברשימות השיבוץ ולא יוכל/תוכל להתחבר. משמרות שעברו, בקשות והזמנות <strong>נשמרים</strong>.
          </p>
          {(detail?.futureShifts ?? 0) > 0 ? (
            <div className="sch-block">
              <Notice tone="warn">
                {name} משובץ/ת עדיין ב-{detail!.futureShifts} משמרות עתידיות. מה לעשות איתן?
              </Notice>
              <div role="radiogroup" aria-label="משמרות עתידיות" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button type="button" role="radio" aria-checked={removeFuture} className="sch-pick press" onClick={() => setRemoveFuture(true)}>
                  <span className="sch-pick__main">
                    <span className="sch-pick__name">להסיר אותו/ה מכל המשמרות העתידיות</span>
                    <span className="sch-pick__hint">המשמרות יישארו בלוח בלי שיבוץ, כדי שתמצאו מישהו אחר. מומלץ.</span>
                  </span>
                  <span className="sch-check" aria-hidden="true">{removeFuture && '✓'}</span>
                </button>
                <button type="button" role="radio" aria-checked={!removeFuture} className="sch-pick press" onClick={() => setRemoveFuture(false)}>
                  <span className="sch-pick__main">
                    <span className="sch-pick__name">להשאיר אותו/ה במשמרות</span>
                    <span className="sch-pick__hint">הלוח יסמן אותן כבעיה עד שתטפלו בהן.</span>
                  </span>
                  <span className="sch-check" aria-hidden="true">{!removeFuture && '✓'}</span>
                </button>
              </div>
            </div>
          ) : (
            <p className="sch-sub">אין לו/ה משמרות עתידיות.</p>
          )}
        </div>
        <div className="sch-sheet__foot">
          <button type="button" className="sch-btn press" style={{ flex: 1 }} onClick={() => setDeactivateOpen(false)}>
            ביטול
          </button>
          <button type="button" className="sch-btn sch-btn--danger press" style={{ flex: 2 }} disabled={busyDanger} onClick={deactivate}>
            {busyDanger ? 'משבית…' : 'השבתה'}
          </button>
        </div>
      </SheetShell>

      <ConfirmSheet
        request={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          c?.onYes()
        }}
      />
    </>
  )
}

/** Only the digits (and a leading +) matter when asking "did the phone change?". */
const digitsOf = (s: string) => s.replace(/[^\d+]/g, '')
