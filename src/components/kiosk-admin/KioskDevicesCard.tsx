'use client'

import { useState, type CSSProperties } from 'react'
import Switch from '@/components/Switch'
import { DEVICE_SLUG_PATTERN, effective, type SettingsSparse } from '@/lib/kiosk/device-settings'
import type { OwnerBranch, OwnerDevice } from '@/lib/kiosk/device'

// The kiosk tablets: which ones exist, which branch each belongs to, whether it is on, and what it last said about itself
// (seen, battery, versions). The settings a tablet's control panel changes live on the tablet (5 taps in the top-left corner,
// then the staff PIN); the battery alert is repeated here because the owner decides who is told and when. One draft and one
// Save per tablet (the owner's rule for settings: nothing is sent while a control is being touched).

type Props = { initial: { devices: OwnerDevice[] | null; branches: OwnerBranch[] } }

function ago(iso: string | null): string {
  if (!iso) return 'עוד לא דיווח'
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (seconds < 90) return 'לפני רגע'
  if (seconds < 3600) return `לפני ${Math.round(seconds / 60)} דק׳`
  if (seconds < 86400) return `לפני ${Math.round(seconds / 3600)} שע׳`
  return `לפני ${Math.round(seconds / 86400)} ימים`
}

/** Stale = no report for 20 minutes (the tablet reports every 5 while its screen is on). */
const isQuiet = (iso: string | null) => !iso || Date.now() - Date.parse(iso) > 20 * 60 * 1000

export default function KioskDevicesCard({ initial }: Props) {
  const [data, setData] = useState(initial)
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  async function call(method: 'POST' | 'PATCH', body: Record<string, unknown>): Promise<boolean> {
    setNotice(null)
    try {
      const res = await fetch('/api/owner/kiosk/devices', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setNotice({ type: 'error', text: json?.error?.message ?? 'השמירה נכשלה.' })
        return false
      }
      setData(json)
      setNotice({ type: 'ok', text: 'נשמר.' })
      return true
    } catch {
      setNotice({ type: 'error', text: 'אין חיבור. נסו שוב.' })
      return false
    }
  }

  if (data.devices === null) {
    return (
      <section style={wrap} aria-labelledby="kiosk-devices-title">
        <h2 id="kiosk-devices-title" style={heading}>הטאבלטים</h2>
        <p role="status" style={hint}>
          עדכון מסד הנתונים של הטאבלטים (supabase/migrations/20261104120000_kiosk_devices.sql) עדיין לא הוחל, ולכן אין עדיין מעקב אחרי הטאבלט ולא התראת סוללה.
        </p>
      </section>
    )
  }

  return (
    <section style={wrap} aria-labelledby="kiosk-devices-title">
      <div>
        <h2 id="kiosk-devices-title" style={heading}>הטאבלטים</h2>
        <p style={hint}>
          כל טאבלט שייך לסניף אחד. ההגדרות המלאות שלו נמצאות בלוח הבקרה בטאבלט עצמו: 5 נגיעות בפינה השמאלית העליונה, ואז קוד הצוות.
        </p>
      </div>
      {data.devices.map((device) => (
        <DeviceItem key={`${device.id}:${device.settingsUpdatedAt}:${device.name}:${device.branchId}:${device.active}`} device={device} branches={data.branches} onSave={(body) => call('PATCH', { slug: device.slug, ...body })} />
      ))}
      <AddDevice branches={data.branches} onAdd={(body) => call('POST', body)} />
      {notice && (
        <p role={notice.type === 'error' ? 'alert' : 'status'} style={{ margin: 0, fontSize: '0.82rem', color: notice.type === 'error' ? 'var(--danger)' : 'var(--ok)' }}>{notice.text}</p>
      )}
    </section>
  )
}

function DeviceItem({ device, branches, onSave }: { device: OwnerDevice; branches: OwnerBranch[]; onSave: (body: Record<string, unknown>) => Promise<boolean> }) {
  const settings = effective(device.stored as SettingsSparse)
  const [name, setName] = useState(device.name)
  const [branchId, setBranchId] = useState(device.branchId)
  const [active, setActive] = useState(device.active)
  const [alertOn, setAlertOn] = useState(settings.battery.alertEnabled)
  const [alertAt, setAlertAt] = useState(settings.battery.alertPercent)
  const [saving, setSaving] = useState(false)

  const dirty = name.trim() !== device.name || branchId !== device.branchId || active !== device.active
    || alertOn !== settings.battery.alertEnabled || alertAt !== settings.battery.alertPercent
  const valid = name.trim().length > 0 && name.trim().length <= 60 && Number.isInteger(alertAt) && alertAt >= 10 && alertAt <= 90
    && alertAt > settings.battery.criticalPercent

  async function save() {
    setSaving(true)
    const body: Record<string, unknown> = {}
    if (name.trim() !== device.name) body.name = name.trim()
    if (branchId !== device.branchId) body.branchId = branchId
    if (active !== device.active) body.active = active
    if (alertOn !== settings.battery.alertEnabled || alertAt !== settings.battery.alertPercent) {
      body.settings = { battery: { alertEnabled: alertOn, alertPercent: alertAt } }
    }
    await onSave(body)
    setSaving(false)
  }

  const level = device.batteryLevel
  return (
    <div style={item}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: '0.98rem', color: 'var(--text)' }}>{device.name}</strong>
          <div style={{ ...hint, direction: 'ltr', textAlign: 'right' }}>{device.slug}</div>
        </div>
        <span style={{ ...pill, color: !device.active ? 'var(--text-faint)' : isQuiet(device.lastSeenAt) ? 'var(--danger)' : 'var(--ok)' }}>
          {!device.active ? 'כבוי' : isQuiet(device.lastSeenAt) ? 'לא מדווח' : 'פעיל'}
        </span>
      </div>

      <p style={{ ...note, margin: 0 }}>
        נראה לאחרונה: {ago(device.lastSeenAt)}
        {level !== null && ` · סוללה ${level}%${device.batteryCharging === true ? ' (בטעינה)' : device.batteryCharging === false ? ' (לא בטעינה)' : ''}`}
        {device.appVersion !== null && ` · אפליקציה ${device.appVersion}`}
        {device.webVersion && ` · מסכים ${device.webVersion.slice(0, 8)}`}
      </p>

      <label style={field}>
        <span style={fieldLabel}>שם</span>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={input} />
      </label>
      <label style={field}>
        <span style={fieldLabel}>הסניף של הטאבלט</span>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={input}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>

      <Row label="הטאבלט פעיל" hint="כבוי: נשאר ברשימה, בלי עדכון הגדרות אישיות.">
        <button type="button" role="switch" aria-checked={active} aria-label="הטאבלט פעיל" onClick={() => setActive(!active)} style={switchBtn}><Switch on={active} /></button>
      </Row>
      <Row label="התראה למפתח כשהסוללה יורדת" hint="נשלחת למפתח בלבד, כשהטאבלט לא בטעינה: התראה אחת בכל ירידה של 5%, מהרמה שנקבעה כאן ועד 5%.">
        <button type="button" role="switch" aria-checked={alertOn} aria-label="התראת סוללה" onClick={() => setAlertOn(!alertOn)} style={switchBtn}><Switch on={alertOn} /></button>
      </Row>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.88rem', color: 'var(--text)' }}>להתחיל להתריע מ־(%)</span>
        <input type="number" inputMode="numeric" min={10} max={90} step={5} value={Number.isFinite(alertAt) ? alertAt : ''} disabled={!alertOn}
          onChange={(e) => setAlertAt(e.target.value === '' ? NaN : Number(e.target.value))} style={{ ...input, width: 84, textAlign: 'center', opacity: alertOn ? 1 : 0.5 }} />
      </label>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="press" disabled={!dirty || saving || !valid} onClick={save}
          style={{ ...btn, background: 'var(--neon)', color: 'var(--bg)', border: 0, fontWeight: 800, opacity: !dirty || saving || !valid ? 0.5 : 1 }}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </div>
  )
}

function AddDevice({ branches, onAdd }: { branches: OwnerBranch[]; onAdd: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const slugOk = DEVICE_SLUG_PATTERN.test(slug)

  if (!open) {
    return <button type="button" className="press" onClick={() => setOpen(true)} style={btn}>הוספת טאבלט</button>
  }
  return (
    <div style={item}>
      <strong style={{ fontSize: '0.95rem', color: 'var(--text)' }}>טאבלט חדש</strong>
      <p style={hint}>
        השם הטכני (באותיות אנגליות קטנות, ספרות ומקף) מוקלד פעם אחת בטאבלט עצמו: לוח הבקרה, אבחון, "שינוי שם המכשיר במערכת".
      </p>
      <label style={field}>
        <span style={fieldLabel}>שם טכני</span>
        <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} dir="ltr" placeholder="maor-1" maxLength={40} style={input} />
      </label>
      <label style={field}>
        <span style={fieldLabel}>שם להצגה</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} style={input} />
      </label>
      <label style={field}>
        <span style={fieldLabel}>סניף</span>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={input}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="press" onClick={() => setOpen(false)} style={btn}>ביטול</button>
        <button type="button" className="press" disabled={!slugOk || !name.trim() || !branchId || busy}
          onClick={async () => { setBusy(true); const ok = await onAdd({ slug, name: name.trim(), branchId }); setBusy(false); if (ok) { setOpen(false); setSlug(''); setName('') } }}
          style={{ ...btn, background: 'var(--neon)', color: 'var(--bg)', border: 0, fontWeight: 800, opacity: !slugOk || !name.trim() || busy ? 0.5 : 1 }}>
          {busy ? 'מוסיף…' : 'הוספה'}
        </button>
      </div>
    </div>
  )
}

function Row({ label, hint: text, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.4 }}>{label}</div>
        {text && <div style={hint}>{text}</div>}
      </div>
      {children}
    </div>
  )
}

const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }
const heading: CSSProperties = { margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)' }
const hint: CSSProperties = { margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-faint)', lineHeight: 1.5 }
const item: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 13px' }
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }
const fieldLabel: CSSProperties = { fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-dim)' }
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', minHeight: 40, padding: '8px 10px', borderRadius: 10, fontFamily: 'inherit', fontSize: '0.92rem', color: 'var(--text)', background: 'var(--bg-elev-2)', border: '1px solid var(--line-interactive)' }
const note: CSSProperties = { fontSize: '0.82rem', color: 'var(--text)', background: 'var(--bg-elev-2)', borderRadius: 10, padding: '8px 10px', lineHeight: 1.5 }
const pill: CSSProperties = { display: 'inline-flex', alignItems: 'center', fontSize: '0.74rem', fontWeight: 700, background: 'var(--bg-elev-2)', border: '1px solid var(--line)', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }
const btn: CSSProperties = { fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', background: 'var(--bg-elev-2)', border: '1px solid var(--line-strong)', borderRadius: 11, padding: '8px 12px', fontFamily: 'inherit', cursor: 'pointer', minHeight: 40 }
const switchBtn: CSSProperties = { background: 'none', border: 0, padding: 4, cursor: 'pointer', minHeight: 40, display: 'inline-flex', alignItems: 'center' }
