import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { advanceBody, type AdvanceResponse } from '@/lib/pos/api'
import { canUndoDelivered, isAllowedTransition } from '@/lib/pos/lifecycle'
import { RATE } from '@/lib/pos/vocab'
import type { PosItem } from '@/lib/pos/types'
import { callPosRpc, parseBody, posError, posJson, rateLimit, requirePosStaff } from '@/lib/pos/server/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'

// POST /api/pos/items/advance — move lines one step: accept, ready, handed over, or one
// of the two mis-tap reverts. The hot path of the whole system (every tap on a station).
//
// Trust model.
//   * ACTOR: requirePosStaff. Any active staff member with a nickname may advance a
//     line at any point (the audit log, not a permission, records who really did it).
//   * BRANCH: pos_advance_items takes bare line ids and does not know which branch the
//     caller was cleared for, so the lines are read first and any that belong to a
//     DIFFERENT branch are held back and reported as `missing` — the same answer as an
//     id that does not exist, so it confirms nothing about another event.
//   * The transition itself is a compare-and-swap inside the RPC: a stale `from` is a
//     `conflict` (two tablets tapped together — normal, not an error).
//   * UNDOING A HAND-OVER (delivered -> ready) is the one transition with a rule of its
//     own: a manager always may; anyone else only for lines THEY handed over, within
//     UNDO.deliveredWindowS. Otherwise 403. p_manager is what unlocks it in the RPC, so
//     it is set here, after that decision, never from the browser. Lines that are no
//     longer `delivered` are not part of the decision — they will simply come back as
//     `conflict` — so a stale tap cannot be turned into a refusal by someone else's line.
//   * This is cleanup/flow, not new work: it does not require the POS to be switched on.

type LineRow = Pick<PosItem, 'id' | 'branch_id' | 'status' | 'delivered_by' | 'delivered_at'>

export const POST = apiRoute(async (request: NextRequest) => {
  const body = await parseBody(request, advanceBody)
  const actor = await requirePosStaff(body.branchId, { requireEnabled: false })
  await rateLimit('advance', actor.staff.id, RATE.advancePerMin)

  // Manager-only transitions are allowed to PASS this check; who may take one is decided below.
  if (!isAllowedTransition(body.from, body.to, { manager: true })) {
    throw posError('bad_request', { reason: 'transition' })
  }

  const ids = Array.from(new Set(body.ids))

  // Which lines are these, and whose branch are they in?
  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('pos_order_items')
    .select('id, branch_id, status, delivered_by, delivered_at')
    .in('id', ids)
  if (error) {
    console.error('pos_order_items read failed:', error.code)
    throw posError('internal_error')
  }
  const rows = (data ?? []) as unknown as LineRow[]
  const foreign = new Set(rows.filter((r) => r.branch_id !== actor.branch.id).map((r) => r.id))
  const ours = rows.filter((r) => r.branch_id === actor.branch.id)

  let sendIds = ids.filter((id) => !foreign.has(id))
  const held = new Set<string>() // ids deliberately kept away from the RPC, reported as conflicts
  let manager = false

  if (body.from === 'delivered' && body.to === 'ready') {
    const delivered = ours.filter((r) => r.status === 'delivered')
    if (!actor.isManager) {
      const now = Date.now()
      if (!delivered.every((r) => canUndoDelivered(r, actor.staff.id, now))) throw posError('forbidden')
      // Narrow the write to exactly the lines that were verified above: a line that was not
      // `delivered` a moment ago is not covered by that check, so it is not sent with the
      // manager flag either.
      const verified = new Set(delivered.map((r) => r.id))
      for (const id of sendIds) if (!verified.has(id)) held.add(id)
      sendIds = sendIds.filter((id) => verified.has(id))
    }
    manager = delivered.length > 0
  }

  let ok: string[] = []
  let conflict: string[] = []
  let missing: string[] = []
  if (sendIds.length > 0) {
    const result = await callPosRpc<{
      ok: string[]
      conflict: string[]
      missing: string[]
      invalid?: boolean
      reason?: string
    }>('pos_advance_items', {
      p_staff: actor.staff.id,
      p_ids: sendIds,
      p_from: body.from,
      p_to: body.to,
      p_manager: manager,
    })
    if (result.invalid) throw result.reason === 'no_actor' ? posError('forbidden') : posError('bad_request', { reason: 'transition' })
    if (!Array.isArray(result.ok) || !Array.isArray(result.conflict) || !Array.isArray(result.missing)) {
      console.error('pos_advance_items returned an unexpected shape')
      throw posError('internal_error')
    }
    ok = result.ok
    conflict = result.conflict
    missing = result.missing
  }

  const response: AdvanceResponse = {
    ok,
    conflict: [...conflict, ...Array.from(held)],
    missing: [...missing, ...Array.from(foreign)],
  }
  return posJson(response)
})
