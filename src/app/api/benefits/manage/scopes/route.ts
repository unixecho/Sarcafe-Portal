import { apiRoute } from '@/lib/http/errors'
import { requireBenefitsUser } from '@/lib/identity/server/guard'
import { identityJson } from '@/lib/identity/server/http'
import { manageScopes } from '@/lib/identity/server/organizations'

// What the signed-in user holds: the organizations they administer and the departments they head, by live grants only. A verified
// full Google sign-in (requireBenefitsUser); someone who holds nothing gets two empty lists and learns nothing else.
export const GET = apiRoute(async () => {
  const actor = await requireBenefitsUser()
  return identityJson(await manageScopes(actor.authUserId))
})
