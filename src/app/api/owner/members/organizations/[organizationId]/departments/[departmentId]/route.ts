import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireOwnerBusiness } from '@/lib/identity/server/guard'
import { patchDepartment } from '@/lib/identity/server/org-handlers'

// Rename a department of this organization or switch it off / on.
// Owner family (/api/owner/members): a full owner session AND business_admin on the Sarcafe business (requireOwnerBusiness).
// The database function behind the call rechecks the same actor for this organization (src/lib/identity/server/org-handlers.ts).
type Context = { params: Promise<Record<'organizationId' | 'departmentId', string>> }

export const PATCH = apiRoute((request: NextRequest, context: Context) => patchDepartment(requireOwnerBusiness, request, context))
