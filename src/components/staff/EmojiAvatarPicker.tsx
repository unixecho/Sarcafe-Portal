'use client'

import { useState } from 'react'
import { STAFF_AVATARS } from '@/lib/staff/avatar'

export default function EmojiAvatarPicker({ value, onChange }: { value: string | null; onChange: (emoji: string) => void }) {
  const [selected, setSelected] = useState(value)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function choose(emoji: string) {
    if (saving || emoji === selected) return
    const before = selected
    setSelected(emoji)
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/staff/profile/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error?.message || 'לא הצלחנו לשמור את האווטאר')
      onChange(emoji)
      setMessage('האווטאר נשמר')
    } catch (cause) {
      setSelected(before)
      setMessage(cause instanceof Error ? cause.message : 'לא הצלחנו לשמור את האווטאר')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="sr-avatar-picker" aria-labelledby="avatar-picker-title">
      <div>
        <h2 id="avatar-picker-title">האווטאר שלי</h2>
        <p className="sr-note">בחרו אימוג׳י שמזהה אתכם במהירות בלוח המשמרות.</p>
      </div>
      <div className="sr-emoji-grid" role="radiogroup" aria-label="בחירת אווטאר">
        {STAFF_AVATARS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            role="radio"
            aria-checked={selected === emoji}
            aria-label={`בחירת ${emoji} כאווטאר`}
            className="press"
            disabled={saving}
            onClick={() => void choose(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
      {message && <p role="status" className="sr-note">{message}</p>}
    </section>
  )
}
