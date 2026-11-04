import { fetchMenu } from '@/lib/menu/fetch'
import { resolveKiosk } from './device'
import { KIOSK_BRANCH_SLUG } from './device-settings'
import { buildKioskSnapshot, type KioskSnapshot } from './project'

/** The branch the first kiosk was pinned to; a request that names no device still gets it. */
export { KIOSK_BRANCH_SLUG }

/**
 * The published, variant-resolved menu the public page shows, projected for the kiosk. The branch is the one the
 * requesting device is linked to (`requestedDevice`, the tablet's own name); no name means the tablet that already existed.
 * No caller can pick a branch directly: only a registered device decides which one it gets.
 */
export async function getKioskSnapshot(requestedDevice: string | null = null): Promise<KioskSnapshot | null> {
  const kiosk = await resolveKiosk(requestedDevice)
  if (!kiosk) return null
  const menu = await fetchMenu(kiosk.branch.slug)
  if (!menu) return null
  const branchName = (menu.name.he ?? menu.name.en ?? '').trim() || kiosk.branch.slug
  return buildKioskSnapshot(branchName, menu.publishedAt, menu.categories)
}
