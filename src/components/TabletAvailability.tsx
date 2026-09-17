'use client'

import { useCallback, useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import Switch from '@/components/Switch'
import { ensureUids } from '@/lib/menu/variants'
import type { MenuDoc, MenuItem, MenuItemType } from '@/lib/menu/types'
import type { BranchSlug } from '@/lib/branches'

const POLL_MS = 20_000

// A flat, large-tap-target list for a mounted tablet behind the counter —
// no category CRUD, no translations. Scoped to only the categories the
// owner has flagged `liveOnTablet` (Shakes/Pastries/Sandwiches/Cookies) —
// everything else is accounted for elsewhere (the cart's own stock, the
// outside fridge, coffee/ices) and doesn't belong on a screen meant to be
// updated in a hurry mid-service. Every change POSTs to
// /api/owner/menu-availability, which updates both draft and published
// atomically (migrations 007 + 012) so it's live on the public menu
// immediately, not gated behind the next Publish.
export default function TabletAvailability({ branchSlug }: { branchSlug: BranchSlug }) {
  const [doc, setDoc] = useState<MenuDoc | null>(null)
  const [pending, setPending] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const res = await fetch(`/api/owner/menu-variants?branch=${branchSlug}`)
    if (!res.ok) return
    const payload = (await res.json()) as { draft: MenuDoc }
    setDoc(ensureUids(payload.draft))
  }, [branchSlug])

  useEffect(() => {
    setDoc(null)
    load()
  }, [load])

  useEffect(() => {
    const interval = window.setInterval(load, POLL_MS)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [load])

  async function patch(itemUid: string, typeUid: string | null, patch: { available?: boolean; quantity?: number }) {
    const key = `${itemUid}:${typeUid ?? ''}`
    setPending((prev) => new Set(prev).add(key))

    // Optimistic — a tablet change should feel instant, not wait on a round
    // trip. Rolled back by re-fetching the real state if the write fails.
    setDoc((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      for (const category of next.categories) {
        const item = category.items.find((i) => i.uid === itemUid)
        if (!item) continue
        const target: MenuItem | MenuItemType | undefined = typeUid ? item.types?.find((t) => t.uid === typeUid) : item
        if (!target) continue
        if (patch.available !== undefined) target.available = patch.available
        if (patch.quantity !== undefined) {
          target.quantity = patch.quantity
          if (patch.quantity === 0) target.available = false
        }
      }
      return next
    })

    try {
      const res = await fetch('/api/owner/menu-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchSlug, itemUid, typeUid, ...patch }),
      })
      if (!res.ok) throw new Error('request failed')
    } catch {
      load()
    } finally {
      setPending((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  if (!doc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sk" style={{ height: 64 }} />
        ))}
      </div>
    )
  }

  const tabletCategories = doc.categories.filter((c) => c.liveOnTablet === true)
  const rows = tabletCategories.flatMap((category) => category.items.map((item) => ({ category, item })))

  if (rows.length === 0) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '32px 16px', lineHeight: 1.6 }}>
        אין עדיין קטגוריות מסומנות לניהול מהטאבלט.
        <br />
        סמנו קטגוריה כ&quot;מנוהלת מהטאבלט&quot; בעריכת התפריט (למשל שייקים, מאפים, כריכים, עוגיות).
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map(({ category, item }) => (
        <div
          key={item.uid}
          style={{ padding: '14px 16px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-elev)', border: '1px solid var(--line)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{item.he || 'פריט'}</p>
              <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-faint)' }}>{category.title.he}</p>
            </div>
            {!item.types?.length && (
              <QuantityStepper
                value={item.quantity}
                disabled={!item.uid || pending.has(`${item.uid}:`)}
                onChange={(q) => item.uid && patch(item.uid, null, { quantity: q })}
              />
            )}
            <TabletSwitch
              on={item.available !== false}
              disabled={!item.uid || pending.has(`${item.uid}:`)}
              onClick={() => item.uid && patch(item.uid, null, { available: item.available === false })}
            />
          </div>

          {!!item.types?.length && (
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                borderTop: '1px solid var(--line)',
                paddingTop: 10,
              }}
            >
              {item.types.map((type) => (
                <div key={type.uid} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ flex: 1, fontSize: '0.92rem', color: 'var(--text-dim)' }}>{type.he || 'סוג'}</span>
                  <QuantityStepper
                    value={type.quantity}
                    disabled={!item.uid || pending.has(`${item.uid}:${type.uid}`)}
                    onChange={(q) => item.uid && patch(item.uid, type.uid!, { quantity: q })}
                  />
                  <TabletSwitch
                    on={type.available !== false}
                    disabled={!item.uid || pending.has(`${item.uid}:${type.uid}`)}
                    onClick={() => item.uid && patch(item.uid, type.uid!, { available: type.available === false })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// Bigger tap target than the editor's own inline switch — this page is
// meant for a mounted tablet, tapped in a hurry mid-service.
function TabletSwitch({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? 'זמין' : 'אזל ממלאי'}
      disabled={disabled}
      onClick={onClick}
      className="press"
      style={{
        background: 'none',
        border: 'none',
        padding: 10,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <span style={{ display: 'inline-block', transform: 'scale(1.3)' }}>
        <Switch on={on} />
      </span>
    </button>
  )
}

/** The live-count control — shown to customers on the public menu
 * (MenuView.tsx) when set, so unlike TabletSwitch this isn't decoration:
 * `undefined` means "not tracked," 0 means "tracked and empty," and the
 * two read very differently to a customer deciding what to order. */
function QuantityStepper({ value, disabled, onChange }: { value: number | undefined; disabled?: boolean; onChange: (next: number) => void }) {
  const n = value ?? 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <StepButton label="הפחתת כמות" disabled={disabled || n <= 0} onClick={() => onChange(Math.max(0, n - 1))}>
        <Minus size={16} aria-hidden="true" />
      </StepButton>
      <span
        className="ltr-isolate"
        style={{
          minWidth: 30,
          textAlign: 'center',
          fontSize: '1rem',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: value === undefined ? 'var(--text-faint)' : n === 0 ? '#ff6b6b' : 'var(--text)',
        }}
      >
        {value ?? '—'}
      </span>
      <StepButton label="הוספת כמות" disabled={disabled} onClick={() => onChange(n + 1)}>
        <Plus size={16} aria-hidden="true" />
      </StepButton>
    </div>
  )
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="press"
      style={{
        width: 34,
        height: 34,
        borderRadius: 9,
        border: '1px solid var(--line-strong)',
        background: 'var(--bg-elev-2)',
        color: 'var(--text)',
        display: 'grid',
        placeItems: 'center',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}
