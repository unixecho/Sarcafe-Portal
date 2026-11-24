import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireScanner } from '@/lib/identity/server/guard'
import { verifyScan } from '@/lib/identity/server/verification-handlers'

// One scan of an employee's card by an operator with a scanner grant. Guard: requireScanner (FABLE-004).
export const POST = apiRoute(async (request: NextRequest) => verifyScan(requireScanner, request))
