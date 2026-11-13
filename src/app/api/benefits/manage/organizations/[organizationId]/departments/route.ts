import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireOrganizationAdmin } from '@/lib/identity/server/guard'
import { postDepartment } from '@/lib/identity/server/org-handlers'

// A new department in this organization.
// Benefits family (/api/benefits/manage): an organization administrator of exactly this organization (requireOrganizationAdmin); no staff access is needed or given.
// The database function behind the call rechecks the same actor for this organization (src/lib/identity/server/org-handlers.ts).
type Context = { params: Promise<Record<'organizationId', string>> }

export const POST = apiRoute((request: NextRequest, context: Context) => postDepartment(requireOrganizationAdmin, request, context))
