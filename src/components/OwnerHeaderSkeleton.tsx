// Mirrors OwnerHeader's exact geometry so there's zero layout shift when
// auth/data resolves and the real header swaps in.
import '@/components/app/app.css'

export default function OwnerHeaderSkeleton({ withBack = true }: { withBack?: boolean }) {
  return (
    <>
      <div className="app-header" aria-hidden="true">
        <div className="sk" style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: 15 }} />
        {withBack && <div className="sk" style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: 15 }} />}
        <div className="sk" style={{ height: 20, width: 140, borderRadius: 8, flex: 1 }} />
        <div className="sk" style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: 15 }} />
        <div className="sk" style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: 15 }} />
      </div>
      <div className="app-header__spacer" aria-hidden="true" />
      <div className="app-route-loading" role="status"><span className="sr-only">טוען…</span></div>
    </>
  )
}
