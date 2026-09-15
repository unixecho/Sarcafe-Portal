import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

/**
 * Same reasoning as owner/staff/loading.tsx — this route reads the stored
 * accessibility statement before it can render the editor, and without a
 * skeleton that read happens while the previous page is still frozen on
 * screen under the push.
 *
 * The statement editor is a stack of labelled text fields, so the skeleton is
 * a stack of equal rows rather than one large block: it promises the shape
 * that is actually coming (§4.10).
 */
export default function OwnerAccessibilityLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeaderSkeleton />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="sk" style={{ width: '70%', height: 14, borderRadius: 6 }} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="sk" style={{ width: 96, height: 12, borderRadius: 5 }} />
            <div className="sk" style={{ height: 'var(--tap-min)', borderRadius: 'var(--radius-sm)' }} />
          </div>
        ))}
        <div className="sk" style={{ height: 'var(--tap-min)', borderRadius: 999, marginTop: 4 }} />
      </div>
    </main>
  )
}
