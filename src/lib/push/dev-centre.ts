import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { notificationAudience, pushPathFor, type AlertAudience } from './staff-rules'

// The developer's notification centre (/staff/dev, "התראות"; owner, 2026-10-16: "a custom notification centre just for me, 3
// containers: notifications for devs, for manager/owner, and for me as an employee"). The developer account is all of those
// people at once, so ONE inbox holds every kind of alert; this sorts it into the three containers and says, per alert, where
// tapping it goes and what the push service did with it. It reads only the developer's own rows.

type Service = ReturnType<typeof createServiceRoleClient>

export type CentreRow = {
  id: string
  kind: string
  /** As written (no audience prefix: the container already says whose alert it is). */
  title: string
  body: string | null
  /** Where a tap goes: the thing the alert is about. */
  href: string
  created_at: string
  read_at: string | null
  audience: AlertAudience
  /** What the push service said (see PushOutcome in staff.ts), or null when the alert was never pushed / is older than the record. */
  push: { devices: number; accepted: number } | null
}

export type Centre = { rows: CentreRow[]; unread: Record<AlertAudience, number> }

/** How many of the developer's latest alerts the centre holds: three containers of a screenful each, plus history. */
export const CENTRE_LIMIT = 150

export async function loadDevCentre(service: Service, staffId: string): Promise<Centre> {
  const { data, error } = await service
    .from('schedule_notifications')
    .select('id, kind, title, body, link, created_at, read_at')
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false })
    .limit(CENTRE_LIMIT)
  if (error) throw error
  const rows = (data ?? []).map((row): CentreRow => {
    const kind = String(row.kind ?? '')
    const title = String(row.title ?? '')
    const link = (row.link ?? null) as Record<string, unknown> | null
    const push = link?.push as { devices?: unknown; accepted?: unknown } | undefined
    return {
      id: row.id as string,
      kind,
      title,
      body: (row.body as string | null) ?? null,
      // The developer is an owner, so every manager destination is open to them.
      href: pushPathFor(kind, link, { manager: true, title }),
      created_at: row.created_at as string,
      read_at: (row.read_at as string | null) ?? null,
      audience: notificationAudience(kind, title),
      push: push && typeof push.devices === 'number' && typeof push.accepted === 'number' ? { devices: push.devices, accepted: push.accepted } : null,
    }
  })
  const unread: Centre['unread'] = { developer: 0, owner: 0, employee: 0 }
  for (const row of rows) if (!row.read_at) unread[row.audience] += 1
  return { rows, unread }
}
