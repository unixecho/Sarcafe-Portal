'use client'

import { useState } from 'react'
import { Button } from 'glisse'
import { CircleAlert, LogIn } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { BENEFITS_RETURNS } from '@/lib/identity/invitations'

// The one sign-in of the /benefits pages: Google, through the same Supabase project as the staff door, but returning to a benefits
// page (the auth callback accepts exactly two return pages and never sends this sign-in into the staff app). Signing in gives no
// authority: it only says who is asking.
export default function BenefitsSignIn({ returnTo, label = 'התחברות עם Google', failed = false }: { returnTo: (typeof BENEFITS_RETURNS)[number]; label?: string; failed?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(failed)

  const signIn = async () => {
    setBusy(true)
    setError(false)
    const { error: authError } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo)}`, queryParams: { prompt: 'select_account' } },
    })
    // on success the browser leaves for Google
    if (authError) { setBusy(false); setError(true) }
  }

  return (
    <>
      {error && <p className="gl-note gl-note--bad" role="alert"><CircleAlert size={18} aria-hidden="true" />ההתחברות לא הצליחה. נסו שוב.</p>}
      <div className="gl-card__actions">
        <Button variant="filled" icon={<LogIn size={16} />} disabled={busy} onClick={() => void signIn()} data-identity="google-sign-in">{busy ? 'מעבירים ל־Google…' : label}</Button>
      </div>
    </>
  )
}
