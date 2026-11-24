import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireDepartmentReviewer } from '@/lib/identity/server/guard'
import { departmentReview } from '@/lib/identity/server/registration-handlers'

// A reviewer's decision (approve, reject, deactivate, reactivate) with the version the screen showed. Guard: requireDepartmentReviewer (FABLE-003).
type Context = { params: Promise<Record<'organizationId' | 'departmentId' | 'membershipId', string>> }

export const POST = apiRoute(async (request: NextRequest, context: Context) => departmentReview(requireDepartmentReviewer, request, context))
