import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireOwnerBusiness } from '@/lib/identity/server/guard'
import { getOrganization, patchOrganization } from '@/lib/identity/server/org-handlers'

// One organization: its departments, their heads and its invitations (GET); rename it or switch it off / on (PATCH).
// Owner family (/api/owner/members): a full owner session AND business_admin on the Sarcafe business (requireOwnerBusiness).
// The database function behind the call rechecks the same actor for this organization (src/lib/identity/server/org-handlers.ts).
type Context = { params: Promise<Record<'organizationId', string>> }

export const GET = apiRoute((request: NextRequest, context: Context) => getOrganization(requireOwnerBusiness, request, context))
export const PATCH = apiRoute((request: NextRequest, context: Context) => patchOrganization(requireOwnerBusiness, request, context))
