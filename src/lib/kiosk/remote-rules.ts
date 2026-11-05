import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { DEVICE_SLUG_PATTERN } from '@/lib/kiosk/device-settings'

// The kiosk managed from the dashboard (owner, 2026-11-05; migration 20261105223000_kiosk_remote_control): the pure rules, so the QA
// unit stage and the Java side can check them. docs/SARCAFE_KIOSK_REMOTE.md.

/** What the dashboard can ask a tablet to do at its next report (every 5 minutes). */
export const KIOSK_COMMANDS = ['reload', 'check_updates'] as const
export type KioskCommandKind = (typeof KIOSK_COMMANDS)[number]
export type KioskCommand = { id: string; kind: KioskCommandKind; at: string }

export const COMMAND_LABELS: Record<KioskCommandKind, string> = {
  reload: 'טעינה מחדש של הדף',
  check_updates: 'בדיקת עדכונים עכשיו',
}

/** The staff PIN of a tablet, exactly as the app keeps it (StaffPin.java): "pbkdf2$<iterations>$<salt hex 16 bytes>$<hash hex 32 bytes>",
 *  PBKDF2-HMAC-SHA1. The server keeps ONLY this record, never the PIN. */
export const PIN_ITERATIONS = 15000
export const PIN_RECORD = /^pbkdf2\$[0-9]{4,7}\$[0-9a-f]{32}\$[0-9a-f]{64}$/

export function pinRecord(pin: string, salt: Buffer = randomBytes(16), iterations = PIN_ITERATIONS): string {
  const hash = pbkdf2Sync(pin, salt, iterations, 32, 'sha1')
  return `pbkdf2$${iterations}$${salt.toString('hex')}$${hash.toString('hex')}`
}

/** True when `pin` matches a record (the same rule as StaffPin.verify; used by the tests, never by a route). */
export function pinMatches(record: string, pin: string): boolean {
  if (!PIN_RECORD.test(record)) return false
  const [, iterations, salt, hash] = record.split('$') as [string, string, string, string]
  const got = pbkdf2Sync(pin, Buffer.from(salt, 'hex'), Number(iterations), 32, 'sha1')
  return timingSafeEqual(got, Buffer.from(hash, 'hex'))
}

/** Why a new PIN is refused, or null. The app takes any 6–8 digits; the dashboard also refuses the ones anyone would guess. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{6,8}$/.test(pin)) return 'הקוד צריך להיות 6 עד 8 ספרות.'
  if (/^(\d)\1+$/.test(pin)) return 'קוד של ספרה אחת חוזרת קל מדי לנחש.'
  const digits = [...pin].map(Number)
  const steps = digits.slice(1).map((d, i) => (d - digits[i]! + 10) % 10)
  if (steps.every((s) => s === 1) || steps.every((s) => s === 9)) return 'רצף עולה או יורד קל מדי לנחש.'
  return null
}

const slug = z.string().regex(DEVICE_SLUG_PATTERN)

/** The dashboard's actions on one tablet (POST /api/owner/kiosk/devices/actions). */
export const remoteActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('command'), slug, kind: z.enum(KIOSK_COMMANDS) }).strict(),
  z.object({ action: z.literal('cancel_command'), slug }).strict(),
  z.object({ action: z.literal('pin'), slug, pin: z.string().max(16), confirm: z.string().max(16) }).strict(),
  z.object({ action: z.literal('cancel_pin'), slug }).strict(),
])
export type RemoteAction = z.infer<typeof remoteActionSchema>

/** What the app sends after adopting a PIN (POST /api/kiosk/device/pin). */
export const pinAckSchema = z.object({ device: slug.optional(), id: z.string().uuid() }).strict()

/** A command stored on the tablet's row, read back tolerant of anything else. */
export function readCommand(raw: unknown): KioskCommand | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.id !== 'string' || typeof c.at !== 'string' || !KIOSK_COMMANDS.includes(c.kind as KioskCommandKind)) return null
  return { id: c.id, kind: c.kind as KioskCommandKind, at: c.at }
}
