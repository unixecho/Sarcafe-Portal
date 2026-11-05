import 'server-only'

import type { createServiceRoleClient } from '@/lib/supabase/server'
import { readCommand, type KioskCommand } from '@/lib/kiosk/remote-rules'

// The dashboard's view of each tablet's remote state (migration 20261105223000_kiosk_remote_control): the command waiting for it,
// whether a new PIN is waiting (never the PIN or its record: only when it was set and whether the tablet took it), and when it last
// adopted one. Tolerant: before the migration it answers `ready: false` and the dashboard says the two actions are not ready yet.
type Service = ReturnType<typeof createServiceRoleClient>
export type RemoteDeviceState = { command: KioskCommand | null; pinPending: { createdAt: string; deliveredAt: string | null } | null; pinAppliedAt: string | null }
export type RemoteState = { ready: boolean; bySlug: Record<string, RemoteDeviceState> }

/** A table or a column the migration adds is not there yet. */
export function isMissingObject(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return ['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST202'].includes(error.code ?? '') || /does not exist|could not find/i.test(error.message ?? '')
}

export async function loadRemoteState(service: Service): Promise<RemoteState> {
  const [devices, pins] = await Promise.all([
    service.from('kiosk_devices').select('id, slug, pending_command, pin_reset_applied_at'),
    service.from('kiosk_pin_resets').select('device_id, created_at, delivered_at'),
  ])
  if (devices.error || pins.error) {
    if (isMissingObject(devices.error) || isMissingObject(pins.error)) return { ready: false, bySlug: {} }
    throw new Error('kiosk remote state read failed')
  }
  const pending = new Map(((pins.data ?? []) as Array<{ device_id: string; created_at: string; delivered_at: string | null }>).map((p) => [p.device_id, p]))
  const bySlug: Record<string, RemoteDeviceState> = {}
  for (const row of (devices.data ?? []) as Array<{ id: string; slug: string; pending_command: unknown; pin_reset_applied_at: string | null }>) {
    const pin = pending.get(row.id)
    bySlug[row.slug] = {
      command: readCommand(row.pending_command),
      pinPending: pin ? { createdAt: pin.created_at, deliveredAt: pin.delivered_at } : null,
      pinAppliedAt: row.pin_reset_applied_at,
    }
  }
  return { ready: true, bySlug }
}
