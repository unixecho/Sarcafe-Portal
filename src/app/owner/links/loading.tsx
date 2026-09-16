import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function LinksLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeaderSkeleton withBack />
      <div className="sk" style={{ height: 16, width: 260, borderRadius: 4, marginBottom: 16 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="sk" style={{ height: 52 }} />
        ))}
      </div>
    </main>
  )
}
