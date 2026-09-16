import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function FeedbackLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeaderSkeleton withBack />
      <div className="sk" style={{ height: 60, borderRadius: 14, marginBottom: 14 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk" style={{ height: 96 }} />
        ))}
      </div>
    </main>
  )
}
