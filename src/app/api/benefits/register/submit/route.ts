import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireBenefitsUser } from '@/lib/identity/server/guard'
import { registerSubmit } from '@/lib/identity/server/registration-handlers'

// The application, once, in one transaction; pending until a reviewer decides (FABLE-003).
export const POST = apiRoute(async (request: NextRequest) => registerSubmit(requireBenefitsUser, request))
