import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { ApiError, NotFound } from '@/lib/http/errors'
import { isOp } from '@/lib/staff/access'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkCredentialRateLimit } from '@/lib/rate-limit'
import { PAYSLIP_BUCKET, privateStaffRoute } from '@/lib/staff/records'
import { contentDisposition, MAX_ZIP_BYTES, MAX_ZIP_FILES, requirePayslipReader } from '@/lib/staff/payslips'
import { safeEntryName, uniqueNames, zipStream } from '@/lib/staff/zip'

// Several payslips in one download: /api/staff/payslips/zip?ids=<id>,<id>,…  (a GET, so the browser's own download
// manager takes it, which is what works on a phone). The same access rule as the single download: an employee gets
// only their own, an owner anyone's, nobody on a code session; one id that is not yours is a 404 for the whole request.
// The zip is streamed one file at a time, so a long history never sits in memory and is not held to a response-size cap.
export const GET = privateStaffRoute(async (request: NextRequest) => {
  const me = await requirePayslipReader()
  const wanted = (request.nextUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean)
  const ids = [...new Set(z.array(z.string().uuid()).min(1).max(MAX_ZIP_FILES).parse(wanted))]
  if (!(await checkCredentialRateLimit(`payslip-zip:${me.id}`, 30, 3600))) throw new ApiError(429, 'rate_limited', 'יותר מדי הורדות. נסו שוב בעוד זמן קצר.')

  const service = createServiceRoleClient()
  let query = service.from('staff_payslips').select('id, pay_month, object_path, file_name, byte_size').in('id', ids)
  if (!isOp(me)) query = query.eq('staff_id', me.id)
  const { data, error } = await query
  if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו להכין את הקובץ')
  if (!data || data.length !== ids.length) throw NotFound()
  if (data.reduce((sum, slip) => sum + Number(slip.byte_size ?? 0), 0) > MAX_ZIP_BYTES) throw new ApiError(413, 'too_large', 'נבחרו יותר מדי תלושים להורדה אחת. בחרו פחות והורידו בכמה פעמים.')

  // Oldest month first, so the folder reads like a year.
  const slips = [...data].sort((a, b) => String(a.pay_month).localeCompare(String(b.pay_month)))
  const names = uniqueNames(slips.map((slip) => safeEntryName(String(slip.file_name), `תלוש ${String(slip.pay_month).slice(0, 7)}`)))
  async function* files() {
    for (const [index, slip] of slips.entries()) {
      const downloaded = await service.storage.from(PAYSLIP_BUCKET).download(slip.object_path as string)
      if (downloaded.error || !downloaded.data) throw new Error('payslip download failed')
      yield { name: names[index]!, data: new Uint8Array(await downloaded.data.arrayBuffer()) }
    }
  }
  return new Response(zipStream(files()), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition('attachment', slips.length === 1 ? names[0]!.replace(/\.[^.]+$/, '') + '.zip' : 'תלושי שכר.zip', 'payslips.zip'),
    },
  })
})
