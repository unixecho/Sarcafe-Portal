'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronDown, UtensilsCrossed, Accessibility, Check } from 'lucide-react'
import { fetchMenuClient } from '@/lib/menu/client'
import { localized, type Lang } from '@/lib/menu/types'
import type { ResolvedMenu } from '@/lib/menu/fetch'
import type { Branch, BranchSlug } from '@/lib/branches'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import PublicBackdrop from '@/components/PublicBackdrop'
import LanguageSwitch, { useLanguage } from '@/components/LanguageSwitch'
import SheetShell from '@/components/SheetShell'

const REFRESH_MS = 30_000 // re-checks published_at; also catches a scheduled
// variant flipping on/off within about this margin. A full resolveVariant
// recompute independent of network polling (AyekaBar's 60s client tick)
// is a follow-up refinement, not a functional gap — this refetch achieves
// the same outcome, just tied to the network poll instead of a separate timer.

type MenuCopy = {
  viewOnly: string
  back: string
  footer: string
  accessibility: string
  shekel: string
  soldOut: string
  switchBranch: string
  currentBranch: string
}

const T: Record<Lang, MenuCopy> = {
  he: {
    viewOnly: 'התפריט לתצוגה בלבד — מזמינים ומשלמים בדוכן.',
    back: 'לפורטל',
    footer: 'המחירים בשקלים חדשים וכוללים מע"מ.',
    accessibility: 'הצהרת נגישות',
    shekel: '₪',
    soldOut: 'אזל',
    switchBranch: 'החלפת סניף',
    currentBranch: 'סניף נוכחי',
  },
  en: {
    viewOnly: 'This menu is for display only — order and pay at the truck.',
    back: 'Back to portal',
    footer: 'Prices are in NIS and include VAT.',
    accessibility: 'Accessibility statement',
    shekel: '₪',
    soldOut: 'Sold out',
    switchBranch: 'Change branch',
    currentBranch: 'Current branch',
  },
  ar: {
    viewOnly: 'القائمة للعرض فقط — الطلب والدفع عند العربة.',
    back: 'إلى البوابة',
    footer: 'الأسعار بالشيكل الجديد وتشمل ضريبة القيمة المضافة.',
    accessibility: 'بيان إمكانية الوصول',
    shekel: '₪',
    soldOut: 'نفدت الكمية',
    switchBranch: 'تغيير الفرع',
    currentBranch: 'الفرع الحالي',
  },
}

export default function MenuView({ branchSlug, initial }: { branchSlug: BranchSlug; initial: ResolvedMenu }) {
  const [lang, setLang] = useLanguage()
  const [menu, setMenu] = useState(initial)
  const [openId, setOpenId] = useState<string | null>(initial.categories[0]?.id ?? null)
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [branchSheetOpen, setBranchSheetOpen] = useState(false)
  const lastPublishedAt = useRef(initial.publishedAt)
  const chipsRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)

  // Lets the top bar offer every other branch's menu directly (see the
  // switcher sheet below) instead of forcing "back to portal, pick a
  // branch, tap the menu link" for what should be a one-tap switch. Fetched
  // lazily (not blocking initial render) since it's only needed once the
  // switcher is opened; branches are public data, same endpoint the portal
  // uses.
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

  useEffect(() => {
    async function refresh() {
      const fresh = await fetchMenuClient(branchSlug)
      if (fresh) {
        setMenu(fresh)
        lastPublishedAt.current = fresh.publishedAt
      }
    }

    const interval = window.setInterval(refresh, REFRESH_MS)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [branchSlug])

  // Keeps the active chip scrolled into view (centered once the row is
  // wider than the viewport; the row simply centers itself via .fits
  // otherwise). Ported from AyekaBar's MenuView.
  const centerChip = useCallback((id: string | null, instant = false) => {
    const chips = chipsRef.current
    if (!chips || !id) return
    const fits = chips.scrollWidth <= chips.clientWidth + 1
    chips.classList.toggle('fits', fits)
    if (fits) return
    const chip = chips.querySelector<HTMLElement>(`[data-chip="${id}"]`)
    chip?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: instant ? 'auto' : 'smooth' })
  }, [])
  useEffect(() => {
    centerChip(openId, true)
  }, [openId, menu, lang, centerChip])

  // Tracks the sticky header's real height in a CSS var so a category's
  // scroll-margin-top (menu-cat in globals.css) lands its top just below
  // the bar, however tall the bar ends up being (it grows with wrapped
  // category names at some font sizes).
  useEffect(() => {
    function setH() {
      document.documentElement.style.setProperty('--sticky-h', `${stickyRef.current?.offsetHeight ?? 108}px`)
    }
    setH()
    const el = stickyRef.current
    if (el && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(setH)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', setH)
    return () => window.removeEventListener('resize', setH)
  }, [menu, lang])

  // On open, scroll so the category's top sits under the sticky bar — but
  // wait for the accordion (and the collapsing sibling) to finish
  // animating, so this scrolls to the settled position, not the
  // pre-collapse one. Ported from AyekaBar's MenuView; skips the very
  // first render (nothing to scroll to yet).
  const firstOpen = useRef(true)
  useEffect(() => {
    if (firstOpen.current) {
      firstOpen.current = false
      return
    }
    if (!openId) return
    const sec = document.getElementById(`category-${openId}`)
    if (!sec) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let done = false
    function go() {
      if (done) return
      done = true
      sec!.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    }
    const body = sec.querySelector('.accordion-body')
    function onEnd(e: Event) {
      if ((e as TransitionEvent).propertyName === 'grid-template-rows') go()
    }
    body?.addEventListener('transitionend', onEnd)
    const fallback = window.setTimeout(go, 560)
    return () => {
      body?.removeEventListener('transitionend', onEnd)
      window.clearTimeout(fallback)
    }
  }, [openId])

  function openCategory(id: string) {
    setOpenId((cur) => (cur === id ? null : id))
  }

  const t = T[lang]
  const brand = localized(menu.name, lang)

  return (
    <PublicBackdrop>
      <main id="main" tabIndex={-1} style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 48, position: 'relative' }}>
        <div className="menu-sticky" ref={stickyRef}>
          <div className="menu-topbar">
            <div className="menu-lang-slot rise" style={{ animationDelay: '20ms' }}>
              <LanguageSwitch lang={lang} onChange={setLang} variant="inline" />
            </div>
            <h1 className="menu-brand-wrap rise" style={{ animationDelay: '90ms' }}>
              <button
                type="button"
                className="menu-brand press"
                onClick={() => setBranchSheetOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={branchSheetOpen}
              >
                <span className="menu-brand-text">{brand}</span>
                <ChevronDown size={16} aria-hidden="true" className="menu-brand-chev" />
              </button>
            </h1>
            <Link href="/" className="menu-back press rise" aria-label={t.back} style={{ animationDelay: '20ms' }}>
              <ChevronLeft size={18} className="dir-flip" aria-hidden="true" />
            </Link>
          </div>

          <p style={{ margin: '0 16px 8px', fontSize: '0.76rem', color: 'var(--text-faint)', textAlign: 'center' }}>{t.viewOnly}</p>

          {menu.activeVariant && !menu.isDefaultVariant && (
            <p
              style={{
                margin: '0 16px 8px',
                fontSize: '0.78rem',
                color: 'var(--neon-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              <UtensilsCrossed size={14} aria-hidden="true" /> {localized(menu.activeVariant.name, lang)}
            </p>
          )}

          {menu.categories.length > 1 && (
            <div className="menu-chips-wrap rise" style={{ animationDelay: '160ms' }}>
              <nav className="menu-chips" ref={chipsRef} aria-label="Categories">
                {menu.categories.map((category) => {
                  const CategoryIcon = resolveCategoryIcon(category.icon)
                  return (
                    <button
                      key={category.id}
                      data-chip={category.id}
                      type="button"
                      className={`menu-chip press${category.id === openId ? ' active' : ''}`}
                      onClick={() => openCategory(category.id)}
                    >
                      <CategoryIcon size={14} aria-hidden="true" /> {localized(category.title, lang)}
                    </button>
                  )
                })}
              </nav>
            </div>
          )}
        </div>

        <SheetShell open={branchSheetOpen} onClose={() => setBranchSheetOpen(false)} labelledBy="branch-switch-title">
          <h2 id="branch-switch-title" style={{ margin: '0 0 12px', fontSize: '1.05rem', fontWeight: 800, textAlign: 'center' }}>
            {t.switchBranch}
          </h2>
          <div className="sheet-scroll">
            {branches === null ? (
              [0, 1].map((i) => <div key={i} className="sk" style={{ height: 60 }} />)
            ) : (
              branches.map((b) => {
                const isCurrent = b.slug === branchSlug
                return isCurrent ? (
                  <div key={b.slug} className="branch-switch-row branch-switch-row--current" aria-current="true">
                    <span style={{ fontWeight: 700, fontSize: '1rem' }}>{b.name[lang] || b.name.he}</span>
                    <span className="branch-switch-current-tag">
                      <Check size={13} aria-hidden="true" /> {t.currentBranch}
                    </span>
                  </div>
                ) : (
                  <Link
                    key={b.slug}
                    href={`/menu/${b.slug}`}
                    className="branch-switch-row press"
                    onClick={() => setBranchSheetOpen(false)}
                  >
                    <span style={{ fontWeight: 700, fontSize: '1rem' }}>{b.name[lang] || b.name.he}</span>
                    <ChevronLeft size={16} className="dir-flip" aria-hidden="true" style={{ color: 'var(--text-faint)' }} />
                  </Link>
                )
              })
            )}
          </div>
        </SheetShell>

        <div style={{ padding: '8px 16px 0' }}>
          {menu.categories.map((category, i) => {
            const isOpen = category.id === openId
            const CategoryIcon = resolveCategoryIcon(category.icon)
            return (
              <section
                key={category.id}
                id={`category-${category.id}`}
                className={`menu-cat rise${isOpen ? ' is-open' : ''}`}
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              >
                <h2 style={{ margin: 0 }}>
                  <button
                    type="button"
                    className="menu-cat-head press"
                    aria-expanded={isOpen}
                    aria-controls={`category-body-${category.id}`}
                    onClick={() => openCategory(category.id)}
                  >
                    <span className="menu-cat-icon">
                      <CategoryIcon size={19} aria-hidden="true" />
                    </span>
                    <span style={{ flex: 1, fontWeight: 700, fontSize: '1.05rem' }}>{localized(category.title, lang)}</span>
                    <span style={{ color: 'var(--text-faint)', fontSize: '0.82rem', fontWeight: 500 }}>{category.items.length}</span>
                    <ChevronDownIcon />
                  </button>
                </h2>
                <div id={`category-body-${category.id}`} inert={!isOpen} className={`accordion-body${isOpen ? ' is-open' : ''}`}>
                  {/* .accordion-inner must carry NO padding of its own — a
                      border-box element can never render shorter than its
                      own padding, so padding here would put a permanent
                      14px floor under the 0fr collapse no matter what
                      overflow/min-height says (confirmed live: it was
                      stuck at exactly 14px, the padding-bottom value).
                      Padding lives one level deeper instead. */}
                  <div className="accordion-inner">
                    <ul style={{ listStyle: 'none', margin: 0, padding: '0 14px 14px' }}>
                      {category.items.map((item, itemIndex) => {
                      // An item with types but every type sold out reads as
                      // sold out itself — there's nothing left to choose.
                      const allTypesSoldOut = !!item.types?.length && item.types.every((tp) => tp.available === false)
                      const soldOut = item.available === false || allTypesSoldOut
                      return (
                      <li
                        key={item.uid ?? `${category.id}-${itemIndex}`}
                        className="menu-item"
                        /* --i drives this row's place in the cascade and its
                           name's typing delay (globals.css §4.8). --rest is
                           the row's RESTING opacity: it must travel as a
                           custom property rather than an inline `opacity`,
                           because an inline opacity would beat the entrance
                           rule and pin a sold-out row visible at 0.5 before
                           it had arrived. Layout (flex/gap/padding) moved to
                           the class so the entrance has something to own. */
                        style={{
                          '--i': itemIndex,
                          '--rest': soldOut ? 0.5 : 1,
                          borderTop: itemIndex === 0 ? 'none' : '1px solid var(--line)',
                        } as React.CSSProperties}
                      >
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600 }}>
                            {/* Only the NAME types in — the sold-out badge
                                below is status, not content, and must appear
                                with the row rather than being typed out. */}
                            <span className="menu-item-name">{localized(item, lang)}</span>
                            {soldOut && (
                              <span style={{ marginInlineStart: 8, fontSize: '0.7rem', color: '#ff8a5c', fontWeight: 700 }}>
                                {t.soldOut}
                              </span>
                            )}
                          </p>
                          {item.note && (
                            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-faint)' }}>
                              {localized(item.note, lang)}
                            </p>
                          )}
                          {!!item.types?.length && (
                            <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {item.types.map((type) => {
                                const typeSoldOut = type.available === false
                                return (
                                  <li
                                    key={type.uid}
                                    style={{
                                      fontSize: '0.74rem',
                                      padding: '3px 9px',
                                      borderRadius: 999,
                                      background: typeSoldOut ? 'transparent' : 'var(--bg-elev-2)',
                                      border: `1px solid ${typeSoldOut ? 'var(--line)' : 'var(--line-strong)'}`,
                                      color: typeSoldOut ? 'var(--text-faint)' : 'var(--text-dim)',
                                    }}
                                  >
                                    {localized(type, lang)}
                                    {typeSoldOut && (
                                      <span style={{ marginInlineStart: 5, color: '#ff8a5c', fontWeight: 700 }}>· {t.soldOut}</span>
                                    )}
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </div>
                        <span className="ltr-isolate" style={{ fontWeight: 700, fontSize: '0.88rem', whiteSpace: 'nowrap' }}>
                          {item.price} {t.shekel}
                        </span>
                      </li>
                      )
                      })}
                    </ul>
                  </div>
                </div>
              </section>
            )
          })}
        </div>

        <footer style={{ padding: '20px 16px 0', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-faint)' }}>{t.footer}</p>
          <Link
            href="/accessibility"
            className="press"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: '0.78rem', color: 'var(--neon-2)' }}
          >
            <Accessibility size={15} aria-hidden="true" /> {t.accessibility}
          </Link>
        </footer>
      </main>
    </PublicBackdrop>
  )
}

// Rotation/color-on-open comes from the .menu-cat.is-open .menu-chev rule
// in globals.css, not a prop here — same as AyekaBar's .chev, so opening a
// category never fights an inline style against the CSS transition.
function ChevronDownIcon() {
  return (
    <svg
      className="menu-chev"
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
