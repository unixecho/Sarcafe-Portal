import 'server-only'

// Web Push to STAFF (the installed home-screen app). The customer order push in send.ts keys a
// subscription to an order; here it keys to a person, so one phone keeps receiving a person's
// shift and checklist alerts for as long as they stay signed in on it.
//
// The in-app inbox (schedule_notifications) is also the outbox: a row whose push_sent_at is null
// has not been pushed. flushStaffPush() claims those rows, sends them and stamps them, so
// everything that already lands in the inbox (swaps, requests, publishing, hours sync, reminders)
// reaches the phone with no change at its call site. Claiming BEFORE sending makes a push
// at-most-once: a crash loses one alert, it never repeats one, and two overlapping runs
// (a request-triggered flush and the scheduled one) cannot both send the same row.

import webpush from 'web-push'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { ensureVapidConfigured } from './send'
import { hasAnyMenuEditAccess } from '@/lib/staff/access'
import { isDeveloper } from '@/lib/checklists/developer'
import { alertTitle, pushPathFor } from './staff-rules'

type Service = ReturnType<typeof createServiceRoleClient>

/** An inbox row older than this is old news by the time it would be pushed (the phone was off, the
 *  scheduler was down). It is stamped as handled without a buzz. */
const FRESH_MS = 2 * 60 * 60 * 1000
const BATCH = 200
/** More than this many fresh alerts for one person in one run collapse into a single summary. */
const MAX_INDIVIDUAL = 3
const BODY_LIMIT = 180

type SubscriptionRow = { id: string; staff_id: string; endpoint: string; p256dh: string; auth: string }
type InboxRow = { id: string; staff_id: string; kind: string; title: string; body: string | null; link: Record<string, unknown> | null }
type Payload = { title: string; body: string; url: string; tag: string }

const clip = (text: string | null) => {
  const clean = (text ?? '').trim()
  return clean.length > BODY_LIMIT ? `${clean.slice(0, BODY_LIMIT - 1)}…` : clean
}

/** One summary push for several alerts: if they all point to the same place go there, if they are all owner
 *  checklist alerts go to the tracker, otherwise the home page (whose list links each alert to its own place). */
function digestPath(rows: InboxRow[], recipient: { manager: boolean }): string {
  const paths = new Set(rows.map((r) => pushPathFor(r.kind, r.link, recipient)))
  const [only] = [...paths]
  if (paths.size === 1 && only) return only
  if (rows.every((r) => r.kind === 'checklist.gap')) return '/owner/checklists'
  return '/staff'
}

type SendOutcome = { ok: boolean; statusCode: number | null; detail: string }

/** What happened to one alert when it was pushed, kept ON the alert (inside its `link`, which nothing reads for these
 *  keys) so "I never got it" can be answered from the database: how many phones were registered, how many the push
 *  service accepted, and what it said to the ones it refused. Accepted means Apple/Google took it; whether the phone
 *  then showed it (Focus, notification settings) is not something a server can see. No endpoint or key is stored. */
export type PushOutcome = { at: string; devices: number; accepted: number; refused: { status: number | null; detail: string }[] }

async function recordOutcome(service: Service, rows: InboxRow[], results: SendOutcome[], devices: number): Promise<void> {
  const outcome: PushOutcome = {
    at: new Date().toISOString(),
    devices,
    accepted: results.filter((r) => r.ok).length,
    refused: results.filter((r) => !r.ok).map((r) => ({ status: r.statusCode, detail: r.detail.slice(0, 80) })),
  }
  await Promise.all(
    rows.map((row) => service.from('schedule_notifications').update({ link: { ...(row.link ?? {}), push: outcome } }).eq('id', row.id).then(() => undefined, () => undefined))
  )
}

async function sendToOne(service: Service, row: SubscriptionRow, payload: Payload): Promise<SendOutcome> {
  try {
    await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload), {
      urgency: 'high',
      TTL: 60 * 60 * 3, // a shift alert is useless hours later
    })
    return { ok: true, statusCode: null, detail: '' }
  } catch (err) {
    const failure = err as { statusCode?: number; body?: string; message?: string } | null
    const statusCode = failure?.statusCode ?? null
    const detail = failure?.body || failure?.message || String(err)
    // 404/410: this phone's subscription is permanently gone (app removed, permission revoked).
    if (statusCode === 404 || statusCode === 410) await service.from('staff_push_subscriptions').delete().eq('id', row.id)
    else console.error('Staff push failed:', statusCode, detail)
    return { ok: false, statusCode, detail }
  }
}

async function loadSubscriptions(service: Service, staffIds: string[]): Promise<Map<string, SubscriptionRow[]>> {
  const bySubscriber = new Map<string, SubscriptionRow[]>()
  if (staffIds.length === 0) return bySubscriber
  const { data } = await service.from('staff_push_subscriptions').select('id, staff_id, endpoint, p256dh, auth').in('staff_id', staffIds)
  for (const row of (data ?? []) as SubscriptionRow[]) bySubscriber.set(row.staff_id, [...(bySubscriber.get(row.staff_id) ?? []), row])
  return bySubscriber
}

/** Pushes every unsent inbox row that is still fresh. Never throws: a push problem must not fail the
 *  request it rides on (callers schedule this with next/server's after(), see send.ts). */
export async function flushStaffPush(): Promise<{ claimed: number; sent: number }> {
  try {
    if (!ensureVapidConfigured()) return { claimed: 0, sent: 0 }
    const service = createServiceRoleClient()
    const now = new Date().toISOString()

    await service.from('schedule_notifications').update({ push_sent_at: now }).is('push_sent_at', null).lt('created_at', new Date(Date.now() - FRESH_MS).toISOString())

    const { data: pending } = await service.from('schedule_notifications').select('id').is('push_sent_at', null).order('created_at').limit(BATCH)
    const ids = (pending ?? []).map((row) => row.id as string)
    if (ids.length === 0) return { claimed: 0, sent: 0 }

    const { data: claimedRows } = await service
      .from('schedule_notifications')
      .update({ push_sent_at: now })
      .in('id', ids)
      .is('push_sent_at', null)
      .select('id, staff_id, kind, title, body, link')
    const claimed = (claimedRows ?? []) as InboxRow[]
    if (claimed.length === 0) return { claimed: 0, sent: 0 }

    const perPerson = new Map<string, InboxRow[]>()
    for (const row of claimed) perPerson.set(row.staff_id, [...(perPerson.get(row.staff_id) ?? []), row])
    const subscriptions = await loadSubscriptions(service, [...perPerson.keys()])
    // Only people with a phone registered need a destination, and only they need to be looked up.
    const reachable = [...perPerson.keys()].filter((staffId) => (subscriptions.get(staffId) ?? []).length > 0)
    const managers = new Set<string>()
    const developers = new Set<string>()
    if (reachable.length > 0) {
      const { data: people } = await service.from('staff').select('id, role, badge, email').in('id', reachable)
      for (const person of people ?? []) {
        if (hasAnyMenuEditAccess(person as { role?: string | null; badge?: string | null })) managers.add(person.id as string)
        // The developer's alerts say who they are for (owner / developer); nobody else's do.
        if (isDeveloper(person as { badge?: string | null; email?: string | null })) developers.add(person.id as string)
      }
    }

    let sent = 0
    for (const [staffId, rows] of perPerson) {
      const devices = subscriptions.get(staffId) ?? []
      if (devices.length === 0) {
        await recordOutcome(service, rows, [], 0) // claimed with nobody to send to: on record, so it is not a mystery later
        continue
      }
      const recipient = { manager: managers.has(staffId) }
      const named = { developer: developers.has(staffId) }
      const outbound: { payload: Payload; rows: InboxRow[] }[] =
        rows.length > MAX_INDIVIDUAL
          ? [{ payload: { title: `${rows.length} עדכונים חדשים ב-Sarcafe`, body: rows.slice(0, 3).map((r) => alertTitle(r.kind, r.title, named)).join(' · '), url: digestPath(rows, recipient), tag: `staff-digest-${staffId}` }, rows }]
          : rows.map((r) => ({ payload: { title: alertTitle(r.kind, r.title, named), body: clip(r.body), url: pushPathFor(r.kind, r.link, recipient), tag: `staff-${r.id}` }, rows: [r] }))
      for (const { payload, rows: covered } of outbound) {
        const results = await Promise.all(devices.map((device) => sendToOne(service, device, payload)))
        sent += results.filter((r) => r.ok).length
        await recordOutcome(service, covered, results, devices.length)
      }
    }
    return { claimed: claimed.length, sent }
  } catch (err) {
    console.error('flushStaffPush failed:', err instanceof Error ? err.message : err)
    return { claimed: 0, sent: 0 }
  }
}

export type StaffTestResult = {
  configured: boolean
  subscriptions: number
  sent: number
  /** First failure, verbatim from the push service — the one thing that makes a "granted but nothing arrives" report diagnosable from a screenshot. */
  error: { statusCode: number | null; detail: string } | null
}

/** The profile's "send me a test": proves THIS person has a working subscription right now. */
export async function sendStaffTest(staffId: string): Promise<StaffTestResult> {
  if (!ensureVapidConfigured()) {
    return { configured: false, subscriptions: 0, sent: 0, error: { statusCode: null, detail: 'VAPID env vars missing or invalid on the server.' } }
  }
  const service = createServiceRoleClient()
  const devices = (await loadSubscriptions(service, [staffId])).get(staffId) ?? []
  if (devices.length === 0) return { configured: true, subscriptions: 0, sent: 0, error: null }
  const results = await Promise.all(
    devices.map((device) => sendToOne(service, device, { title: 'בדיקת התראות ✓', body: 'אם קיבלת את זה — ההתראות של Sarcafe פעילות במכשיר הזה.', url: '/staff', tag: `staff-test-${staffId}` }))
  )
  const failure = results.find((r) => !r.ok)
  return {
    configured: true,
    subscriptions: devices.length,
    sent: results.filter((r) => r.ok).length,
    error: failure ? { statusCode: failure.statusCode, detail: failure.detail } : null,
  }
}
