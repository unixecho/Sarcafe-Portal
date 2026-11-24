import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireBenefitsUser } from '@/lib/identity/server/guard'
import { registerStatus } from '@/lib/identity/server/registration-handlers'

// What the registration page shows, for a proven Google sign-in (FABLE-003).
export const GET = apiRoute(async (request: NextRequest) => registerStatus(requireBenefitsUser, request))
