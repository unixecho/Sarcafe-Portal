import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireStaff } from '@/lib/staff/guard'
import { fetchMenu } from '@/lib/menu/fetch'

// The order builder's item picker reads the same published-and-variant-
// resolved menu the public /menu/[branch] page shows (fetchMenu) — a
// customer at the counter and the register ringing them up must never
// disagree about what's currently on offer. Gated at the "is staff at
// all" baseline (requireStaff, not a branch-specific check) since the
// content itself is already public; this just keeps every /api/orders/*
// route consistently staff-only rather than carving out one anon path.
export const GET = apiRoute(async (request: NextRequest) => {
  const branchSlug = request.nextUrl.searchParams.get('branch')
  if (!branchSlug) throw BadRequest('Unknown or missing branch.')

  await requireStaff()

  const menu = await fetchMenu(branchSlug)
  if (!menu) throw NotFound('Menu not found for this branch.')

  return NextResponse.json({ categories: menu.categories })
})
