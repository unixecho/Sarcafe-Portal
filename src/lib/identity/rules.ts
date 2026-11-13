// Pure rules of the identity foundation. Every rule here has its twin in the database (customer_access_check and the CHECK
// constraints of 20261112125033_customer_identity_foundation.sql); the database is the authority, these keep a bad question from
// being asked at all. No database, no secrets.
import { isOp } from '@/lib/staff/access'
import type { AccessCheckArgs, IdentityCapability, IdentityScope, IdentitySession } from '@/lib/identity/types'

export const IDENTITY_CAPABILITIES: readonly IdentityCapability[] = ['business_admin', 'organization_admin', 'department_head']

/** The one scope shape each capability lives in (the grant table's CHECK says the same). */
export const SCOPE_OF: Record<IdentityCapability, IdentityScope['kind']> = {
  business_admin: 'business',
  organization_admin: 'organization',
  department_head: 'department',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
export const isCapability = (value: unknown): value is IdentityCapability => typeof value === 'string' && (IDENTITY_CAPABILITIES as readonly string[]).includes(value)

/**
 * A scope as the rules accept it, or null. Exactly the fields of its kind, each a UUID: an extra field (a business id on an
 * organization scope, say) is refused instead of ignored, so a caller can never widen a scope by adding one.
 */
export function normalizeScope(input: unknown): IdentityScope | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const keys = Object.keys(raw).filter((key) => raw[key] !== undefined).sort().join(',')
  if (raw.kind === 'business') return keys === 'businessId,kind' && isUuid(raw.businessId) ? { kind: 'business', businessId: raw.businessId } : null
  if (raw.kind === 'organization') return keys === 'kind,organizationId' && isUuid(raw.organizationId) ? { kind: 'organization', organizationId: raw.organizationId } : null
  if (raw.kind === 'department') {
    return keys === 'departmentId,kind,organizationId' && isUuid(raw.organizationId) && isUuid(raw.departmentId)
      ? { kind: 'department', organizationId: raw.organizationId, departmentId: raw.departmentId }
      : null
  }
  return null
}

/** A capability may only be asked for in its own scope shape. */
export const capabilityFitsScope = (capability: IdentityCapability, scope: IdentityScope): boolean => SCOPE_OF[capability] === scope.kind

/** Identity administration needs a verified auth user whose CURRENT session is a proven Google sign-in. Nothing else qualifies. */
export const hasFullIdentitySession = (session: IdentitySession | null | undefined): session is IdentitySession & { authUserId: string } =>
  !!session && session.via === 'google' && session.full === true && isUuid(session.authUserId)

/**
 * The legacy rule: an existing staff owner administers the ONE business flagged for it (Sarcafe) without a stored grant, and
 * nothing else. A general manager, an ordinary employee and an external administrator never pass. The database decides which
 * business is flagged; this only says whether the caller is such an owner.
 */
export const isLegacyOwnerSession = (session: IdentitySession | null | undefined): boolean => hasFullIdentitySession(session) && isOp(session.staff)

/** The arguments of public.customer_access_check for a capability in a scope. */
export function accessCheckArgs(authUserId: string, capability: IdentityCapability, scope: IdentityScope): AccessCheckArgs {
  return {
    authUserId,
    capability,
    businessId: scope.kind === 'business' ? scope.businessId : null,
    organizationId: scope.kind === 'business' ? null : scope.organizationId,
    departmentId: scope.kind === 'department' ? scope.departmentId : null,
  }
}
