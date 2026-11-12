import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { accessCheckArgs } from '@/lib/identity/rules'
import type { AccessCheck, AccessCheckResult, AccessOutcome, IdentityCapability, IdentityScope } from '@/lib/identity/types'

// The identity tables are reached only from here, with the service role, and only through the customer_* functions that recheck
// the actor. The actor is always the auth user the SERVER resolved (an `AccessOutcome` from requireIdentityAccess), never a value
// from a request body. Nothing here is exported to a browser component (server-only).

const asResult = (data: unknown): AccessCheckResult => {
  const row = data as Partial<Record<string, unknown>> | null
  if (row && row.ok === true && row.via === 'legacy_owner' && typeof row.staff_id === 'string') return { ok: true, via: 'legacy_owner', staff_id: row.staff_id }
  if (row && row.ok === true && row.via === 'grant' && typeof row.grant_id === 'string' && typeof row.principal_id === 'string') return { ok: true, via: 'grant', grant_id: row.grant_id, principal_id: row.principal_id }
  // anything else, including an answer of an unknown shape, is a refusal
  return { ok: false, error: row && row.error === 'bad_request' ? 'bad_request' : 'denied' }
}

/** public.customer_access_check. Throws when the database cannot be asked (the guard turns that into 503, never into access). */
export const identityAccessCheck: AccessCheck = async (args) => {
  const { data, error } = await createServiceRoleClient().rpc('customer_access_check', {
    p_auth_user_id: args.authUserId,
    p_capability: args.capability,
    p_business_id: args.businessId,
    p_organization_id: args.organizationId,
    p_department_id: args.departmentId,
  })
  if (error) throw error
  return asResult(data)
}

export type GrantResult = { ok: true; status: 'created' | 'unchanged' | 'revoked'; grantId: string } | { ok: false; error: 'denied' | 'bad_request' }

const asGrantResult = (data: unknown): GrantResult => {
  const row = data as Partial<Record<string, unknown>> | null
  if (row && row.ok === true && typeof row.grant_id === 'string' && (row.status === 'created' || row.status === 'unchanged' || row.status === 'revoked')) return { ok: true, status: row.status, grantId: row.grant_id }
  const error = row && typeof row.error === 'string' ? row.error : 'denied'
  return { ok: false, error: error === 'bad_request' ? 'bad_request' : 'denied' }
}

/**
 * public.customer_access_grant: one capability in one exact scope for one principal, with its audit row. `actor` must be the
 * outcome of a guard that already passed; the function rechecks that actor's authority for the TARGET scope in the database.
 */
export async function grantIdentityAccess(
  actor: Extract<AccessOutcome, { ok: true }>,
  target: { principalId: string; capability: IdentityCapability; scope: IdentityScope; expiresAt?: Date | null; reason?: string | null },
): Promise<GrantResult> {
  const args = accessCheckArgs(actor.authUserId, target.capability, target.scope)
  const { data, error } = await createServiceRoleClient().rpc('customer_access_grant', {
    p_actor_auth_user_id: actor.authUserId,
    p_principal_id: target.principalId,
    p_capability: target.capability,
    p_business_id: args.businessId,
    p_organization_id: args.organizationId,
    p_department_id: args.departmentId,
    p_expires_at: target.expiresAt ? target.expiresAt.toISOString() : null,
    p_reason: target.reason ?? null,
  })
  if (error) throw error
  return asGrantResult(data)
}

/** public.customer_access_revoke: ends a grant now, with its audit row. The database rechecks the actor against the grant's scope. */
export async function revokeIdentityAccess(actor: Extract<AccessOutcome, { ok: true }>, grantId: string, reason?: string | null): Promise<GrantResult> {
  const { data, error } = await createServiceRoleClient().rpc('customer_access_revoke', {
    p_actor_auth_user_id: actor.authUserId,
    p_grant_id: grantId,
    p_reason: reason ?? null,
  })
  if (error) throw error
  return asGrantResult(data)
}

/** The business a trusted route stands for, by its fixed slug (never by a value from the request). Null when it is not active. */
export async function findActiveBusinessBySlug(slug: string): Promise<{ id: string; slug: string } | null> {
  const { data, error } = await createServiceRoleClient().from('customer_businesses').select('id, slug').eq('slug', slug).eq('state', 'active').maybeSingle()
  if (error) throw error
  return data ? { id: String(data.id), slug: String(data.slug) } : null
}
