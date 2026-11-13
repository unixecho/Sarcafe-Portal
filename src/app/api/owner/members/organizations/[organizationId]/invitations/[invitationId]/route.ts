import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { requireOwnerBusiness } from '@/lib/identity/server/guard'
import { deleteInvitation } from '@/lib/identity/server/org-handlers'

// Revoke an open invitation.
// Owner family (/api/owner/members): a full owner session AND business_admin on the Sarcafe business (requireOwnerBusiness).
// The database function behind the call rechecks the same actor for this organization (src/lib/identity/server/org-handlers.ts).
type Context = { params: Promise<Record<'organizationId' | 'invitationId', string>> }

export const DELETE = apiRoute((request: NextRequest, context: Context) => deleteInvitation(requireOwnerBusiness, request, context))
