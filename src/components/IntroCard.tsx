'use client'

import { useState, type CSSProperties } from 'react'
import Switch from '@/components/Switch'

// The owner's on/off for the portal's opening screen (src/components/intro), and
// the links that let them WATCH it. Ported from AyekaBar's IntroCard.
//
// Saves the moment it is tapped, like the other switches — there is no "save"
// button to forget, and a customer sees the change on their next page load (the
// owner API busts the settings cache tag; the root layout's IntroGate reads it on
// the server).
//
// WHY THE PREVIEWS ARE HERE. The intro has two versions: a longer welcome that a
// device sees ONCE, and a short one on every load after. The moment the owner has
// seen the welcome once, they could never see it again without clearing their
// browser's site data — so the card carries a link to each, and to each LINE
// (the words change from visit to visit, so there is nothing else to point at).
// They load the portal with `?intro=first` / `?intro=repeat` and `?line=N`,
// which play that version and line and write nothing: previewing never uses up a
// real first visit.
//
// The links are plain <a>, not <Link>, and carry `data-no-transition`: the intro
// plays on a full DOCUMENT load, and a client-side navigation to `/` would
// swallow it (the layout it lives in survives navigation by design).

const T = {
  title: 'מסך פתיחה',
  subtitle: 'מסך קצר עם הלוגו והמסר שלכם שנפתח כשנכנסים לפורטל ובאפליקציה המותקנת של הלקוחות, לפני שהאתר מופיע. אפשר לדלג עליו בכל רגע, במגע, בלחיצה או בגלילה.',
  switchLabel: 'הצגת מסך פתיחה',
  on: 'דלוק',
  off: 'כבוי',
  previewTitle: 'תצוגה מקדימה',
  previewOff: 'הדליקו את המסך כדי לצפות בו.',
  previewHint: 'נפתח בפורטל, ולא משפיע על מה שהלקוחות רואים.',
  linesTitle: 'השורות, בסדר שבו הן מופיעות',
  linesHint: 'בכל כניסה מוצגת שורה אחרת מהקודמת. מי שנכנס בפעם הראשונה רואה תמיד את השורה הראשונה. אפשר להקיש על שורה כדי לראות אותה.',
  failed: 'השינוי לא נשמר. נסו שוב.',
  hint: 'השינוי חל מהכניסה הבאה לאתר, ומי שכבר פתח את הדף לא מושפע. המסך מופיע בפורטל (לא בתפריט הדיגיטלי ולא בדפי הצוות והניהול) ובאפליקציה המותקנת של הלקוחות, ולא למי שהפעיל "עצירת אנימציות" בכפתור הנגישות.',
}

export interface IntroCardLine {
  line1: string
  line2: string
}

export default function IntroCard({ initial, firstSeconds, repeatSeconds, lines }: {
  initial: boolean
  /** About how long each version runs, from the real timeline — so the words on
   *  this card can never drift from what the intro actually does. */
  firstSeconds: number
  repeatSeconds: number
  /** Every line, in Hebrew, in play order. */
  lines: IntroCardLine[]
}) {
  const [on, setOn] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function toggle() {
    // A11y (WCAG 2.4.3): the in-flight guard lives here, not on `disabled` —
    // disabling the switch that holds keyboard focus would drop focus to <body>.
    if (busy) return
    const before = on
    setBusy(true)
    setErr(null)
    setOn(!before) // optimistic — a switch has to feel instant
    try {
      const res = await fetch('/api/owner/intro', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !before }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error?.message ?? T.failed)
      setOn(j.enabled)
    } catch (e) {
      setOn(before) // roll back
      setErr(e instanceof Error ? e.message : T.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={card}>
      <div>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>{T.title}</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.5 }}>{T.subtitle}</p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-disabled={busy}
        onClick={toggle}
        className="press"
        style={{ ...row, ...rowButton, opacity: busy ? 0.7 : 1 }}
      >
        <span style={{ flex: 1, fontWeight: 700, color: 'var(--text)', textAlign: 'start' }}>{T.switchLabel}</span>
        <span style={{ fontSize: '0.78rem', color: on ? 'var(--neon-soft)' : 'var(--text-faint)', fontWeight: 600 }}>{on ? T.on : T.off}</span>
        <Switch on={on} />
      </button>

      <p aria-live="polite" style={{ fontSize: '0.84rem', color: 'var(--text-dim)', margin: 0, lineHeight: 1.55 }}>
        {on ? (
          <>
            מבקר חדש רואה את הגרסה המלאה (<b style={{ color: 'var(--text)' }}>כ-{firstSeconds} שניות</b>) בכניסה הראשונה שלו, ובכל כניסה נוספת גרסה קצרה (<b style={{ color: 'var(--text)' }}>כ-{repeatSeconds} שניות</b>).
          </>
        ) : (
          'המסך כבוי, והלקוחות נכנסים ישר לפורטל.'
        )}
      </p>

      <div style={section}>
        <h3 style={h3}>{T.previewTitle}</h3>
        {on ? (
          <>
            <a href="/?intro=first" data-no-transition className="press" style={{ ...row, ...rowLink }}>
              <span aria-hidden="true" style={{ color: 'var(--neon-soft)' }}>▶</span>
              <span style={{ flex: 1, fontWeight: 700 }}>כניסה ראשונה</span>
              <span style={dim}>כ-{firstSeconds} שניות</span>
            </a>
            <a href="/?intro=repeat" data-no-transition className="press" style={{ ...row, ...rowLink }}>
              <span aria-hidden="true" style={{ color: 'var(--neon-soft)' }}>▶</span>
              <span style={{ flex: 1, fontWeight: 700 }}>כניסה חוזרת</span>
              <span style={dim}>כ-{repeatSeconds} שניות</span>
            </a>
            <p style={small}>{T.previewHint}</p>
          </>
        ) : (
          <p style={{ ...small, fontSize: '0.82rem' }}>{T.previewOff}</p>
        )}
      </div>

      <div style={section}>
        <h3 style={h3}>{T.linesTitle}</h3>
        <p style={small}>{T.linesHint}</p>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lines.map((l, i) => (
            <li key={i}>
              {on ? (
                <a href={`/?intro=repeat&line=${i + 1}`} data-no-transition className="press" style={{ ...row, ...rowLink, alignItems: 'flex-start' }}>
                  <LineBody n={i + 1} line={l} />
                </a>
              ) : (
                <div style={{ ...row, alignItems: 'flex-start' }}>
                  <LineBody n={i + 1} line={l} />
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>

      <p style={{ ...small, lineHeight: 1.6, borderTop: '1px solid var(--line)', paddingTop: 10 }}>{T.hint}</p>

      {err && (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.82rem', margin: 0 }}>
          {err}
        </p>
      )}
    </div>
  )
}

function LineBody({ n, line }: { n: number; line: IntroCardLine }) {
  return (
    <>
      <span aria-hidden="true" style={{ ...dim, minWidth: 18, paddingTop: 2 }}>{n}</span>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{line.line1}</span>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>{line.line2}</span>
      </span>
    </>
  )
}

const card: CSSProperties = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
  borderRadius: 16,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}
const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 48,
  padding: '8px 12px',
  borderRadius: 12,
  border: '1px solid var(--line)',
  background: 'var(--bg-elev-2)',
  fontSize: '0.95rem',
}
const rowButton: CSSProperties = { width: '100%', font: 'inherit', cursor: 'pointer', color: 'inherit' }
const rowLink: CSSProperties = { color: 'var(--text)', textDecoration: 'none', cursor: 'pointer' }
const dim: CSSProperties = { fontSize: '0.78rem', color: 'var(--text-faint)', fontWeight: 600 }
const section: CSSProperties = { borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }
const h3: CSSProperties = { fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', margin: 0 }
const small: CSSProperties = { fontSize: '0.76rem', color: 'var(--text-faint)', margin: 0, lineHeight: 1.5 }
