// The staff list's shapes, shared by the list, the add sheet and the edit sheet.

export type BranchOption = { id: string; slug: string; name: { he?: string; en?: string; ar?: string } }

export type StaffRow = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  display_name: string | null
  /** The one name every screen shows (display name → first+last → nickname → email). Resolved server-side. */
  label: string
  phone: string | null
  role: 'staff' | 'owner'
  badge: string | null
  branch_id: string | null
  active: boolean
  claimed_at: string | null
  /** POS nickname. null/absent only for a row the API predates. */
  handle?: string | null
  /** null = the person has not yet confirmed (or chosen) their own nickname. */
  handle_set_at?: string | null
  colour?: string | null
  /** Quick-login employee number, and whether a passcode exists -- never the passcode. */
  employee_no?: string | null
  has_passcode?: boolean
  /** Has signed in with Google (their login is linked to this record). */
  has_google?: boolean
}

export type ScheduleMemberRow = { branch_id: string; staff_id: string; schedulable: boolean }

export type StaffDetail = {
  hasHistory: boolean
  futureShifts: number
  audit: { id: string; actorName: string | null; summary: string | null; createdAt: string }[]
}

/** A refusal's machine reason, wherever the route put it. Never shown -- only mapped to words. */
export function reasonOf(payload: unknown): string | null {
  const p = payload as { reason?: unknown; error?: { reason?: unknown; details?: { reason?: unknown } } } | null
  const r = p?.error?.details?.reason ?? p?.error?.reason ?? p?.reason
  return typeof r === 'string' ? r : null
}

export function messageOf(payload: unknown, fallback: string): string {
  const m = (payload as { error?: { message?: unknown } } | null)?.error?.message
  return typeof m === 'string' && m ? m : fallback
}
