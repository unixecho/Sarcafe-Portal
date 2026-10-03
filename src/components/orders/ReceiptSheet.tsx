'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import QRCode from 'qrcode'
import { Printer } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { haptic } from '@/lib/haptics'
import type { OrderAccess } from '@/lib/orders/types'

export type ReceiptLine = { label: string; qty: number; unitPrice: number }
export type ReceiptData = { orderNumber: number; access: OrderAccess; lines: ReceiptLine[]; total: number }

/** Renders and (optionally) prints an order's QR + written recovery
 *  code. This is the ONLY moment either secret is ever on screen — see
 *  migration 018's header: only their hashes are stored, so there is no
 *  "view again later" for THIS pair. A lost/failed print reissues a
 *  fresh pair via the 'regenerateAccess' action instead (OrderCard's
 *  reprint button), which is a rotation, not a re-reveal. */
export default function ReceiptSheet({
  open,
  onClose,
  orderNumber,
  access,
  lines,
  total,
}: {
  open: boolean
  onClose: () => void
  orderNumber: number | null
  access: OrderAccess | null
  lines: ReceiptLine[]
  total: number
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const titleId = 'receipt-title'

  useEffect(() => {
    if (!open || !access || typeof window === 'undefined') {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    const url = `${window.location.origin}/order/${access.token}`
    QRCode.toDataURL(url, { width: 320, margin: 1, color: { dark: '#150f0c', light: '#ffffff' } })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, access])

  function print() {
    if (!access || orderNumber === null) return
    haptic('select')
    // Opened synchronously inside this click handler (the QR data URL is
    // already sitting in state from the effect above) — Safari and other
    // popup blockers only allow window.open() as a direct result of a
    // user gesture, so nothing here may `await` before calling it.
    const win = window.open('', '_blank')
    if (!win) return
    win.document.open()
    win.document.write(buildReceiptHtml({ orderNumber, access, lines, total, qrDataUrl }))
    win.document.close()
  }

  if (!access || orderNumber === null) return null

  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId}>
      <h2 id={titleId} style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 800 }}>
        קבלה — הזמנה #{orderNumber}
      </h2>
      <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
        תנו את הקוד ללקוח (או תנו לו לסרוק את ה-QR) כדי שיוכל לעקוב אחרי ההזמנה.
      </p>

      <div className="sheet-scroll" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingTop: 6 }}>
        <div style={qrWrapStyle}>
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a locally generated data: URL, not a remote image Next's optimizer can process.
            <img src={qrDataUrl} alt="QR למעקב אחרי ההזמנה" width={200} height={200} style={{ display: 'block' }} />
          ) : (
            <div style={{ width: 200, height: 200, display: 'grid', placeItems: 'center', color: '#150f0c', fontSize: '0.8rem' }}>טוען QR…</div>
          )}
        </div>

        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--text-faint)' }}>קוד שחזור</p>
          <p style={{ margin: 0, fontSize: '2.2rem', fontWeight: 800, letterSpacing: '0.15em', fontVariantNumeric: 'tabular-nums', direction: 'ltr' }}>
            {access.recoveryCode}
          </p>
        </div>

        <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-faint)', textAlign: 'center' }}>
          בתוקף ל-{Math.round((new Date(access.expiresAt).getTime() - Date.now()) / 3_600_000)} שעות
        </p>
      </div>

      <div style={{ paddingTop: 16, display: 'flex', gap: 8 }}>
        <button type="button" className="press" onClick={onClose} style={secondaryBtnStyle}>
          סגירה
        </button>
        <button type="button" className="press" onClick={print} style={primaryBtnStyle}>
          <Printer size={16} aria-hidden="true" /> הדפסת קבלה
        </button>
      </div>
    </SheetShell>
  )
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function buildReceiptHtml({
  orderNumber,
  access,
  lines,
  total,
  qrDataUrl,
}: {
  orderNumber: number
  access: OrderAccess
  lines: ReceiptLine[]
  total: number
  qrDataUrl: string | null
}): string {
  const rows = lines
    .map(
      (line) =>
        `<tr><td class="qty">${line.qty}×</td><td class="label">${escapeHtml(line.label)}</td><td class="price">${(line.qty * line.unitPrice).toFixed(2)}</td></tr>`
    )
    .join('')

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>קבלה #${orderNumber}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; color: #150f0c; background: #fff; margin: 0; padding: 24px; }
  .receipt { max-width: 320px; margin: 0 auto; }
  h1 { font-size: 1.4rem; margin: 0 0 2px; text-align: center; }
  .sub { text-align: center; color: #666; font-size: 0.8rem; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-bottom: 12px; }
  td { padding: 4px 2px; border-bottom: 1px dashed #ccc; }
  td.qty { width: 30px; font-weight: 700; }
  td.price { width: 60px; text-align: left; direction: ltr; }
  .total { display: flex; justify-content: space-between; font-weight: 800; font-size: 1.05rem; border-top: 2px solid #150f0c; padding-top: 8px; margin-bottom: 20px; }
  .qr { display: flex; justify-content: center; margin-bottom: 12px; }
  .code-label { text-align: center; font-size: 0.75rem; color: #666; margin: 0 0 2px; }
  .code { text-align: center; font-size: 2rem; font-weight: 800; letter-spacing: 0.15em; direction: ltr; margin: 0 0 16px; }
  .footer { text-align: center; font-size: 0.72rem; color: #777; margin-top: 8px; }
  .print-btn { display: block; width: 100%; margin: 16px 0; padding: 10px; font-size: 0.95rem; border-radius: 8px; border: 1px solid #150f0c; background: #fff; cursor: pointer; }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>
  <div class="receipt">
    <h1>SarCafe</h1>
    <p class="sub">הזמנה #${orderNumber}</p>
    <table>${rows}</table>
    <div class="total"><span>סה״כ</span><span>${total.toFixed(2)} ₪</span></div>
    ${qrDataUrl ? `<div class="qr"><img src="${qrDataUrl}" width="200" height="200" alt="QR"></div>` : ''}
    <p class="code-label">קוד שחזור למעקב אחרי ההזמנה</p>
    <p class="code">${escapeHtml(access.recoveryCode)}</p>
    <p class="footer">סרקו את הקוד או היכנסו לאתר עם קוד השחזור כדי לעקוב אחרי ההזמנה ולקבל התראה כשהיא מוכנה.</p>
    <button class="print-btn" onclick="window.print()">הדפסה</button>
  </div>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 200); };</script>
</body>
</html>`
}

const qrWrapStyle: CSSProperties = { background: '#fff', padding: 10, borderRadius: 12, width: 220, height: 220, display: 'grid', placeItems: 'center' }

const primaryBtnStyle: CSSProperties = {
  flex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontSize: '0.92rem',
  fontWeight: 800,
  cursor: 'pointer',
}
const secondaryBtnStyle: CSSProperties = {
  flex: 1,
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontSize: '0.92rem',
  fontWeight: 700,
  cursor: 'pointer',
}
