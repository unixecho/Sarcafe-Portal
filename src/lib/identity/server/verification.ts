import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { CREDENTIAL_TOKEN_PREFIX } from '@/lib/identity/verification'
import { identityUnavailable } from '@/lib/identity/server/organizations'
import { createServiceRoleClient } from '@/lib/supabase/server'

// QR credentials, scanner grants and verifications (FABLE-004). Every call goes through a customer_* function of
// 20261124084601_customer_identity_verification.sql with the service role and with the auth user the SERVER resolved; the function
// rechecks that actor. Nothing here decides authority. Server-only.

type Row = Record<string, unknown>
export type Refusal = { ok: false; error: 'denied' | 'bad_request' | 'conflict' | 'limit' | 'stale' | 'expired' }

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
const REFUSALS = ['bad_request', 'conflict', 'limit', 'stale', 'expired'] as const
const refusal = (row: Row): Refusal => ({ ok: false, error: (REFUSALS as readonly unknown[]).includes(row.error) ? (row.error as Refusal['error']) : 'denied' })
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const list = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : [])

/** A fresh card token, and the digest the database stores (the purpose is part of it). */
export const newCredentialToken = (): string => CREDENTIAL_TOKEN_PREFIX + randomBytes(32).toString('base64url')
export const credentialTokenDigest = (token: string) => createHash('sha256').update(`sarcafe:identity:credential:organization_member:v1:${token}`, 'utf8').digest('hex')

// ---------------------------------------------------------------- the employee's card

export async function issueCredential(authUserId: string, membershipId: string, tokenDigest: string, expiresAt: Date): Promise<{ ok: true; expiresAt: string } | Refusal> {
  const row = await call('customer_credential_issue', { p_auth_user_id: authUserId, p_membership_id: membershipId, p_token_digest: tokenDigest, p_expires_at: expiresAt.toISOString() })
  return row.ok === true ? { ok: true, expiresAt: text(row.expires_at) } : refusal(row)
}

export async function revokeCredentials(authUserId: string, membershipId: string): Promise<{ ok: true; status: string } | Refusal> {
  const row = await call('customer_credential_revoke', { p_auth_user_id: authUserId, p_membership_id: membershipId })
  return row.ok === true ? { ok: true, status: text(row.status) } : refusal(row)
}

// ---------------------------------------------------------------- the scanner

export type ScannerScope = { branches: Array<{ branchId: string; name: string }> }

/** The branches of the business this operator may scan at (their live grants), with their names. Refused: no grant at all. */
export async function scannerScope(authUserId: string, businessId: string): Promise<({ ok: true } & ScannerScope) | Refusal> {
  const row = await call('customer_scanner_scope', { p_auth_user_id: authUserId, p_business_id: businessId })
  if (row.ok !== true) return refusal(row)
  return { ok: true, branches: list(row.branches).map((b) => ({ branchId: text(b.branch_id), name: text(b.name) })) }
}

export type ScanView = { verificationId: string; expiresAt: string; firstName: string; lastName: string | null; nickname: string | null; organizationName: string; departmentName: string }

export async function scanCredential(authUserId: string, businessId: string, branchId: string, tokenDigest: string): Promise<({ ok: true } & ScanView) | Refusal> {
  const row = await call('customer_verification_scan', { p_actor_auth_user_id: authUserId, p_business_id: businessId, p_branch_id: branchId, p_token_digest: tokenDigest })
  if (row.ok !== true || typeof row.verification_id !== 'string') return refusal(row)
  return {
    ok: true, verificationId: row.verification_id, expiresAt: text(row.expires_at), firstName: text(row.first_name), lastName: textOrNull(row.last_name), nickname: textOrNull(row.nickname),
    organizationName: text(row.organization_name), departmentName: text(row.department_name),
  }
}

export async function verificationPhoto(authUserId: string, verificationId: string): Promise<{ objectPath: string; sha256: string } | null> {
  const row = await call('customer_verification_photo', { p_actor_auth_user_id: authUserId, p_verification_id: verificationId })
  return row.ok === true && typeof row.object_path === 'string' ? { objectPath: row.object_path, sha256: text(row.sha256) } : null
}

export async function decideVerification(authUserId: string, verificationId: string, decision: string): Promise<{ ok: true; status: string } | Refusal> {
  const row = await call('customer_verification_decide', { p_actor_auth_user_id: authUserId, p_verification_id: verificationId, p_decision: decision })
  return row.ok === true ? { ok: true, status: text(row.status) } : refusal(row)
}

// ---------------------------------------------------------------- managing scanners (the owner)

export type ScannerStaff = { staffId: string; name: string; grants: Array<{ grantId: string; branchId: string | null; grantedAt: string }> }
export type ScannerList = { staff: ScannerStaff[]; branches: Array<{ branchId: string; name: string }> }

export async function listScanners(actor: string, businessId: string): Promise<({ ok: true } & ScannerList) | Refusal> {
  const row = await call('customer_scanner_list', { p_actor_auth_user_id: actor, p_business_id: businessId })
  if (row.ok !== true) return refusal(row)
  return {
    ok: true,
    staff: list(row.staff).map((s) => ({ staffId: text(s.staff_id), name: text(s.name), grants: list(s.grants).map((g) => ({ grantId: text(g.grant_id), branchId: textOrNull(g.branch_id), grantedAt: text(g.granted_at) })) })),
    branches: list(row.branches).map((b) => ({ branchId: text(b.branch_id), name: text(b.name) })),
  }
}

export async function grantScanner(actor: string, businessId: string, staffId: string, branchId: string | null): Promise<{ ok: true; status: string; grantId: string } | Refusal> {
  const row = await call('customer_scanner_grant', { p_actor_auth_user_id: actor, p_business_id: businessId, p_staff_id: staffId, p_branch_id: branchId })
  return row.ok === true && typeof row.grant_id === 'string' ? { ok: true, status: text(row.status), grantId: row.grant_id } : refusal(row)
}

export async function revokeScanner(actor: string, grantId: string): Promise<{ ok: true; status: string } | Refusal> {
  const row = await call('customer_scanner_revoke', { p_actor_auth_user_id: actor, p_grant_id: grantId })
  return row.ok === true ? { ok: true, status: text(row.status) } : refusal(row)
}
