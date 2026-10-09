import Link from 'next/link'
import { ChevronLeft, Home } from 'lucide-react'
import SignOutButton from '@/components/SignOutButton'
import AppNavigation from '@/components/app/AppNavigation'
import '@/components/app/app.css'

type OwnerHeaderProps = {
  title: string
  backHref?: string
  homeHref?: string
  right?: React.ReactNode
}

/** Back follows the explicit parent; Home uses the role-aware staff entry. */
export default function OwnerHeader({ title, backHref, homeHref = '/staff', right }: OwnerHeaderProps) {
  return (
    <>
      <header className="app-header">
        <AppNavigation />
        {backHref && (
          <Link href={backHref} aria-label="חזרה לעמוד הקודם" className="app-header__icon press dir-flip">
            <ChevronLeft size={21} strokeWidth={2.25} aria-hidden="true" />
          </Link>
        )}
        <h1 className="app-header__title">{title}</h1>
        {right}
        <Link href={homeHref} aria-label="מסך הבית" title="מסך הבית" className="app-header__icon app-header__home press">
          <Home size={20} strokeWidth={2} aria-hidden="true" />
        </Link>
        <SignOutButton className="app-header__signout" />
      </header>
      <div className="app-header__spacer" aria-hidden="true" />
    </>
  )
}
