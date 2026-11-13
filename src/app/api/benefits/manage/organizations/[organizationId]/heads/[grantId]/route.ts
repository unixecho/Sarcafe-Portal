import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireOrganizationAdmin } from '@/lib/identity/server/guard'
import { deleteHead } from '@/lib/identity/server/org-handlers'

// End a department head's grant.
// Benefits family (/api/benefits/manage): an organization administrator of exactly this organization (requireOrganizationAdmin); no staff access is needed or given.
// The database function behind the call rechecks the same actor for this organization (src/lib/identity/server/org-handlers.ts).
type Context = { params: Promise<Record<'organizationId' | 'grantId', string>> }

export const DELETE = apiRoute((request: NextRequest, context: Context) => deleteHead(requireOrganizationAdmin, request, context))
