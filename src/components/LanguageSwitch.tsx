'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Globe } from 'lucide-react'

// One language switcher for the whole site (portal + digital menu), ported
// from AyekaBar's LanguageSwitch.tsx — that project consolidated three
// divergent implementations into this single one for the same reason
// Sarcafe's inline HE/EN/AR pill row needed replacing: a control that
// changes shape between pages doesn't feel native. A single globe button
// opening a real dropdown panel (never a native <select>) instead.

export type Lang = 'he' | 'en' | 'ar'

export const LANG_NAMES: Record<Lang, string> = {
  he: 'עברית',
  en: 'English',
  ar: 'العربية',
}

const ORDER: Lang[] = ['he', 'en', 'ar']

const TRIGGER_LABEL: Record<Lang, string> = {
  he: 'שינוי שפה',
  en: 'Change language',
  ar: 'تغيير اللغة',
}

const LANGUAGE_STORAGE_KEY = 'sarcafe-language'

export default function LanguageSwitch({
  lang,
  onChange,
  variant = 'fixed',
}: {
  lang: Lang
  onChange: (next: Lang) => void
  /** `fixed` pins to the viewport corner (portal); `inline` sits in a topbar
   * (digital menu) — same physical corner either way, see useLanguage(). */
  variant?: 'fixed' | 'inline'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const closeAndReturnFocus = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAndReturnFocus()
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [closeAndReturnFocus])

  const wrap: CSSProperties =
    variant === 'fixed'
      ? { position: 'fixed', left: 14, top: 'calc(env(safe-area-inset-top) + 14px)', zIndex: 50 }
      : { position: 'relative', zIndex: 30 }

  return (
    <div ref={ref} style={wrap}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={TRIGGER_LABEL[lang]}
        aria-expanded={open}
        aria-haspopup="menu"
        className="press"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        style={{
          width: 44,
          height: 44,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 12,
          border: `1px solid ${open ? 'var(--neon-2)' : 'var(--line)'}`,
          background: open ? 'rgba(87,217,192,0.1)' : 'var(--bg-elev)',
          color: 'var(--text)',
          cursor: 'pointer',
          boxShadow: open ? '0 0 18px rgba(87,217,192,0.35)' : 'none',
          transition: 'border-color 0.2s var(--ease), box-shadow 0.2s var(--ease), background 0.2s var(--ease)',
        }}
      >
        <Globe size={20} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="rise"
          style={{
            position: 'absolute',
            top: 52,
            left: 0,
            minWidth: 132,
            background: 'var(--bg-elev-2)',
            border: '1px solid var(--line-strong)',
            borderRadius: 14,
            padding: 6,
            boxShadow: '0 18px 40px rgba(0,0,0,0.55)',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {ORDER.map((l) => {
            const active = l === lang
            return (
              <button
                key={l}
                type="button"
                role="menuitem"
                className="press"
                onClick={() => {
                  onChange(l)
                  closeAndReturnFocus()
                }}
                style={{
                  border: 0,
                  background: active ? 'rgba(255,122,69,0.14)' : 'transparent',
                  boxShadow: active ? 'inset 0 0 0 1px rgba(255,122,69,0.3)' : 'none',
                  color: active ? 'var(--text)' : 'var(--text-dim)',
                  textAlign: 'start',
                  font: 'inherit',
                  fontWeight: 500,
                  padding: '9px 12px',
                  minHeight: 44,
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                {LANG_NAMES[l]}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Shared persistence + <html> sync, so every page treats language identically. */
export function useLanguage(): [Lang, (next: Lang) => void] {
  const [lang, setLang] = useState<Lang>('he')

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (saved && (ORDER as string[]).includes(saved)) setLang(saved as Lang)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl'
  }, [lang])

  return [
    lang,
    (next: Lang) => {
      setLang(next)
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next)
    },
  ]
}
