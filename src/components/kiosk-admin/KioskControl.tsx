'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button, Switch } from 'glisse'
import { BatteryCharging, BatteryMedium, ChevronLeft, KeyRound, ListChecks, Megaphone, Package, QrCode, RefreshCw, RotateCw, Tablet, Users, Wifi, WifiOff } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import Seg from '@/components/glass/Seg'
import Pill from '@/components/glass/Pill'
import { glassToast } from '@/components/glass/toast'
import { crossRuleError, effective, mergeStored, SETTINGS_SPEC, type KioskDeviceSettings, type SettingsPatch, type SettingsSparse } from '@/lib/kiosk/device-settings'
import { COMMAND_LABELS, pinProblem, type KioskCommandKind } from '@/lib/kiosk/remote-rules'
import { LANG_NAMES, SETTINGS_UI, type SettingUi } from '@/lib/kiosk/settings-ui'
import type { OwnerBranch, OwnerDevice } from '@/lib/kiosk/device'
import type { RemoteState } from '@/lib/kiosk/remote'

// The kiosk dashboard (owner, 2026-11-05: "I want the kiosk to be manageable from the dashboard … access to the kiosk control panel as
// well … reset the kiosk pin"): each tablet's state, the remote actions, and EVERY setting its own control panel has, with one Save.
// Settings reach the tablet with its next report (≤ 5 minutes) and a command with the one after; a new PIN with its next update
// check, once it runs app 0.4. docs/SARCAFE_KIOSK_REMOTE.md.

const ONLINE_MS = 7 * 60_000
type Props = { initialDevices: OwnerDevice[] | null; branches: OwnerBranch[]; initialRemote: RemoteState }

const ago = (iso: string | null) => {
  if (!iso) return 'עוד לא דיווח'
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (min < 1) return 'עכשיו'
  if (min < 60) return `לפני ${min} דק׳`
  const h = Math.round(min / 60)
  return h < 48 ? `לפני ${h} שע׳` : `לפני ${Math.round(h / 24)} ימים`
}
const appName = (code: number | null) => (code == null ? 'לא ידוע' : `0.${code}`)

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return { ok: res.ok, status: res.status, json }
  } catch {
    return { ok: false, status: 0, json: null }
  }
}
const messageOf = (json: Record<string, unknown> | null, fallback: string) => {
  const e = json?.error as { message?: unknown } | undefined
  return typeof e?.message === 'string' ? e.message : fallback
}

export default function KioskControl({ initialDevices, branches, initialRemote }: Props) {
  const [devices, setDevices] = useState(initialDevices)
  const [remote, setRemote] = useState(initialRemote)
  const [slug, setSlug] = useState(initialDevices?.[0]?.slug ?? '')
  const [patch, setPatch] = useState<SettingsPatch>({})
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [pinOpen, setPinOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')

  const device = devices?.find((d) => d.slug === slug) ?? null
  const merged: SettingsSparse = useMemo(() => (device ? mergeStored(device.stored, patch) : {}), [device, patch])
  const values: KioskDeviceSettings | null = useMemo(() => (device ? effective(merged) : null), [device, merged])
  const dirty = Object.values(patch).some((section) => section && Object.keys(section).length > 0)
  const rule = dirty ? crossRuleError(merged) : null
  const state = device ? remote.bySlug[device.slug] : undefined

  // the state on screen follows the tablet: every minute, and when the page comes back to the front
  const reload = useCallback(async () => {
    const [d, r] = await Promise.all([call('/api/owner/kiosk/devices'), call('/api/owner/kiosk/devices/actions')])
    if (d.ok && d.json) setDevices((d.json.devices as OwnerDevice[] | null) ?? null)
    if (r.ok && r.json?.remote) setRemote(r.json.remote as RemoteState)
  }, [])
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void reload() }, 60_000)
    return () => window.clearInterval(t)
  }, [reload])

  function set<S extends keyof KioskDeviceSettings>(section: S, key: keyof KioskDeviceSettings[S], value: unknown) {
    setPatch((p) => ({ ...p, [section]: { ...(p[section] ?? {}), [key]: value } }))
  }

  async function save() {
    if (!device || !dirty || rule) return
    setSaving(true)
    const res = await call('/api/owner/kiosk/devices', { method: 'PATCH', body: JSON.stringify({ slug: device.slug, settings: patch }) })
    setSaving(false)
    if (!res.ok) { glassToast(messageOf(res.json, 'השמירה לא הצליחה. נסו שוב.'), 'bad'); return }
    setDevices((res.json?.devices as OwnerDevice[] | null) ?? devices)
    setPatch({})
    glassToast('נשמר. הטאבלט יקבל את השינוי בדיווח הבא שלו (עד 5 דקות).', 'ok')
  }

  async function act(body: Record<string, unknown>, ok: string) {
    if (!device) return false
    setBusy(String(body.action))
    const res = await call('/api/owner/kiosk/devices/actions', { method: 'POST', body: JSON.stringify({ slug: device.slug, ...body }) })
    setBusy(null)
    if (!res.ok) { glassToast(messageOf(res.json, 'הפעולה לא הצליחה. נסו שוב.'), 'bad'); return false }
    if (res.json?.remote) setRemote(res.json.remote as RemoteState)
    glassToast(ok, 'ok')
    return true
  }

  async function submitPin() {
    const problem = pinProblem(pin) ?? (pin !== confirm ? 'שני הקודים לא זהים.' : null)
    if (problem) { glassToast(problem, 'bad'); return }
    if (await act({ action: 'pin', pin, confirm }, 'הקוד החדש נשמר. הטאבלט יחליף אותו בבדיקת העדכונים הבאה (עד 10 דקות).')) {
      setPin(''); setConfirm(''); setPinOpen(false)
    }
  }

  if (!devices) {
    return <section className="gl-surf gl-card"><h2 className="gl-card__title"><Tablet size={17} aria-hidden="true" />הטאבלטים</h2><p className="gl-note">עדכון מסד הנתונים של הטאבלטים עדיין לא הוחל.</p></section>
  }
  if (!device || !values) {
    return <section className="gl-surf gl-card"><h2 className="gl-card__title"><Tablet size={17} aria-hidden="true" />אין עדיין טאבלט</h2><p className="gl-note">מוסיפים טאבלט בעמוד תוכן הקיוסק.</p><Link className="gl-chip gl-chip--soft" href="/owner/kiosk">לתוכן הקיוסק</Link></section>
  }

  const online = !!device.lastSeenAt && Date.now() - Date.parse(device.lastSeenAt) < ONLINE_MS
  const level = device.batteryLevel
  const tone = level == null ? '' : level <= 15 ? 'bad' : level <= 40 ? 'warn' : 'ok'
  const needsApp = (device.appVersion ?? 0) < 4
  const branchName = branches.find((b) => b.id === device.branchId)?.name ?? device.branchName

  return (
    <div className="kc" data-kiosk-control="">
      {devices.length > 1 && <Seg fill label="טאבלט" value={slug} onChange={(v) => { setSlug(v); setPatch({}) }} items={devices.map((d) => ({ value: d.slug, label: d.name }))} />}

      <section className={`gl-surf kc-hero${online ? ' kc-hero--ok' : ' kc-hero--bad'}`} aria-labelledby="kc-name">
        <div className="kc-hero__copy">
          <p className="kc-eyebrow">{branchName} · {device.active ? 'פעיל' : 'כבוי'}</p>
          <h2 id="kc-name">{device.name}</h2>
          <p className="kc-line">{online ? <Wifi size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}{online ? 'מחובר' : 'לא מחובר'} · נראה {ago(device.lastSeenAt)}</p>
          <div className="gl-wrap">
            <Pill tone={online ? 'ok' : 'bad'}>{online ? 'מחובר' : 'לא מחובר'}</Pill>
            <Pill tone="quiet">אפליקציה {appName(device.appVersion)}</Pill>
            {device.webVersion && <Pill tone="quiet">דף {device.webVersion.slice(0, 7)}</Pill>}
          </div>
        </div>
        <BatteryRing level={level} charging={device.batteryCharging === true} tone={tone} />
      </section>

      <section className="gl-surf gl-card" aria-labelledby="kc-actions">
        <h2 className="gl-card__title" id="kc-actions"><RotateCw size={17} aria-hidden="true" />פעולות מרחוק</h2>
        {!remote.ready && <p className="gl-note gl-note--bad">עדכון מסד הנתונים של שליטה מרחוק עדיין לא הוחל: הפעולות יופעלו אחריו.</p>}
        <div className="gl-wrap">
          {(['reload', 'check_updates'] as KioskCommandKind[]).map((kind) => (
            <Button key={kind} icon={kind === 'reload' ? <RefreshCw size={16} /> : <RotateCw size={16} />} disabled={!remote.ready || busy !== null}
              onClick={() => void act({ action: 'command', kind }, `נשלח: ${COMMAND_LABELS[kind]}. הטאבלט יבצע בדיווח הבא (עד 5 דקות).`)}>
              {COMMAND_LABELS[kind]}
            </Button>
          ))}
          <Button icon={<KeyRound size={16} />} disabled={!remote.ready || busy !== null} onClick={() => setPinOpen(true)}>איפוס קוד הצוות</Button>
        </div>
        {state?.command && (
          <p className="gl-summary" data-command-pending="">ממתין לטאבלט: {COMMAND_LABELS[state.command.kind]} (נשלח {ago(state.command.at)}) <button type="button" className="gl-chip gl-chip--soft" onClick={() => void act({ action: 'cancel_command' }, 'הפעולה בוטלה.')}>ביטול</button></p>
        )}
        {state?.pinPending && (
          <p className="gl-summary" data-pin-pending="">קוד חדש {state.pinPending.deliveredAt ? `נמסר לטאבלט ${ago(state.pinPending.deliveredAt)}, ממתין לאישור` : `נשמר ${ago(state.pinPending.createdAt)}, ממתין לטאבלט`} <button type="button" className="gl-chip gl-chip--soft" onClick={() => void act({ action: 'cancel_pin' }, 'איפוס הקוד בוטל.')}>ביטול</button></p>
        )}
        {state?.pinAppliedAt && !state.pinPending && <p className="gl-summary gl-tone-ok">הקוד הוחלף בטאבלט {ago(state.pinAppliedAt)}.</p>}
        {needsApp && <p className="gl-note">קבלת קוד מרחוק ובדיקת עדכונים מרחוק דורשות את אפליקציית הקיוסק 0.4 ומעלה (בטאבלט: {appName(device.appVersion)}). טעינת הדף מחדש עובדת עם הדף החתום הבא.</p>}
      </section>

      {(Object.keys(SETTINGS_UI) as (keyof KioskDeviceSettings)[]).map((section) => (
        <SettingsSection key={section} section={section} values={values} onChange={set} />
      ))}

      <nav className="gl-surf gl-card" aria-label="עוד בקיוסק">
        <Link className="gl-row-card" href="/owner/kiosk/install"><span className="gl-ico" aria-hidden="true"><QrCode size={20} /></span><span className="gl-row-card__copy"><strong>התקנת קיוסק על טאבלט</strong><small>קוד QR חד־פעמי: טאבלט שאופס מתקין את הקיוסק ומתחבר לסניף לבד, בלי מחשב</small></span><ChevronLeft size={18} className="gl-chev" aria-hidden="true" /></Link>
        <Link className="gl-row-card" href="/owner/tablet"><span className="gl-ico" aria-hidden="true"><Package size={20} /></span><span className="gl-row-card__copy"><strong>מלאי חי</strong><small>כריכים, מאפים ושייקים: במלאי, אזל וכמה נשארו. אותה רשימה כמו לשונית "מלאי" בקיוסק</small></span><ChevronLeft size={18} className="gl-chev" aria-hidden="true" /></Link>
        <Link className="gl-row-card" href="/owner/kiosk"><span className="gl-ico" aria-hidden="true"><Megaphone size={20} /></span><span className="gl-row-card__copy"><strong>תוכן הקיוסק</strong><small>מודעות, זמנים, ימים חריגים, שם הטאבלט והסניף שלו</small></span><ChevronLeft size={18} className="gl-chev" aria-hidden="true" /></Link>
        <Link className="gl-row-card" href="/owner/kiosk/feedback"><span className="gl-ico" aria-hidden="true"><ListChecks size={20} /></span><span className="gl-row-card__copy"><strong>תוצאות ההצבעה</strong><small>מה הלקוחות בחרו בקיוסק</small></span><ChevronLeft size={18} className="gl-chev" aria-hidden="true" /></Link>
        <Link className="gl-row-card" href="/owner/waitlist"><span className="gl-ico" aria-hidden="true"><Users size={20} /></span><span className="gl-row-card__copy"><strong>נרשמים למועדון</strong><small>מי נרשם בקיוסק, בהסכמתו</small></span><ChevronLeft size={18} className="gl-chev" aria-hidden="true" /></Link>
      </nav>

      {dirty && (
        <div className="gl-savebar" role="region" aria-label="שמירה">
          <span className={rule ? 'gl-tone-bad' : ''}>{rule ?? 'יש שינויים שלא נשמרו'}</span>
          <Button onClick={() => setPatch({})} disabled={saving}>ביטול</Button>
          <Button variant="filled" onClick={() => void save()} disabled={saving || !!rule}>{saving ? 'שומר…' : 'שמירה'}</Button>
        </div>
      )}

      <SheetShell open={pinOpen} onClose={() => setPinOpen(false)} labelledBy="kc-pin-title">
        <h2 id="kc-pin-title" className="gl-card__title"><KeyRound size={17} aria-hidden="true" />קוד צוות חדש ל{device.name}</h2>
        <p className="gl-note">6 עד 8 ספרות. הקוד לא נשמר בשום מקום: נשמר רק "טביעה" שלו, והטאבלט מקבל אותה בבדיקת העדכונים הבאה. הקוד הקודם עובד עד אז.</p>
        <form className="kc-pin" onSubmit={(e) => { e.preventDefault(); void submitPin() }}>
          <label>קוד חדש<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-describedby="kc-pin-problem" /></label>
          <label>שוב, לאישור<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} /></label>
          <p id="kc-pin-problem" className="gl-note gl-tone-bad" aria-live="polite">{pin && (pinProblem(pin) ?? (confirm && pin !== confirm ? 'שני הקודים לא זהים.' : ''))}</p>
          <Button variant="filled" type="submit" disabled={busy !== null || !pin || !confirm}>שמירת הקוד</Button>
        </form>
      </SheetShell>
    </div>
  )
}

function BatteryRing({ level, charging, tone }: { level: number | null; charging: boolean; tone: string }) {
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <div className={`kc-battery${tone ? ` kc-battery--${tone}` : ''}`} role="img" aria-label={level == null ? 'הטעינה לא ידועה' : `טעינה ${level}%${charging ? ', בטעינה' : ''}`}>
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r={r} className="kc-battery__track" />
        {level != null && <circle cx="42" cy="42" r={r} className="kc-battery__fill" strokeDasharray={`${(c * level) / 100} ${c}`} transform="rotate(-90 42 42)" />}
      </svg>
      <span className="kc-battery__num">{level == null ? '—' : `${level}%`}</span>
      <span className="kc-battery__cap">{charging ? <BatteryCharging size={14} aria-hidden="true" /> : <BatteryMedium size={14} aria-hidden="true" />}{charging ? 'בטעינה' : 'סוללה'}</span>
    </div>
  )
}

function SettingsSection<S extends keyof KioskDeviceSettings>({ section, values, onChange }: { section: S; values: KioskDeviceSettings; onChange: (s: S, k: keyof KioskDeviceSettings[S], v: unknown) => void }) {
  const meta = SETTINGS_UI[section]
  const spec = SETTINGS_SPEC[section] as Record<string, { t: string; min?: number; max?: number }>
  return (
    <section className="gl-surf gl-card kc-section" aria-labelledby={`kc-${section}`}>
      <h2 className="gl-card__title" id={`kc-${section}`}>{meta.title}</h2>
      {meta.hint && <p className="gl-note">{meta.hint}</p>}
      {(Object.entries(meta.fields) as [keyof KioskDeviceSettings[S] & string, SettingUi][]).map(([key, ui]) => {
        const value = values[section][key] as unknown
        const id = `kc-${section}-${key}`
        if (ui.kind === 'bool') return (
          <div className="kc-row" key={key}>
            <span className="kc-row__copy"><strong id={id}>{ui.label}</strong>{ui.hint && <small>{ui.hint}</small>}</span>
            <Switch aria-labelledby={id} checked={value === true} onCheckedChange={(v: boolean) => onChange(section, key, v)} />
          </div>
        )
        if (ui.kind === 'enum') return (
          <div className="kc-row kc-row--stack" key={key}>
            <span className="kc-row__copy"><strong>{ui.label}</strong>{ui.hint && <small>{ui.hint}</small>}</span>
            <Seg fill label={ui.label} value={String(value)} onChange={(v) => onChange(section, key, v)} items={ui.options.map(([v, l]) => ({ value: v, label: l }))} />
          </div>
        )
        if (ui.kind === 'langs') {
          const list = (value as string[]) ?? []
          return (
            <div className="kc-row kc-row--stack" key={key}>
              <span className="kc-row__copy"><strong>{ui.label}</strong>{ui.hint && <small>{ui.hint}</small>}</span>
              <div className="gl-wrap" role="group" aria-label={ui.label}>
                {Object.entries(LANG_NAMES).map(([code, name]) => (
                  <button key={code} type="button" aria-pressed={list.includes(code)} className={`gl-chip${list.includes(code) ? ' is-on' : ''}`}
                    onClick={() => onChange(section, key, list.includes(code) ? list.filter((c) => c !== code) : [...list, code])}>{name}</button>
                ))}
              </div>
            </div>
          )
        }
        const bounds: { min?: number; max?: number } = spec[key] ?? {}
        const n = value as number | null
        const clamp = (x: number) => Math.min(bounds.max ?? x, Math.max(bounds.min ?? x, x))
        return (
          <div className="kc-row" key={key}>
            <span className="kc-row__copy"><strong id={id}>{ui.label}</strong><small>{n == null ? ui.nullable : `${n} ${ui.unit}`}{ui.hint ? ` · ${ui.hint}` : ''}</small></span>
            <span className="kc-stepper" role="group" aria-labelledby={id}>
              <button type="button" className="gl-chip gl-chip--soft" aria-label="פחות" onClick={() => onChange(section, key, clamp((n ?? bounds.min ?? 0) - ui.step))}>−</button>
              <b className="ltr-isolate">{n == null ? '—' : n}</b>
              <button type="button" className="gl-chip gl-chip--soft" aria-label="יותר" onClick={() => onChange(section, key, clamp((n ?? bounds.min ?? 0) + ui.step))}>+</button>
              {ui.nullable && n != null && <button type="button" className="gl-chip gl-chip--soft" onClick={() => onChange(section, key, null)}>{ui.nullable}</button>}
            </span>
          </div>
        )
      })}
    </section>
  )
}
