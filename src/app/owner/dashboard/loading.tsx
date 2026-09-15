import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function DashboardLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeaderSkeleton withBack={false} />
      <div className="sk" style={{ height: 44, borderRadius: 999, marginBottom: 16 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 24 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk" style={{ height: 68 }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk" style={{ height: 74 }} />
        ))}
      </div>
    </main>
  )
}
