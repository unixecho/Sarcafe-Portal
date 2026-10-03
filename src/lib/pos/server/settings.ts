// The owner's WRITES and the small reads that go with them: the event's on/off
// switch + Ready-board link, opening and closing the event, and creating / editing
// / stopping a selling point.
//
// Every write is ONE database function (020): check + write + audit event in a single
// transaction, executable by service_role only. This file only translates — a
// validated request in, the function's `{ok, reason}` out as a typed result the
// routes turn into 200 / 409. The actor is the guarded manager's staff id, passed in
// by the route; it is never read from a body.
//
// REFUSALS ARE VALUES, not exceptions. "This item is already sold at another point"
// and "the event still has items in preparation" are ordinary outcomes the screen has
// to react to ("move it here?", "cancel the uncollected ones and close?"), so these
// functions RETURN them. Only a genuinely broken call (transport failure, a bad actor)
// throws, through the guard's posError().

import { randomBytes } from 'node:crypto'
import { callPosRpc, posError, rpcFailure } from '@/lib/pos/server/guard'
import {
  directoryMap, fetchAll, guarded, liteSession, readDirectory, readPublishedMenu, readSessions, readSettingsRow,
  unwrap, type Service,
} from '@/lib/pos/server/readiness'
import {
  OWNER_MESSAGES,
  type PointConfig, type PointDeactivateResult, type PointSaveResult, type RouteConflict, type SessionAction,
  type SessionActionOk, type SessionActionRefused, type SessionRefusalReason, type SessionRow, type SessionsPayload,
  type SettingsPatchBody, type SettingsPayload, type SettingsRefused,
} from '@/lib/pos/owner-api'
import type { Localized } from '@/lib/menu/types'

// ======================================================================================
// Settings: on/off, the Ready-board link, items not sold here
// ======================================================================================

const NO_SETTINGS: SettingsPayload = { enabled: false, boardToken: null, boardPath: null, unsold: [], updatedAt: null }

/** Throws on a failed read — a settings screen that shows "off" because the read
 *  failed would invite the owner to switch on something that is already on. */
export async function readSettings(service: Service, branchId: string): Promise<SettingsPayload> {
  const row = await readSettingsRow(service, branchId)
  if (!row) return NO_SETTINGS
  return {
    enabled: row.enabled,
    boardToken: row.board_token,
    boardPath: row.board_token ? `/board/${row.board_token}` : null,
    unsold: row.unsold_refs,
    updatedAt: row.updated_at,
  }
}

/** 256 bits of randomness, hex. The RPC only requires >= 24 characters; this is 64.
 *  The token IS the credential for the public board, so it is never derived from
 *  anything guessable (a branch id, a timestamp) and is generated here, not in SQL. */
export const mintBoardToken = (): string => randomBytes(32).toString('hex')

/**
 * Applies a settings patch. Order matters: the on/off switch and the token go first
 * (one RPC), then the unsold list (another). They are independent and each is valid on
 * its own, so a failure in the second leaves a consistent, merely partial, result — the
 * route reports the failure and the screen re-reads.
 *
 * Switching ON for the first time also mints the Ready-board link, so the owner's next
 * step is not "now go and create a link" (the checklist's board row would otherwise sit
 * amber for no reason a non-technical person could guess).
 */
export async function updateSettings(
  service: Service,
  actorId: string,
  branchId: string,
  patch: Pick<SettingsPatchBody, 'enabled' | 'rotateBoardToken' | 'unsold'>,
): Promise<SettingsPayload | SettingsRefused> {
  if (patch.enabled !== undefined || patch.rotateBoardToken) {
    const current = await readSettingsRow(service, branchId)
    const needsFirstToken = patch.enabled === true && !current?.board_token
    const token = patch.rotateBoardToken || needsFirstToken ? mintBoardToken() : null

    const r = await callPosRpc<{ ok: boolean; reason?: string }>('pos_configure_branch', {
      p_staff: actorId,
      p_branch: branchId,
      p_enabled: patch.enabled ?? null,
      p_board_token: token,
    })
    if (!r.ok) {
      if (r.reason === 'session_active') return { ok: false, reason: 'session_active', message: OWNER_MESSAGES.session_active }
      if (r.reason === 'not_found') throw posError('not_found')
      throw rpcFailure(r.reason)
    }
  }

  if (patch.unsold !== undefined) {
    const r = await callPosRpc<{ ok: boolean; reason?: string }>('pos_set_unsold', {
      p_staff: actorId,
      p_branch: branchId,
      p_refs: patch.unsold,
    })
    if (!r.ok) throw rpcFailure(r.reason)
  }

  return readSettings(service, branchId)
}

// ======================================================================================
// Sessions — "the event is open"
// ======================================================================================

/** GET: the one open session, the latest ten, and how much practice data is waiting. */
export async function readSessionsPayload(service: Service, branchId: string): Promise<SessionsPayload> {
  const [dirRead, sessionsRead, settingsRead] = await Promise.all([
    readDirectory(service),
    guarded([] as Awaited<ReturnType<typeof readSessions>>, () => readSessions(service, branchId, 10)),
    guarded<boolean>(false, async () => (await readSettingsRow(service, branchId))?.enabled === true),
  ])
  const dmap = directoryMap(dirRead.data)
  const raw = sessionsRead.data
  const ids = raw.map((s) => s.id)

  const totals = await guarded<Map<string, { orders: number; sales: number }>>(new Map(), async () => {
    const m = new Map<string, { orders: number; sales: number }>()
    if (ids.length === 0) return m
    const rows = await fetchAll<{ session_id: string; total_agorot: number; status: string }>((from, to) =>
      service
        .from('pos_orders')
        .select('id, session_id, total_agorot, status')
        .in('session_id', ids)
        .order('id', { ascending: true })
        .range(from, to)
    )
    for (const o of rows) {
      if (o.status === 'void') continue
      const t = m.get(o.session_id) ?? { orders: 0, sales: 0 }
      t.orders++
      t.sales += o.total_agorot
      m.set(o.session_id, t)
    }
    return m
  })

  const training = await guarded<{ sessions: number; orders: number }>({ sessions: 0, orders: 0 }, async () => {
    const sres = await service.from('pos_sessions').select('id').eq('branch_id', branchId).eq('kind', 'training')
    const tids = (unwrap<{ id: string }[] | null>(sres) ?? []).map((s) => s.id)
    if (tids.length === 0) return { sessions: 0, orders: 0 }
    const ores = await service.from('pos_orders').select('id', { count: 'exact', head: true }).in('session_id', tids)
    if (ores.error) throw new Error(`read failed (${ores.error.code ?? 'unknown'})`)
    return { sessions: tids.length, orders: ores.count ?? 0 }
  })

  const recent: SessionRow[] = raw.map((s) => {
    const t = totals.data.get(s.id)
    return { ...liteSession(s, dmap), orders: t?.orders ?? 0, sales_agorot: t?.sales ?? 0, totals_known: totals.ok }
  })
  const active = raw.find((s) => s.status === 'active')

  return {
    enabled: settingsRead.data,
    current: active ? liteSession(active, dmap) : null,
    recent,
    training: { ...training.data, known: training.ok },
    serverTime: new Date().toISOString(),
  }
}

function refusal(reason: SessionRefusalReason, extra: Pick<SessionActionRefused, 'inFlight' | 'uncollected'> = {}): SessionActionRefused {
  return { ok: false, reason, message: OWNER_MESSAGES[reason], ...extra }
}

/** POST: opens / closes the event, or wipes practice data. */
export async function runSessionAction(
  actorId: string,
  branchId: string,
  action: SessionAction,
): Promise<SessionActionOk | SessionActionRefused> {
  if (action === 'open' || action === 'open_training') {
    const r = await callPosRpc<{ ok: boolean; reason?: string; session_id?: string }>('pos_open_session', {
      p_staff: actorId,
      p_branch: branchId,
      p_kind: action === 'open' ? 'live' : 'training',
    })
    if (r.ok) return { ok: true, action, sessionId: r.session_id }
    if (r.reason === 'already_open' || r.reason === 'not_enabled') return refusal(r.reason)
    throw rpcFailure(r.reason)
  }

  if (action === 'close' || action === 'close_void_uncollected') {
    const r = await callPosRpc<{
      ok: boolean; reason?: string; in_flight?: number; uncollected?: number; voided_uncollected?: number
    }>('pos_close_session', {
      p_staff: actorId,
      p_branch: branchId,
      p_void_uncollected: action === 'close_void_uncollected',
    })
    if (r.ok) return { ok: true, action, voidedUncollected: r.voided_uncollected ?? 0 }
    if (r.reason === 'no_session') return refusal('no_session')
    if (r.reason === 'in_flight' || r.reason === 'uncollected') {
      return refusal(r.reason, { inFlight: r.in_flight ?? 0, uncollected: r.uncollected ?? 0 })
    }
    throw rpcFailure(r.reason)
  }

  // wipe_training — the one hard delete in the system. The RPC refuses anything that
  // is not a training session, so a live event's data cannot be reached from here.
  const r = await callPosRpc<{ ok: boolean; reason?: string; orders?: number }>('pos_wipe_training', {
    p_staff: actorId,
    p_branch: branchId,
  })
  if (r.ok) return { ok: true, action, wipedOrders: r.orders ?? 0 }
  throw rpcFailure(r.reason)
}

// ======================================================================================
// Selling points
// ======================================================================================

/** The wizard's PointConfig as the RPC's `p_cfg` (snake_case jsonb). */
function toRpcConfig(c: PointConfig): Record<string, unknown> {
  return {
    name: c.name,
    icon: c.icon,
    colour: c.colour,
    hands_over: c.handsOver,
    prep_minutes: c.prepMinutes,
    category_ids: c.categoryIds,
    item_uids: c.itemUids,
    excluded_uids: c.excludedUids,
    staff_ids: c.staffIds,
  }
}

/** Names for the refs in a conflict, so the wizard can say WHAT is already sold elsewhere.
 *  Best effort — a failed read just leaves `label` null, the refusal still goes out. */
async function labelConflicts(service: Service, branchId: string, raw: unknown): Promise<RouteConflict[]> {
  const list = Array.isArray(raw) ? (raw as { kind?: string; ref?: string; point_id?: string; point_name?: string }[]) : []
  const menu = await guarded(null as Awaited<ReturnType<typeof readPublishedMenu>>, () => readPublishedMenu(service, branchId))
  const categories = new Map<string, Localized>()
  const items = new Map<string, Localized>()
  for (const c of menu.data?.categories ?? []) {
    categories.set(c.id, c.title)
    for (const i of c.items ?? []) if (i.uid) items.set(i.uid, { he: i.he, en: i.en, ar: i.ar })
  }
  const out: RouteConflict[] = []
  for (const c of list) {
    if ((c.kind !== 'category' && c.kind !== 'item') || !c.ref || !c.point_id) continue
    out.push({
      kind: c.kind,
      ref: c.ref,
      pointId: c.point_id,
      pointName: c.point_name ?? '',
      label: (c.kind === 'category' ? categories.get(c.ref) : items.get(c.ref)) ?? null,
    })
  }
  return out
}

/**
 * Creates (`pointId` null) or updates a point. A conflict is NEVER resolved silently:
 * without `move` the database refuses and names the other point; with `move` the
 * wizard has asked the owner "move it here?" and got a yes.
 */
export async function savePoint(
  service: Service,
  actorId: string,
  branchId: string,
  pointId: string | null,
  config: PointConfig,
  move: boolean,
): Promise<PointSaveResult> {
  const r = await callPosRpc<{ ok: boolean; reason?: string; point_id?: string; conflicts?: unknown }>('pos_save_point', {
    p_staff: actorId,
    p_branch: branchId,
    p_point: pointId,
    p_cfg: toRpcConfig(config),
    p_move: move,
  })
  if (r.ok && r.point_id) return { ok: true, pointId: r.point_id }
  if (r.reason === 'name_taken') return { ok: false, reason: 'name_taken', message: OWNER_MESSAGES.name_taken }
  if (r.reason === 'conflicts') {
    return { ok: false, reason: 'conflicts', message: OWNER_MESSAGES.conflicts, conflicts: await labelConflicts(service, branchId, r.conflicts) }
  }
  if (r.reason === 'bad_cfg') throw posError('bad_request', { reason: 'bad_config' }, OWNER_MESSAGES.bad_config)
  throw rpcFailure(r.reason)
}

/** Stops a point (never deletes it — history keeps pointing at it). Refused while it has live lines. */
export async function deactivatePoint(actorId: string, branchId: string, pointId: string): Promise<PointDeactivateResult> {
  const r = await callPosRpc<{ ok: boolean; reason?: string; n?: number }>('pos_deactivate_point', {
    p_staff: actorId,
    p_branch: branchId,
    p_point: pointId,
  })
  if (r.ok) return { ok: true }
  if (r.reason === 'live_items') return { ok: false, reason: 'live_items', message: OWNER_MESSAGES.live_items, liveItems: r.n ?? 0 }
  throw rpcFailure(r.reason)
}
