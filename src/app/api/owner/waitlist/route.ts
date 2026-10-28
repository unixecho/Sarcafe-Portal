import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'

// The loyalty-club sign-ups the kiosk collected. Full owner only (requireOwner refuses quick sessions, employees,
// managers and anyone not an owner): these are customers' phone numbers, and being trusted with the menu or the
// schedule never meant being handed them. The tables have no browser grants at all, so this is the only way in.

const PAGE = 40

export type WaitlistContact = {
  id: string
  firstName: string
  phone: string
  email: string | null
  marketing: boolean
  createdAt: string
  lastInterestAt: string
}

export const GET = apiRoute(async (request: NextRequest) => {
  await requireOwner()
  const offset = Math.max(0, Number(request.nextUrl.searchParams.get('offset') ?? 0) || 0)
  const service = createServiceRoleClient()
  const { data, error, count } = await service
    .from('customer_waitlist_contacts')
    .select('id, first_name, normalized_phone, email, current_marketing_consent, created_at, last_interest_at', { count: 'exact' })
    .order('last_interest_at', { ascending: false })
    .range(offset, offset + PAGE - 1)
  if (error) throw BadRequest('Could not load the list.')

  const { count: marketingCount } = await service
    .from('customer_waitlist_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('current_marketing_consent', true)

  const items: WaitlistContact[] = (data ?? []).map((row) => ({
    id: row.id as string,
    firstName: row.first_name as string,
    phone: row.normalized_phone as string,
    email: (row.email as string | null) ?? null,
    marketing: row.current_marketing_consent as boolean,
    createdAt: row.created_at as string,
    lastInterestAt: row.last_interest_at as string,
  }))
  return NextResponse.json({ items, total: count ?? items.length, marketing: marketingCount ?? 0 }, { headers: { 'Cache-Control': 'no-store' } })
})

const actionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['grant_marketing', 'withdraw_marketing', 'erase']),
})

export const POST = apiRoute(async (request: NextRequest) => {
  await requireOwner()
  const body = actionSchema.parse(await request.json())
  const service = createServiceRoleClient()

  const { data, error } =
    body.action === 'erase'
      ? await service.rpc('customer_waitlist_erase', { p_contact_id: body.id })
      : await service.rpc('customer_waitlist_set_marketing', { p_contact_id: body.id, p_grant: body.action === 'grant_marketing' })
  if (error) throw BadRequest('Could not save the change.')
  const result = data as { ok: boolean; error?: string }
  if (!result.ok) throw NotFound('This person is no longer on the list.')
  return NextResponse.json({ ok: true })
})
