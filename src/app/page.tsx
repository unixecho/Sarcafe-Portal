'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BRANCHES, type BranchSlug } from '@/lib/branches'
import { PAYBOX_PHONE_NUMBER, PORTAL_BRANCHES } from '@/lib/portal-config'

type Lang = 'he' | 'en' | 'ar'
const LANGUAGE_STORAGE_KEY = 'sarcafe-language'

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
    changeBranch: '← החלפת סניף',
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
    changeBranch: '← Change branch',
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
    changeBranch: '← تغيير الفرع',
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

function getInitialLanguage(): Lang {
  if (typeof window === 'undefined') return 'he'
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return stored === 'en' || stored === 'ar' || stored === 'he' ? stored : 'he'
}

export default function PortalPage() {
  const [lang, setLang] = useState<Lang>('he')
  const [branch, setBranch] = useState<BranchSlug | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  useEffect(() => {
    setLang(getInitialLanguage())
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl'
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
  }, [lang])

  const t = T[lang]
  const config = branch ? PORTAL_BRANCHES[branch] : null
  const branchMeta = BRANCHES.find((b) => b.slug === branch)

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
      }}
    >
      <nav aria-label="בחירת שפה" style={{ position: 'fixed', insetInlineEnd: 16, top: 16, display: 'flex', gap: 4 }}>
        {(['he', 'en', 'ar'] as Lang[]).map((l) => (
          <button
            key={l}
            type="button"
            className="press"
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            style={{
              minWidth: 36,
              minHeight: 36,
              borderRadius: 999,
              border: `1px solid ${lang === l ? 'var(--neon)' : 'var(--line-strong)'}`,
              background: lang === l ? 'rgba(255,122,69,0.14)' : 'var(--bg-elev)',
              color: 'var(--text)',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </nav>

      <div aria-hidden="true" style={{ fontSize: '2.6rem' }}>
        ☕
      </div>

      {!branch ? (
        <section key="branches" className="rise" style={{ maxWidth: 360 }}>
          <p style={{ margin: 0, color: 'var(--neon-soft)', fontSize: '0.8rem', fontWeight: 700 }}>{t.eyebrow}</p>
          <h1 style={{ margin: '4px 0 6px', fontSize: '1.8rem', fontWeight: 800 }}>{t.welcome}</h1>
          <p style={{ margin: '0 0 20px', color: 'var(--text-dim)', fontSize: '0.9rem' }}>{t.chooseBranch}</p>

          <div role="group" aria-label={t.chooseBranch} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {BRANCHES.map((b) => (
              <button
                key={b.slug}
                type="button"
                className="press"
                onClick={() => setBranch(b.slug)}
                style={{
                  minHeight: 64,
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--line-strong)',
                  background: 'var(--bg-elev)',
                  color: 'var(--text)',
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{b.name[lang]}</span>
                <small style={{ color: 'var(--text-faint)', fontSize: '0.72rem' }}>{t.branchLabel}</small>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section key="actions" className="rise" style={{ maxWidth: 360, width: '100%' }}>
          <button
            type="button"
            onClick={() => {
              setBranch(null)
              setNavOpen(false)
              setPayOpen(false)
            }}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 12, cursor: 'pointer' }}
          >
            {t.changeBranch}
          </button>

          <p style={{ margin: 0, color: 'var(--neon-soft)', fontSize: '0.8rem', fontWeight: 700 }}>{t.branchLabel}</p>
          <h1 style={{ margin: '4px 0 6px', fontSize: '1.6rem', fontWeight: 800 }}>{branchMeta?.name[lang]}</h1>
          <p style={{ margin: '0 0 16px', color: 'var(--text-dim)', fontSize: '0.85rem' }}>{t.quickLinks}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ExpandableAction
              open={navOpen}
              onToggle={() => setNavOpen((v) => !v)}
              icon="🗺️"
              label={t.navigation}
              primary
            >
              <ActionLink href={config!.navigation.googleMaps} icon="🗺️" label="Google Maps" primary />
              <ActionLink href={config!.navigation.waze} icon="🚗" label="Waze" />
              <ActionLink href={config!.navigation.appleMaps} icon="🍎" label="Apple Maps" />
            </ExpandableAction>

            <Link
              href={`/menu/${branch}`}
              className="press action-link"
              style={{ ...actionLinkStyle, textDecoration: 'none' }}
            >
              <span style={actionLabelStyle}>
                <span aria-hidden="true">📖</span> {t.menu}
              </span>
              <span aria-hidden="true">←</span>
            </Link>

            <ActionLink href={config!.instagram} icon="📸" label={t.instagram} external />
            <ActionLink href={config!.review} icon="⭐" label={t.review} external />

            <ExpandableAction open={payOpen} onToggle={() => setPayOpen((v) => !v)} icon="💳" label={t.payment}>
              <ActionLink href={config!.bit} icon="⚡" label="Bit" primary external />
              <div
                aria-disabled="true"
                style={{ ...actionLinkStyle, opacity: 0.6, cursor: 'default' }}
              >
                <span style={actionLabelStyle}>
                  <span aria-hidden="true">📦</span>
                  <span>
                    PayBox
                    <small style={{ display: 'block', color: 'var(--text-faint)', fontSize: '0.7rem' }}>{t.payboxManual}</small>
                  </span>
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

function ExpandableAction({
  open,
  onToggle,
  icon,
  label,
  primary,
  children,
}: {
  open: boolean
  onToggle: () => void
  icon: string
  label: string
  primary?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        className="press"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          ...actionLinkStyle,
          width: '100%',
          border: primary ? '1px solid var(--neon)' : actionLinkStyle.border,
        }}
      >
        <span style={actionLabelStyle}>
          <span aria-hidden="true">{icon}</span> {label}
        </span>
        <span aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s var(--ease)' }}>
          ⌄
        </span>
      </button>
      {open && (
        <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, paddingInlineStart: 8 }}>
          {children}
        </div>
      )}
    </div>
  )
}

function ActionLink({ href, icon, label, primary, external }: { href: string; icon: string; label: string; primary?: boolean; external?: boolean }) {
  const missing = !href || href === '#'
  return (
    <a
      href={missing ? undefined : href}
      target={external && !missing ? '_blank' : undefined}
      rel={external && !missing ? 'noopener noreferrer' : undefined}
      aria-disabled={missing}
      className="press"
      style={{
        ...actionLinkStyle,
        border: primary ? '1px solid var(--neon)' : actionLinkStyle.border,
        opacity: missing ? 0.5 : 1,
        cursor: missing ? 'not-allowed' : 'pointer',
        pointerEvents: missing ? 'none' : 'auto',
      }}
    >
      <span style={actionLabelStyle}>
        <span aria-hidden="true">{icon}</span> {label}
      </span>
      <span aria-hidden="true">↗</span>
    </a>
  )
}

const actionLinkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: 'var(--tap-min)',
  padding: '0 16px',
  borderRadius: 999,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontWeight: 600,
  fontSize: '0.9rem',
}

const actionLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }
