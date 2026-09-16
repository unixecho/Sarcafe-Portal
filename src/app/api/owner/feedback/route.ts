import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { revalidateTag } from 'next/cache'
import { apiRoute, BadRequest, NotFound, RateLimited } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { isFeedbackCategory, isFeedbackStatus } from '@/lib/feedback/validate'
import { FEEDBACK_STATUSES } from '@/lib/feedback/types'
import { CUSTOMER_FEEDBACK_ENABLED_KEY, DEFAULT_CUSTOMER_FEEDBACK_ENABLED, SETTINGS_TAG } from '@/lib/settings/keys'

// The owner's side of the feedback box — ported from AyekaBar's
// /api/owner/feedback/route.ts. requireOwner() (not requireMenuEditor()):
// this is unsolicited free text from the public, sometimes with a contact
// address attached, and being trusted with the menu has never implied
// being handed customer correspondence.

const LIST_COLS = 'id, category, message, contact_email, page_url, branch_slug, status, resolved_at, created_at'
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

export const GET = apiRoute(async (request: NextRequest) => {
  await requireOwner()
  const service = createServiceRoleClient()

  const status = request.nextUrl.searchParams.get('status')
  const category = request.nextUrl.searchParams.get('category')
  const branch = request.nextUrl.searchParams.get('branch') // '' or absent = every branch
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(Number(request.nextUrl.searchParams.get('offset')) || 0, 0)

  let query = service.from('customer_feedback').select(LIST_COLS, { count: 'exact' })
  // Anything not a recognized value is "no filter," not an error — these
  // come from the UI's own chips, and a filter that 400s is a worse
  // failure than a filter that shows everything.
  if (isFeedbackStatus(status)) query = query.eq('status', status)
  if (isFeedbackCategory(category)) query = query.eq('category', category)
  if (branch) query = query.eq('branch_slug', branch)

  const [list, counts, setting] = await Promise.all([
    query.order('created_at', { ascending: false }).range(offset, offset + limit - 1),
    Promise.all(
      FEEDBACK_STATUSES.map((s) =>
        service
          .from('customer_feedback')
          .select('id', { count: 'exact', head: true })
          .eq('status', s)
          .then((r) => [s, r.count ?? 0] as const)
      )
    ),
    service.from('app_settings').select('value').eq('key', CUSTOMER_FEEDBACK_ENABLED_KEY).maybeSingle(),
  ])

  if (list.error) throw BadRequest('Could not load feedback.')

  return NextResponse.json({
    items: list.data ?? [],
    total: list.count ?? 0,
    counts: Object.fromEntries(counts) as Record<'new' | 'read' | 'resolved', number>,
    enabled: (setting.data?.value as boolean | undefined) ?? DEFAULT_CUSTOMER_FEEDBACK_ENABLED,
  })
})

const patchSchema = z.union([
  z.object({ enabled: z.boolean() }),
  z.object({ id: z.string().uuid(), status: z.enum(FEEDBACK_STATUSES) }),
])

export const PATCH = apiRoute(async (request: NextRequest) => {
  const staff = await requireOwner()
  // Keyed on the owner, not the IP — this is an authenticated route, and
  // the thing worth bounding is a runaway client loop, not an attacker.
  if (!(await checkRateLimit(`feedback-admin:${staff.auth_user_id}`, 120, 60))) throw RateLimited()

  const body = patchSchema.parse(await request.json())
  const service = createServiceRoleClient()

  if ('enabled' in body) {
    const { data, error } = await service
      .from('app_settings')
      .upsert(
        {
          key: CUSTOMER_FEEDBACK_ENABLED_KEY,
          value: body.enabled,
          is_public: true, // the signed-out portal/menu decides whether to render the button
          updated_at: new Date().toISOString(),
          updated_by: staff.auth_user_id,
        },
        { onConflict: 'key' }
      )
      .select('value')
      .single()
    if (error) throw BadRequest('Could not save setting.')

    revalidateTag(SETTINGS_TAG)
    return NextResponse.json({ enabled: data.value as boolean })
  }

  // resolved_by/resolved_at come from the server's own guard, never the
  // body — the row records who actually did it. Moving OUT of resolved
  // clears both so a stale signature can't outlive the state it described.
  const resolving = body.status === 'resolved'
  const { data, error } = await service
    .from('customer_feedback')
    .update({
      status: body.status,
      resolved_by: resolving ? staff.auth_user_id : null,
      resolved_at: resolving ? new Date().toISOString() : null,
    })
    .eq('id', body.id)
    .select(LIST_COLS)
    .maybeSingle()

  if (error) throw BadRequest('Could not update feedback.')
  if (!data) throw NotFound('Feedback not found.')

  return NextResponse.json({ item: data })
})
