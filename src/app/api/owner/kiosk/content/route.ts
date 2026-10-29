import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { imagePrefix, loadOwnerKioskContent } from '@/lib/kiosk/content'
import { imageAllowed } from '@/lib/kiosk/content-project'
import { contentSaveSchema } from '@/lib/kiosk/content-schema'

// What the kiosk shows between customers: the cards, the timings, the dated hours exceptions and the poll's options.
// Full owner only (requireOwner refuses quick sessions, employees and managers), re-checked here whatever the
// middleware decided. One PUT is the page's one Save: the database function validates everything again and writes it
// all or nothing.

const SAVE_ERRORS: Record<string, string> = {
  bad_settings: 'זמני הקיוסק מחוץ לטווח המותר.',
  bad_exception: 'אחד מימי החריגה בשעות אינו תקין.',
  duplicate_exception: 'אותו תאריך מופיע פעמיים בימי החריגה.',
  too_many_ads: 'יותר מדי כרטיסים.',
  bad_ad: 'אחד הכרטיסים אינו תקין.',
  seeded_ad_missing: 'אי אפשר למחוק את הכרטיסים הקבועים, רק לכבות אותם.',
  too_many_options: 'יותר מדי אפשרויות הצבעה.',
  bad_option: 'אחת מאפשרויות ההצבעה אינה תקינה.',
}

export const GET = apiRoute(async () => {
  await requireOwner()
  const content = await loadOwnerKioskContent()
  if (!content) throw NotFound('The kiosk branch was not found.')
  return NextResponse.json(content, { headers: { 'Cache-Control': 'no-store' } })
})

export const PUT = apiRoute(async (request: NextRequest) => {
  const me = await requireOwner()
  const body = contentSaveSchema.parse(await request.json())

  // Pictures only from our own public storage (the kiosk loads them from the open internet otherwise).
  const prefix = imagePrefix()
  const badImage = body.ads.findIndex((ad) => ad.imageUrl !== null && ad.imageUrl !== '' && !imageAllowed(ad.imageUrl, prefix))
  if (badImage >= 0) throw BadRequest('תמונה מותרת רק מהאחסון של שרקפה (קישור ציבורי מ-Supabase Storage).')

  const { data, error } = await createServiceRoleClient().rpc('kiosk_content_save', {
    p_actor: me.id,
    p_settings: body.settings,
    p_ads: body.ads.map((ad) => ({ ...ad, imageUrl: ad.imageUrl || null })),
    p_options: body.options,
  })
  if (error || !data) throw BadRequest('השמירה נכשלה.')
  const result = data as { ok: boolean; error?: string }
  if (!result.ok) throw BadRequest(SAVE_ERRORS[result.error ?? ''] ?? 'השמירה נכשלה.')

  const content = await loadOwnerKioskContent()
  return NextResponse.json(content, { headers: { 'Cache-Control': 'no-store' } })
})
