import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireDepartmentReviewer } from '@/lib/identity/server/guard'
import { departmentPhoto } from '@/lib/identity/server/registration-handlers'

// An applicant's or member's photo for its reviewer, through the private proxy (no-store, audited). Guard: requireDepartmentReviewer (FABLE-003).
type Context = { params: Promise<Record<'organizationId' | 'departmentId' | 'membershipId', string>> }

export const GET = apiRoute(async (request: NextRequest, context: Context) => departmentPhoto(requireDepartmentReviewer, request, context))
