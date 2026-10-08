import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError, BadRequest, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { assertSameOrigin } from '@/lib/pos/server/guard'
import { PAYSLIP_BUCKET, PAYSLIP_LIMIT, privateStaffRoute } from '@/lib/staff/records'
import { checkCredentialRateLimit } from '@/lib/rate-limit'

export const POST = privateStaffRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const owner = await requireOwner()
  assertSameOrigin(request)
  const id = z.string().uuid().parse((await params).id)
  if (!(await checkCredentialRateLimit(`payslip:${owner.id}`, 30, 3600))) throw new ApiError(429, 'rate_limited', 'יותר מדי העלאות. נסו שוב בהמשך.')
  if (Number(request.headers.get('content-length')) > PAYSLIP_LIMIT + 64 * 1024) throw BadRequest('הקובץ גדול מדי. אפשר עד 4MB.')
  const form = await request.formData()
  const month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).parse(form.get('month'))
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0 || file.size > PAYSLIP_LIMIT) throw BadRequest('בחרו קובץ PDF או תמונה עד 4MB')
  const bytes = Buffer.from(await file.arrayBuffer())
  const detected = bytes.subarray(0, 5).toString() === '%PDF-' ? { mime: 'application/pdf', ext: 'pdf' }
    : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? { mime: 'image/png', ext: 'png' }
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? { mime: 'image/jpeg', ext: 'jpg' } : null
  if (!detected) throw BadRequest('אפשר להעלות PDF, PNG או JPG בלבד')
  const service = createServiceRoleClient()
  const { data: staff, error: staffError } = await service.from('staff').select('id').eq('id', id).maybeSingle()
  if (staffError) throw new ApiError(503, 'unavailable', 'לא הצלחנו לטעון את העובד')
  if (!staff) throw NotFound()
  const documentId = randomUUID()
  const objectPath = `${id}/${month}/${documentId}.${detected.ext}`
  const uploaded = await service.storage.from(PAYSLIP_BUCKET).upload(objectPath, bytes, { contentType: detected.mime, upsert: false, cacheControl: '0' })
  if (uploaded.error) throw new ApiError(503, 'unavailable', 'הקובץ לא הועלה. נסו שוב.')
  const { error } = await service.from('staff_payslips').insert({ id: documentId, staff_id: id, pay_month: `${month}-01`, object_path: objectPath, file_name: `תלוש ${month}.${detected.ext}`, content_type: detected.mime, byte_size: bytes.length, uploaded_by: owner.id })
  if (error) {
    await service.storage.from(PAYSLIP_BUCKET).remove([objectPath])
    throw new ApiError(503, 'unavailable', 'התלוש לא נשמר. נסו שוב.')
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
})
