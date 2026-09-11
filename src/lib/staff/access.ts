// Authorization model, mirrored from AyekaBar's src/lib/staff/access.ts.
//
// Two axes, kept deliberately separate (this is the load-bearing idea to
// preserve): `role` is the actual authorization bit; `badge` is a display
// job title that ALSO happens to grant capabilities for two specific
// values ('owner', 'general_manager') — badges can imply admin trust
// because a business can have co-owners who were never given role='owner'
// directly. Every predicate here must have an exact SQL twin (see
// supabase/migrations/002_staff_roles.sql) — a rule that diverges between
// the two layers is the single bug class AyekaBar's own history warns
// about most.
//
// Sarcafe addition (AyekaBar has no equivalent): `branch_id`. `null` means
// all-branch access (an owner, or a general manager who runs both
// locations); a real id scopes MENU-level access to that branch only.
// `isOp()` is never branch-scoped — a true owner has full access to every
// branch by definition.

export type AccessRow = {
  role?: string | null
  badge?: string | null
  branch_id?: string | null
}

/** Full admin — "OP." Everything, no exceptions, at every branch. */
export function isOp(row: AccessRow | null | undefined): boolean {
  if (!row) return false
  return row.role === 'owner' || row.badge === 'owner'
}

/**
 * Menu-editor access for a specific branch. OP can edit any branch's menu.
 * A general_manager can edit a branch's menu only if their own branch_id is
 * null (all-branch GM) or matches the branch being edited.
 */
export function canEditMenu(row: AccessRow | null | undefined, branchId: string): boolean {
  if (!row) return false
  if (isOp(row)) return true
  if (row.badge !== 'general_manager') return false
  return row.branch_id === null || row.branch_id === undefined || row.branch_id === branchId
}

/** Baseline — any row in `staff` at all grants the staff app itself. */
export function isStaff(row: AccessRow | null | undefined): boolean {
  return !!row
}

/**
 * Coarse "can edit a menu somewhere" check, ignoring which branch — used
 * only by middleware to gate route access before a branch is known from
 * the URL. The real per-branch decision is canEditMenu() above, resolved
 * again server-side on the page/API once the branch is known (mirrors
 * AyekaBar's own documented pattern of deferring the finer check downstream
 * rather than teaching middleware every route's branch parameter).
 */
export function hasAnyMenuEditAccess(row: AccessRow | null | undefined): boolean {
  if (!row) return false
  return isOp(row) || row.badge === 'general_manager'
}
