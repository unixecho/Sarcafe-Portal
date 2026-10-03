// The base of the owner/manager server layer, and the setup checklist built on it.
//
//   * The small plumbing every owner read shares: `guarded` (a read that is
//     ALLOWED to fail), `fetchAll` (PostgREST caps a response at 1000 rows, so
//     anything that sums or lists pages with .range()), `cap`, the directory.
//   * The PUBLISHED menu as the owner sees it, variant-resolved — never the
//     draft, because the POS sells what customers can see.
//   * The readiness checklist (blueprint §9.5): one row per thing the owner has
//     to do before the event, each done / needs attention / blocked.
//
// POSTURE (the one src/lib/owner/signals.ts set): server-only, service role,
// EVERY read independent and swallowing its own failure. A broken query drops its
// own row to `known: false` — it never takes the page down, and it never reads as
// a confident "all done". Nothing here takes the service-role client from a
// global: the route creates it AFTER its guard and passes it in, which also keeps
// this module free of runtime server imports (the harness can load it).

import type { createServiceRoleClient } from '@/lib/supabase/server'
import type { Localized, MenuCategory, MenuDoc, MenuVariant, ModifierGroup } from '@/lib/menu/types'
import { applyVariant, resolveVariant } from '@/lib/menu/variants'
import { routeMenu, type RoutingContext } from '@/lib/pos/routing'
import {
  CHECKIN_COLUMNS, DIRECTORY_COLUMNS, POINT_COLUMNS, POINT_STAFF_COLUMNS, ROUTE_COLUMNS, SESSION_COLUMNS,
} from '@/lib/pos/columns'
import { LIVE_ITEM_STATUSES } from '@/lib/pos/vocab'
import type { PosCheckin, PosPoint, PosPointStaff, PosRoute, PosSession, StaffDirEntry } from '@/lib/pos/types'
import type {
  BoardRow, BranchInfo, CatalogueCategory, Capped, EventRow, Known, MenuRow, PeopleRow, PersonRow, PointConfig,
  PointSummary, PointsRow, PosStat, ReadinessId, ReadinessRow, RoutingRow, SessionLite, SessionRowSetup,
  SetupState, StaffRef, UnroutedItem,
} from '@/lib/pos/owner-api'

export type Service = ReturnType<typeof createServiceRoleClient>

// ======================================================================================
// Plumbing
// ======================================================================================

/** A read that may have failed. `data` is ALWAYS usable (an empty fallback), so a
 *  consumer can keep computing; `ok` is what says whether to believe it. */
export type Read<T> = { ok: boolean; data: T }

/** Runs a read; a throw becomes `{ ok:false, data: fallback }` — never a rejected promise. */
export async function guarded<T>(fallback: T, fn: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    // The code only. A PostgREST error message can echo a filter value, and some
    // filters here are a customer's phone digits.
    console.error('pos owner read failed:', err instanceof Error ? err.message.slice(0, 120) : 'unknown')
    return { ok: false, data: fallback }
  }
}

export const known = <T>(r: Read<T>): Known<T> => ({ known: r.ok, value: r.data })
export const stat = (r: Read<number>): PosStat => ({ known: r.ok, value: r.data })
/** A stat computed from several reads is known only if every one of them was. */
export const statFrom = (value: number, ...reads: Read<unknown>[]): PosStat => ({ known: reads.every((r) => r.ok), value })
export const knownFrom = <T>(value: T, ...reads: Read<unknown>[]): Known<T> => ({ known: reads.every((r) => r.ok), value })

type PageResult = { data: unknown; error: { code?: string } | null }

/** Throws on a failed page (the caller's `guarded` turns that into `known:false`). */
export function unwrap<T>(res: PageResult): T {
  if (res.error) throw new Error(`read failed (${res.error.code ?? 'unknown'})`)
  return res.data as T
}

const PAGE = 1000

/**
 * Pages through a query with .range(). PostgREST truncates a response at 1000
 * rows without saying so, so an event with 1,400 orders would silently report 1,000
 * — the sort of confident wrong number this layer exists to avoid. `build` MUST
 * carry a stable `.order(...)` ending in a unique column or pages can overlap.
 * `maxRows` is a runaway ceiling, not a feature: hitting it throws instead of
 * returning a quietly partial answer.
 */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<PageResult>, maxRows = 60_000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    if (from >= maxRows) throw new Error('read exceeded its row ceiling')
    const rows = unwrap<T[] | null>(await build(from, from + PAGE - 1)) ?? []
    for (const r of rows) out.push(r)
    if (rows.length < PAGE) break
  }
  return out
}

/** Cuts a list to a screen's worth; `total` is the length BEFORE the cut. */
export function cap<T>(rows: T[], n: number): Capped<T> {
  return { total: rows.length, rows: rows.length > n ? rows.slice(0, n) : rows }
}

export const iso = (ms: number): string => new Date(ms).toISOString()
export const ms = (t: string | null | undefined): number | null => {
  if (!t) return null
  const v = Date.parse(t)
  return Number.isFinite(v) ? v : null
}

// ======================================================================================
// Branch, people, sessions
// ======================================================================================

export async function readBranch(service: Service, branch: { id: string; slug: string }): Promise<BranchInfo> {
  const fallback: BranchInfo = { id: branch.id, slug: branch.slug, name: { he: branch.slug }, kind: 'permanent', timezone: 'Asia/Jerusalem' }
  const r = await guarded<BranchInfo>(fallback, async () => {
    const res = await service.from('branches').select('id, slug, name, kind, timezone').eq('id', branch.id).maybeSingle()
    const row = unwrap<{ id: string; slug: string; name: Localized | null; kind: string | null; timezone: string | null } | null>(res)
    if (!row) return fallback
    return {
      id: row.id,
      slug: row.slug,
      name: row.name ?? { he: row.slug },
      kind: row.kind === 'event' ? 'event' : 'permanent',
      timezone: row.timezone || 'Asia/Jerusalem',
    }
  })
  return r.data
}

/** Everyone's handle + colour. Not filtered by `active`: history keeps resolving the
 *  names of people who were later removed (the same rule as pos_staff_directory). */
export async function readDirectory(service: Service): Promise<Read<StaffDirEntry[]>> {
  return guarded<StaffDirEntry[]>([], async () => {
    const res = await service.from('staff').select(DIRECTORY_COLUMNS)
    return unwrap<StaffDirEntry[] | null>(res) ?? []
  })
}

export type DirectoryMap = ReadonlyMap<string, StaffDirEntry>
export const directoryMap = (dir: readonly StaffDirEntry[]): DirectoryMap => new Map(dir.map((d) => [d.id, d] as const))

/** A person as a row shows them. A deleted or unknown id resolves to null, never to a blank chip. */
export function staffRef(dir: DirectoryMap, id: string | null | undefined): StaffRef | null {
  if (!id) return null
  const d = dir.get(id)
  return d ? { id: d.id, handle: d.handle } : null
}

export async function readSessions(service: Service, branchId: string, limit = 40): Promise<PosSession[]> {
  const res = await service
    .from('pos_sessions')
    .select(SESSION_COLUMNS)
    .eq('branch_id', branchId)
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  return unwrap<PosSession[] | null>(res) ?? []
}

export function liteSession(s: PosSession, dir: DirectoryMap): SessionLite {
  return {
    ...s,
    started_by_handle: s.started_by ? (dir.get(s.started_by)?.handle ?? null) : null,
    ended_by_handle: s.ended_by ? (dir.get(s.ended_by)?.handle ?? null) : null,
  }
}

// ======================================================================================
// Points, routes, settings
// ======================================================================================

export async function readPoints(service: Service, branchId: string, opts: { includeInactive?: boolean } = {}): Promise<PosPoint[]> {
  let q = service.from('pos_points').select(POINT_COLUMNS).eq('branch_id', branchId)
  if (!opts.includeInactive) q = q.eq('active', true)
  const res = await q.order('sort_order', { ascending: true }).order('id', { ascending: true })
  return unwrap<PosPoint[] | null>(res) ?? []
}

export async function readRoutes(service: Service, branchId: string): Promise<PosRoute[]> {
  const res = await service.from('pos_point_routes').select(ROUTE_COLUMNS).eq('branch_id', branchId).order('id', { ascending: true })
  return unwrap<PosRoute[] | null>(res) ?? []
}

export async function readPointStaff(service: Service, pointIds: string[]): Promise<PosPointStaff[]> {
  if (pointIds.length === 0) return []
  const res = await service.from('pos_point_staff').select(POINT_STAFF_COLUMNS).in('point_id', pointIds)
  return unwrap<PosPointStaff[] | null>(res) ?? []
}

export type SettingsRow = { enabled: boolean; board_token: string | null; unsold_refs: string[]; updated_at: string | null }

/** pos_branch_settings has NO client grant at all (the board token lives in it) — service role only. */
export async function readSettingsRow(service: Service, branchId: string): Promise<SettingsRow | null> {
  const res = await service
    .from('pos_branch_settings')
    .select('enabled, board_token, unsold_refs, updated_at')
    .eq('branch_id', branchId)
    .maybeSingle()
  const row = unwrap<Partial<SettingsRow> | null>(res)
  if (!row) return null
  return {
    enabled: row.enabled === true,
    board_token: row.board_token ?? null,
    unsold_refs: Array.isArray(row.unsold_refs) ? row.unsold_refs : [],
    updated_at: row.updated_at ?? null,
  }
}

/** Lines waiting / being prepared / ready, per point — what blocks deactivating one. */
export async function readLiveCountsByPoint(service: Service, branchId: string): Promise<Record<string, number>> {
  const rows = await fetchAll<{ point_id: string }>((from, to) =>
    service
      .from('pos_order_items')
      .select('id, point_id')
      .eq('branch_id', branchId)
      .in('status', [...LIVE_ITEM_STATUSES])
      .order('id', { ascending: true })
      .range(from, to)
  )
  const out: Record<string, number> = {}
  for (const r of rows) out[r.point_id] = (out[r.point_id] ?? 0) + 1
  return out
}

export async function readCheckins(service: Service, branchId: string, sinceIso: string): Promise<PosCheckin[]> {
  return fetchAll<PosCheckin>((from, to) =>
    service
      .from('pos_point_checkins')
      .select(CHECKIN_COLUMNS)
      .eq('branch_id', branchId)
      .gte('at', sinceIso)
      .order('at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )
}

// ======================================================================================
// The published menu
// ======================================================================================

export type PublishedMenu = {
  /** variant-resolved: an item the live variant hides is not on sale, so it is not "unrouted" either */
  categories: MenuCategory[]
  modifierGroups: ModifierGroup[]
  publishedAt: string | null
  /** the draft differs from what is published — edited, never published */
  hasUnpublishedChanges: boolean
  itemCount: number
  categoryCount: number
  /** published items with no uid: they cannot be ordered or routed until the menu is republished */
  itemsWithoutUid: number
}

/** null = the branch has no menu row at all. THROWS on a failed read: "no menu" and
 *  "could not read the menu" must never look alike (one would flag every item). */
export async function readPublishedMenu(service: Service, branchId: string): Promise<PublishedMenu | null> {
  const menuRes = await service
    .from('menus')
    .select('id, draft, published, published_at, active_variant_id')
    .eq('branch_id', branchId)
    .maybeSingle()
  const menu = unwrap<{
    id: string
    draft: MenuDoc | null
    published: MenuDoc | null
    published_at: string | null
    active_variant_id: string | null
  } | null>(menuRes)
  if (!menu) return null

  const variantRes = await service.from('menu_variants').select('*').eq('menu_id', menu.id)
  const variants = unwrap<MenuVariant[] | null>(variantRes) ?? []

  const published: MenuDoc = menu.published ?? { categories: [] }
  const resolved = applyVariant(published, resolveVariant(variants, menu.active_variant_id, new Date()))
  const categories = resolved.categories ?? []
  let itemCount = 0
  let itemsWithoutUid = 0
  for (const c of categories) {
    for (const i of c.items ?? []) {
      itemCount++
      if (!i.uid) itemsWithoutUid++
    }
  }
  return {
    categories,
    modifierGroups: resolved.modifierGroups ?? [],
    publishedAt: menu.published_at,
    hasUnpublishedChanges: JSON.stringify(menu.draft ?? null) !== JSON.stringify(menu.published ?? null),
    itemCount,
    categoryCount: categories.length,
    itemsWithoutUid,
  }
}

export const routingContext = (points: PosPoint[], routes: PosRoute[], unsold: string[]): RoutingContext => ({ points, routes, unsold })

// ======================================================================================
// Points as the checklist and the wizard show them
// ======================================================================================

/** Pure. One card per active point: what it makes, in the owner's terms. */
export function buildPointSummaries(
  points: PosPoint[],
  routes: PosRoute[],
  pointStaff: PosPointStaff[],
  categories: MenuCategory[],
  unsold: string[],
  liveByPoint: Record<string, number>,
): PointSummary[] {
  const ctx = routingContext(points, routes, unsold)
  const routed = routeMenu(ctx, categories)
  const itemByUid = new Map<string, { name: Localized }>()
  for (const c of categories) for (const i of c.items ?? []) if (i.uid) itemByUid.set(i.uid, { name: { he: i.he, en: i.en, ar: i.ar } })

  return points
    .filter((p) => p.active)
    .map((p): PointSummary => {
      const mine = routes.filter((r) => r.point_id === p.id)
      const categoryIds = mine.filter((r) => r.kind === 'category').map((r) => r.ref)
      const itemUids = mine.filter((r) => r.kind === 'item').map((r) => r.ref)
      const config: PointConfig = {
        name: p.name,
        icon: p.icon as PointConfig['icon'],
        colour: p.colour,
        handsOver: p.hands_over,
        prepMinutes: p.prep_minutes,
        categoryIds,
        itemUids,
        excludedUids: p.excluded_uids ?? [],
        staffIds: pointStaff.filter((s) => s.point_id === p.id).map((s) => s.staff_id),
      }

      const perCategory = new Map<string, number>()
      let itemCount = 0
      for (const r of routed) {
        if (r.route.kind !== 'point' || r.route.pointId !== p.id) continue
        itemCount++
        perCategory.set(r.category.id, (perCategory.get(r.category.id) ?? 0) + 1)
      }
      const claimedWhole = new Set(categoryIds)
      const itemCategory = new Map<string, string>()
      for (const c of categories) for (const i of c.items ?? []) if (i.uid) itemCategory.set(i.uid, c.id)

      return {
        id: p.id,
        name: p.name,
        icon: p.icon,
        colour: p.colour,
        handsOver: p.hands_over,
        prepMinutes: p.prep_minutes,
        sortOrder: p.sort_order,
        config,
        itemCount,
        categories: categories
          .filter((c) => claimedWhole.has(c.id))
          .map((c) => ({ id: c.id, title: c.title, itemCount: perCategory.get(c.id) ?? 0 })),
        // an item-level route inside a category this point already claims is redundant — not worth a chip
        extraItems: itemUids
          .filter((uid) => itemByUid.has(uid) && !claimedWhole.has(itemCategory.get(uid) ?? ''))
          .map((uid) => ({ uid, name: itemByUid.get(uid)!.name })),
        liveItems: liveByPoint[p.id] ?? 0,
      }
    })
}

/** Pure. The menu as the wizard browses it: every category, every item, where each goes. */
export function buildCatalogue(ctx: RoutingContext, categories: MenuCategory[]): CatalogueCategory[] {
  const routed = routeMenu(ctx, categories)
  const byCategory = new Map<string, typeof routed>()
  for (const r of routed) {
    const list = byCategory.get(r.category.id) ?? []
    list.push(r)
    byCategory.set(r.category.id, list)
  }
  const itemRoute = new Set(ctx.routes.filter((r) => r.kind === 'item').map((r) => r.ref))
  const categoryOwner = new Map(ctx.routes.filter((r) => r.kind === 'category').map((r) => [r.ref, r.point_id] as const))

  return categories.map((c): CatalogueCategory => ({
    id: c.id,
    title: c.title,
    icon: c.icon ?? null,
    ownerPointId: categoryOwner.get(c.id) ?? null,
    unsold: ctx.unsold.includes(`c:${c.id}`),
    items: (byCategory.get(c.id) ?? []).map((r) => ({
      uid: r.item.uid as string,
      name: { he: r.item.he, en: r.item.en, ar: r.item.ar },
      route: r.route.kind === 'point' ? 'point' : r.route.kind,
      pointId: r.route.kind === 'point' ? r.route.pointId : null,
      via: r.route.kind === 'point' ? (itemRoute.has(r.item.uid as string) ? 'item' : 'category') : null,
    })),
  }))
}

export function toUnrouted(items: { category: MenuCategory; item: { uid?: string; he?: string; en?: string; ar?: string } }[]): UnroutedItem[] {
  return items.map((r) => ({
    uid: r.item.uid as string,
    name: { he: r.item.he, en: r.item.en, ar: r.item.ar },
    categoryId: r.category.id,
    categoryTitle: r.category.title,
  }))
}

// ======================================================================================
// People
// ======================================================================================

export type StaffPerson = {
  id: string
  handle: string
  handle_set_at: string | null
  colour: string | null
  badge: string | null
  branch_id: string | null
  auth_user_id: string | null
  email: string | null
}

/** Active staff who can actually work THIS branch's POS: a linked Google account or a
 *  pending invite with an email. A name-only roster row (the scheduler's) can never sign
 *  in, so it can never confirm a nickname — counting it would keep the row amber forever. */
export async function readPeople(service: Service, branchId: string): Promise<StaffPerson[]> {
  const res = await service
    .from('staff')
    .select('id, handle, handle_set_at, colour, badge, branch_id, auth_user_id, email')
    .eq('active', true)
    .order('id', { ascending: true })
  const rows = unwrap<StaffPerson[] | null>(res) ?? []
  return rows.filter((p) => (p.branch_id === null || p.branch_id === branchId) && (p.auth_user_id !== null || p.email !== null))
}

// ======================================================================================
// The checklist
// ======================================================================================

export type SetupInput = {
  settings: Read<SettingsRow | null>
  active: Read<SessionLite | null>
  points: Read<PosPoint[]>
  routes: Read<PosRoute[]>
  pointStaff: Read<PosPointStaff[]>
  menu: Read<PublishedMenu | null>
  people: Read<StaffPerson[]>
  liveByPoint: Read<Record<string, number>>
}

/** Pure — the whole checklist from already-read inputs, so it can be tested without a database. */
export function buildReadiness(i: SetupInput): { rows: ReadinessRow[]; canOpen: boolean; blockers: ReadinessId[]; catalogue: CatalogueCategory[] } {
  const settings = i.settings.data
  const menu = i.menu.data
  const categories = menu?.categories ?? []
  const activePoints = i.points.data.filter((p) => p.active)
  const unsold = settings?.unsold_refs ?? []
  const ctx = routingContext(activePoints, i.routes.data, unsold)

  // 1. Event
  const enabled = settings?.enabled === true
  const event: EventRow = {
    id: 'event',
    known: i.settings.ok,
    status: enabled ? 'done' : 'attention',
    enabled,
  }

  // 2. Menu — blocked while nothing is published: there is nothing to sell.
  const published = (menu?.itemCount ?? 0) > 0
  const menuRow: MenuRow = {
    id: 'menu',
    known: i.menu.ok,
    status: !i.menu.ok ? 'attention' : !published ? 'blocked' : menu!.hasUnpublishedChanges || menu!.itemsWithoutUid > 0 ? 'attention' : 'done',
    published,
    publishedAt: menu?.publishedAt ?? null,
    itemCount: menu?.itemCount ?? 0,
    categoryCount: menu?.categoryCount ?? 0,
    unpublishedChanges: menu?.hasUnpublishedChanges ?? false,
    itemsWithoutId: menu?.itemsWithoutUid ?? 0,
  }
  const menuBlocked = i.menu.ok && !published

  // 3. Points
  const summaries = buildPointSummaries(activePoints, i.routes.data, i.pointStaff.data, categories, unsold, i.liveByPoint.data)
  const pointsKnown = i.points.ok && i.routes.ok && i.pointStaff.ok && i.menu.ok
  const pointsRow: PointsRow = {
    id: 'points',
    known: pointsKnown,
    status: !pointsKnown ? 'attention' : menuBlocked ? 'blocked' : activePoints.length === 0 ? 'attention' : 'done',
    points: summaries,
  }

  // 4. Everything routed — THE gate for opening
  const unroutedList = toUnrouted(routeMenu(ctx, categories).filter((r) => r.route.kind === 'unrouted'))
  const routingKnown = i.menu.ok && i.points.ok && i.routes.ok && i.settings.ok
  const routing: RoutingRow = {
    id: 'routing',
    known: routingKnown,
    status: !routingKnown ? 'attention' : menuBlocked || activePoints.length === 0 ? 'blocked' : unroutedList.length > 0 ? 'attention' : 'done',
    unrouted: unroutedList,
    unsold,
  }

  // 5. People
  const pointIdsByStaff = new Map<string, string[]>()
  for (const s of i.pointStaff.data) {
    const list = pointIdsByStaff.get(s.staff_id) ?? []
    list.push(s.point_id)
    pointIdsByStaff.set(s.staff_id, list)
  }
  const people: PersonRow[] = i.people.data.map((p) => ({
    id: p.id,
    handle: p.handle,
    handleConfirmed: p.handle_set_at !== null,
    colour: p.colour,
    badge: p.badge,
    pointIds: pointIdsByStaff.get(p.id) ?? [],
  }))
  const unconfirmed = people.filter((p) => !p.handleConfirmed).length
  const peopleRow: PeopleRow = {
    id: 'people',
    known: i.people.ok,
    status: unconfirmed > 0 ? 'attention' : 'done',
    people,
    unconfirmed,
  }

  // 6. Ready board
  const token = settings?.board_token ?? null
  const board: BoardRow = {
    id: 'board',
    known: i.settings.ok,
    status: token ? 'done' : enabled ? 'attention' : 'blocked',
    hasToken: token !== null,
    token,
    path: token ? `/board/${token}` : null,
  }

  // The gate for opening: event on, menu published, a point, everything routed. A row
  // whose read FAILED is not counted — "could not tell" must not lock the owner out of
  // opening an event (the database refuses a new order without a session regardless).
  const blockers: ReadinessId[] = []
  if (event.known && event.status !== 'done') blockers.push('event')
  if (menuRow.known && menuRow.status === 'blocked') blockers.push('menu')
  if (pointsRow.known && pointsRow.status !== 'done') blockers.push('points')
  if (routing.known && routing.status !== 'done') blockers.push('routing')
  const canOpen = blockers.length === 0

  // 7. Open the event
  const active = i.active.data
  const session: SessionRowSetup = {
    id: 'session',
    known: i.active.ok,
    status: active ? (active.kind === 'training' ? 'attention' : 'done') : canOpen ? 'attention' : 'blocked',
    active,
    blockedBecause: !active && !canOpen ? (blockers[0] ?? null) : null,
  }

  return {
    rows: [event, menuRow, pointsRow, routing, peopleRow, board, session],
    canOpen,
    blockers,
    catalogue: routingKnown ? buildCatalogue(ctx, categories) : [],
  }
}

/** GET /api/owner/pos/setup */
export async function readSetupState(service: Service, branch: { id: string; slug: string }): Promise<SetupState> {
  const [info, dir, settings, sessions, points, routes, menu, people, liveByPoint] = await Promise.all([
    readBranch(service, branch),
    readDirectory(service),
    guarded<SettingsRow | null>(null, () => readSettingsRow(service, branch.id)),
    guarded<PosSession[]>([], () => readSessions(service, branch.id, 5)),
    guarded<PosPoint[]>([], () => readPoints(service, branch.id)),
    guarded<PosRoute[]>([], () => readRoutes(service, branch.id)),
    guarded<PublishedMenu | null>(null, () => readPublishedMenu(service, branch.id)),
    guarded<StaffPerson[]>([], () => readPeople(service, branch.id)),
    guarded<Record<string, number>>({}, () => readLiveCountsByPoint(service, branch.id)),
  ])
  // Point staff depends on the point ids, so it is the one dependent read.
  const pointStaff = await guarded<PosPointStaff[]>([], () => readPointStaff(service, points.data.map((p) => p.id)))

  const dmap = directoryMap(dir.data)
  const activeRaw = sessions.data.find((s) => s.status === 'active') ?? null
  const active: Read<SessionLite | null> = { ok: sessions.ok, data: activeRaw ? liteSession(activeRaw, dmap) : null }

  const built = buildReadiness({ settings, active, points, routes, pointStaff, menu, people, liveByPoint })
  return {
    branch: info,
    rows: built.rows,
    canOpen: built.canOpen,
    blockers: built.blockers,
    catalogue: built.catalogue,
    directory: dir.data,
    serverTime: new Date().toISOString(),
  }
}
