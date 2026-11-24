import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireBenefitsUser } from '@/lib/identity/server/guard'
import { mePhoto, mePhotoUpload } from '@/lib/identity/server/registration-handlers'

// One's own photo through the private proxy (GET), or a new photo for a change (POST, raw image body) (FABLE-003).
type Context = { params: Promise<Record<'membershipId', string>> }

export const GET = apiRoute(async (request: NextRequest, context: Context) => mePhoto(requireBenefitsUser, request, context))
export const POST = apiRoute(async (request: NextRequest, context: Context) => mePhotoUpload(requireBenefitsUser, request, context))
