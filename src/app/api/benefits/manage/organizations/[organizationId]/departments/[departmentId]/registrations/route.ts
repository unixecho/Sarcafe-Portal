import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireDepartmentReviewer } from '@/lib/identity/server/guard'
import { departmentInvite, departmentRegistrations } from '@/lib/identity/server/registration-handlers'

// A department's applications and members, and its registration links. Guard: requireDepartmentReviewer (FABLE-003).
type Context = { params: Promise<Record<'organizationId' | 'departmentId', string>> }

export const GET = apiRoute(async (request: NextRequest, context: Context) => departmentRegistrations(requireDepartmentReviewer, request, context))
export const POST = apiRoute(async (request: NextRequest, context: Context) => departmentInvite(requireDepartmentReviewer, request, context))
