import { Forbidden, NotFound } from '@/lib/http/errors'
import { requireMenuEditor, type StaffRow } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { isWithinOperatingHours } from '@/lib/shifts/hours'
import { isOp } from '@/lib/staff/access'
import type { MenuDoc } from './types'

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>

export type TabletWriteContext = {
  service: ServiceRoleClient
  menuId: string
  branchId: string
  draft: MenuDoc
  staff: StaffRow
  /** Whether this write may also touch `published` — false outside
   * operating hours, unless the caller is the owner testing the tool (see
   * lib/shifts/hours.ts). Pass straight through as set_availability() /
   * add_menu_item() / remove_menu_item()'s p_publish argument. */
  publish: boolean
}

/**
 * Shared entry point for every live-tablet write (availability/quantity
 * toggles, and adding/removing items) — resolves the menu, checks
 * menu-editor access for its branch, and applies the one operating-hours
 * rule all of them share: outside operating hours, only the owner may
 * write at all, and even then only to draft. Keeping this in one place
 * means the rule can't drift between routes the way it would if each
 * route re-implemented the check.
 */
export async function resolveTabletWrite(branchSlug: string): Promise<TabletWriteContext> {
  const service = createServiceRoleClient()
  const { data: menu } = await service.from('menus').select('id, branch_id, draft').eq('slug', branchSlug).maybeSingle()
  if (!menu) throw NotFound('Menu not found for this branch.')

  const staff = await requireMenuEditor(menu.branch_id)
  const publish = await isWithinOperatingHours(menu.branch_id)
  if (!publish && !isOp(staff)) {
    throw Forbidden('Live availability can only be edited during operating hours.')
  }

  return { service, menuId: menu.id, branchId: menu.branch_id, draft: menu.draft as MenuDoc, staff, publish }
}
