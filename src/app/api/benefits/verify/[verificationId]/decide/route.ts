import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireScanner } from '@/lib/identity/server/guard'
import { verifyDecide } from '@/lib/identity/server/verification-handlers'

// The operator's decision: match, mismatch or cancel. Guard: requireScanner (FABLE-004).
type Context = { params: Promise<Record<'verificationId', string>> }

export const POST = apiRoute(async (request: NextRequest, context: Context) => verifyDecide(requireScanner, request, context))
