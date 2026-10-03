'use client'

// The one sentence on this screen that must be believed instantly. Rendered ONLY when at
// least one line is critical, and the number is overdueCount() — the very function the glowing
// cards use — so it can never disagree with what is glowing. Singular and plural are separate
// strings because "1 פריטים" reads as a typo, and a typo here costs trust in the alarm.

import { AlertTriangle } from 'lucide-react'
import { useT } from '@/lib/pos/useT'

export default function OverdueStrip({ count }: { count: number }) {
  const t = useT()
  if (count < 1) return null
  return (
    <div className="sto" role="alert">
      <AlertTriangle size={22} aria-hidden="true" />
      <span>{count === 1 ? t('station.overdue.one') : t('station.overdue.many', { n: count })}</span>
    </div>
  )
}
