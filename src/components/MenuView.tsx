'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { fetchMenuClient } from '@/lib/menu/client'
import { localized, type Lang } from '@/lib/menu/types'
import type { ResolvedMenu } from '@/lib/menu/fetch'
import type { BranchSlug } from '@/lib/branches'

const LANGUAGE_STORAGE_KEY = 'sarcafe-language'
const REFRESH_MS = 30_000 // re-checks published_at; also catches a scheduled
// variant flipping on/off within about this margin. A full resolveVariant
// recompute independent of network polling (AyekaBar's 60s client tick)
// is a follow-up refinement, not a functional gap — this refetch achieves
// the same outcome, just tied to the network poll instead of a separate timer.

type MenuCopy = { viewOnly: string; back: string; footer: string; accessibility: string; shekel: string; soldOut: string }

const T: Record<Lang, MenuCopy> = {
  he: { viewOnly: 'התפריט לתצוגה בלבד — מזמינים ומשלמים בדוכן.', back: '→ לפורטל', footer: 'המחירים בשקלים חדשים וכוללים מע"מ.', accessibility: 'הצהרת נגישות', shekel: '₪', soldOut: 'אזל' },
  en: { viewOnly: 'This menu is for display only — order and pay at the truck.', back: '← Back to portal', footer: 'Prices are in NIS and include VAT.', accessibility: 'Accessibility statement', shekel: '₪', soldOut: 'Sold out' },
  ar: { viewOnly: 'القائمة للعرض فقط — الطلب والدفع عند العربة.', back: '→ إلى البوابة', footer: 'الأسعار بالشيكل الجديد وتشمل ضريبة القيمة المضافة.', accessibility: 'بيان إمكانية الوصول', shekel: '₪', soldOut: 'نفدت الكمية' },
}

function getInitialLanguage(): Lang {
  if (typeof window === 'undefined') return 'he'
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return stored === 'en' || stored === 'ar' || stored === 'he' ? stored : 'he'
}

export default function MenuView({ branchSlug, initial }: { branchSlug: BranchSlug; initial: ResolvedMenu }) {
  const [lang, setLang] = useState<Lang>('he')
  const [menu, setMenu] = useState(initial)
  const [expandedId, setExpandedId] = useState<string | null>(initial.categories[0]?.id ?? null)
  const lastPublishedAt = useRef(initial.publishedAt)

  useEffect(() => {
    setLang(getInitialLanguage())
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl'
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
  }, [lang])

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

  const t = T[lang]

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 48 }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--bg)',
          padding: '14px 16px 10px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Link href="/" style={{ color: 'var(--text-dim)', fontSize: '0.8rem', textDecoration: 'none' }}>
            {t.back}
          </Link>
          <div role="group" aria-label="Language" style={{ display: 'flex', gap: 4 }}>
            {(['he', 'en', 'ar'] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                style={{
                  minWidth: 30,
                  minHeight: 30,
                  borderRadius: 999,
                  border: `1px solid ${lang === l ? 'var(--neon)' : 'var(--line-strong)'}`,
                  background: lang === l ? 'rgba(255,122,69,0.14)' : 'transparent',
                  color: 'var(--text)',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>{localized(menu.name, lang)}</h1>
        <p style={{ margin: '4px 0 0', fontSize: '0.76rem', color: 'var(--text-faint)' }}>{t.viewOnly}</p>
        {menu.activeVariant && !menu.isDefaultVariant && (
          <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--neon-soft)' }}>
            🍽️ {localized(menu.activeVariant.name, lang)}
          </p>
        )}

        {menu.categories.length > 1 && (
          <nav aria-label="Categories" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 12, paddingBottom: 2 }}>
            {menu.categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => {
                  setExpandedId(category.id)
                  document.getElementById(`category-${category.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                style={{
                  flexShrink: 0,
                  minHeight: 36,
                  padding: '0 14px',
                  borderRadius: 999,
                  border: '1px solid var(--line-strong)',
                  background: expandedId === category.id ? 'rgba(255,122,69,0.14)' : 'var(--bg-elev)',
                  color: 'var(--text)',
                  fontSize: '0.78rem',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                {category.icon} {localized(category.title, lang)}
              </button>
            ))}
          </nav>
        )}
      </header>

      <div style={{ padding: '8px 16px 0' }}>
        {menu.categories.map((category) => {
          const isOpen = category.id === expandedId
          return (
            <section key={category.id} id={`category-${category.id}`} style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`category-body-${category.id}`}
                  onClick={() => setExpandedId(isOpen ? null : category.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: 'var(--tap-min)',
                    padding: '0 4px',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid var(--line)',
                    color: 'var(--text)',
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <span>
                    <span aria-hidden="true">{category.icon}</span> {localized(category.title, lang)}
                  </span>
                  <span aria-hidden="true" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s var(--ease)' }}>
                    ⌄
                  </span>
                </button>
              </h2>
              <div id={`category-body-${category.id}`} inert={!isOpen} hidden={!isOpen}>
                <ul style={{ listStyle: 'none', margin: 0, padding: '8px 0' }}>
                  {category.items.map((item) => (
                    <li
                      key={item.uid}
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'flex-start',
                        padding: '10px 4px',
                        borderBottom: '1px solid var(--line)',
                        opacity: item.available === false ? 0.5 : 1,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600 }}>
                          {localized(item, lang)}
                          {item.available === false && (
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
                      </div>
                      <span className="ltr-isolate" style={{ fontWeight: 700, fontSize: '0.88rem', whiteSpace: 'nowrap' }}>
                        {item.price} {t.shekel}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )
        })}
      </div>

      <footer style={{ padding: '20px 16px 0', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-faint)' }}>{t.footer}</p>
        <Link href="/accessibility" style={{ display: 'inline-block', marginTop: 8, fontSize: '0.78rem', color: 'var(--neon-2)' }}>
          ♿ {t.accessibility}
        </Link>
      </footer>
    </main>
  )
}
