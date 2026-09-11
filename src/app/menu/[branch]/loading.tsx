export default function MenuLoading() {
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '16px' }}>
      <div className="sk" style={{ height: 32, width: '60%', margin: '0 auto 20px', borderRadius: 8 }} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sk" style={{ height: 36, width: 90, borderRadius: 999, flexShrink: 0 }} />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="sk" style={{ height: 64, marginBottom: 10 }} />
      ))}
    </main>
  )
}
