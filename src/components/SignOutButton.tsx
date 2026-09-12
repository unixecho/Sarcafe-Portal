'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

export default function SignOutButton({ className }: { className?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signOut() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/signout', { method: 'POST' })
      if (!res.ok) {
        // A non-ok (but non-throwing) response previously left this button
        // stuck disabled forever with no feedback — always resolve busy
        // state and surface something, even on failure.
        setError('שגיאה בהתנתקות')
        setBusy(false)
        return
      }
      router.push('/login')
      router.refresh()
    } catch {
      setError('שגיאה בהתנתקות')
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        className={`press${className ? ` ${className}` : ''}`}
        onClick={signOut}
        disabled={busy}
        aria-label="התנתקות"
        title="התנתקות"
        style={{
          width: 34,
          height: 34,
          minWidth: 34,
          borderRadius: '50%',
          background: 'var(--bg-elev-2)',
          border: 'none',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--text-dim)',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <LogOut size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {error && (
        <p role="alert" style={{ color: '#ff6b6b', fontSize: '0.8rem', marginTop: 6 }}>
          {error}
        </p>
      )}
    </div>
  )
}
