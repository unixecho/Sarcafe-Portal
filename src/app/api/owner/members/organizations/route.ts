import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute } from '@/lib/http/errors'
import { requireOwnerBusiness } from '@/lib/identity/server/guard'
import { identityJson, readIdentityBody, refuse, throttleWrites } from '@/lib/identity/server/http'
import { createOrganization, listOrganizations } from '@/lib/identity/server/organizations'

// The organizations that have an agreement with Sarcafe (GET), and a new one (POST: created together with a draft agreement, so it
// is never unattached and never attached to another business). A full owner session AND business_admin on the Sarcafe business
// (requireOwnerBusiness); the business is this deployment's constant, never a value from the request.

export const GET = apiRoute(async () => {
  const actor = await requireOwnerBusiness()
  const result = await listOrganizations(actor.authUserId, actor.businessId)
  if (!result.ok) refuse(result.error)
  return identityJson({ organizations: result.organizations })
})

export const POST = apiRoute(async (request: NextRequest) => {
  const actor = await requireOwnerBusiness()
  const body = await readIdentityBody(request, z.object({ name: z.string().trim().min(1).max(80) }).strict())
  await throttleWrites(actor.authUserId)
  const result = await createOrganization(actor.authUserId, actor.businessId, body.name)
  if (!result.ok) refuse(result.error)
  return identityJson({ ok: true, organizationId: result.organizationId }, 201)
})
