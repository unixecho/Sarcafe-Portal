import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { PIN_RECORD } from '@/lib/kiosk/remote-rules'

// The tablet's staff PIN record, made on the server (POST /api/owner/kiosk/devices/actions) exactly as the app makes it
// (StaffPin.java): PBKDF2-HMAC-SHA1, 15000 iterations, a 16-byte random salt, a 32-byte hash. Only the record is stored, never the
// PIN. Server only (node:crypto): the dashboard screen uses remote-rules.ts. docs/SARCAFE_KIOSK_REMOTE.md.
export const PIN_ITERATIONS = 15000

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
