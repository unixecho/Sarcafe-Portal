'use client'

import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import { runLocalTransition } from '@/lib/nav/viewTransition'
import {
  MapPin,
  Car,
  Compass,
  BookOpen,
  Camera,
  Star,
  CreditCard,
  Zap,
  Package,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import PublicBackdrop from '@/components/PublicBackdrop'
import LogoMark from '@/components/LogoMark'
import LanguageSwitch, { useLanguage } from '@/components/LanguageSwitch'
import type { Branch } from '@/lib/branches'

type Lang = 'he' | 'en' | 'ar'
const PAYBOX_PHONE_NUMBER = '0507437395'

type PortalCopy = {
  eyebrow: string
  welcome: string
  chooseBranch: string
  branchLabel: string
  changeBranch: string
  quickLinks: string
  navigation: string
  menu: string
  instagram: string
  review: string
  payment: string
  paused: string
  payboxManual: string
}

const T: Record<Lang, PortalCopy> = {
  he: {
    eyebrow: 'פורטל קפה',
    welcome: 'ברוכים הבאים ל־Sarcafe',
    chooseBranch: 'בחרו סניף כדי להמשיך.',
    branchLabel: 'סניף',
    changeBranch: 'החלפת סניף',
    quickLinks: 'קישורים מהירים למיקום הזה.',
    navigation: 'ניווט אלינו',
    menu: 'תפריט דיגיטלי',
    instagram: 'אינסטגרם',
    review: 'השארת ביקורת',
    payment: 'תשלום',
    paused: 'ידני',
    payboxManual: `נא להזין ידנית ב־PayBox: ${PAYBOX_PHONE_NUMBER}`,
  },
  en: {
    eyebrow: 'Coffee truck portal',
    welcome: 'Welcome to Sarcafe',
    chooseBranch: 'Choose your branch to continue.',
    branchLabel: 'Branch',
    changeBranch: 'Change branch',
    quickLinks: 'Quick links for this location.',
    navigation: 'Navigate to Us',
    menu: 'Digital Menu',
    instagram: 'Instagram',
    review: 'Leave a Review',
    payment: 'Payment',
    paused: 'Manual',
    payboxManual: `Enter this number manually in PayBox: ${PAYBOX_PHONE_NUMBER}`,
  },
  ar: {
    eyebrow: 'بوابة عربة القهوة',
    welcome: 'أهلاً بكم في Sarcafe',
    chooseBranch: 'اختاروا الفرع للمتابعة.',
    branchLabel: 'فرع',
    changeBranch: 'تغيير الفرع',
    quickLinks: 'روابط سريعة لهذا الموقع.',
    navigation: 'التنقل إلينا',
    menu: 'القائمة الرقمية',
    instagram: 'إنستغرام',
    review: 'ترك تقييم',
    payment: 'الدفع',
    paused: 'يدوي',
    payboxManual: `يرجى إدخال الرقم يدوياً في PayBox: ${PAYBOX_PHONE_NUMBER}`,
  },
}

export default function PortalPage() {
  const [lang, setLang] = useLanguage()
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [branchSlug, setBranchSlug] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/branches')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { branches: Branch[] } | null) => {
        if (!cancelled && payload) setBranches(payload.branches)
      })
      .catch(() => {
        if (!cancelled) setBranches([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const t = T[lang]
  const branch = branches?.find((b) => b.slug === branchSlug) ?? null

  // Same iOS push/pop the rest of the app uses for page navigation, just
  // driven locally since picking a branch never touches the router. See
  // runLocalTransition's doc comment for why this needs flushSync and its
  // own view-transition-name instead of reusing the page-nav machinery.
  function selectBranch(slug: string | null) {
    runLocalTransition('portal-panel', slug ? 'forward' : 'back', () => {
      flushSync(() => {
        setBranchSlug(slug)
        setNavOpen(false)
        setPayOpen(false)
      })
    })
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
        gap: 20,
        textAlign: 'center',
        position: 'relative',
      }}
    >
      <PublicBackdrop />

      <LanguageSwitch lang={lang} onChange={setLang} />

      <LogoMark size={92} />

      {!branch ? (
        <section key="branches" style={{ maxWidth: 360, width: '100%', viewTransitionName: 'portal-panel' }}>
          <p style={{ margin: 0, color: 'var(--neon-soft)', fontSize: '0.8rem', fontWeight: 700 }}>{t.eyebrow}</p>
          <h1 style={{ margin: '4px 0 6px', fontSize: '1.8rem', fontWeight: 800 }}>{t.welcome}</h1>
          <p style={{ margin: '0 0 20px', color: 'var(--text-dim)', fontSize: '0.9rem' }}>{t.chooseBranch}</p>

          {branches === null ? (
            <div role="group" aria-label={t.chooseBranch} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[0, 1].map((i) => (
                <div key={i} className="sk" style={{ height: 64 }} />
              ))}
            </div>
          ) : (
            <div role="group" aria-label={t.chooseBranch} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {branches.map((b) => (
                <button
                  key={b.slug}
                  type="button"
                  className="press"
                  onClick={() => selectBranch(b.slug)}
                  style={{
                    minHeight: 64,
                    borderRadius: 15,
                    border: '1px solid var(--line)',
                    background: 'var(--bg-elev)',
                    color: 'var(--text)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{b.name[lang] || b.name.he}</span>
                  <small style={{ color: 'var(--text-faint)', fontSize: '0.72rem' }}>{t.branchLabel}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section key="actions" style={{ maxWidth: 360, width: '100%', viewTransitionName: 'portal-panel' }}>
          <button
            type="button"
            onClick={() => selectBranch(null)}
            className="press"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              color: 'var(--text-dim)',
              fontSize: '0.85rem',
              marginBottom: 12,
              cursor: 'pointer',
            }}
          >
            <ChevronLeft size={16} className="dir-flip" aria-hidden="true" />
            {t.changeBranch}
          </button>

          <p style={{ margin: 0, color: 'var(--neon-soft)', fontSize: '0.8rem', fontWeight: 700 }}>{t.branchLabel}</p>
          <h1 style={{ margin: '4px 0 6px', fontSize: '1.6rem', fontWeight: 800 }}>{branch.name[lang] || branch.name.he}</h1>
          <p style={{ margin: '0 0 16px', color: 'var(--text-dim)', fontSize: '0.85rem' }}>{t.quickLinks}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ExpandableAction open={navOpen} onToggle={() => setNavOpen((v) => !v)} icon={<MapPin size={18} />} label={t.navigation}>
              <ActionLink href={branch.links.navGoogleMaps} icon={<MapPin size={16} />} label="Google Maps" />
              <ActionLink href={branch.links.navWaze} icon={<Car size={16} />} label="Waze" />
              <ActionLink href={branch.links.navAppleMaps} icon={<Compass size={16} />} label="Apple Maps" />
            </ExpandableAction>

            {/* The hero action — one clear primary CTA per screen, same
                gradient+glow treatment AyekaBar gives its own "Menu" button. */}
            <Link href={`/menu/${branch.slug}`} className="press" style={heroButtonStyle}>
              <span style={icWrap}>
                <BookOpen size={18} aria-hidden="true" />
              </span>
              <span style={{ flex: 1, textAlign: 'start' }}>{t.menu}</span>
              <Arrow />
            </Link>

            <ActionLink href={branch.links.instagram} icon={<Camera size={16} />} label={t.instagram} external />
            <ActionLink href={branch.links.review} icon={<Star size={16} />} label={t.review} external />

            <ExpandableAction open={payOpen} onToggle={() => setPayOpen((v) => !v)} icon={<CreditCard size={18} />} label={t.payment}>
              <ActionLink href={branch.links.bit} icon={<Zap size={16} />} label="Bit" external />
              <div aria-disabled="true" style={{ ...subOptStyle, opacity: 0.6, cursor: 'default' }}>
                <span style={icWrap}>
                  <Package size={16} aria-hidden="true" />
                </span>
                <span style={{ flex: 1, textAlign: 'start' }}>
                  PayBox
                  <small style={{ display: 'block', color: 'var(--text-faint)', fontSize: '0.7rem' }}>{t.payboxManual}</small>
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>{t.paused}</span>
              </div>
            </ExpandableAction>
          </div>
        </section>
      )}
    </main>
  )
}

function Arrow() {
  return <ChevronRight size={16} className="dir-flip" aria-hidden="true" style={{ color: 'var(--text-faint)' }} />
}

function ExpandableAction({
  open,
  onToggle,
  icon,
  label,
  children,
}: {
  open: boolean
  onToggle: () => void
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <button type="button" className="press" aria-expanded={open} onClick={onToggle} style={{ ...actionRowStyle, width: '100%' }}>
        <span style={icWrap}>{icon}</span>
        <span style={{ flex: 1, textAlign: 'start' }}>{label}</span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s var(--ease)' }}
        />
      </button>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 0.4s var(--ease)' }}>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0 2px' }}>{children}</div>
        </div>
      </div>
    </div>
  )
}

function ActionLink({
  href,
  icon,
  label,
  external,
}: {
  href: string | null
  icon: React.ReactNode
  label: string
  external?: boolean
}) {
  const missing = !href
  return (
    <a
      href={missing ? undefined : href}
      target={external && !missing ? '_blank' : undefined}
      rel={external && !missing ? 'noopener noreferrer' : undefined}
      aria-disabled={missing}
      className="press"
      style={{
        ...actionRowStyle,
        opacity: missing ? 0.5 : 1,
        cursor: missing ? 'not-allowed' : 'pointer',
        pointerEvents: missing ? 'none' : 'auto',
      }}
    >
      <span style={icWrap}>{icon}</span>
      <span style={{ flex: 1, textAlign: 'start' }}>{label}</span>
      {external ? <ExternalLink size={14} aria-hidden="true" style={{ color: 'var(--text-faint)' }} /> : <Arrow />}
    </a>
  )
}

const icWrap: React.CSSProperties = { width: 26, display: 'grid', placeItems: 'center', color: 'var(--neon-soft)', flex: '0 0 auto' }

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 'var(--tap-min)',
  padding: '0 16px',
  borderRadius: 15,
  border: '1px solid var(--line)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontWeight: 600,
  fontSize: '0.95rem',
  textDecoration: 'none',
}

const subOptStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 48,
  padding: '0 16px',
  borderRadius: 13,
  border: '1px solid var(--line)',
  background: 'rgba(21,15,12,0.75)',
  color: 'var(--text)',
  fontWeight: 600,
  fontSize: '0.9rem',
  textDecoration: 'none',
}

// One clear hero per screen — the digital-menu link — same gradient/glow
// treatment AyekaBar reserves for its single primary CTA, so it doesn't
// compete visually with the plain rows around it.
const heroButtonStyle: React.CSSProperties = {
  ...actionRowStyle,
  border: '1px solid transparent',
  background: 'linear-gradient(135deg, rgba(255,122,69,0.2), rgba(255,171,122,0.1))',
  boxShadow: '0 0 24px rgba(255,122,69,0.22)',
  textDecoration: 'none',
}
