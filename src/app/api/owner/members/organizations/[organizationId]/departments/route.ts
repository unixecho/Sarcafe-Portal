import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireOwnerBusiness } from '@/lib/identity/server/guard'
import { postDepartment } from '@/lib/identity/server/org-handlers'

// A new department in this organization.
// Owner family (/api/owner/members): a full owner session AND business_admin on the Sarcafe business (requireOwnerBusiness).
// The database function behind the call rechecks the same actor for this organization (src/lib/identity/server/org-handlers.ts).
type Context = { params: Promise<Record<'organizationId', string>> }

export const POST = apiRoute((request: NextRequest, context: Context) => postDepartment(requireOwnerBusiness, request, context))
