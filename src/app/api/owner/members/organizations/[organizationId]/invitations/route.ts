import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireOwnerBusiness } from '@/lib/identity/server/guard'
import { postInvitation } from '@/lib/identity/server/org-handlers'

// Invite a department head: answers the single-use token once (a private link to copy); nothing is sent.
// Owner family (/api/owner/members): a full owner session AND business_admin on the Sarcafe business (requireOwnerBusiness).
// The database function behind the call rechecks the same actor for this organization (src/lib/identity/server/org-handlers.ts).
type Context = { params: Promise<Record<'organizationId', string>> }

export const POST = apiRoute((request: NextRequest, context: Context) => postInvitation(requireOwnerBusiness, request, context))
