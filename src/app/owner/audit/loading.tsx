import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function AuditLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeaderSkeleton withBack />
      <div className="sk" style={{ height: 44, borderRadius: 999, marginBottom: 16 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sk" style={{ height: 64 }} />
        ))}
      </div>
    </main>
  )
}
