import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireBenefitsUser } from '@/lib/identity/server/guard'
import { meChange } from '@/lib/identity/server/registration-handlers'

// A change to one's own application: a changed name, nickname or photo is reviewed again (FABLE-003).
type Context = { params: Promise<Record<'membershipId', string>> }

export const PATCH = apiRoute(async (request: NextRequest, context: Context) => meChange(requireBenefitsUser, request, context))
