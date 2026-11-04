import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { resolveKiosk, isMissingTable } from '@/lib/kiosk/device'
import {
  DEFAULT_KIOSK_DEVICE,
  crossRuleError,
  deviceReportSchema,
  deviceSaveSchema,
  effective,
  mergeStored,
} from '@/lib/kiosk/device-settings'
import { keysMatch, readLimitedText } from '@/lib/kiosk/waitlist'

// What the kiosk tablet says about itself, and what its control panel saves. Two calls, both with the kiosk's shared key
// (the same one the sign-up uses; without KIOSK_SIGNUP_KEY in the host's environment both answer 503):
//
//   POST  the periodic report: battery level and whether it is charging, the app and page versions. Recorded, and when the
//         charge has fallen below this tablet's alert level while NOT charging the database writes ONE alert for each
//         developer (kiosk_device_report). Answers the time the tablet's settings last changed, so a change made on the
//         owner's page reaches the tablet within one report without it asking for the content again.
//   PUT   the control panel's save: a patch of the settings (sparse, bounded, see lib/kiosk/device-settings.ts). The
//         tablet can only change its OWN settings; the branch a tablet belongs to, its name and its key are the owner's
//         (the owner page), never the tablet's.
//
// Nothing personal is read or written. Nothing here is logged except a generic failure.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Kiosk-Key',
  'Cache-Control': 'no-store',
}
const BODY_MAX = 4096

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: CORS })

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

async function readJson(request: NextRequest): Promise<{ ok: true; json: unknown } | { ok: false; response: NextResponse }> {
  const secret = process.env.KIOSK_SIGNUP_KEY
  if (!secret) return { ok: false, response: reply(503, { ok: false, error: 'not_configured' }) }
  if (!keysMatch(request.headers.get('x-kiosk-key'), secret)) return { ok: false, response: reply(401, { ok: false, error: 'unauthorized' }) }
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return { ok: false, response: reply(415, { ok: false, error: 'bad_request' }) }
  }
  const text = await readLimitedText(request, BODY_MAX)
  if (text === null) return { ok: false, response: reply(413, { ok: false, error: 'too_large' }) }
  try {
    return { ok: true, json: JSON.parse(text) }
  } catch {
    return { ok: false, response: reply(400, { ok: false, error: 'bad_request' }) }
  }
}

export async function POST(request: NextRequest) {
  const body = await readJson(request)
  if (!body.ok) return body.response
  const parsed = deviceReportSchema.safeParse(body.json)
  if (!parsed.success) return reply(400, { ok: false, error: 'bad_request' })
  const report = parsed.data

  try {
    if (report.test) {
      const { data, error } = await createServiceRoleClient().rpc('kiosk_device_alert_test', { p_slug: report.device ?? DEFAULT_KIOSK_DEVICE })
      if (error && (error.code === 'PGRST202' || isMissingTable(error))) return reply(503, { ok: false, error: 'not_ready' })
      if (error || !data) return reply(502, { ok: false, error: 'unavailable' })
      const result = data as { ok: boolean; error?: string }
      if (!result.ok) return reply(result.error === 'unknown_device' ? 404 : 502, { ok: false, error: result.error ?? 'unavailable' })
      return reply(200, { ok: true })
    }
    const { data, error } = await createServiceRoleClient().rpc('kiosk_device_report', {
      p_slug: report.device ?? DEFAULT_KIOSK_DEVICE,
      p_level: report.battery?.level ?? null,
      p_charging: report.battery?.charging ?? null,
      p_app_version: report.app ?? null,
      p_web_version: report.web ?? null,
    })
    // the migration is not applied yet: the tablet just tries again later
    if (error && (error.code === 'PGRST202' || isMissingTable(error))) return reply(503, { ok: false, error: 'not_ready' })
    if (error || !data) return reply(502, { ok: false, error: 'unavailable' })
    const result = data as { ok: boolean; error?: string; alerted?: boolean; settingsUpdatedAt?: string | null }
    if (!result.ok) return reply(result.error === 'unknown_device' ? 404 : 502, { ok: false, error: result.error ?? 'unavailable' })
    return reply(200, { ok: true, settingsUpdatedAt: result.settingsUpdatedAt ?? null })
  } catch {
    return reply(502, { ok: false, error: 'unavailable' })
  }
}

export async function PUT(request: NextRequest) {
  const body = await readJson(request)
  if (!body.ok) return body.response
  const parsed = deviceSaveSchema.safeParse(body.json)
  if (!parsed.success) {
    const fields = Array.from(new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(body)'))).slice(0, 8)
    return reply(400, { ok: false, error: 'bad_request', fields })
  }

  try {
    const service = createServiceRoleClient()
    // two tries: another writer (the owner's page) may have saved between our read and our write
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const kiosk = await resolveKiosk(parsed.data.device ?? null)
      if (!kiosk) return reply(404, { ok: false, error: 'unknown_device' })
      if (kiosk.legacy) return reply(503, { ok: false, error: 'not_ready' }) // no registry row to save into yet

      const merged = mergeStored(kiosk.stored, parsed.data.patch)
      const rule = crossRuleError(merged)
      if (rule) return reply(400, { ok: false, error: 'bad_settings', message: rule })

      const now = new Date().toISOString()
      let update = service
        .from('kiosk_devices')
        .update({ settings: merged, settings_updated_at: now, settings_updated_by: null, updated_at: now })
        .eq('slug', kiosk.slug)
      update = kiosk.settingsUpdatedAt ? update.eq('settings_updated_at', kiosk.settingsUpdatedAt) : update
      const { data, error } = await update.select('slug')
      if (error) return reply(502, { ok: false, error: 'unavailable' })
      if (data && data.length > 0) return reply(200, { ok: true, settings: effective(merged), settingsUpdatedAt: now })
    }
    return reply(409, { ok: false, error: 'conflict' })
  } catch {
    return reply(502, { ok: false, error: 'unavailable' })
  }
}
