import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { WORKSHOP_COVER, WORKSHOP_SLIDES, WORKSHOP_TAGLINE, WORKSHOP_TITLE } from '@/lib/workshop/slides'
import '@/components/app/app.css'

// The coffee workshop, as a quiet card on the home screens: a small picture of the first slide, the name and how long
// it is. No badge, no colour glow, no motion: it sits where it is easy to find and never competes with the shift or the alerts.
export default function WorkshopCard() {
  return (
    <Link href="/staff/workshop" className="app-workshop press" aria-label={`${WORKSHOP_TITLE}: ${WORKSHOP_SLIDES.length} שקפים. פתיחת המצגת`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="app-workshop__cover" src={WORKSHOP_COVER} width={640} height={360} alt="" loading="lazy" decoding="async" />
      <span className="app-workshop__copy">
        <small>הדרכה לעובדי העגלה</small>
        <strong>{WORKSHOP_TITLE}</strong>
        <span>{WORKSHOP_TAGLINE} · {WORKSHOP_SLIDES.length} שקפים</span>
      </span>
      <ChevronLeft size={18} className="app-row__chevron" aria-hidden="true" />
    </Link>
  )
}
