import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireBenefitsUser } from '@/lib/identity/server/guard'
import { registerOpen } from '@/lib/identity/server/registration-handlers'

// A proven Google sign-in opens the link from the cookie: a one-hour registration session for this person and this link (FABLE-003).
export const POST = apiRoute(async (request: NextRequest) => registerOpen(requireBenefitsUser, request))
