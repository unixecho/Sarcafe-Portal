import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireOrganizationAdmin } from '@/lib/identity/server/guard'
import { getOrganization, patchOrganization } from '@/lib/identity/server/org-handlers'

// One organization: its departments, their heads and its invitations (GET); rename it or switch it off / on (PATCH).
// Benefits family (/api/benefits/manage): an organization administrator of exactly this organization (requireOrganizationAdmin); no staff access is needed or given.
// The database function behind the call rechecks the same actor for this organization (src/lib/identity/server/org-handlers.ts).
type Context = { params: Promise<Record<'organizationId', string>> }

export const GET = apiRoute((request: NextRequest, context: Context) => getOrganization(requireOrganizationAdmin, request, context))
export const PATCH = apiRoute((request: NextRequest, context: Context) => patchOrganization(requireOrganizationAdmin, request, context))
