import 'server-only'

import { ApiError } from '@/lib/http/errors'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Organizations, departments and department-head invitations (FABLE-002). Every read and write goes through a customer_*
// function of 20261112162132_customer_org_management.sql, called with the service role and with the auth user the SERVER resolved
// as its first argument: the function rechecks that actor in the database, so nothing here decides authority and no table is
// touched directly. Server-only.

/** The identity system could not be asked (the database is down, or the migration is not applied here). Never access, never 500. */
export const identityUnavailable = () => new ApiError(503, 'unavailable', 'הניהול הזה אינו זמין כרגע. נסו שוב בעוד רגע.')

type Row = Record<string, unknown>
type Refusal = { ok: false; error: 'denied' | 'bad_request' | 'conflict' | 'limit' }

async function call(name: string, args: Record<string, unknown>): Promise<Row> {
  let answer: { data: unknown; error: unknown }
  try {
    answer = await createServiceRoleClient().rpc(name, args)
  } catch {
    throw identityUnavailable()
  }
  if (answer.error || !answer.data || typeof answer.data !== 'object') throw identityUnavailable()
  return answer.data as Row
}

/** A refusal exactly as the database gave it; anything unexpected is 'denied', never a pass. */
const refusal = (row: Row): Refusal => ({
  ok: false,
  error: row.error === 'bad_request' || row.error === 'conflict' || row.error === 'limit' ? row.error : 'denied',
})
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const list = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : [])

// ---------------------------------------------------------------- who may manage an organization

export type ManageCheck =
  | { ok: true; via: 'organization_admin' | 'setup' }
  | { ok: false; error: 'denied' | 'bad_request' }

/** public.customer_org_manage_check: an organization administrator, or a business in setup (no live administrator yet). */
export async function identityManageCheck(authUserId: string, organizationId: string, anyState = false): Promise<ManageCheck> {
  const row = await call('customer_org_manage_check', { p_auth_user_id: authUserId, p_organization_id: organizationId, p_any_state: anyState })
  if (row.ok === true && (row.via === 'organization_admin' || row.via === 'setup')) return { ok: true, via: row.via }
  return { ok: false, error: row.error === 'bad_request' ? 'bad_request' : 'denied' }
}

// ---------------------------------------------------------------- organizations

export type OrganizationSummary = {
  id: string
  name: string
  state: 'active' | 'inactive'
  agreementState: string
  hasAdmin: boolean
  canManage: boolean
  departments: number
}

export async function listOrganizations(actorAuthUserId: string, businessId: string): Promise<{ ok: true; organizations: OrganizationSummary[] } | Refusal> {
  const row = await call('customer_org_list', { p_actor_auth_user_id: actorAuthUserId, p_business_id: businessId })
  if (row.ok !== true) return refusal(row)
  return {
    ok: true,
    organizations: list(row.organizations).map((o) => ({
      id: text(o.id),
      name: text(o.name),
      state: o.state === 'inactive' ? 'inactive' : 'active',
      agreementState: text(o.agreement_state),
      hasAdmin: o.has_admin === true,
      canManage: o.can_manage === true,
      departments: Number(o.departments) || 0,
    })),
  }
}

export async function createOrganization(actorAuthUserId: string, businessId: string, name: string): Promise<{ ok: true; organizationId: string } | Refusal> {
  const row = await call('customer_org_create', { p_actor_auth_user_id: actorAuthUserId, p_business_id: businessId, p_name: name })
  return row.ok === true && typeof row.organization_id === 'string' ? { ok: true, organizationId: row.organization_id } : refusal(row)
}

export type Changed = { ok: true; status: string } | Refusal
const changed = (row: Row): Changed => (row.ok === true ? { ok: true, status: text(row.status) } : refusal(row))

export async function updateOrganization(actorAuthUserId: string, organizationId: string, patch: { name?: string; state?: 'active' | 'inactive' }): Promise<Changed> {
  return changed(await call('customer_org_update', { p_actor_auth_user_id: actorAuthUserId, p_organization_id: organizationId, p_name: patch.name ?? null, p_state: patch.state ?? null }))
}

export type OrganizationDetail = {
  via: 'organization_admin' | 'setup'
  organization: { id: string; name: string; state: 'active' | 'inactive' }
  departments: Array<{ id: string; name: string; state: 'active' | 'inactive' }>
  heads: Array<{ grantId: string; departmentId: string; grantedAt: string; hint: string | null }>
  invitations: Array<{ id: string; departmentId: string; hint: string; createdAt: string; expiresAt: string; status: 'pending' | 'accepted' | 'revoked' | 'expired' }>
}

const STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const

export async function organizationDetail(actorAuthUserId: string, organizationId: string): Promise<({ ok: true } & OrganizationDetail) | Refusal> {
  const row = await call('customer_org_detail', { p_actor_auth_user_id: actorAuthUserId, p_organization_id: organizationId })
  const org = row.organization as Row | null
  if (row.ok !== true || !org || typeof org !== 'object') return refusal(row)
  return {
    ok: true,
    via: row.via === 'organization_admin' ? 'organization_admin' : 'setup',
    organization: { id: text(org.id), name: text(org.name), state: org.state === 'inactive' ? 'inactive' : 'active' },
    departments: list(row.departments).map((d) => ({ id: text(d.id), name: text(d.name), state: d.state === 'inactive' ? 'inactive' : 'active' })),
    heads: list(row.heads).map((h) => ({ grantId: text(h.grant_id), departmentId: text(h.department_id), grantedAt: text(h.granted_at), hint: typeof h.hint === 'string' ? h.hint : null })),
    invitations: list(row.invitations).map((i) => ({
      id: text(i.id),
      departmentId: text(i.department_id),
      hint: text(i.hint),
      createdAt: text(i.created_at),
      expiresAt: text(i.expires_at),
      status: (STATUSES as readonly string[]).includes(text(i.status)) ? (text(i.status) as (typeof STATUSES)[number]) : 'expired',
    })),
  }
}

// ---------------------------------------------------------------- departments

export async function createDepartment(actorAuthUserId: string, organizationId: string, name: string): Promise<{ ok: true; departmentId: string } | Refusal> {
  const row = await call('customer_department_create', { p_actor_auth_user_id: actorAuthUserId, p_organization_id: organizationId, p_name: name })
  return row.ok === true && typeof row.department_id === 'string' ? { ok: true, departmentId: row.department_id } : refusal(row)
}

export async function updateDepartment(actorAuthUserId: string, organizationId: string, departmentId: string, patch: { name?: string; state?: 'active' | 'inactive' }): Promise<Changed> {
  return changed(await call('customer_department_update', {
    p_actor_auth_user_id: actorAuthUserId, p_organization_id: organizationId, p_department_id: departmentId, p_name: patch.name ?? null, p_state: patch.state ?? null,
  }))
}

// ---------------------------------------------------------------- invitations and heads

export async function createInvitation(
  actorAuthUserId: string,
  invitation: { organizationId: string; departmentId: string; tokenDigest: string; recipientDigest: string; recipientHint: string; expiresAt: Date },
): Promise<{ ok: true; invitationId: string } | Refusal> {
  const row = await call('customer_invitation_create', {
    p_actor_auth_user_id: actorAuthUserId,
    p_organization_id: invitation.organizationId,
    p_department_id: invitation.departmentId,
    p_token_digest: invitation.tokenDigest,
    p_recipient_digest: invitation.recipientDigest,
    p_recipient_hint: invitation.recipientHint,
    p_expires_at: invitation.expiresAt.toISOString(),
  })
  return row.ok === true && typeof row.invitation_id === 'string' ? { ok: true, invitationId: row.invitation_id } : refusal(row)
}

export async function revokeInvitation(actorAuthUserId: string, invitationId: string): Promise<Changed> {
  return changed(await call('customer_invitation_revoke', { p_actor_auth_user_id: actorAuthUserId, p_invitation_id: invitationId, p_reason: null }))
}

export async function revokeDepartmentHead(actorAuthUserId: string, grantId: string): Promise<Changed> {
  return changed(await call('customer_department_head_revoke', { p_actor_auth_user_id: actorAuthUserId, p_grant_id: grantId, p_reason: null }))
}

/** What the invitation page may show the signed-in intended recipient before they accept; null for everyone and everything else. */
export async function peekInvitation(tokenDigest: string, authUserId: string, recipient: string): Promise<{ organizationName: string; departmentName: string; expiresAt: string } | null> {
  const row = await call('customer_invitation_peek', { p_token_digest: tokenDigest, p_auth_user_id: authUserId, p_recipient_digest: recipient })
  if (row.ok !== true) return null
  return { organizationName: text(row.organization_name), departmentName: text(row.department_name), expiresAt: text(row.expires_at) }
}

/** Acceptance: one transaction in the database, once. Null = refused (the database does not say why, and neither do we). */
export async function acceptInvitation(tokenDigest: string, authUserId: string, recipient: string): Promise<{ organizationId: string; departmentId: string } | null> {
  const row = await call('customer_invitation_accept', { p_token_digest: tokenDigest, p_auth_user_id: authUserId, p_recipient_digest: recipient })
  if (row.ok !== true || row.status !== 'accepted') return null
  return { organizationId: text(row.organization_id), departmentId: text(row.department_id) }
}

// ---------------------------------------------------------------- what the signed-in user holds

export type ManageScopes = {
  /** Every organization the person administers, switched-off ones included (state shown) so they can be switched back on. */
  organizations: Array<{ organizationId: string; name: string; state: 'active' | 'inactive' }>
  departments: Array<{ organizationId: string; organizationName: string; departmentId: string; departmentName: string }>
}

export async function manageScopes(authUserId: string): Promise<ManageScopes> {
  const row = await call('customer_manage_scopes', { p_auth_user_id: authUserId })
  if (row.ok !== true) throw identityUnavailable()
  return {
    organizations: list(row.organizations).map((o) => ({ organizationId: text(o.organization_id), name: text(o.name), state: o.state === 'active' ? 'active' as const : 'inactive' as const })),
    departments: list(row.departments).map((d) => ({
      organizationId: text(d.organization_id), organizationName: text(d.organization_name), departmentId: text(d.department_id), departmentName: text(d.department_name),
    })),
  }
}
