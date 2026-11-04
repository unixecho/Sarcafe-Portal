import { createServiceRoleClient } from '@/lib/supabase/server'
import { DEFAULT_KIOSK_DEVICE, DEVICE_SLUG_PATTERN, KIOSK_BRANCH_SLUG, normalizeStored, type SettingsSparse } from './device-settings'

// Which kiosk is asking, and which branch it belongs to. A tablet names itself with ?device=<slug> (a public name, not a
// secret); a request that names none is the tablet that already existed (Givat Haviva), so every tablet in the field keeps
// working untouched. Until the kiosk_devices migration is applied, EVERY request resolves to that same legacy kiosk with
// the default settings, so shipping the code before the database cannot break the kiosk.
//
// Service role on purpose: the tables have no browser grants. Nothing personal is read here.

export type BranchName = { he: string; en: string | null; ar: string | null }

export type KioskContext = {
  /** The device's slug, or the default one when running without the registry (legacy). */
  slug: string
  name: string
  /** true: answered from the built-in Givat Haviva kiosk because the registry has no row (or does not exist yet). */
  legacy: boolean
  branch: { id: string; slug: string; name: BranchName; timezone: string }
  stored: SettingsSparse
  settingsUpdatedAt: string | null
}

type DeviceRow = {
  id: string
  slug: string
  name: string
  branch_id: string
  active: boolean
  settings: unknown
  settings_updated_at: string | null
}

type BranchRow = { id: string; slug: string; name: Record<string, unknown> | null; timezone: string | null }

/** Postgres "relation does not exist" / PostgREST "not in the schema cache": the migration has not been applied yet. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '')
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

function toBranch(row: BranchRow): KioskContext['branch'] {
  const name = row.name ?? {}
  return {
    id: row.id,
    slug: row.slug,
    name: { he: text(name.he) ?? text(name.en) ?? row.slug, en: text(name.en), ar: text(name.ar) },
    timezone: row.timezone || 'Asia/Jerusalem',
  }
}

export function cleanSlug(value: string | null | undefined): string | null {
  return value && DEVICE_SLUG_PATTERN.test(value) ? value : null
}

/**
 * The kiosk a request is for. `null` only when a device was NAMED and the registry has no active row for it (a 404);
 * a request without a name, or a registry that is not there yet, is the legacy kiosk.
 */
export async function resolveKiosk(requested: string | null | undefined): Promise<KioskContext | null> {
  const named = cleanSlug(requested)
  if (requested && !named) return null // a malformed name is not a device
  const service = createServiceRoleClient()
  const wanted = named ?? DEFAULT_KIOSK_DEVICE

  const { data: device, error } = await service
    .from('kiosk_devices')
    .select('id, slug, name, branch_id, active, settings, settings_updated_at')
    .eq('slug', wanted)
    .eq('active', true)
    .maybeSingle()
  if (error && !isMissingTable(error)) throw new Error('kiosk device read failed')

  if (device) {
    const row = device as DeviceRow
    const { data: branch, error: branchError } = await service.from('branches').select('id, slug, name, timezone').eq('id', row.branch_id).maybeSingle()
    if (branchError) throw new Error('kiosk branch read failed')
    if (!branch) return null
    return { slug: row.slug, name: row.name, legacy: false, branch: toBranch(branch as BranchRow), stored: normalizeStored(row.settings), settingsUpdatedAt: row.settings_updated_at }
  }

  // No registry row. A named device that does not exist is a 404; no name at all is the legacy kiosk.
  if (named && named !== DEFAULT_KIOSK_DEVICE && !isMissingTable(error)) return null
  const { data: branch, error: branchError } = await service.from('branches').select('id, slug, name, timezone').eq('slug', KIOSK_BRANCH_SLUG).maybeSingle()
  if (branchError) throw new Error('kiosk branch read failed')
  if (!branch) return null
  return { slug: DEFAULT_KIOSK_DEVICE, name: 'קיוסק גבעת חביבה', legacy: true, branch: toBranch(branch as BranchRow), stored: {}, settingsUpdatedAt: null }
}

// ---- owner side ---------------------------------------------------------------------------------------------------

export type OwnerDevice = {
  id: string
  slug: string
  name: string
  active: boolean
  branchId: string
  branchName: string
  stored: SettingsSparse
  settingsUpdatedAt: string | null
  lastSeenAt: string | null
  batteryLevel: number | null
  batteryCharging: boolean | null
  batteryReportedAt: string | null
  appVersion: number | null
  webVersion: string | null
}

type OwnerDeviceRow = DeviceRow & {
  last_seen_at: string | null
  battery_level: number | null
  battery_charging: boolean | null
  battery_reported_at: string | null
  app_version: number | null
  web_version: string | null
}

export type OwnerBranch = { id: string; slug: string; name: string }

/** Every kiosk and the branches one can be linked to. `devices` is null when the migration has not been applied. */
export async function loadOwnerDevices(): Promise<{ devices: OwnerDevice[] | null; branches: OwnerBranch[] }> {
  const service = createServiceRoleClient()
  const [devicesRes, branchesRes] = await Promise.all([
    service
      .from('kiosk_devices')
      .select('id, slug, name, branch_id, active, settings, settings_updated_at, last_seen_at, battery_level, battery_charging, battery_reported_at, app_version, web_version')
      .order('created_at', { ascending: true }),
    service.from('branches').select('id, slug, name, active').eq('active', true).order('created_at', { ascending: true }),
  ])
  if (branchesRes.error) throw new Error('kiosk branches read failed')
  const branches = ((branchesRes.data ?? []) as Array<{ id: string; slug: string; name: Record<string, unknown> | null }>).map((b) => ({
    id: b.id,
    slug: b.slug,
    name: text(b.name?.he) ?? text(b.name?.en) ?? b.slug,
  }))
  if (devicesRes.error) {
    if (isMissingTable(devicesRes.error)) return { devices: null, branches }
    throw new Error('kiosk devices read failed')
  }
  const names = new Map(branches.map((b) => [b.id, b.name]))
  const devices = ((devicesRes.data ?? []) as OwnerDeviceRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    active: row.active,
    branchId: row.branch_id,
    branchName: names.get(row.branch_id) ?? '—',
    stored: normalizeStored(row.settings),
    settingsUpdatedAt: row.settings_updated_at,
    lastSeenAt: row.last_seen_at,
    batteryLevel: row.battery_level,
    batteryCharging: row.battery_charging,
    batteryReportedAt: row.battery_reported_at,
    appVersion: row.app_version,
    webVersion: row.web_version,
  }))
  return { devices, branches }
}
