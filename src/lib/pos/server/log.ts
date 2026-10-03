// The audit log — every event the register ever wrote, newest first, 50 a page.
//
// Like the order history this read does NOT swallow its failure: an empty list that is
// really a failed read would say "nothing happened", which in an audit log is the one
// lie it must never tell. Only the decorations (point names, emails, the roster)
// degrade quietly.
//
// MANAGER-ONLY: the actor's email appears here (and in the order timeline) and nowhere
// else. Payloads are passed through scrubPayload(), so even a future event that
// carried a phone-shaped key could not leak it through this door.

import { EVENT_COLUMNS } from '@/lib/pos/columns'
import type { PosEvent, StaffDirEntry } from '@/lib/pos/types'
import type { LogPage, LogQuery, LogRow } from '@/lib/pos/owner-api'
import { fetchAll, guarded, iso, readBranch, readDirectory, unwrap, type Service } from '@/lib/pos/server/readiness'
import { scrubPayload } from '@/lib/pos/server/details'
import { dateRangeMs } from '@/lib/pos/server/stats'

export const LOG_DEFAULT_PAGE = 50

/** The cursor is the last event's id (a number: events have a monotonic id). */
export function decodeLogCursor(raw: string | undefined): number | null {
  if (!raw) return null
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null
}

/** GET /api/owner/pos/log */
export async function readLogPage(service: Service, branch: { id: string; slug: string }, query: LogQuery): Promise<LogPage> {
  const [info, dirRead] = await Promise.all([readBranch(service, branch), readDirectory(service)])
  const empty: LogPage = { rows: [], nextCursor: null, directory: dirRead.data }

  const sessionsRes = await service.from('pos_sessions').select('id, kind').eq('branch_id', branch.id)
  const sessions = unwrap<{ id: string; kind: 'live' | 'training' }[] | null>(sessionsRes) ?? []
  const kindOf = new Map(sessions.map((s) => [s.id, s.kind] as const))
  const trainingIds = sessions.filter((s) => s.kind === 'training').map((s) => s.id)

  let actorId: string | null = null
  if (query.handle) {
    const wanted = query.handle.toLowerCase()
    const hit = dirRead.data.find((d: StaffDirEntry) => d.handle.toLowerCase() === wanted)
    if (!hit) return empty
    actorId = hit.id
  }

  const limit = query.limit ?? LOG_DEFAULT_PAGE
  const { fromMs, toMs } = dateRangeMs(query.from, query.to, info.timezone)
  const cursor = decodeLogCursor(query.cursor)
  if (query.cursor && cursor === null) return empty

  let q = service.from('pos_events').select(EVENT_COLUMNS).eq('branch_id', branch.id)
  if (query.events) q = q.in('event', query.events.split(','))
  if (actorId) q = q.eq('actor_id', actorId)
  if (query.point) q = q.eq('point_id', query.point)
  if (fromMs !== null) q = q.gte('at', iso(fromMs))
  if (toMs !== null) q = q.lt('at', iso(toMs))
  // Settings events have no session (null) and must survive the practice filter.
  if (query.training !== '1' && trainingIds.length > 0) q = q.or(`session_id.is.null,session_id.not.in.(${trainingIds.join(',')})`)
  if (cursor !== null) q = q.lt('id', cursor)

  const res = await q.order('id', { ascending: false }).limit(limit + 1)
  const fetched = unwrap<PosEvent[] | null>(res) ?? []
  const hasMore = fetched.length > limit
  const events = hasMore ? fetched.slice(0, limit) : fetched

  const actorIds = Array.from(new Set(events.map((e) => e.actor_id).filter((x): x is string => !!x)))
  const [emails, points] = await Promise.all([
    actorIds.length === 0
      ? { ok: true, data: new Map<string, string | null>() }
      : guarded(new Map<string, string | null>(), async () => {
          const r = await service.from('staff').select('id, email').in('id', actorIds)
          const rows = unwrap<{ id: string; email: string | null }[] | null>(r) ?? []
          return new Map(rows.map((x) => [x.id, x.email] as const))
        }),
    guarded(new Map<string, string>(), async () => {
      const rows = await fetchAll<{ id: string; name: string }>((from, to) =>
        service.from('pos_points').select('id, name').eq('branch_id', branch.id).order('id', { ascending: true }).range(from, to)
      )
      return new Map(rows.map((p) => [p.id, p.name] as const))
    }),
  ])

  const rows: LogRow[] = events.map((e) => ({
    ...e,
    payload: scrubPayload(e.payload),
    actor_email: e.actor_id ? emails.data.get(e.actor_id) ?? null : null,
    point_name: e.point_id ? points.data.get(e.point_id) ?? null : null,
    session_kind: e.session_id ? kindOf.get(e.session_id) ?? null : null,
  }))
  const last = events[events.length - 1]
  return { rows, nextCursor: hasMore && last ? String(last.id) : null, directory: dirRead.data }
}
