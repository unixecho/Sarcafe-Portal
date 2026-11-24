import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { registerExchange, registerForget } from '@/lib/identity/server/registration-handlers'

// PUBLIC (the employee is not signed in yet): the registration link's token, from the URL fragment, becomes an HttpOnly cookie
// sent only to /api/benefits/register. The database is not asked and nothing about the link is said (FABLE-003).
export const POST = apiRoute(async (request: NextRequest) => registerExchange(request))
export const DELETE = apiRoute(async (request: NextRequest) => registerForget(request))
