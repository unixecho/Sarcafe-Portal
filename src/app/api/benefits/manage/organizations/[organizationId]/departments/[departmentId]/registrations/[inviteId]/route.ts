import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireDepartmentReviewer } from '@/lib/identity/server/guard'
import { departmentInviteRevoke } from '@/lib/identity/server/registration-handlers'

// Ends an open registration link. Guard: requireDepartmentReviewer (FABLE-003).
type Context = { params: Promise<Record<'organizationId' | 'departmentId' | 'inviteId', string>> }

export const DELETE = apiRoute(async (request: NextRequest, context: Context) => departmentInviteRevoke(requireDepartmentReviewer, request, context))
