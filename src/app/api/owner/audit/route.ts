import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireMenuEditor } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

export const GET = apiRoute(async (request: NextRequest) => {
  const branchSlug = request.nextUrl.searchParams.get('branch')
  if (!branchSlug) throw BadRequest('Unknown or missing branch.')

  const limitParam = Number(request.nextUrl.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT

  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id').eq('slug', branchSlug).maybeSingle()
  if (!branch) throw NotFound('Branch not found.')

  // Same gate as the editor/menu-variants routes: whoever can edit this
  // branch's menu can see its change history — the log is a consequence of
  // that access, not a separate permission.
  await requireMenuEditor(branch.id)

  const { data: entries } = await service
    .from('menu_audit')
    .select('id, actor_name, actor_email, action, summary, detail, created_at')
    .eq('branch_id', branch.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  return NextResponse.json({ entries: entries ?? [] })
})
