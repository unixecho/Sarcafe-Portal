'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronLeft, ClipboardCheck, MapPin, MapPinPlus, Users } from 'lucide-react'
import AddBranchSheet from '@/components/AddBranchSheet'
import BranchSlider from '@/components/branches/BranchSlider'
import './branches.css'

export type BranchCard = {
  slug: string
  name: string
  kind: 'permanent' | 'event'
  openNow: boolean
  hoursConfigured: boolean
  hoursToday: { open: string; close: string } | null
  shortages: number | null
  missing: number | null
  people: number | null
  checklistsOn: number | null
  /** how many events (registers) belong to this truck */
  events: number
}

// ניהול סניפים — the list. Each card says in one glance whether the branch is open, whether anything is missing to run
// it, and how many things need attention; tapping it opens that branch's manager. "הוספת סניף" is the same sheet the menu
// editor uses, then goes straight to the new branch's manager so the readiness list guides the rest.
export default function BranchList({ cards, unassignedEvents = 0 }: { cards: BranchCard[]; unassignedEvents?: number }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  return (
    <div className="bm">
      <BranchSlider trucks={cards.map((card) => ({ id: card.slug, slug: card.slug, name: card.name }))} onAdd={() => setAdding(true)} />
      <p className="sch-sub" style={{ margin: '4px 0 0' }}>כל סניף במקום אחד: צ׳קליסטים, סידור עבודה, צוות, פרטי הסניף והקופה והאירועים שלו. בחרו סניף כדי לנהל אותו.</p>
      {unassignedEvents > 0 && cards[0] && <Link href={`/owner/branches/${cards[0].slug}?tab=pos`} className="bm-note bm-note--ok press" style={{ textDecoration: 'none' }}>{unassignedEvents === 1 ? 'יש אירוע אחד' : `יש ${unassignedEvents} אירועים`} שעוד לא שייכים לסניף. אפשר לשייך אותם בלשונית ״קופה ואירועים״.</Link>}
      <div className="bm-grid">
        {cards.map((card) => (
          <Link key={card.slug} href={`/owner/branches/${card.slug}`} className="bm-branch press">
            <div className="bm-branch__top">
              <span className="bm-hero__icon" aria-hidden="true"><MapPin size={20} /></span>
              <strong>{card.name}</strong>
              <ChevronLeft size={18} aria-hidden="true" />
            </div>
            <p className="sch-sub" style={{ margin: 0 }}>
              <span className={`bm-dot${card.openNow ? ' bm-dot--on' : ''}`} aria-hidden="true" />{' '}
              {!card.hoursConfigured ? 'שעות הפעילות עדיין לא הוגדרו' : card.openNow ? 'פתוח עכשיו' : 'סגור כרגע'}
              {card.hoursToday && <> · <bdi dir="ltr">{card.hoursToday.open}–{card.hoursToday.close}</bdi></>}
              {card.kind === 'event' && ' · אירוע'}
            </p>
            <div className="bm-branch__meta">
              {card.missing !== null && <span className={`bm-pill${card.missing === 0 ? ' bm-pill--ok' : ''}`}>{card.missing === 0 ? 'מוכן לעבודה' : `חסרים ${card.missing} דברים`}</span>}
              {card.people !== null && <span className="bm-pill"><Users size={13} aria-hidden="true" style={{ marginInlineEnd: 4 }} />{card.people} בסידור</span>}
              {card.checklistsOn !== null && <span className="bm-pill"><ClipboardCheck size={13} aria-hidden="true" style={{ marginInlineEnd: 4 }} />{card.checklistsOn}/3 צ׳קליסטים</span>}
              {card.events > 0 && <span className="bm-pill">{card.events === 1 ? 'אירוע אחד' : `${card.events} אירועים`}</span>}
              {card.shortages !== null && card.shortages > 0 && <span className="bm-pill" style={{ color: 'var(--warn, #fbbf24)', borderColor: 'var(--warn, #fbbf24)' }}><AlertTriangle size={13} aria-hidden="true" style={{ marginInlineEnd: 4 }} />{card.shortages} לטיפול</span>}
            </div>
            <span className="bm-branch__go">ניהול הסניף</span>
          </Link>
        ))}
        <button type="button" className="bm-branch bm-add press" onClick={() => setAdding(true)}>
          <MapPinPlus size={22} aria-hidden="true" />הוספת סניף חדש
        </button>
      </div>
      <AddBranchSheet permanentOnly open={adding} onClose={() => setAdding(false)} onCreated={(branch) => { setAdding(false); router.push(`/owner/branches/${branch.slug}?tab=overview`) }} />
    </div>
  )
}
