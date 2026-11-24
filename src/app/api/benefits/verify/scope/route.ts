import { apiRoute } from '@/lib/http/errors'
import { requireScanner } from '@/lib/identity/server/guard'
import { verifyScope } from '@/lib/identity/server/verification-handlers'

// Where this operator may scan (their live scanner grants). Guard: requireScanner (FABLE-004).
export const GET = apiRoute(async () => verifyScope(requireScanner))
