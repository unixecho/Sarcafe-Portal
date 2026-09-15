import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function EditorLoading() {
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeaderSkeleton />
      <div className="sk" style={{ height: 44, borderRadius: 999, marginBottom: 16 }} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="sk" style={{ height: 160, marginBottom: 12 }} />
      ))}
    </main>
  )
}
