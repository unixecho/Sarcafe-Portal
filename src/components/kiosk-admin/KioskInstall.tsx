'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from 'glisse'
import { CheckCircle2, ChevronLeft, Download, QrCode, ShieldCheck, Tablet, Wifi } from 'lucide-react'
import QRCode from 'qrcode'
import Seg from '@/components/glass/Seg'
import Pill from '@/components/glass/Pill'
import { glassToast } from '@/components/glass/toast'
import { pinProblem } from '@/lib/kiosk/remote-rules'
import { DEVICE_SLUG_PATTERN } from '@/lib/kiosk/device-settings'
import type { OwnerBranch } from '@/lib/kiosk/device'

// The kiosk install wizard (owner, 2026-11-06: "an install wizard and a private internal link I can use to install the kiosk on any
// tablet"). Owner only (/owner/kiosk/install). Three steps: which branch and what the tablet is called, the staff PIN (and Wi-Fi if
// wanted), then a one-time QR that a factory-reset tablet scans on its welcome screen. The QR holds a code good for 24 hours, once;
// it is shown here only and never stored (the portal keeps its hash). docs/SARCAFE_KIOSK_INSTALL.md.

type Recent = { id: string; slug: string | null; name: string | null; createdAt: string; expiresAt: string; usedAt: string | null }
type Status = { ready: boolean; app: { version: string; qr: boolean } | null; recent: Recent[] }
type Made = { qr: string; image: string; expiresAt: string; slug: string; name: string; app: string; madeAt: number }

const nextSlug = (branch: string, taken: string[]) => {
  for (let n = 1; n < 100; n++) { const s = `${branch}-${n}`; if (!taken.includes(s)) return s }
  return `${branch}-${Date.now() % 1000}`
}
const when = (iso: string) => new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' }).format(new Date(iso))

export default function KioskInstall({ branches, takenSlugs, apkFile }: { branches: OwnerBranch[]; takenSlugs: string[]; apkFile: string | null }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '')
  const branch = branches.find((b) => b.id === branchId)
  const [name, setName] = useState(branch ? `קיוסק ${branch.name}` : '')
  const [slug, setSlug] = useState(branch ? nextSlug(branch.slug, takenSlugs) : '')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [wifiOn, setWifiOn] = useState(false)
  const [ssid, setSsid] = useState('')
  const [wifiPass, setWifiPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<Made | null>(null)
  const [status, setStatus] = useState<Status | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/owner/kiosk/install', { cache: 'no-store' })
      if (res.ok) setStatus(await res.json())
    } catch { /* the page keeps what it showed */ }
  }, [])
  useEffect(() => { void load() }, [load])
  // while a QR is on screen, watch for the tablet to use it
  useEffect(() => {
    if (!made) return
    const t = setInterval(() => { void load() }, 5000)
    return () => clearInterval(t)
  }, [made, load])

  const pick = (id: string) => {
    setBranchId(id)
    const b = branches.find((x) => x.id === id)
    if (b) { setName(`קיוסק ${b.name}`); setSlug(nextSlug(b.slug, takenSlugs)) }
  }

  const pinError = pin ? pinProblem(pin) : null
  const slugOk = DEVICE_SLUG_PATTERN.test(slug)
  const canQr = !!status?.app?.qr && status.ready
  const ready = canQr && !!branchId && name.trim().length >= 2 && slugOk && !pinError && pin.length > 0 && pin === confirm && (!wifiOn || ssid.trim().length > 0)
  const used = useMemo(() => (made ? status?.recent.find((r) => r.slug === made.slug && r.usedAt && Date.parse(r.usedAt) >= made.madeAt - 60_000) : null), [made, status])

  async function create() {
    if (!ready || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/owner/kiosk/install', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, slug, name: name.trim(), pin, confirm, ...(wifiOn ? { wifi: { ssid: ssid.trim(), password: wifiPass || undefined, security: wifiPass ? 'WPA' : 'NONE' } } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { glassToast(data?.error?.message || 'לא הצלחנו ליצור קוד התקנה.', 'bad'); return }
      const image = await QRCode.toDataURL(data.qr, { errorCorrectionLevel: 'M', margin: 2, width: 420 })
      setMade({ qr: data.qr, image, expiresAt: data.expiresAt, slug, name: name.trim(), app: data.app, madeAt: Date.now() })
      setPin(''); setConfirm(''); setWifiPass('')
      glassToast('קוד ההתקנה מוכן.', 'ok')
      void load()
    } catch {
      glassToast('אין חיבור. נסו שוב.', 'bad')
    } finally { setBusy(false) }
  }

  if (made) {
    return (
      <div className="ki" data-kiosk-install="qr">
        <section className="gl-surf gl-card ki-qr">
          <h2 className="gl-card__title"><QrCode size={17} aria-hidden="true" />סורקים בטאבלט: {made.name}</h2>
          {used
            ? <p className="gl-summary gl-tone-ok" data-installed><CheckCircle2 size={16} aria-hidden="true" /> הטאבלט הותקן והתחבר לסניף ({when(used.usedAt!)}). אפשר לנהל אותו בלוח הקיוסק.</p>
            : <img className="ki-qr__img" src={made.image} alt="קוד QR להתקנת הקיוסק" width={420} height={420} />}
          <p className="gl-note">קוד חד־פעמי, בתוקף עד {when(made.expiresAt)}. אחרי סריקה אחת הוא לא עובד יותר. אל תשתפו צילום שלו.</p>
          <ol className="ki-steps">
            <li><b>איפוס יצרן</b> לטאבלט (הגדרות ← מערכת ← איפוס ← מחיקת כל הנתונים). טאבלט חדש מהקופסה כבר מוכן.</li>
            <li>במסך הפתיחה (״ברוכים הבאים״) <b>מקישים 6 פעמים</b> באותו מקום, עד שנפתח סורק QR.</li>
            <li>מתחברים ל־Wi‑Fi אם הטאבלט מבקש{wifiOn ? ' (ה־QR כבר כולל את הרשת)' : ''}, וסורקים את הקוד.</li>
            <li>הטאבלט מוריד את הקיוסק ({made.app}), נכנס למצב קיוסק נעול ומתחבר ל{branch?.name ?? 'סניף'} לבד. 3–5 דקות.</li>
            <li>בודקים: 5 הקשות בפינה השמאלית העליונה ואז הקוד שבחרתם.</li>
          </ol>
          <div className="ki-actions">
            <Button variant="filled" onClick={() => setMade(null)}>התקנה של טאבלט נוסף</Button>
            <Link className="gl-chip gl-chip--soft" href="/owner/kiosk/control">ללוח הקיוסק</Link>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="ki" data-kiosk-install="form">
      <section className="gl-surf gl-card">
        <h2 className="gl-card__title"><Tablet size={17} aria-hidden="true" />התקנת הקיוסק על טאבלט</h2>
        <p className="gl-note">בלי מחשב ובלי כבל: ממלאים כאן, ובטאבלט שאופס סורקים QR. הטאבלט מוריד את האפליקציה, ננעל במצב קיוסק ומתחבר לסניף לבד. אחרי זה כל העדכונים מגיעים לבד ברשת.</p>
        {!status ? <div className="sk gl-sk-line" aria-hidden="true" />
          : !status.ready ? <p className="gl-summary gl-tone-bad">צריך להחיל קודם את עדכון מסד הנתונים של אשף ההתקנה (20261106140000).</p>
          : !status.app?.qr ? <p className="gl-summary gl-tone-bad">הגרסה הבאה של האפליקציה (שנבנית ב־GitHub) תאפשר התקנה ב־QR. היא נבנית עם השינוי הבא בקיוסק.</p>
          : <p className="gl-summary gl-tone-ok"><ShieldCheck size={16} aria-hidden="true" /> מוכן להתקנה: אפליקציה {status.app.version}, חתומה.</p>}
      </section>

      <section className="gl-surf gl-card ki-form">
        <h3 className="gl-card__title">1 · לאיזה סניף ואיך קוראים לטאבלט</h3>
        {branches.length > 1 && <Seg label="סניף" value={branchId} onChange={pick} items={branches.map((b) => ({ value: b.id, label: b.name }))} fill />}
        <label className="gl-field"><span className="gl-field__label">שם הטאבלט (מופיע בלוח הקיוסק)</span>
          <input className="ki-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>
        <label className="gl-field"><span className="gl-field__label">מזהה (אותיות קטנות באנגלית, ספרות ומקף). מזהה של טאבלט קיים = התקנה מחדש שלו</span>
          <input className="ki-input ki-input--ltr" dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={40} aria-invalid={!slugOk} /></label>
        {takenSlugs.includes(slug) && <p className="gl-note">טאבלט בשם הזה כבר קיים: הוא יותקן מחדש ויקבל את ההגדרות שלו.</p>}
      </section>

      <section className="gl-surf gl-card ki-form">
        <h3 className="gl-card__title">2 · קוד הצוות של הטאבלט</h3>
        <label className="gl-field"><span className="gl-field__label">קוד חדש (6 עד 8 ספרות)</span>
          <input className="ki-input ki-input--pin" dir="ltr" inputMode="numeric" autoComplete="new-password" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
        {pinError && <p className="gl-summary gl-tone-bad">{pinError}</p>}
        <label className="gl-field"><span className="gl-field__label">שוב, לאישור</span>
          <input className="ki-input ki-input--pin" dir="ltr" inputMode="numeric" autoComplete="new-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
        {confirm && pin !== confirm && <p className="gl-summary gl-tone-bad">שני הקודים לא זהים.</p>}
        <p className="gl-note">הקוד לא נשמר בשום מקום: רק ״טביעה״ שלו, שהטאבלט מקבל פעם אחת.</p>
      </section>

      <section className="gl-surf gl-card ki-form">
        <h3 className="gl-card__title"><Wifi size={16} aria-hidden="true" />3 · רשת (לא חובה)</h3>
        <label className="ki-check"><input type="checkbox" checked={wifiOn} onChange={(e) => setWifiOn(e.target.checked)} /> להכניס את רשת ה־Wi‑Fi לקוד, כדי שהטאבלט יתחבר לבד</label>
        {wifiOn && <>
          <label className="gl-field"><span className="gl-field__label">שם הרשת</span><input className="ki-input ki-input--ltr" dir="ltr" value={ssid} onChange={(e) => setSsid(e.target.value)} maxLength={32} /></label>
          <label className="gl-field"><span className="gl-field__label">סיסמה (ריק לרשת פתוחה). נמצאת רק בתוך ה־QR, לא נשמרת</span><input className="ki-input ki-input--ltr" dir="ltr" type="password" value={wifiPass} onChange={(e) => setWifiPass(e.target.value)} maxLength={63} /></label>
        </>}
      </section>

      <div className="ki-actions">
        <Button variant="filled" onClick={() => { void create() }} disabled={!ready || busy}>{busy ? 'יוצר…' : 'יצירת קוד QR להתקנה'}</Button>
        {apkFile && <a className="gl-chip gl-chip--soft" href={`/kiosk-ota/apk/${apkFile}`} download><Download size={16} aria-hidden="true" />הורדת האפליקציה (התקנה ידנית)</a>}
      </div>

      {status && status.recent.length > 0 && (
        <section className="gl-surf gl-card">
          <h3 className="gl-card__title">התקנות אחרונות</h3>
          <ul className="ki-recent">
            {status.recent.map((r) => (
              <li key={r.id}><span>{r.name ?? r.slug ?? 'טאבלט'}</span>
                {r.usedAt ? <Pill tone="ok">הותקן {when(r.usedAt)}</Pill> : Date.parse(r.expiresAt) < Date.now() ? <Pill tone="quiet">פג תוקף</Pill> : <Pill>ממתין לסריקה</Pill>}</li>
            ))}
          </ul>
          <Link className="gl-row-card" href="/owner/kiosk/control"><span className="gl-row-card__copy"><strong>ללוח הקיוסק</strong></span><ChevronLeft size={18} className="gl-chev" aria-hidden="true" /></Link>
        </section>
      )}
    </div>
  )
}
