import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireMenuEditor } from '@/lib/owner/guard'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { logMenuAudit, summarizeMenuDiff } from '@/lib/menu/audit'
import type { MenuDoc } from '@/lib/menu/types'

// Replaces MenuEditor.tsx's previous direct-browser-Supabase writes for
// Save/Publish. The actual mutation still runs as the CALLER'S OWN session
// (createServerSupabaseClient, not service role) — same RLS policy
// ("menu editors can update their branch's menu") and the same auth.uid()
// publish_menu() relies on for menu_versions.published_by, so behavior is
// byte-identical to before. Service role is used for exactly one thing:
// writing to menu_audit, which has no RLS policies at all and is reachable
// only through a service-role client by design.

const bodySchema = z.object({
  branch: z.string(),
  action: z.enum(['save', 'publish']),
  draft: z.object({ categories: z.array(z.record(z.string(), z.unknown())) }),
})

export const POST = apiRoute(async (request: NextRequest) => {
  const body = bodySchema.parse(await request.json())
  const audit = createServiceRoleClient()

  const { data: menu } = await audit
    .from('menus')
    .select('id, branch_id, draft')
    .eq('slug', body.branch)
    .maybeSingle()
  if (!menu) throw NotFound('Menu not found for this branch.')

  const staff = await requireMenuEditor(menu.branch_id)

  const previousDraft = menu.draft as MenuDoc
  const nextDraft = body.draft as unknown as MenuDoc

  const supabase = await createServerSupabaseClient()
  const { error: saveError } = await supabase
    .from('menus')
    .update({ draft: nextDraft, updated_at: new Date().toISOString() })
    .eq('id', menu.id)
  if (saveError) throw BadRequest('Could not save draft.')

  if (body.action === 'save') {
    const { summary, detail } = summarizeMenuDiff(previousDraft, nextDraft)
    await logMenuAudit(audit, {
      actor: staff,
      branchId: menu.branch_id,
      menuId: menu.id,
      action: 'menu.save',
      summary: `שמר טיוטת תפריט — ${summary}`,
      detail,
    })
    return NextResponse.json({ ok: true })
  }

  const { error: publishError } = await supabase.rpc('publish_menu', { p_menu_id: menu.id })
  if (publishError) throw BadRequest('Could not publish menu.')

  const { summary, detail } = summarizeMenuDiff(previousDraft, nextDraft)
  await logMenuAudit(audit, {
    actor: staff,
    branchId: menu.branch_id,
    menuId: menu.id,
    action: 'menu.publish',
    summary: `פרסם את התפריט ללקוחות — ${summary}`,
    detail,
  })

  return NextResponse.json({ ok: true })
})
