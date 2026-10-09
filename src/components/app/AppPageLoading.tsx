import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'

export default function AppPageLoading({ wide = false }: { wide?: boolean }) {
  return (
    <main className="app-page" style={wide ? { maxWidth: 1760 } : undefined} aria-busy="true">
      <OwnerHeaderSkeleton withBack={false} />
      <div className="app-loading-content" aria-hidden="true">
        <div className="sk" style={{ height: 34, width: 'min(280px,70%)', borderRadius: 11 }} />
        <div className="sk" style={{ height: 112, borderRadius: 25 }} />
        <div className="app-loading-grid">
          <div className="sk" />
          <div className="sk" />
          <div className="sk" />
          <div className="sk" />
        </div>
      </div>
    </main>
  )
}
