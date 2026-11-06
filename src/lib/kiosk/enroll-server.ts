import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { menuChannelName } from '@/lib/menu/realtime'
import type { EnrollConfig } from '@/lib/kiosk/enroll'

/** The settings a newly installed kiosk receives (QR install or pairing by code): the same the adb setup used to give it. */
export async function enrollConfig(deviceId: string, pinRecord: string | null, origin: string): Promise<EnrollConfig | 'not_configured' | null> {
  const key = process.env.KIOSK_SIGNUP_KEY
  const rt = process.env.NEXT_PUBLIC_SUPABASE_URL
  const rtKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key || !rt || !rtKey) return 'not_configured'
  const service = createServiceRoleClient()
  const { data: device } = await service.from('kiosk_devices').select('slug, name, branch_id').eq('id', deviceId).maybeSingle()
  const d = device as { slug: string; name: string; branch_id: string } | null
  if (!d) return null
  const { data: branch } = await service.from('branches').select('slug').eq('id', d.branch_id).maybeSingle()
  const branchSlug = (branch as { slug: string } | null)?.slug
  if (!branchSlug) return null
  return {
    device: d.slug, name: d.name, branch: branchSlug,
    api: `${origin}/api/kiosk/menu`, ota: `${origin}/kiosk-ota/`,
    rt, rtKey, rtChannel: menuChannelName(branchSlug), key,
    pinRecord,
  }
}
