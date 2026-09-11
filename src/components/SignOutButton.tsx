'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
      <button type="button" className={`press${className ? ` ${className}` : ''}`} onClick={signOut} disabled={busy}>
        {busy ? 'יוצא...' : 'התנתק'}
      </button>
      {error && (
        <p role="alert" style={{ color: '#ff6b6b', fontSize: '0.8rem', marginTop: 6 }}>
          {error}
        </p>
      )}
    </div>
  )
}
