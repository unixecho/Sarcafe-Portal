'use client'

import { ShoppingBag } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { useCart } from '@/components/cart/CartProvider'

// Shown once per device, the first time an add ever lands (see
// CartProvider's showTutorial logic) — explains what the list is for
// before the customer wonders why a floating button appeared. Not a
// SheetShell: this is a one-time explainer with a single dismiss action,
// not a form, so a lighter centered card is enough.
export default function CartTutorial() {
  const { showTutorial, dismissTutorial } = useCart()
  if (!showTutorial) return null

  return (
    <ModalPortal>
      <div className="sheet-scrim" onClick={dismissTutorial}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cart-tutorial-title"
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: 320,
            margin: '0 auto',
            padding: 24,
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-elev)',
            border: '1px solid var(--line-strong)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 52, height: 52, borderRadius: 16, background: 'rgba(255,122,69,0.14)', color: 'var(--neon)', display: 'grid', placeItems: 'center' }}
          >
            <ShoppingBag size={24} strokeWidth={2} />
          </span>
          <h2 id="cart-tutorial-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>
            בונים רשימה בקצב שלכם
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
            הוספתם פריט ראשון — הכפתור הצף למטה שומר את הרשימה שלכם. כשמגיע התור, פותחים אותה ומראים לצוות בדוכן. זו לא הזמנה בפועל, רק תזכורת אישית.
          </p>
          <button
            type="button"
            className="press"
            onClick={dismissTutorial}
            style={{
              marginTop: 4,
              width: '100%',
              minHeight: 'var(--tap-min)',
              borderRadius: 999,
              border: 'none',
              background: 'var(--neon)',
              color: 'var(--bg)',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            הבנתי
          </button>
        </div>
      </div>
    </ModalPortal>
  )
}
