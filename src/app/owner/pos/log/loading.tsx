import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'
import '@/components/owner/pos/ops.css'

// Same geometry as the real page: a filter strip, a count line, then rows.
export default function OwnerPosLogLoading() {
  return (
    <main id="main" tabIndex={-1} className="ops-main">
      <OwnerHeaderSkeleton withBack />
      <div className="sk" style={{ height: 52, borderRadius: 16, marginBottom: 12 }} />
      <div className="ops-list-head">
        <div className="sk" style={{ height: 18, width: 90, borderRadius: 6 }} />
      </div>
      <div className="ops-order-list" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="sk" style={{ height: 58, borderRadius: 14 }} />
        ))}
      </div>
    </main>
  )
}
