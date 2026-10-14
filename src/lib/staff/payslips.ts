import 'server-only'
import { Forbidden, Unauthorized } from '@/lib/http/errors'
import { resolveStaffIdentity } from '@/lib/staff/session'

/** Who may read payslips at all: a signed-in Google employee (their own, the route filters by person) or an owner
 *  (anyone's). A number + code session and the old PIN session never: the documents are private. */
export async function requirePayslipReader() {
  const me = await resolveStaffIdentity()
  if (!me) throw Unauthorized()
  if (me.quick || me.via !== 'google') throw Forbidden('כדי לפתוח תלוש שכר צריך להתחבר עם Google')
  return me
}

/** A Content-Disposition with a Hebrew file name that every browser reads (RFC 5987 `filename*`, plus an ASCII fallback). */
export function contentDisposition(kind: 'inline' | 'attachment', name: string, asciiFallback: string): string {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${kind}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

/** The only kinds the viewer shows inline (the upload route accepts exactly these, checked by their first bytes). */
export const VIEWABLE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg'])
export const MAX_ZIP_FILES = 100
/** Together, in bytes, as recorded when each file was uploaded (the upload cap is 4MB each). */
export const MAX_ZIP_BYTES = 32 * 1024 * 1024
