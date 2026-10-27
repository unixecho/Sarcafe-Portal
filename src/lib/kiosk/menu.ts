import { fetchMenu } from '@/lib/menu/fetch'
import { buildKioskSnapshot, type KioskSnapshot } from './project'

/** The kiosk is pinned to one branch on the server; no caller can pick another. */
export const KIOSK_BRANCH_SLUG = 'givat-haviva'

/** The published, variant-resolved menu the public page shows, projected for the kiosk. */
export async function getKioskSnapshot(): Promise<KioskSnapshot | null> {
  const menu = await fetchMenu(KIOSK_BRANCH_SLUG)
  if (!menu) return null
  const branchName = (menu.name.he ?? menu.name.en ?? '').trim() || KIOSK_BRANCH_SLUG
  return buildKioskSnapshot(branchName, menu.publishedAt, menu.categories)
}
