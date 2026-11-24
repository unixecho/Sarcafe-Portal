import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireOwnerBusiness } from '@/lib/identity/server/guard'
import { scannersRevoke } from '@/lib/identity/server/verification-handlers'

// Ends a scanner grant (and the operator's open verification). Guard: requireOwnerBusiness (FABLE-004).
type Context = { params: Promise<Record<'grantId', string>> }

export const DELETE = apiRoute(async (request: NextRequest, context: Context) => scannersRevoke(requireOwnerBusiness, request, context))
