'use client'

import { Glass, Menu, type MenuEntry } from 'glisse'
import { LogOut, UserRound } from 'lucide-react'
import { glassToast } from '@/components/glass/toast'

// The top bar of the /benefits pages: the logo, the page's title and, when someone is signed in, the account menu (glisse's Menu,
// the app's one menu style) with a single entry. Nothing here leads into the staff app.
export default function BenefitsTopBar({ title, signedIn }: { title: string; signedIn: boolean }) {
  const items: MenuEntry[] = [{
    label: 'התנתקות', icon: <LogOut size={18} />, destructive: true,
    onSelect: () => {
      void (async () => {
        try {
          const response = await fetch('/api/auth/signout', { method: 'POST' })
          if (!response.ok) throw new Error('signout')
          window.location.assign('/benefits')
        } catch { glassToast('ההתנתקות לא הצליחה. נסו שוב.', 'bad') }
      })()
    },
  }]
  return (
    <header className="gl-top">
      <Glass className="gl-top__bar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <span className="gl-top__logo"><img src="/sarcafe-logo.png" alt="סרקפה" width={32} height={32} /></span>
        <span className="gl-top__title">{title}</span>
        {signedIn && <span className="gl-account"><Menu aria-label="החשבון" icon={<UserRound size={20} />} align="start" items={items} /></span>}
      </Glass>
    </header>
  )
}
