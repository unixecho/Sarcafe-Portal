import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import {
  branchQuery, pointCreateBody, pointDeleteQuery, pointUpdateBody,
  type PointsPayload, type PointSaveResult,
} from '@/lib/pos/owner-api'
import { parseBody, parseQuery, posError, posJson, rateLimit, requirePosManager } from '@/lib/pos/server/guard'
import { readSetupState } from '@/lib/pos/server/readiness'
import { deactivatePoint, savePoint } from '@/lib/pos/server/settings'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Selling points (the stations: bar, kitchen, the coffee cart...). Manager-only.
//
// The actor handed to the database function is the GUARDED manager's staff id — a body
// has no field that could name anybody else (every schema is .strict()). The database
// is the authority on whether a configuration is valid and on conflicts: an item or
// category can belong to ONE point, so a save that would steal one is REFUSED with 409
// and the other point named, and the wizard asks "move it here?" and re-sends with
// `move: true`. A conflict is an ordinary outcome, not an error, which is why it is a
// body and not the error envelope.

export const GET = apiRoute(async (request: NextRequest) => {
  const q = parseQuery(new URL(request.url), branchQuery)
  const actor = await requirePosManager(q.branch)
  // The summaries are built by the same code as the checklist's points row, so the two
  // screens can never describe a point differently. A failed read is an error here: a
  // wizard that showed "no points" because the read broke would invite duplicates.
  const state = await readSetupState(createServiceRoleClient(), actor.branch)
  const row = state.rows.find((r) => r.id === 'points')
  if (!row || row.id !== 'points' || !row.known) throw posError('internal_error')
  const payload: PointsPayload = { points: row.points, serverTime: state.serverTime }
  return posJson(payload)
})

const statusOf = (r: PointSaveResult) => (r.ok ? 200 : 409)

export const POST = apiRoute(async (request: NextRequest) => {
  const body = await parseBody(request, pointCreateBody)
  const actor = await requirePosManager(body.branch)
  await rateLimit('owner-point', actor.staff.id, 60)
  const result = await savePoint(createServiceRoleClient(), actor.staff.id, actor.branch.id, null, body.config, body.move === true)
  return posJson(result, statusOf(result))
})

export const PATCH = apiRoute(async (request: NextRequest) => {
  const body = await parseBody(request, pointUpdateBody)
  const actor = await requirePosManager(body.branch)
  await rateLimit('owner-point', actor.staff.id, 60)
  const result = await savePoint(createServiceRoleClient(), actor.staff.id, actor.branch.id, body.pointId, body.config, body.move === true)
  return posJson(result, statusOf(result))
})

export const DELETE = apiRoute(async (request: NextRequest) => {
  const q = parseQuery(new URL(request.url), pointDeleteQuery)
  const actor = await requirePosManager(q.branch)
  await rateLimit('owner-point', actor.staff.id, 60)
  const result = await deactivatePoint(actor.staff.id, actor.branch.id, q.pointId)
  return posJson(result, result.ok ? 200 : 409)
})
