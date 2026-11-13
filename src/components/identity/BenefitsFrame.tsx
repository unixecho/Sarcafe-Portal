import type { ReactNode } from 'react'
import GlassPage from '@/components/glass/GlassPage'
import BenefitsTopBar from './BenefitsTopBar'

// The frame of every /benefits page: the glass backdrop and toaster (GlassPage) and a top bar of its own. It is NOT the staff
// shell: the people here are organization administrators and department heads, who are not Sarcafe staff, so there are no
// notifications, no branch switch, no tool finder and no dock, and nothing in it links into the staff or owner app.
export default function BenefitsFrame({ title, signedIn, children }: { title: string; signedIn: boolean; children: ReactNode }) {
  return (
    <GlassPage>
      <BenefitsTopBar title={title} signedIn={signedIn} />
      <main id="main" tabIndex={-1} className="gl-main">{children}</main>
    </GlassPage>
  )
}

/** The loading screen of a /benefits page, shaped like it (a title bar and two cards). */
export function BenefitsSkeleton({ title }: { title: string }) {
  return (
    <GlassPage>
      <header className="gl-top" aria-hidden="true">
        <div className="gl-top__bar gl-surf gl-sk-top">
          <span className="sk gl-sk-ico" />
          <span className="gl-top__title">{title}</span>
          <span className="sk gl-sk-ico" />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="gl-main" aria-busy="true" data-glass-skeleton="">
        <p className="sr-only" role="status">טוען…</p>
        {[3, 2].map((lines, card) => (
          <div key={card} className="gl-surf gl-card gl-sk-card">
            <span className="sk gl-sk-line gl-sk-line--title" />
            {Array.from({ length: lines }, (_, i) => <span key={i} className={`sk gl-sk-line${i === lines - 1 ? ' gl-sk-line--short' : ''}`} />)}
          </div>
        ))}
      </main>
    </GlassPage>
  )
}
