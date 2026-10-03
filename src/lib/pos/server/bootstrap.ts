// Everything the staff app needs to paint its first screen. Used by BOTH
// GET /api/pos/bootstrap (a refresh) and the /pos page (first paint, rendered into
// props), so the two can never describe the world differently.
//
// "Not enabled yet" is a STATE here, not an error: an owner who opens /pos before
// switching the POS on should read a friendly sentence, not hit a 409. So the branch
// comes back with `enabled: false` and the heavy parts (session, points, menu) are
// simply left empty — there is nothing to work on yet, and nothing for a till to
// show for an event that has not opened.
//
// Service-role reads. The caller has resolved the identity (guard.ts); `staffId` is
// that identity, never a request field.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { hasAnyMenuEditAccess, canEditMenu } from '@/lib/staff/access'
import type { BootstrapResponse, BranchLite } from '@/lib/pos/api'
import {
  DIRECTORY_COLUMNS, POINT_COLUMNS, POINT_STAFF_COLUMNS, ROUTE_COLUMNS, SESSION_COLUMNS,
} from '@/lib/pos/columns'
import type { PosPoint, PosPointStaff, PosRoute, PosSession, StaffDirEntry } from '@/lib/pos/types'
import { canAccessBranch, isUuid, posError, type PosStaffRow } from './guard'
import { sessionIsQuick } from './quick-login'
import { loadPosMenu } from './menu'

export type BootstrapInput = {
  /** the resolved identity's staff id — never taken from a request */
  staffId: string
  /** a slug or uuid the caller asked for; absent = pick sensibly */
  branchRef?: string | null
  /** the already-resolved row, to spare a second read (it must be the same person) */
  staff?: PosStaffRow | null
  /** whether this session is a quick-login one; read from the session when not given */
  quick?: boolean
}

type Res = { data: unknown; error: { code?: string } | null }

/** A failed read is a 500, never an empty list the UI would take as "there are none". */
function ok<T>(label: string, res: Res, fallback: T): T {
  if (res.error) {
    console.error(`bootstrap: ${label} read failed:`, res.error.code)
    throw posError('internal_error')
  }
  return (res.data as T | null) ?? fallback
}

type BranchRow = { id: string; slug: string; name: BranchLite['name'] | null; kind: string | null }
const toLite = (r: BranchRow): BranchLite => ({
  id: r.id,
  slug: r.slug,
  name: r.name ?? { he: r.slug },
  kind: r.kind === 'event' ? 'event' : 'permanent',
})

export async function loadBootstrap(input: BootstrapInput): Promise<BootstrapResponse> {
  const service = createServiceRoleClient()

  // ---- who ---------------------------------------------------------------------
  let staff: PosStaffRow | null = input.staff && input.staff.id === input.staffId ? input.staff : null
  if (!staff) {
    const { data } = await service
      .from('staff')
      .select('id, auth_user_id, role, badge, branch_id, active, email, display_name, handle, handle_set_at, colour')
      .eq('id', input.staffId)
      .eq('active', true)
      .maybeSingle()
    staff = (data as unknown as PosStaffRow | null) ?? null
  }
  if (!staff) throw posError('forbidden')

  // ---- which branch --------------------------------------------------------------
  // Both tables are a handful of rows; reading them whole is cheaper than being clever.
  const [branchesRes, enabledRes] = await Promise.all([
    service.from('branches').select('id, slug, name, kind').eq('active', true).order('created_at', { ascending: true }),
    service.from('pos_branch_settings').select('branch_id').eq('enabled', true),
  ])
  const allBranches = ok<BranchRow[]>('branches', branchesRes as unknown as Res, [])
  const enabledIds = new Set(ok<{ branch_id: string }[]>('pos_branch_settings', enabledRes as unknown as Res, []).map((r) => r.branch_id))

  const mayWork = allBranches.filter((b) => canAccessBranch(staff, b.id))
  const workable = mayWork.filter((b) => enabledIds.has(b.id))

  let chosen: BranchRow | null = null
  const ref = input.branchRef?.trim()
  if (ref) {
    const hit = allBranches.find((b) => (isUuid(ref) ? b.id === ref : b.slug === ref))
    if (!hit) throw posError('not_found')
    if (!canAccessBranch(staff, hit.id)) throw posError('forbidden')
    chosen = hit
  } else if (workable.length >= 1) {
    // The single enabled branch, or — when a person may work several — the first. The
    // device remembers its own choice client-side; this is only the first-ever default.
    chosen = workable[0] ?? null
  } else if (staff.branch_id) {
    // Nothing is switched on: show the person's own branch so the message can name it.
    chosen = mayWork.find((b) => b.id === staff!.branch_id) ?? null
  }

  const branch = chosen ? toLite(chosen) : null
  const enabled = chosen ? enabledIds.has(chosen.id) : false

  // Quick-login facts. The hash is read only to answer "is a code set" and is never
  // returned; a failed read just hides the Me sheet's code row, it does not break the app.
  const [quick, quickFacts] = await Promise.all([
    input.quick ?? staff.quick ?? sessionIsQuick().catch(() => true),
    service.from('staff').select('employee_no, pin_hash').eq('id', staff.id).maybeSingle(),
  ])
  const facts = (quickFacts.data as { employee_no: number | null; pin_hash: string | null } | null) ?? null

  const me = {
    id: staff.id,
    handle: staff.handle,
    handleConfirmed: staff.handle_set_at !== null && staff.handle_set_at !== undefined,
    colour: staff.colour ?? null,
    // A quick-login session is floor work only: never a manager, whatever the person is.
    isManager: !quick && (chosen ? canEditMenu(staff, chosen.id) : hasAnyMenuEditAccess(staff)),
    employeeNo: facts?.employee_no ?? null,
    hasPasscode: facts?.pin_hash != null,
    quickSession: quick,
  }

  // `staff` is read directly (id, handle, colour only — exactly what the
  // pos_staff_directory view exposes). The view itself is gated by auth.uid() through
  // is_staff_client(), and under the service role auth.uid() is null: it would
  // return zero rows here.
  const directoryRes = await service.from('staff').select(DIRECTORY_COLUMNS).order('handle', { ascending: true })
  const directory = ok<StaffDirEntry[]>('staff directory', directoryRes as unknown as Res, [])

  const base: BootstrapResponse = {
    me,
    branches: workable.map(toLite),
    branch,
    enabled,
    session: null,
    points: [],
    routes: [],
    pointStaff: [],
    unsold: [],
    menu: null,
    directory,
    serverTime: new Date().toISOString(),
  }
  if (!chosen || !enabled) return base

  // ---- the branch's working state --------------------------------------------------
  const [sessionRes, pointsRes, routesRes, settingsRes, menu] = await Promise.all([
    service.from('pos_sessions').select(SESSION_COLUMNS).eq('branch_id', chosen.id).eq('status', 'active').maybeSingle(),
    service.from('pos_points').select(POINT_COLUMNS).eq('branch_id', chosen.id).eq('active', true).order('sort_order', { ascending: true }).order('name', { ascending: true }),
    service.from('pos_point_routes').select(ROUTE_COLUMNS).eq('branch_id', chosen.id),
    service.from('pos_branch_settings').select('unsold_refs').eq('branch_id', chosen.id).maybeSingle(),
    loadPosMenu(chosen.id),
  ])

  const points = ok<PosPoint[]>('pos_points', pointsRes as unknown as Res, [])
  const pointStaffRes =
    points.length === 0
      ? ({ data: [], error: null } as Res)
      : ((await service
          .from('pos_point_staff')
          .select(POINT_STAFF_COLUMNS)
          .in('point_id', points.map((p) => p.id))) as unknown as Res)

  return {
    ...base,
    session: ok<PosSession | null>('pos_sessions', sessionRes as unknown as Res, null),
    points,
    routes: ok<PosRoute[]>('pos_point_routes', routesRes as unknown as Res, []),
    pointStaff: ok<PosPointStaff[]>('pos_point_staff', pointStaffRes, []),
    unsold: ok<{ unsold_refs?: string[] } | null>('pos_branch_settings', settingsRes as unknown as Res, null)?.unsold_refs ?? [],
    menu,
  }
}
