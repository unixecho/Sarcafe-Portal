import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

/**
 * /owner/staff is a dynamic route that reads the roster and the branch list
 * before it can render anything. Without a skeleton the push animation holds
 * the OUTGOING page on screen until that finishes (viewTransition.ts keeps
 * the snapshot up to COMMIT_TIMEOUT_MS), so the tap reads as "nothing
 * happened" for a beat. A loading.tsx turns the same wait into an instant
 * arrival that fills in.
 *
 * Geometry mirrors page.tsx: same maxWidth, same padding, header first, then
 * the invite card, then roster rows.
 */
export default function OwnerStaffLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeaderSkeleton />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* the invite card — email field, two pickers, submit */}
        <div className="sk" style={{ height: 196, borderRadius: 'var(--radius-md)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="sk" style={{ height: 74, borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      </div>
    </main>
  )
}
