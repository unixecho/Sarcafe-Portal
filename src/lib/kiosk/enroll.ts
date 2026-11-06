import { z } from 'zod'
import { DEVICE_SLUG_PATTERN } from '@/lib/kiosk/device-settings'

// The kiosk install wizard (owner, 2026-11-06; migration 20261106140000_kiosk_enrollments; docs/SARCAFE_KIOSK_INSTALL.md).
// Pure rules (the dashboard screen imports this file, so no Node modules here): what the owner sends, what Android's QR setup
// reads, and what a newly installed tablet receives. The code itself is made and hashed on the server (enroll-server.ts).

export const ENROLL_HOURS = 24
export const KIOSK_PACKAGE = 'il.co.sarcafe.kiosk'
export const KIOSK_ADMIN_COMPONENT = 'il.co.sarcafe.kiosk/.KioskAdminReceiver'
/** The install code: 32 random bytes, base64url (43 characters). */
export const ENROLL_CODE = /^[A-Za-z0-9_-]{43}$/

/** The short code a fresh kiosk shows on its setup screen: 6 characters without look-alikes (no I, O, 0, 1). */
export const PAIR_CODE = /^[A-HJ-NP-Z2-9]{6}$/
export const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const PAIR_MINUTES = 15
/** The tablet's secret for its own pairing: 32 random bytes, base64url. */
export const PAIR_TOKEN = /^[A-Za-z0-9_-]{43}$/
/** "abc 234" as typed by the owner → "ABC234" (spaces and dashes dropped, upper case). */
export const normalizePairCode = (s: string) => s.replace(/[\s-]/g, '').toUpperCase()

export const installRequestSchema = z
  .object({
    branchId: z.string().uuid(),
    slug: z.string().regex(DEVICE_SLUG_PATTERN),
    name: z.string().trim().min(2).max(60),
    pin: z.string().max(16),
    confirm: z.string().max(16),
    pairCode: z.string().max(12).transform(normalizePairCode).pipe(z.string().regex(PAIR_CODE)).optional(),
    wifi: z.object({ ssid: z.string().min(1).max(32), password: z.string().max(63).optional(), security: z.enum(['WPA', 'WEP', 'NONE']).default('WPA') }).strict().optional(),
  })
  .strict()

export const enrollRequestSchema = z.object({ code: z.string().regex(ENROLL_CODE) }).strict()


/** "a1b2…" (64 hex) → URL-safe base64 of the bytes: the form Android wants for PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM. */
export function certChecksum(hex: string): string | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null
  const bytes = hex.match(/../g)!.map((b) => parseInt(b, 16))
  const b64 = typeof btoa === 'function' ? btoa(String.fromCharCode(...bytes)) : Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The JSON Android's device-owner setup reads from the QR (tap the welcome screen 6 times on a factory-reset tablet). */
export function provisioningPayload(o: { apkUrl: string; certSha256: string; code: string; portal: string; wifi?: { ssid: string; password?: string; security: 'WPA' | 'WEP' | 'NONE' } }): string {
  const checksum = certChecksum(o.certSha256)
  if (!checksum) throw new Error('bad certificate digest')
  const p: Record<string, unknown> = {
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': KIOSK_ADMIN_COMPONENT,
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': o.apkUrl,
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM': checksum,
    'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
    'android.app.extra.PROVISIONING_SKIP_ENCRYPTION': true,
    'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': { enroll: o.code, portal: o.portal },
  }
  if (o.wifi) {
    p['android.app.extra.PROVISIONING_WIFI_SSID'] = o.wifi.ssid
    p['android.app.extra.PROVISIONING_WIFI_SECURITY_TYPE'] = o.wifi.security
    if (o.wifi.password && o.wifi.security !== 'NONE') p['android.app.extra.PROVISIONING_WIFI_PASSWORD'] = o.wifi.password
  }
  return JSON.stringify(p)
}

/** What a newly installed tablet is told (POST /api/kiosk/enroll), the same settings the adb setup used to give it. */
export type EnrollConfig = {
  device: string; name: string; branch: string
  api: string; ota: string; rt: string; rtKey: string; rtChannel: string; key: string
  pinRecord: string | null
}
