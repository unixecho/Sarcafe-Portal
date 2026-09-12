import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import SignOutButton from '@/components/SignOutButton'

type OwnerHeaderProps = {
  title: string
  backHref?: string
  /** e.g. a branch switcher or a save status — rendered at the header's
   * trailing edge. Optional so leaf pages that don't need one stay simple. */
  right?: React.ReactNode
}

// Mirrors AyekaBar's OwnerHeader: a single circular back button pointing at
// this page's ACTUAL parent (not always the dashboard), plus the page
// title. No persistent sidebar/tab bar anywhere in the owner app — this is
// the entire navigation chrome; everything else is a leaf reached from the
// dashboard's tile grid.
export default function OwnerHeader({ title, backHref, right }: OwnerHeaderProps) {
  return (
    <header
      className="rise"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '16px 4px',
      }}
    >
      {backHref && (
        <Link
          href={backHref}
          aria-label="חזרה"
          className="press dir-flip"
          style={{
            width: 34,
            height: 34,
            minWidth: 34,
            borderRadius: '50%',
            background: 'var(--bg-elev-2)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--text)',
            textDecoration: 'none',
          }}
        >
          <ChevronLeft size={18} strokeWidth={2.25} aria-hidden="true" />
        </Link>
      )}
      <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, flex: 1 }}>{title}</h1>
      {right}
      <SignOutButton />
    </header>
  )
}
