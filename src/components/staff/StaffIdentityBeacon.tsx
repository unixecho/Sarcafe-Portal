'use client'

import { useEffect } from 'react'
import { INTRO_NAME_KEY, INTRO_SIGNED_KEY, cleanName } from '@/lib/staff/app-intro-copy'

// Rendered by the staff layout, where the server knows who is signed in. It leaves two facts in storage for the opening screen
// (components/staff/StaffAppIntro.tsx, which lives in the root layout and cannot ask the server itself):
//   • whether this launch has a session (this launch only: sessionStorage), and
//   • the first name, kept on the phone so that a later launch with an expired session can still say "I see it's you again".
// Only a first name is stored, on this device only, and signing in again replaces it. Nothing is sent anywhere.
export default function StaffIdentityBeacon({ name, signedIn }: { name: string | null; signedIn: boolean }) {
  useEffect(() => {
    try {
      sessionStorage.setItem(INTRO_SIGNED_KEY, signedIn ? '1' : '0')
      const clean = cleanName(name)
      if (signedIn && clean) localStorage.setItem(INTRO_NAME_KEY, clean)
    } catch { /* Storage can be unavailable; the opening screen then treats the person as a stranger. */ }
  }, [name, signedIn])
  return null
}
