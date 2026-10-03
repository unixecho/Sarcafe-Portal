import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'
import '@/components/owner/pos/setup.css'

// Same box as the real page: the shared header, the "next step" line, then the
// checklist's rows at the heights they take (a short one, a tall one with a button),
// so the swap-in moves nothing.
export default function OwnerPosSetupLoading() {
  return (
    <main id="main" tabIndex={-1} className="os-page" aria-busy="true">
      <OwnerHeaderSkeleton />
      <div className="sk" style={{ height: 22, width: '60%', borderRadius: 8, margin: '4px 4px 14px' }} />
      <ul className="os-rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {[132, 112, 200, 112, 112, 220, 190].map((h, i) => (
          <li key={i} className="sk" style={{ height: h, borderRadius: 'var(--radius-lg)' }} />
        ))}
      </ul>
    </main>
  )
}
