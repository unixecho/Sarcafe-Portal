'use client'

import { useEffect, useState } from 'react'
import { BADGES, badgeLabel, type Badge } from '@/lib/staff/badges'

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
      <section
        style={{
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
            <select value={badge} onChange={(e) => setBadge(e.target.value as Badge)} style={{ ...inputStyle, flex: 1 }}>
              <option value="">תפקיד</option>
              {(Object.keys(BADGES) as Badge[]).map((b) => (
                <option key={b} value={b}>
                  {BADGES[b].he}
                </option>
              ))}
            </select>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              <option value="">כל הסניפים</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name.he}
                </option>
              ))}
            </select>
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

      <section>
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
