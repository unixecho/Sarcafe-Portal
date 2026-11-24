import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireBenefitsUser } from '@/lib/identity/server/guard'
import { registerPhoto } from '@/lib/identity/server/registration-handlers'

// The registration photo: a raw image body (at most 8 MB), checked and re-encoded by the server, stored privately (FABLE-003).
export const POST = apiRoute(async (request: NextRequest) => registerPhoto(requireBenefitsUser, request))
