// Hybrid identity foundation (FABLE-001, docs/SARCAFE_IDENTITY.md). Pure types: no database, no secrets, safe to import anywhere.
//
// Three things are kept apart: who a person is (a private member id), what they belong to (a membership of ONE organization or ONE
// business) and what a signed-in user may administer (a capability in ONE exact scope). None of them is a staff row.

/** What a signed-in user may administer. Each capability belongs to exactly one scope shape (SCOPE_OF). */
export type IdentityCapability = 'business_admin' | 'organization_admin' | 'department_head'

/** One exact scope. There is no "everything" scope: a new operation always names its business, organization or department. */
export type IdentityScope =
  | { kind: 'business'; businessId: string }
  | { kind: 'organization'; organizationId: string }
  | { kind: 'department'; organizationId: string; departmentId: string }

/** The staff facts the identity rules read (the same columns as src/lib/staff/access.ts AccessRow, plus the id). */
export type IdentityStaff = { id: string; role?: string | null; badge?: string | null; branch_id?: string | null }

/**
 * Who is asking, as the SERVER resolved it (never from a request body):
 * - `authUserId`: the verified Supabase Auth subject, or null for a six-digit employee-code session (no auth user behind it);
 * - `full`: a full sign-in (Google), not a quick code session. Identity administration needs a full session;
 * - `staff`: the caller's existing staff row when they have one. An external administrator has none, and never gets one.
 */
export type IdentitySession = {
  authUserId: string | null
  via: 'google' | 'employee_code'
  full: boolean
  staff: IdentityStaff | null
}

/** The question put to the database (public.customer_access_check). Unused scope parts are null. */
export type AccessCheckArgs = {
  authUserId: string
  capability: IdentityCapability
  businessId: string | null
  organizationId: string | null
  departmentId: string | null
}

/** The database's answer. `denied` is the same for "no such target" and "not yours". */
export type AccessCheckResult =
  | { ok: true; via: 'legacy_owner'; staff_id: string }
  | { ok: true; via: 'grant'; grant_id: string; principal_id: string }
  | { ok: false; error: 'denied' | 'bad_request' }

export type AccessCheck = (args: AccessCheckArgs) => Promise<AccessCheckResult>

export type AccessDenial = 'unauthenticated' | 'full_session_required' | 'quick_session' | 'bad_scope' | 'denied' | 'unavailable'

export type AccessOutcome =
  | { ok: true; via: 'legacy_owner' | 'grant'; authUserId: string; capability: IdentityCapability; scope: IdentityScope; grantId: string | null; principalId: string | null; staffId: string | null }
  | { ok: false; status: 400 | 401 | 403 | 503; code: AccessDenial }
