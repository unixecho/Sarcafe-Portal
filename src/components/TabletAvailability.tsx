'use client'

import { useCallback, useEffect, useState } from 'react'
import Switch from '@/components/Switch'
import { ensureUids } from '@/lib/menu/variants'
import type { MenuDoc } from '@/lib/menu/types'
import type { BranchSlug } from '@/lib/branches'

const POLL_MS = 20_000

// A flat, large-tap-target list for a mounted tablet behind the counter —
// no category CRUD, no translations, just "is this in stock right now."
// Every toggle POSTs to /api/owner/menu-availability, which updates both
// draft and published atomically (see migration 007) so it's live on the
// public menu immediately, not gated behind the next Publish.
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

  async function toggle(itemUid: string, typeUid: string | null, nextAvailable: boolean) {
    const key = `${itemUid}:${typeUid ?? ''}`
    setPending((prev) => new Set(prev).add(key))

    // Optimistic — a tablet toggle should feel instant, not wait on a round
    // trip. Rolled back by re-fetching the real state if the write fails.
    setDoc((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      for (const category of next.categories) {
        const item = category.items.find((i) => i.uid === itemUid)
        if (!item) continue
        if (typeUid) {
          const type = item.types?.find((t) => t.uid === typeUid)
          if (type) type.available = nextAvailable
        } else {
          item.available = nextAvailable
        }
      }
      return next
    })

    try {
      const res = await fetch('/api/owner/menu-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchSlug, itemUid, typeUid, available: nextAvailable }),
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

  const rows = doc.categories.flatMap((category) => category.items.map((item) => ({ category, item })))

  if (rows.length === 0) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '32px 16px' }}>
        אין עדיין פריטים בתפריט הסניף הזה.
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
            <TabletSwitch
              on={item.available !== false}
              disabled={!item.uid || pending.has(`${item.uid}:`)}
              onClick={() => item.uid && toggle(item.uid, null, item.available === false)}
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
                  <TabletSwitch
                    on={type.available !== false}
                    disabled={!item.uid || pending.has(`${item.uid}:${type.uid}`)}
                    onClick={() => item.uid && toggle(item.uid, type.uid, type.available === false)}
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
