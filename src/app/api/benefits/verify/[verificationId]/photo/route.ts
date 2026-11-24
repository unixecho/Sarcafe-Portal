import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireScanner } from '@/lib/identity/server/guard'
import { verifyPhoto } from '@/lib/identity/server/verification-handlers'

// The open verification's photo, for the operator who scanned it (private proxy). Guard: requireScanner (FABLE-004).
type Context = { params: Promise<Record<'verificationId', string>> }

export const GET = apiRoute(async (request: NextRequest, context: Context) => verifyPhoto(requireScanner, request, context))
