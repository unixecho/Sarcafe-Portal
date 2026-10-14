import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError, NotFound } from '@/lib/http/errors'
import { isOp } from '@/lib/staff/access'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { PAYSLIP_BUCKET, privateStaffRoute } from '@/lib/staff/records'
import { contentDisposition, requirePayslipReader, VIEWABLE_TYPES } from '@/lib/staff/payslips'

// The payslip, shown IN the page instead of downloaded: the bytes come through here (never a storage link) so the same
// rule as the download decides who may see which file: an employee their own, an owner anyone's, nobody on a code session.
// The site forbids framing every page (clickjacking); this one route may be framed, by our own pages only (next.config.mjs).
export const GET = privateStaffRoute(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const me = await requirePayslipReader()
  const id = z.string().uuid().parse((await params).id)
  const service = createServiceRoleClient()
  let query = service.from('staff_payslips').select('object_path, file_name, content_type').eq('id', id)
  if (!isOp(me)) query = query.eq('staff_id', me.id)
  const { data: slip, error } = await query.maybeSingle()
  if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו לפתוח את התלוש')
  if (!slip) throw NotFound()
  const downloaded = await service.storage.from(PAYSLIP_BUCKET).download(slip.object_path)
  if (downloaded.error || !downloaded.data) throw new ApiError(503, 'unavailable', 'לא הצלחנו לפתוח את התלוש')
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
  const type = VIEWABLE_TYPES.has(slip.content_type as string) ? (slip.content_type as string) : 'application/octet-stream'
  const extension = type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'bin'
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(bytes.length),
      // Anything that is not a known document type is offered as a download, never rendered.
      'Content-Disposition': contentDisposition(type === 'application/octet-stream' ? 'attachment' : 'inline', slip.file_name as string, `payslip.${extension}`),
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  })
})
