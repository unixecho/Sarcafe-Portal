import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireOwnerBusiness } from '@/lib/identity/server/guard'
import { scannersGrant, scannersList } from '@/lib/identity/server/verification-handlers'

// Who may scan: the staff and their scanner grants (GET), a new grant (POST). Guard: requireOwnerBusiness (FABLE-004).
export const GET = apiRoute(async () => scannersList(requireOwnerBusiness))
export const POST = apiRoute(async (request: NextRequest) => scannersGrant(requireOwnerBusiness, request))
