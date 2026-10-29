import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'

// The poll's results for the owner: counts per option, answers per day and the rating for a period (7 / 30 days or
// all time), plus the suggestions, newest first, a page at a time. Full owner only. The answers are anonymous (no
// personal data is ever collected), but they are still the public's free text, so they stay behind the owner gate.

const PAGE = 30
const PERIODS = new Set([7, 30, 0])

export type PollSuggestion = {
  id: string
  suggestion: string
  rating: number | null
  options: string[]
  hidden: boolean
  createdAt: string
}

export type PollSummary = {
  total: number
  withSuggestion: number
  ratingCount: number
  ratingAverage: number | null
  options: Array<{ id: string; label: string; enabled: boolean; votes: number }>
  perDay: Array<{ day: string; count: number }>
}

export const GET = apiRoute(async (request: NextRequest) => {
  await requireOwner()
  const params = request.nextUrl.searchParams
  const days = Number(params.get('days') ?? 30)
  if (!PERIODS.has(days)) throw BadRequest('Unknown period.')
  const offset = Math.max(0, Math.min(100000, Number(params.get('offset') ?? 0) || 0))
  const showHidden = params.get('hidden') === '1'
  const service = createServiceRoleClient()

  const { data: summary, error: summaryError } = await service.rpc('kiosk_feedback_summary', { p_days: days })
  if (summaryError || !summary || (summary as { ok?: boolean }).ok !== true) throw BadRequest('Could not load the results.')

  let query = service
    .from('kiosk_feedback_responses')
    .select('id, suggestion, rating, option_ids, hidden, created_at', { count: 'exact' })
    .not('suggestion', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE - 1)
  if (!showHidden) query = query.eq('hidden', false)
  if (days > 0) query = query.gte('created_at', new Date(Date.now() - days * 86_400_000).toISOString())
  const { data, error, count } = await query
  if (error) throw BadRequest('Could not load the suggestions.')

  const labels = new Map((summary as PollSummary).options.map((o) => [o.id, o.label]))
  const items: PollSuggestion[] = (data ?? []).map((row) => ({
    id: row.id as string,
    suggestion: row.suggestion as string,
    rating: (row.rating as number | null) ?? null,
    options: ((row.option_ids as string[] | null) ?? []).map((id) => labels.get(id)).filter((l): l is string => !!l),
    hidden: row.hidden as boolean,
    createdAt: row.created_at as string,
  }))

  const s = summary as PollSummary & { ratingAverage: number | string | null }
  return NextResponse.json(
    {
      summary: { ...s, ratingAverage: s.ratingAverage === null ? null : Number(s.ratingAverage) },
      suggestions: { items, total: count ?? items.length },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})

const actionSchema = z.object({ id: z.string().uuid(), hidden: z.boolean() }).strict()

export const POST = apiRoute(async (request: NextRequest) => {
  await requireOwner()
  const body = actionSchema.parse(await request.json())
  const { data, error } = await createServiceRoleClient().rpc('kiosk_feedback_set_hidden', { p_response_id: body.id, p_hidden: body.hidden })
  if (error || !data) throw BadRequest('Could not save the change.')
  if (!(data as { ok: boolean }).ok) throw NotFound('This answer no longer exists.')
  return NextResponse.json({ ok: true })
})
