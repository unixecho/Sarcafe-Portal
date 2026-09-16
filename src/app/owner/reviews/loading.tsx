import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function ReviewsLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeaderSkeleton withBack />
      <div className="sk" style={{ height: 16, width: 280, borderRadius: 4, marginBottom: 16 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk" style={{ height: 96 }} />
        ))}
      </div>
    </main>
  )
}
