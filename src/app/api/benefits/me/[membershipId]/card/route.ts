import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireBenefitsUser } from '@/lib/identity/server/guard'
import { cardIssue, cardRevoke } from '@/lib/identity/server/verification-handlers'

// The employee's own card: a fresh QR token (POST) or every live card hidden (DELETE). Guard: requireBenefitsUser (FABLE-004).
type Context = { params: Promise<Record<'membershipId', string>> }

export const POST = apiRoute(async (request: NextRequest, context: Context) => cardIssue(requireBenefitsUser, request, context))
export const DELETE = apiRoute(async (request: NextRequest, context: Context) => cardRevoke(requireBenefitsUser, request, context))
