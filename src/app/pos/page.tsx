import type { Metadata, Viewport } from 'next'
import { redirect } from 'next/navigation'
import PosApp from '@/components/pos/PosApp'
import { ApiError } from '@/lib/http/errors'
import type { BootstrapResponse } from '@/lib/pos/api'
import { loadBootstrap } from '@/lib/pos/server/bootstrap'
import { canAccessBranch, isUuid, resolvePosIdentity } from '@/lib/pos/server/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Sarcafe — קופה',
  description: 'Sarcafe — קופה ועמדות הכנה.',
  manifest: '/staff-manifest.json',
  appleWebApp: { capable: true, title: 'Sarcafe צוות', statusBarStyle: 'black-translucent' },
}

// A till on a tablet: zoom stays ENABLED (accessibility — a person who needs to
// pinch must be able to), so there is no maximumScale / userScalable here. The theme
// colour is the app's own --bg so the browser chrome does not flash a different
// shade around a dark screen.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#150f0c',
  viewportFit: 'cover',
}

// The staff app's server entry. Middleware has already sent strangers to /login and
// non-staff to /no-access; the page checks AGAIN (middleware is the first gate, not
// the only one) and uses the SAME single identity resolution every /api/pos route
// uses. It then renders the first paint already populated — identity, branch, session,
// points, routes, menu, staff directory — as props, so a tablet waking up shows the
// register instead of a spinner. Everything after that (live queue, orders) is read by
// the browser directly over RLS and refreshed by the realtime signal.
//
// `?branch=<slug|uuid>` is only a first-paint hint for a person who may work several
// branches; a stale or foreign value falls back to the default rather than breaking
// the app.
export default async function PosPage({ searchParams }: { searchParams: Promise<{ branch?: string | string[]; v?: string; p?: string }> }) {
  const { signedIn, staff } = await resolvePosIdentity()
  if (!signedIn) redirect('/login')
  if (!staff) redirect('/no-access')

  const params = await searchParams
  let ref = typeof params.branch === 'string' && params.branch.trim() !== '' ? params.branch.trim().slice(0, 80) : undefined
  // A shared station link identifies its event even when it has no branch query.
  // Resolve on the server and retain the independently authorized branch scope.
  if (!ref && (params.v === 'station' || params.v === 'timeline') && isUuid(params.p)) {
    const { data: point, error } = await createServiceRoleClient().from('pos_points').select('branch_id').eq('id', params.p).eq('active', true).maybeSingle()
    if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו לפתוח את העמדה. נסו שוב.')
    if (point && canAccessBranch(staff, point.branch_id)) ref = point.branch_id
  }

  let initial: BootstrapResponse
  try {
    initial = await loadBootstrap({ staffId: staff.id, staff, branchRef: ref })
  } catch (err) {
    // A branch hint that does not resolve (renamed slug, someone else's event) is not
    // an outage: load the default. Anything else — a read that really failed — surfaces.
    if (ref && err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      initial = await loadBootstrap({ staffId: staff.id, staff })
    } else {
      throw err
    }
  }

  return <PosApp initial={initial} />
}
