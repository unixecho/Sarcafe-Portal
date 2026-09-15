'use client'

import { useEffect, useState } from 'react'
import { BADGES, badgeLabel, type Badge } from '@/lib/staff/badges'
import SelectSheet from '@/components/SelectSheet'

type BranchOption = { id: string; slug: string; name: { he?: string; en?: string; ar?: string } }

type StaffRow = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  display_name: string | null
  role: 'staff' | 'owner'
  badge: string | null
  branch_id: string | null
  active: boolean
  claimed_at: string | null
}

export default function StaffManager({ branches }: { branches: BranchOption[] }) {
  const [staff, setStaff] = useState<StaffRow[] | null>(null)
  const [email, setEmail] = useState('')
  const [badge, setBadge] = useState<Badge | ''>('')
  const [branchId, setBranchId] = useState<string>('')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/owner/staff')
    if (res.ok) setStaff((await res.json()).staff)
  }

  useEffect(() => {
    load()
  }, [])

  async function invite() {
    if (!email.trim()) return
    setInviting(true)
    setError(null)
    try {
      const res = await fetch('/api/owner/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), badge: badge || null, branchId: branchId || null }),
      })
      const payload = await res.json()
      if (!res.ok) {
        setError(payload?.error?.message ?? 'שגיאה בהזמנה')
        return
      }
      setEmail('')
      setBadge('')
      setBranchId('')
      load()
    } finally {
      setInviting(false)
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch('/api/owner/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Entrance cadence copied from the owner dashboard: the header is at
          0ms (it rises inside OwnerHeader on the page above this component),
          so the first card here takes 60ms and the team list 140ms — the
          dashboard's own two body delays. Hand-written rather than a delay()
          counter because both sections are unconditional: nothing here can be
          skipped, so there is no hole for a counter to close. Reduced motion
          is already handled — globals.css REMOVEs .rise, which is also what
          makes these visible at all, since rise-in fills `backwards` from
          opacity 0. The <p role="alert"> inside this card is NOT animated
          itself: it does not exist at mount, and this animation (0.55s, no
          `forwards` fill) is finished and leaves nothing behind long before a
          failed invite can put text in it. */}
      <section
        className="rise"
        style={{
          animationDelay: '60ms',
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          padding: 14,
        }}
      >
        <h2 style={{ margin: '0 0 10px', fontSize: '0.95rem', fontWeight: 700 }}>הזמנת איש/אשת צוות</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="email"
            placeholder="אימייל Google של איש הצוות"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Both of these were native <select>s, which §5.9 forbids
                outright — a native select paints in the OS's own chrome
                (Latin-first, light, platform-positioned) and cannot be
                reached by the token system, so it is the one control on
                the page that ignores the design entirely. SelectSheet is
                the iOS equivalent, built on SheetShell so it inherits the
                real focus trap rather than reimplementing one. */}
            <SelectSheet
              label="תפקיד"
              placeholder="תפקיד"
              value={badge}
              options={(Object.keys(BADGES) as Badge[]).map((b) => ({ value: b, label: BADGES[b].he }))}
              onChange={(v) => setBadge(v as Badge | '')}
              style={{ ...inputStyle, flex: 1 }}
            />
            <SelectSheet
              label="סניף"
              placeholder="כל הסניפים"
              value={branchId}
              options={branches.map((b) => ({ value: b.id, label: b.name.he ?? b.slug }))}
              onChange={setBranchId}
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
          {error && (
            <p role="alert" style={{ color: '#ff6b6b', fontSize: '0.8rem', margin: 0 }}>
              {error}
            </p>
          )}
          <button
            type="button"
            className="press"
            onClick={invite}
            disabled={inviting || !email.trim()}
            style={{
              minHeight: 'var(--tap-min)',
              borderRadius: 999,
              border: 'none',
              background: 'var(--neon)',
              color: 'var(--bg)',
              fontWeight: 700,
              cursor: 'pointer',
              opacity: inviting || !email.trim() ? 0.6 : 1,
            }}
          >
            {inviting ? 'שולח…' : '＋ הזמנה'}
          </button>
        </div>
      </section>

      {/* The team list: one rise for the whole section at 140ms. The rows
          inside are deliberately NOT staggered — they arrive from a fetch
          after mount, so a per-row entrance would be animating data landing
          rather than the page arriving, and a manager checking who is on
          shift should not wait on rows fading in one at a time. */}
      <section className="rise" style={{ animationDelay: '140ms' }}>
        <h2 style={{ margin: '0 0 10px', fontSize: '0.95rem', fontWeight: 700 }}>הצוות</h2>
        {!staff ? (
          <div className="sk" style={{ height: 120 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {staff.map((row) => (
              <div
                key={row.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--bg-elev)',
                  opacity: row.active ? 1 : 0.5,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.display_name || row.email}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-faint)' }}>
                    {row.role === 'owner' ? 'בעלים' : badgeLabel(row.badge) || 'צוות'}
                    {row.branch_id && ` · ${branches.find((b) => b.id === row.branch_id)?.name.he ?? ''}`}
                    {!row.claimed_at && ' · ממתין להתחברות'}
                  </p>
                </div>
                <button
                  type="button"
                  className="press"
                  onClick={() => patch(row.id, { active: !row.active })}
                  style={{
                    minHeight: 32,
                    padding: '0 10px',
                    borderRadius: 999,
                    border: '1px solid var(--line-strong)',
                    background: 'transparent',
                    color: row.active ? '#ff6b6b' : 'var(--neon-2)',
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                  }}
                >
                  {row.active ? 'השבתה' : 'הפעלה'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 10,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 12px',
  fontSize: '0.88rem',
}
