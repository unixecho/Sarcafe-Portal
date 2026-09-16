'use client'

import { useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { useCart } from '@/components/cart/CartProvider'
import CartSheet from '@/components/cart/CartSheet'
import type { Lang } from '@/lib/menu/types'

// Portalled to <body> (same reasoning as every other overlay in this app —
// see ModalPortal's own comment on fixed-position elements under a
// transformed ancestor). Invisible until "summoned" — the first successful
// add — so it never appears on a menu the customer hasn't touched yet.
export default function CartFab({ lang }: { lang: Lang }) {
  const { count, summoned } = useCart()
  const [open, setOpen] = useState(false)

  if (!summoned) return null

  return (
    <ModalPortal>
      <button
        type="button"
        className="press"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`הרשימה שלי${count > 0 ? `, ${count} פריטים` : ''}`}
        style={fabStyle}
      >
        <ShoppingBag size={20} aria-hidden="true" />
        {count > 0 && (
          <span aria-hidden="true" style={badgeStyle}>
            {count}
          </span>
        )}
      </button>

      <CartSheet open={open} onClose={() => setOpen(false)} lang={lang} />
    </ModalPortal>
  )
}

const fabStyle: React.CSSProperties = {
  position: 'fixed',
  insetInlineEnd: 18,
  bottom: 'calc(env(safe-area-inset-bottom) + 18px)',
  width: 54,
  height: 54,
  borderRadius: '50%',
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  boxShadow: 'var(--glow), 0 4px 14px rgba(0,0,0,0.35)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  zIndex: 30,
}

const badgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: -4,
  insetInlineEnd: -4,
  minWidth: 20,
  height: 20,
  padding: '0 5px',
  borderRadius: 999,
  background: 'var(--bg)',
  color: 'var(--neon)',
  border: '2px solid var(--neon)',
  fontSize: '0.68rem',
  fontWeight: 800,
  display: 'grid',
  placeItems: 'center',
  fontVariantNumeric: 'tabular-nums',
}
