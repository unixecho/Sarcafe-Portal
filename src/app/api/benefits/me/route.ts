import { apiRoute } from '@/lib/http/errors'
import { requireBenefitsUser } from '@/lib/identity/server/guard'
import { meList } from '@/lib/identity/server/registration-handlers'

// The signed-in person's own applications, in every organization (FABLE-003).
export const GET = apiRoute(async () => meList(requireBenefitsUser))
