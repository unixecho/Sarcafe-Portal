import { NextResponse, type NextRequest } from 'next/server'
import { bearerMatches } from '@/lib/http/cron'
import { apiRoute, ApiError, Unauthorized } from '@/lib/http/errors'
import { removePhotos } from '@/lib/identity/server/photo-store'
import { photoCleanupDone, photoCleanupDue } from '@/lib/identity/server/registration'

// The photo cleanup of employee registration (FABLE-003): deletes from the private bucket the uploads that never became part of an
// application (an hour after they were written) and the rejected or replaced photos whose erase date (from the PUBLISHED retention)
// has passed, then reports them done; the database then also removes the names of rejected applications past that date. Nothing is
// deleted by age when the business decided no retention. Order matters: objects first, then the rows, so a failed deletion is
// simply listed again on the next run (nothing is marked erased that still exists).
//
// Protected like every scheduled route (CRON_SECRET bearer). It is NOT in vercel.json yet: schedule it when the identity migrations
// are applied and registration is opened (docs/SARCAFE_IDENTITY.md, release checklist).
export const GET = apiRoute(async (request: NextRequest) => {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) throw Unauthorized('Not a scheduled invocation.')
  const due = await photoCleanupDue(200)
  if (due.length === 0) return NextResponse.json({ ok: true, removed: 0, discarded: 0, erased: 0, profilesErased: 0 }, { headers: { 'Cache-Control': 'no-store' } })
  try {
    await removePhotos(due.map((photo) => photo.objectPath))
  } catch {
    console.error('identity photo cleanup: storage did not delete; nothing marked, retried next run')
    throw new ApiError(503, 'unavailable', 'storage unavailable')
  }
  const done = await photoCleanupDone(due.map((photo) => photo.photoId))
  return NextResponse.json({ ok: true, removed: due.length, ...done }, { headers: { 'Cache-Control': 'no-store' } })
})
