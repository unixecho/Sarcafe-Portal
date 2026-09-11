// Mirrors OwnerHeader's exact geometry so there's zero layout shift when
// auth/data resolves and the real header swaps in.
export default function OwnerHeaderSkeleton({ withBack = true }: { withBack?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 4px' }}>
      {withBack && <div className="sk" style={{ width: 34, height: 34, minWidth: 34, borderRadius: '50%' }} />}
      <div className="sk" style={{ height: 22, width: 140, borderRadius: 6, flex: 1 }} />
      <div className="sk" style={{ height: 30, width: 64, borderRadius: 999 }} />
    </div>
  )
}
