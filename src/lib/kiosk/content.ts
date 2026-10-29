import { createHash, createHmac } from 'node:crypto'
import QRCode from 'qrcode'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { fetchMenu } from '@/lib/menu/fetch'
import { getBranchOpenStates } from '@/lib/shifts/hours'
import { KIOSK_BRANCH_SLUG } from './menu'
import {
  FEEDBACK_PATH,
  buildKioskContent,
  normalizeSettings,
  type HighlightSourceItem,
  type KioskContent,
  type KioskHoursException,
  type StoredAd,
} from './content-project'

// Server side of the kiosk's content: reads what the owner saved (kiosk_settings, kiosk_ads), the branch's operating
// hours (shift_settings, the "שעות פעילות" the schedule settings already manage) and the published menu, and hands
// them to the pure projection in content-project.ts. Service role on purpose: the kiosk tables have no browser grants
// at all, and only the projected, personal-data-free shape ever leaves this file for the public route.

const AD_COLUMNS = 'id, kind, title, body, action, image_url, menu_item_ids, enabled, sort_order, seed_key'

type AdRow = {
  id: string
  kind: string
  title: string
  body: string
  action: string
  image_url: string | null
  menu_item_ids: string[] | null
  enabled: boolean
  sort_order: number
  seed_key: string | null
}

type SettingsRow = { idle_seconds: number; grace_seconds: number; slide_seconds: number; hours_exceptions: unknown }

export const toStoredAd = (row: AdRow): StoredAd => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body ?? '',
  action: row.action,
  imageUrl: row.image_url,
  menuItemIds: row.menu_item_ids ?? [],
  enabled: row.enabled,
  sortOrder: row.sort_order,
})

function toExceptions(raw: unknown): KioskHoursException[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      date: typeof e.date === 'string' ? e.date : '',
      closed: e.closed === true,
      open: typeof e.open === 'string' ? e.open : null,
      close: typeof e.close === 'string' ? e.close : null,
      note: typeof e.note === 'string' ? e.note : null,
    }))
}

/** YYYY-MM-DD in the given zone (falls back to UTC on a broken zone name). */
export function todayIn(timezone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

/** QR rows of '0'/'1' (quiet zone not included: the kiosk draws its own margin). */
export function qrModules(url: string): string[] {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  const rows: string[] = []
  for (let r = 0; r < size; r++) {
    let row = ''
    for (let c = 0; c < size; c++) row += qr.modules.get(r, c) ? '1' : '0'
    rows.push(row)
  }
  return rows
}

const sha16 = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** Card pictures may only come from our own Supabase project's public storage. */
export function imagePrefix(): string | null {
  try {
    const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    return base.protocol === 'https:' ? `${base.origin}/storage/v1/object/public/` : null
  } catch {
    return null
  }
}

/** Every item of a menu's categories, in menu order. */
function flattenItems(categories: Array<{ items?: HighlightSourceItem[] }> | null | undefined): HighlightSourceItem[] {
  return (categories ?? []).flatMap((category) => category.items ?? [])
}

async function kioskBranch() {
  const service = createServiceRoleClient()
  const { data, error } = await service.from('branches').select('id, timezone').eq('slug', KIOSK_BRANCH_SLUG).maybeSingle()
  // a read failure is an outage (500), not "no such branch" (404)
  if (error) throw new Error('kiosk branch read failed')
  return data as { id: string; timezone: string | null } | null
}

/** The whole public answer. `origin` builds the poll link the feedback card's QR opens. Null when the branch is missing. */
export async function getKioskContent(origin: string, at: Date = new Date()): Promise<KioskContent | null> {
  const branch = await kioskBranch()
  if (!branch) return null
  const timezone = branch.timezone || 'Asia/Jerusalem'
  const service = createServiceRoleClient()
  const [settingsRes, adsRes, openStates, menu] = await Promise.all([
    service.from('kiosk_settings').select('idle_seconds, grace_seconds, slide_seconds, hours_exceptions').eq('branch_id', branch.id).maybeSingle(),
    service.from('kiosk_ads').select(AD_COLUMNS).eq('branch_id', branch.id).order('sort_order', { ascending: true }),
    getBranchOpenStates([{ id: branch.id, timezone }], at),
    fetchMenu(KIOSK_BRANCH_SLUG),
  ])
  if (settingsRes.error || adsRes.error) throw new Error('kiosk content read failed')
  const settings = settingsRes.data as SettingsRow | null

  return buildKioskContent(
    {
      settings: settings
        ? { idleSeconds: settings.idle_seconds, graceSeconds: settings.grace_seconds, slideSeconds: settings.slide_seconds }
        : null,
      ads: ((adsRes.data ?? []) as AdRow[]).map(toStoredAd),
      weeklyHours: openStates[branch.id]?.weeklyHours ?? null,
      exceptions: toExceptions(settings?.hours_exceptions),
      timezone,
      menuItems: flattenItems(menu?.categories as Array<{ items?: HighlightSourceItem[] }> | undefined),
      feedbackUrl: `${origin.replace(/\/+$/, '')}${FEEDBACK_PATH}`,
      today: todayIn(timezone, at),
      imagePrefix: imagePrefix(),
    },
    { qr: qrModules, hash: sha16 },
  )
}

export type PollOption = { id: string; label: string }

/** The options the public poll offers right now (enabled, in the owner's order). */
export async function getPollOptions(): Promise<PollOption[]> {
  // the poll page must still open (rating and suggestion work without options) when this read fails
  const branch = await kioskBranch().catch(() => null)
  if (!branch) return []
  const { data } = await createServiceRoleClient()
    .from('kiosk_feedback_options')
    .select('id, label')
    .eq('branch_id', branch.id)
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
  return ((data ?? []) as PollOption[]).map((row) => ({ id: row.id, label: row.label }))
}

// ---- owner side ----------------------------------------------------------------------------------------------------

export type OwnerAd = StoredAd & { seeded: boolean }
export type OwnerOption = { id: string; label: string; enabled: boolean }
export type OwnerMenuItem = { id: string; name: string; category: string; price: number | string | null; available: boolean }
export type OwnerKioskContent = {
  settings: { idleSeconds: number; graceSeconds: number; slideSeconds: number; exceptions: KioskHoursException[] }
  ads: OwnerAd[]
  options: OwnerOption[]
  menuItems: OwnerMenuItem[]
  weeklyHours: Array<{ open: string; close: string } | null> | null
  timezone: string
  imagePrefix: string | null
}

/** Everything /owner/kiosk edits, plus the published menu items to pick highlights from. The caller checks the owner. */
export async function loadOwnerKioskContent(): Promise<OwnerKioskContent | null> {
  const branch = await kioskBranch()
  if (!branch) return null
  const timezone = branch.timezone || 'Asia/Jerusalem'
  const service = createServiceRoleClient()
  const [settingsRes, adsRes, optionsRes, openStates, menu] = await Promise.all([
    service.from('kiosk_settings').select('idle_seconds, grace_seconds, slide_seconds, hours_exceptions').eq('branch_id', branch.id).maybeSingle(),
    service.from('kiosk_ads').select(AD_COLUMNS).eq('branch_id', branch.id).order('sort_order', { ascending: true }),
    service.from('kiosk_feedback_options').select('id, label, enabled').eq('branch_id', branch.id).order('sort_order', { ascending: true }),
    getBranchOpenStates([{ id: branch.id, timezone }]),
    fetchMenu(KIOSK_BRANCH_SLUG),
  ])
  if (settingsRes.error || adsRes.error || optionsRes.error) throw new Error('kiosk content read failed')
  const s = settingsRes.data as SettingsRow | null
  const base = normalizeSettings(s ? { idleSeconds: s.idle_seconds, graceSeconds: s.grace_seconds, slideSeconds: s.slide_seconds } : null)

  const menuItems: OwnerMenuItem[] = []
  for (const category of (menu?.categories ?? []) as Array<{ title?: { he?: string; en?: string }; items?: HighlightSourceItem[] }>) {
    const categoryName = (category.title?.he ?? category.title?.en ?? '').trim()
    for (const item of category.items ?? []) {
      const name = (item.he ?? item.en ?? '').trim()
      if (!item.uid || !name) continue
      menuItems.push({ id: item.uid, name, category: categoryName, price: item.price ?? null, available: item.available !== false && item.quantity !== 0 })
    }
  }

  return {
    settings: { ...base, exceptions: toExceptions(s?.hours_exceptions) },
    ads: ((adsRes.data ?? []) as AdRow[]).map((row) => ({ ...toStoredAd(row), seeded: row.seed_key !== null })),
    options: ((optionsRes.data ?? []) as OwnerOption[]).map((row) => ({ id: row.id, label: row.label, enabled: row.enabled })),
    menuItems,
    weeklyHours: openStates[branch.id]?.weeklyHours ?? null,
    timezone,
    imagePrefix: imagePrefix(),
  }
}

// ---- the poll's rate-limit key -------------------------------------------------------------------------------------

/**
 * An HMAC of the caller's address and the date (the same idea as the kiosk sign-up's callerKey): no raw address is
 * ever stored, and the key changes every day. The secret is the one the rest of the app's rate limits use.
 */
export function feedbackCallerKey(forwardedFor: string | null, now: Date = new Date()): string | null {
  const secret = process.env.RATE_LIMIT_KEY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) return null
  const ip = (forwardedFor ?? '').split(',')[0]?.trim() || 'unknown'
  return createHmac('sha256', secret).update(`kiosk-feedback|${now.toISOString().slice(0, 10)}|${ip}`).digest('hex')
}
