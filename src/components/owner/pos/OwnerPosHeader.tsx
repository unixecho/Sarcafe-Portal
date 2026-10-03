'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import OwnerHeader from '@/components/OwnerHeader'
import BranchSwitcher from '@/components/BranchSwitcher'
import type { Branch } from '@/lib/branches'
import { useT } from '@/lib/pos/useT'

// The owner POS pages' header: the shared OwnerHeader (back to the POS hub) plus the
// shared branch chips, so the event chosen here is the same one every other owner page
// reads from the cookie. Choosing an event re-renders the SERVER page for it
// (router.refresh) rather than fetching client-side: the first paint of the new
// event's checklist is then server-rendered like the first one was, and the
// workspace below remounts keyed on the event so no state leaks across events.

export type EventLite = { id: string; slug: string; label: string }

const NO_LINKS = { navGoogleMaps: null, navWaze: null, navAppleMaps: null, instagram: null, review: null, bit: null }

export default function OwnerPosHeader({ events, current }: { events: EventLite[]; current: string }) {
  const t = useT()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // BranchSwitcher only reads slug + name.he; the rest of Branch is filled so the type holds.
  const branches: Branch[] = events.map((e) => ({ id: e.id, slug: e.slug, name: { he: e.label }, kind: 'event', links: NO_LINKS, reviews: null, hoursToday: null, openNow: true }))

  return (
    <>
      <OwnerHeader title={t('owner.setup.title')} backHref="/owner/pos" />
      {events.length > 1 && (
        <div className="os-switch" aria-label={t('owner.setup.switchEvent')}>
          <BranchSwitcher branches={branches} value={current} disabled={pending} onChange={() => startTransition(() => router.refresh())} />
        </div>
      )}
    </>
  )
}
