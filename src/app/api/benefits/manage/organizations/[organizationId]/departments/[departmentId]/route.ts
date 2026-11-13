import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireOrganizationAdmin } from '@/lib/identity/server/guard'
import { patchDepartment } from '@/lib/identity/server/org-handlers'

// Rename a department of this organization or switch it off / on.
// Benefits family (/api/benefits/manage): an organization administrator of exactly this organization (requireOrganizationAdmin); no staff access is needed or given.
// The database function behind the call rechecks the same actor for this organization (src/lib/identity/server/org-handlers.ts).
type Context = { params: Promise<Record<'organizationId' | 'departmentId', string>> }

export const PATCH = apiRoute((request: NextRequest, context: Context) => patchDepartment(requireOrganizationAdmin, request, context))
