'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { prefersReducedMotion, runLocalTransition, navigateWithTransition, directionFor } from '@/lib/nav/viewTransition'
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
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ExternalLink,
} from 'lucide-react'
import PublicBackdrop from '@/components/PublicBackdrop'
import LogoMark from '@/components/LogoMark'
import LanguageSwitch, { useLanguage } from '@/components/LanguageSwitch'
import ReviewWall from '@/components/ReviewWall'
import FeedbackButton from '@/components/FeedbackButton'
import { normalizeReviews, PLACEHOLDER_BLOCK } from '@/lib/reviews'
import { hoursStatusLabel, type Branch } from '@/lib/branches'

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
  payment: string
  paused: string
  payboxManual: string
  reviewsCue: string
  reviewCta: string
  footer: string
  accessibility: string
  privacy: string
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
    payment: 'תשלום',
    paused: 'ידני',
    payboxManual: `נא להזין ידנית ב־PayBox: ${PAYBOX_PHONE_NUMBER}`,
    reviewsCue: 'ביקורות',
    reviewCta: 'השארת ביקורת בגוגל',
    footer: '© Sarcafe',
    accessibility: 'הצהרת נגישות',
    privacy: 'מדיניות פרטיות',
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
    payment: 'Payment',
    paused: 'Manual',
    payboxManual: `Enter this number manually in PayBox: ${PAYBOX_PHONE_NUMBER}`,
    reviewsCue: 'Reviews',
    reviewCta: 'Leave a review on Google',
    footer: '© Sarcafe',
    accessibility: 'Accessibility statement',
    privacy: 'Privacy policy',
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
    payment: 'الدفع',
    paused: 'يدوي',
    payboxManual: `يرجى إدخال الرقم يدوياً في PayBox: ${PAYBOX_PHONE_NUMBER}`,
    reviewsCue: 'التقييمات',
    reviewCta: 'ترك تقييم على غوغل',
    footer: '© Sarcafe',
    accessibility: 'بيان إمكانية الوصول',
    privacy: 'سياسة الخصوصية',
  },
}

const CURRENT_TAG: Record<Lang, string> = { he: 'סניף נוכחי', en: 'Current', ar: 'الحالي' }

const LOGO_TAP_STAFF_ENTRANCE = 5
const LOGO_TAP_WINDOW_MS = 600

export default function PortalPage() {
  const router = useRouter()
  const [lang, setLang] = useLanguage()
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [branchSlug, setBranchSlug] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [feedbackEnabled, setFeedbackEnabled] = useState(false)
  const logoTapCount = useRef(0)
  const logoTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Every tap resets to the portal home instantly (branchSlug back to the
  // picker) — never delayed waiting to see if more taps are coming, since
  // "go home" must feel immediate on a single tap. 5 taps within the
  // window additionally routes to the hidden staff entrance instead
  // (already reachable via the "© Sarcafe" footer link — this is a second,
  // discoverable-by-anyone-who-knows path, same idea).
  function onLogoTap() {
    setBranchSlug(null)
    logoTapCount.current += 1
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current)
    if (logoTapCount.current >= LOGO_TAP_STAFF_ENTRANCE) {
      logoTapCount.current = 0
      navigateWithTransition('/login', directionFor('/login'), () => router.push('/login'))
      return
    }
    logoTapTimer.current = setTimeout(() => {
      logoTapCount.current = 0
    }, LOGO_TAP_WINDOW_MS)
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/feedback')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { enabled?: boolean } | null) => {
        if (!cancelled && payload) setFeedbackEnabled(!!payload.enabled)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Whether the panel currently on screen arrived through a local view
  // transition (a branch tap, or a "change branch" tap) rather than being the
  // one the page first rendered with. Drives `.panel-enter--pushed`
  // (globals.css), which delays this panel's own `.rise` cascade until the swap
  // has finished sliding — the same staging `.page-enter--pushed` does for a
  // real page push, one level down. Without it the six action rows cascade
  // INSIDE the panel while the panel is itself still sliding and fading: two
  // animation systems moving the same content, which is what "animations still
  // mix together" looks like on this exact tap.
  //
  // It is STATE, set inside the same flushSync that swaps the panel, for
  // exactly the reason template.tsx reads `data-vt` once at mount: the class
  // must be decided when the panel is CREATED and must not change while that
  // panel is mounted. Keying the CSS off `html[data-local-nav]` instead would
  // look simpler and would be the §4.3 bug — runLocalTransition deletes that
  // attribute when the transition finishes, and toggling `animation-name` off a
  // value starts a brand-new animation from frame zero, so every row would
  // replay its entrance the instant the slide ended. This flag only ever
  // changes on the NEXT swap, which replaces the panel with a differently-keyed
  // element anyway.
  const [panelPushed, setPanelPushed] = useState(false)

  // Remembers which branch you were just looking at across a "change
  // branch" tap (which resets branchSlug to null to show the picker again)
  // so that branch can be marked "current" in the list instead of looking
  // like any other option — the whole point being to stop a mis-tap back
  // onto the same branch, not just to get back to the picker.
  const lastBranchSlug = useRef<string | null>(null)
  useEffect(() => {
    if (branchSlug) lastBranchSlug.current = branchSlug
  }, [branchSlug])

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
        // Set unconditionally, including under prefers-reduced-motion — where
        // runLocalTransition does not start a transition at all. The motion
        // preference is answered in exactly one place, the reduced-motion block
        // in globals.css, which cancels the staged cascade outright. Reading
        // the preference here as well would be a second source of truth for the
        // same decision, free to drift away from the first.
        setPanelPushed(true)
        setNavOpen(false)
        setPayOpen(false)
      })
    })
  }

  return (
    <PublicBackdrop>
      <main id="main" tabIndex={-1}
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          // NO justifyContent and NO gap here any more, deliberately. Centring
          // THIS element is what broke the reviews cue: logo, panel, cue, wall
          // and CTA were one vertically-centred column, so the wall was never
          // reliably below the fold and scrollIntoView had almost nothing to
          // travel (on a viewport tall enough to fit the lot, literally
          // nothing). main is now just the scroll column; the hero section
          // below does the centring, inside one screen. Blueprint §10.1.
          padding: 'calc(env(safe-area-inset-top) + 20px) 20px calc(env(safe-area-inset-bottom) + 24px)',
          textAlign: 'center',
          position: 'relative',
        }}
      >
        <LanguageSwitch lang={lang} onChange={setLang} />

        {/* HERO — owns exactly one screen, so the first paint is unchanged and
            everything after it is a deliberate scroll-down reward. The 44px
            subtracted is main's own vertical padding (20 top + 24 bottom):
            leave it out and the hero is one screen PLUS that padding, which
            pushes the wall off the fold by exactly the amount that makes the
            cue feel like it did nothing again. minHeight, never height — an
            open accordion, a long branch name or a visitor's enlarged font
            grows the hero instead of being clipped. Mirrors AyekaBar's
            Portal.tsx hero block; 360 (not Ayeka's 380) because that is the
            column width both panels below already use. */}
        <section
          style={{
            width: '100%',
            maxWidth: 360,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            minHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 44px)',
          }}
        >
          <button
            type="button"
            className="portal-hero-mark press"
            onClick={onLogoTap}
            aria-label={t.welcome}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <LogoMark size={92} />
          </button>

          {!branch ? (
            <section
              key="branches"
              className={panelPushed ? 'panel-enter--pushed' : undefined}
              style={{ maxWidth: 360, width: '100%', viewTransitionName: 'portal-panel' }}
            >
              <div className="rise" style={{ animationDelay: '80ms' }}>
                <p style={{ margin: 0, color: 'var(--neon-soft)', fontSize: '0.8rem', fontWeight: 700 }}>{t.eyebrow}</p>
                <h1 style={{ margin: '4px 0 6px', fontSize: '1.8rem', fontWeight: 800 }}>{t.welcome}</h1>
                <p style={{ margin: '0 0 20px', color: 'var(--text-dim)', fontSize: '0.9rem' }}>{t.chooseBranch}</p>
              </div>

              {branches === null ? (
                <div role="group" aria-label={t.chooseBranch} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[0, 1].map((i) => (
                    <div key={i} className="sk" style={{ height: 64 }} />
                  ))}
                </div>
              ) : (
                <div role="group" aria-label={t.chooseBranch} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {branches.map((b, i) => {
                    const isCurrent = b.slug === lastBranchSlug.current
                    return (
                      <button
                        key={b.slug}
                        type="button"
                        className="press rise"
                        disabled={isCurrent}
                        aria-current={isCurrent || undefined}
                        onClick={() => selectBranch(b.slug)}
                        style={{
                          minHeight: 64,
                          borderRadius: 15,
                          border: isCurrent ? '1px solid var(--line-interactive)' : '1px solid var(--line)',
                          background: isCurrent ? 'var(--bg-elev-2)' : 'var(--bg-elev)',
                          color: 'var(--text)',
                          display: 'flex',
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 10,
                          padding: '0 16px',
                          cursor: isCurrent ? 'default' : 'pointer',
                          animationDelay: `${160 + i * 70}ms`,
                        }}
                      >
                        <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'center' }}>
                          <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{b.name[lang] || b.name.he}</span>
                          <small style={{ color: 'var(--text-faint)', fontSize: '0.72rem' }}>{hoursStatusLabel(b, lang)}</small>
                        </span>
                        {isCurrent && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              color: 'var(--neon-soft)',
                            }}
                          >
                            <Check size={13} aria-hidden="true" /> {CURRENT_TAG[lang]}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          ) : (
            <section
              key="actions"
              className={panelPushed ? 'panel-enter--pushed' : undefined}
              style={{ maxWidth: 360, width: '100%', viewTransitionName: 'portal-panel' }}
            >
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

              <div className="rise" style={{ animationDelay: '60ms' }}>
                <p style={{ margin: 0, color: 'var(--neon-soft)', fontSize: '0.8rem', fontWeight: 700 }}>{t.branchLabel}</p>
                <h1 style={{ margin: '4px 0 6px', fontSize: '1.6rem', fontWeight: 800 }}>{branch.name[lang] || branch.name.he}</h1>
                <p
                  style={{
                    margin: '0 0 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    color: branch.openNow ? 'var(--text-dim)' : 'var(--text-faint)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: branch.openNow ? 'var(--sage-soft)' : 'var(--text-faint)',
                      flexShrink: 0,
                    }}
                  />
                  {hoursStatusLabel(branch, lang)}
                </p>
                <p style={{ margin: '0 0 16px', color: 'var(--text-dim)', fontSize: '0.85rem' }}>{t.quickLinks}</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="rise" style={{ animationDelay: '140ms' }}>
                  <ExpandableAction open={navOpen} onToggle={() => setNavOpen((v) => !v)} icon={<MapPin size={18} />} label={t.navigation}>
                    <ActionLink href={branch.links.navGoogleMaps} icon={<MapPin size={16} />} label="Google Maps" />
                    <ActionLink href={branch.links.navWaze} icon={<Car size={16} />} label="Waze" />
                    <ActionLink href={branch.links.navAppleMaps} icon={<Compass size={16} />} label="Apple Maps" />
                  </ExpandableAction>
                </div>

                {/* The hero action — one clear primary CTA per screen. Visuals
                    live in .portal-cta-hero (globals.css), built from --neon —
                    the app's one existing interactive primary — rather than a
                    one-off orange invented just for this button. */}
                <Link
                  href={`/menu/${branch.slug}`}
                  className="press portal-cta-hero rise"
                  style={{ ...heroButtonStyle, animationDelay: '210ms' }}
                >
                  <span style={icWrap}>
                    <BookOpen size={18} aria-hidden="true" />
                  </span>
                  <span style={{ flex: 1, textAlign: 'start' }}>{t.menu}</span>
                  <Arrow />
                </Link>

                <div className="rise" style={{ animationDelay: '280ms' }}>
                  <ActionLink href={branch.links.instagram} icon={<Camera size={16} />} label={t.instagram} external />
                </div>

                {/* No standalone "leave a review" row here — the wall below
                    makes that case with actual quotes first, then the CTA
                    right under it is the one place that ask lives (same
                    restructuring AyekaBar's Portal documents: a plain link
                    ahead of the wall would just be the same ask twice). */}
                <div className="rise" style={{ animationDelay: '350ms' }}>
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
              </div>

              {/* iOS-style "more below" cue pointing at the reviews wall — a
                  real 44px button, not a decorative arrow (see .portal-cue in
                  globals.css). Sarcafe's reviews are per-branch, so — unlike
                  AyekaBar's single always-on wall — this whole block only
                  exists once a branch is actually chosen. It is the LAST thing
                  in the hero on purpose: it sits on the bottom edge of the one
                  screen the hero owns, pointing past the fold at a wall that
                  now genuinely starts below it. */}
              <button
                type="button"
                className="press portal-cue rise"
                style={{ animationDelay: '490ms' }}
                onClick={() =>
                  // behavior:'smooth' is an EXPLICIT option, and an explicit
                  // option beats the CSS `scroll-behavior` property — including
                  // the `html { scroll-behavior: auto }` opt-out at the bottom
                  // of globals.css. A full-viewport smooth scroll is exactly
                  // the vestibular trigger that opt-out exists for, so the
                  // preference has to be read here, in JS. SUBSTITUTE (§4.13):
                  // the jump still happens and still lands on the wall, it just
                  // arrives instead of travelling.
                  document
                    .getElementById('reviews')
                    ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
                }
              >
                <span className="portal-cue-badge" aria-hidden="true">
                  <ChevronsDown size={15} strokeWidth={2.4} />
                </span>
                {t.reviewsCue}
              </button>
            </section>
          )}
        </section>

        {/* BELOW THE FOLD — siblings of the hero, never children of it: this is
            the scroll-down reward the cue points at, and the whole reason the
            cue now has somewhere to go. Rendered only once a branch is chosen,
            because Sarcafe's reviews are per-branch (the one place this
            diverges from AyekaBar, whose single wall is always on). Outside
            the `portal-panel` view-transition group on purpose: the wall is
            not part of the picker↔actions slide. */}
        {branch && (
          <>
            <ReviewWall block={normalizeReviews(branch.reviews, PLACEHOLDER_BLOCK)} reviewUrl={branch.links.review} lang={lang} />

            {/* The private half of the same ask the wall just made in
                public — same row shape as every other action, a sage-on-
                paper finish (`.portal-cta-review`) instead of the hero's
                orange so it doesn't compete with the one true primary CTA
                above. The wrapper is what carries the column width: as a
                direct child of main's centred flex column the <a> would
                shrink to the width of its own label instead. It stays at the
                hero's 360 while the wall beside it runs to its own 480 —
                same relationship AyekaBar's post-wall block has. */}
            <div style={{ width: '100%', maxWidth: 360 }}>
              <a
                href={branch.links.review ?? undefined}
                target={branch.links.review ? '_blank' : undefined}
                rel={branch.links.review ? 'noopener noreferrer' : undefined}
                aria-disabled={!branch.links.review}
                className="press portal-cta-review"
                style={{
                  ...actionRowStyle,
                  // Undefined, not omitted — actionRowStyle's own border/
                  // background would otherwise win over .portal-cta-review as
                  // an inline style, same reasoning as heroButtonStyle above.
                  border: undefined,
                  background: undefined,
                  marginTop: 20,
                  width: '100%',
                  opacity: branch.links.review ? 1 : 0.5,
                  pointerEvents: branch.links.review ? 'auto' : 'none',
                }}
              >
                <span style={icWrap}>
                  <Star size={16} aria-hidden="true" style={{ color: 'var(--sage-soft)' }} />
                </span>
                <span style={{ flex: 1, textAlign: 'start' }}>{t.reviewCta}</span>
                <Arrow />
              </a>
            </div>
          </>
        )}

        {/* FOOTER — last child of <main>, and a SIBLING of the `{branch && …}`
            block above rather than a child of it. That placement is the whole
            point: the accessibility statement is required to be reachable
            under IS 5568, and inside that fragment it would only exist after a
            branch has been picked — leaving the portal's first paint, the
            state every first-time visitor lands in, with no link to it. As a
            sibling it renders in both states.

            role="contentinfo" is REQUIRED here, not decoration. Per the
            HTML/ARIA spec a <footer> nested inside <main> (or
            article/aside/nav/section) does NOT get the implicit `contentinfo`
            role that a top-level one does, so without the explicit role this
            is not a landmark and never appears in a screen reader's landmark
            list. Same note as AyekaBar's Portal.tsx footer.

            .rise at 560ms continues this file's hand-written cadence (…280,
            350, 490) by one more 70ms step; there is no delay() counter in
            this component to reuse. No reduced-motion work is needed here —
            .rise's REMOVE opt-out lives beside the keyframe in globals.css,
            and because rise-in runs with `backwards` fill that opt-out is
            also what keeps the footer VISIBLE: it drops the animation
            outright instead of zeroing a duration, which would strand the
            element at opacity 0. */}
        <footer
          role="contentinfo"
          className="rise"
          style={{
            width: '100%',
            maxWidth: 360,
            marginTop: 24,
            textAlign: 'center',
            animationDelay: '560ms',
          }}
        >
          {/* The manager door into /login, disguised as the plain copyright
              line rather than a labeled button — customers scanning the
              portal have no visual cue this is tappable (inherited colour,
              no underline, no .press feedback), so it reads as static text.
              aria-label keeps it honest for screen-reader users instead of
              a silent, unexplained link — the ONE deliberate exception to
              the "colour alone must never be the signal" rule the
              accessibility link below documents, because here blending in
              IS the point. */}
          <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-faint)' }}>
            <Link href="/login" aria-label="כניסת צוות" style={{ color: 'inherit', textDecoration: 'none' }}>
              {t.footer}
            </Link>
          </p>
          {/* next/link, not a bare <a>: PageTransitions listens for same-origin
              anchor clicks in the capture phase and re-dispatches them through
              the View Transition API, and <Link> renders exactly such an
              anchor — so the push animates with no per-link wiring, plus the
              route gets prefetched. Underlined rather than tinted: at
              --text-faint the underline is the only thing marking this as a
              link, and colour alone must never be that signal (WCAG 1.4.1).
              minHeight pins it to the app's --tap-min floor so a 0.78rem line
              is still a real touch target. */}
          <Link
            href="/accessibility"
            className="press"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 'var(--tap-min)',
              padding: '0 12px',
              fontSize: '0.78rem',
              color: 'var(--text-faint)',
              textDecoration: 'underline',
            }}
          >
            {t.accessibility}
          </Link>
          <Link
            href="/privacy"
            className="press"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 'var(--tap-min)',
              padding: '0 12px',
              fontSize: '0.78rem',
              color: 'var(--text-faint)',
              textDecoration: 'underline',
            }}
          >
            {t.privacy}
          </Link>
          <FeedbackButton lang={lang} enabled={feedbackEnabled} branchSlug={branch?.slug ?? null} variant="card" />
        </footer>
      </main>
    </PublicBackdrop>
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
  const bodyId = useId()
  return (
    <div>
      <button
        type="button"
        className="press"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        style={{ ...actionRowStyle, width: '100%' }}
      >
        <span style={icWrap}>{icon}</span>
        <span style={{ flex: 1, textAlign: 'start' }}>{label}</span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s var(--ease)' }}
        />
      </button>
      {/* `inert` is NOT optional here (blueprint §4.7). The 0fr grid row plus
          overflow:hidden collapses this body VISUALLY ONLY — every link
          inside stays in the tab order at zero height. Without inert, a
          keyboard user tabbing down the portal falls into three invisible
          map links sitting between the branch header and the menu button,
          with no way to see where focus went. This exact bug shipped on
          AyekaBar's portal and went unnoticed for months, and it is why
          both menu accordions in this codebase set inert too. */}
      <div
        id={bodyId}
        inert={!open}
        style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 0.4s var(--ease)' }}
      >
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

// Layout only — border/background are `undefined`, not just left at
// actionRowStyle's defaults, because an inline style always wins over a
// class for the same property. `.portal-cta-hero` (globals.css) supplies
// the actual gradient/glow finish, shared with anything else that wants the
// app's one hero treatment instead of redefining it inline here.
const heroButtonStyle: React.CSSProperties = {
  ...actionRowStyle,
  border: undefined,
  background: undefined,
  textDecoration: 'none',
}
