import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError, Forbidden, NotFound, Unauthorized } from '@/lib/http/errors'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isOp } from '@/lib/staff/access'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { PAYSLIP_BUCKET, privateStaffRoute } from '@/lib/staff/records'

export const GET = privateStaffRoute(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const me = await resolveStaffIdentity()
  if (!me) throw Unauthorized()
  if (me.quick || me.via !== 'google') throw Forbidden('כדי לפתוח תלוש שכר צריך להתחבר עם Google')
  const id = z.string().uuid().parse((await params).id)
  const service = createServiceRoleClient()
  let query = service.from('staff_payslips').select('object_path, file_name').eq('id', id)
  if (!isOp(me)) query = query.eq('staff_id', me.id)
  const { data: slip, error } = await query.maybeSingle()
  if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו לפתוח את התלוש')
  if (!slip) throw NotFound()
  const signed = await service.storage.from(PAYSLIP_BUCKET).createSignedUrl(slip.object_path, 60, { download: slip.file_name })
  if (signed.error || !signed.data) throw new ApiError(503, 'unavailable', 'לא הצלחנו לפתוח את התלוש')
  return NextResponse.redirect(signed.data.signedUrl, { status: 303, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } })
})
