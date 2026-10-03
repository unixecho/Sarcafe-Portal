import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError, BadRequest, NotFound } from '@/lib/http/errors'
import { OWNER_MESSAGES } from '@/lib/pos/owner-api'
import { requireOwner, requireMenuEditor } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SLUG_PATTERN } from '@/lib/branches'
import { normalizeReviews, MAX_REVIEWS, MAX_REVIEW_TEXT_LEN, PLACEHOLDER_BLOCK } from '@/lib/reviews'

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
  // 'event' branches (a one-off festival, a pop-up) are hidden from the public
  // site's branch list; the point-of-sale runs on them. Defaults to today's behaviour.
  kind: z.enum(['permanent', 'event']).default('permanent'),
  // Start an event from a real menu: the slug of an existing branch whose PUBLISHED
  // menu is copied into the new one (as both its draft and its published copy).
  cloneFromSlug: z.string().regex(SLUG_PATTERN).optional(),
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

  // Read the source BEFORE creating anything: a missing source must not leave a
  // half-made location behind.
  let sourcePublished: unknown = null
  if (body.cloneFromSlug) {
    const { data: source } = await service
      .from('menus')
      .select('published')
      .eq('slug', body.cloneFromSlug)
      .maybeSingle()
    if (!source || !source.published) {
      throw new ApiError(404, 'not_found', `${OWNER_MESSAGES.source_menu_missing.he} / ${OWNER_MESSAGES.source_menu_missing.en}`)
    }
    sourcePublished = source.published
  }

  const { data, error } = await service.rpc('create_branch_with_menu', {
    p_slug: body.slug,
    p_name: { he: body.name.he, en: body.name.en ?? '', ar: body.name.ar ?? '' },
  })
  if (error || !data?.[0]) throw BadRequest('Could not create the new location. Please try again.')

  const row = data[0] as { branch_id: string; menu_id: string }

  if (body.kind !== 'permanent') {
    const { error: kindError } = await service.from('branches').update({ kind: body.kind }).eq('id', row.branch_id)
    // An event that silently stayed 'permanent' would show up on the public site.
    if (kindError) {
      throw new ApiError(500, 'internal_error', 'The location was created but could not be marked as an event. Open it and try again.', {
        branchId: row.branch_id,
      })
    }
  }

  // The copy goes into draft AND published so the event starts from a menu customers
  // and the register can both read straight away; variants stay at the default one the
  // create function made. A failed copy is reported, not fatal: the location exists and
  // the menu editor can still fill it.
  let cloneFailed = false
  if (body.cloneFromSlug) {
    const now = new Date().toISOString()
    const { error: cloneError } = await service
      .from('menus')
      .update({ draft: sourcePublished, published: sourcePublished, published_at: now, updated_at: now })
      .eq('id', row.menu_id)
    if (cloneError) {
      cloneFailed = true
      console.error('event menu clone failed:', cloneError.code)
    }
  }

  return NextResponse.json({
    branchId: row.branch_id,
    menuId: row.menu_id,
    slug: body.slug,
    kind: body.kind,
    ...(cloneFailed ? { cloneFailed: true, message: `${OWNER_MESSAGES.clone_failed.he} / ${OWNER_MESSAGES.clone_failed.en}` } : {}),
  })
})

// Branch-scoped, not owner-only — same access level as editing the menu
// itself (requireMenuEditor), unlike branch CREATION above which stays
// requireOwner()-gated. A general_manager scoped to a branch can fix that
// branch's own links/reviews without needing full owner rights.
const HTTPS_PATTERN = /^https:\/\/.+/i

function nullableHttpsUrl(fieldLabel: string) {
  return z
    .string()
    .nullable()
    .refine((v) => v === null || HTTPS_PATTERN.test(v), { message: `${fieldLabel} must start with https:// or be empty.` })
}

const linksSchema = z
  .object({
    navGoogleMaps: nullableHttpsUrl('Google Maps link'),
    navWaze: nullableHttpsUrl('Waze link'),
    navAppleMaps: nullableHttpsUrl('Apple Maps link'),
    instagram: nullableHttpsUrl('Instagram link'),
    review: nullableHttpsUrl('Review link'),
    bit: nullableHttpsUrl('Bit link'),
  })
  .partial()

const reviewsSchema = z.object({
  rating: z.number().min(0).max(5),
  count: z.number().int().min(0),
  items: z
    .array(
      z.object({
        id: z.string(),
        author: z.string().max(120).optional(),
        stars: z.number().int().min(1).max(5),
        lang: z.enum(['he', 'en', 'ar']),
        date: z.string().max(40).optional(),
        text: z.string().trim().min(1, 'Review text cannot be empty.').max(MAX_REVIEW_TEXT_LEN),
        visible: z.boolean().optional(),
      })
    )
    .max(MAX_REVIEWS, `A branch can carry at most ${MAX_REVIEWS} reviews.`),
})

const patchSchema = z.object({
  branchId: z.string().uuid(),
  links: linksSchema.optional(),
  reviews: reviewsSchema.optional(),
})

const LINK_COLUMNS: Record<string, string> = {
  navGoogleMaps: 'nav_google_maps',
  navWaze: 'nav_waze',
  navAppleMaps: 'nav_apple_maps',
  instagram: 'instagram_url',
  review: 'review_url',
  bit: 'bit_url',
}

export const PATCH = apiRoute(async (request: Request) => {
  const body = patchSchema.parse(await request.json())
  const service = createServiceRoleClient()

  const { data: branch } = await service.from('branches').select('id').eq('id', body.branchId).maybeSingle()
  if (!branch) throw NotFound('Branch not found.')

  await requireMenuEditor(body.branchId)

  const updates: Record<string, unknown> = {}
  if (body.links) {
    for (const [key, value] of Object.entries(body.links)) {
      if (value === undefined) continue
      const column = LINK_COLUMNS[key]
      if (column) updates[column] = value
    }
  }
  if (body.reviews) {
    // normalizeReviews is the same validator the public render path trusts
    // — running the write through it too means what's stored is exactly
    // what will render, never a shape that only happened to pass zod.
    updates.reviews = normalizeReviews(body.reviews, PLACEHOLDER_BLOCK)
  }

  if (Object.keys(updates).length === 0) {
    throw BadRequest('Nothing to update.')
  }

  const { data: updated, error } = await service
    .from('branches')
    .update(updates)
    .eq('id', body.branchId)
    .select(
      'nav_google_maps, nav_waze, nav_apple_maps, instagram_url, review_url, bit_url, reviews'
    )
    .single()
  if (error || !updated) throw BadRequest('Could not save changes.')

  return NextResponse.json({
    links: {
      navGoogleMaps: updated.nav_google_maps,
      navWaze: updated.nav_waze,
      navAppleMaps: updated.nav_apple_maps,
      instagram: updated.instagram_url,
      review: updated.review_url,
      bit: updated.bit_url,
    },
    reviews: updated.reviews,
  })
})
