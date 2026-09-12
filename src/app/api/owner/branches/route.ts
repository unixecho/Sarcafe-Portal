import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SLUG_PATTERN } from '@/lib/branches'

// Owner-only ("she branches out with another branch"). A branch-scoped
// general_manager cannot reach this — requireOwner() is the true-owner
// check (role='owner' or badge='owner'), not the branch-aware
// requireMenuEditor() every other menu route uses.
const createSchema = z.object({
  slug: z.string().regex(SLUG_PATTERN, 'Use lowercase letters, numbers, and hyphens only.'),
  name: z.object({
    he: z.string().trim().min(1, 'Hebrew name is required.'),
    en: z.string().trim().optional(),
    ar: z.string().trim().optional(),
  }),
})

export const POST = apiRoute(async (request: Request) => {
  await requireOwner()

  const body = createSchema.parse(await request.json())
  const service = createServiceRoleClient()

  const { data: existing } = await service
    .from('branches')
    .select('id')
    .eq('slug', body.slug)
    .maybeSingle()
  if (existing) throw BadRequest('That location name is already taken — try a different one.')

  const { data, error } = await service.rpc('create_branch_with_menu', {
    p_slug: body.slug,
    p_name: { he: body.name.he, en: body.name.en ?? '', ar: body.name.ar ?? '' },
  })
  if (error || !data?.[0]) throw BadRequest('Could not create the new location. Please try again.')

  const row = data[0] as { branch_id: string; menu_id: string }
  return NextResponse.json({ branchId: row.branch_id, menuId: row.menu_id, slug: body.slug })
})
