import Link from 'next/link'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { readSetting } from '@/lib/settings/server'
import { DEFAULT_ACCESSIBILITY_STATEMENT, type AccessibilityStatement } from '@/lib/settings/keys'
import PublicBackdrop from '@/components/PublicBackdrop'
import { WIDGET_COVERAGE } from 'a11y-widget'

export const metadata = { title: 'Sarcafe | הצהרת נגישות' }

// IS 5568 (Israeli accessibility-service regulations) / WCAG 2.2 AA target.
// Fixed copy below is not owner-editable on purpose (it describes what the
// codebase actually does, not a business-specific claim); the
// conditionally-rendered sections are, via /owner/accessibility. An empty
// field is simply omitted, never shown as a "[to be completed]" placeholder.
export default async function AccessibilityStatementPage() {
  const statement = await readSetting<AccessibilityStatement>('accessibility_statement', DEFAULT_ACCESSIBILITY_STATEMENT)

  const hasPhysicalNotes = statement.entranceAccess || statement.restroomAccess || statement.generalNote
  const hasContact = statement.contactName || statement.contactPhone || statement.contactEmail

  // Ayeka's stagger counter (§4.4), not hand-written delays. 260ms of lead-in
  // so the page itself has arrived before its contents start, then 85ms
  // between siblings. The counter — rather than literal values — is the whole
  // point on THIS page: several blocks below are conditional on the owner
  // having filled that field in, and a skipped block skips its delay() call,
  // so everything after it simply moves one step earlier instead of leaving a
  // visible hole in the cadence.
  let d = 0
  const delay = () => `${260 + d++ * 85}ms`

  return (
    <PublicBackdrop>
      <main id="main" tabIndex={-1} dir="rtl" lang="he" style={{ maxWidth: 560, margin: '0 auto', padding: '32px 20px 48px', position: 'relative' }}>
        <Link
          href="/"
          className="press rise"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-dim)', fontSize: '0.85rem', animationDelay: delay() }}
        >
          <ArrowRight size={15} aria-hidden="true" />
          לדף הבית
        </Link>
        <div
          className="rise"
          style={{
            background: 'var(--glass)',
            backdropFilter: 'blur(20px)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 22px',
            marginTop: 16,
            animationDelay: delay(),
          }}
        >
          <h1 className="rise" style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: 0, animationDelay: delay() }}>
            הצהרת נגישות
          </h1>

          {/* Deliberately NO typewriter on this page. steps() is tuned to a
              character count and reads as a stutter on anything longer than a
              label — and this is a legal statement someone may be here to
              read urgently. Making them wait for prose to type itself is a
              worse experience, not a more considered one. Fade only. */}
          <p className="rise" style={{ color: 'var(--text-dim)', lineHeight: 1.7, animationDelay: delay() }}>
            אנו פועלים להנגשת האתר בהתאם לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), תשע״ג-2013,
            ובהתאם לתקן הישראלי (ת״י) 5568 ברמת AA, המבוסס על הנחיות WCAG 2.2.
          </p>

          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: 24 }}>תפריט הנגישות</h2>
          <p style={{ color: 'var(--text-dim)', lineHeight: 1.7 }}>
            בפינה הימנית התחתונה של המסך מופיע כפתור נגישות. לחיצה עליו — או הקשה על <strong>F2</strong> מהמקלדת
            בכל מקום באתר — פותחת תפריט התאמות אישיות לביקור זה; אותה הקשה, או <strong>Esc</strong>, סוגרת אותו.
            ההתאמות נשמרות במכשיר ונשארות פעילות בביקורים הבאים, עד לאיפוס ידני מתוך התפריט עצמו.
          </p>
          <ul style={{ color: 'var(--text-dim)', lineHeight: 1.9, paddingInlineStart: 20 }}>
            {WIDGET_COVERAGE.map((item) => (
              <li key={item.id}>{item.labels.he}</li>
            ))}
          </ul>

          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: 24 }}>מה נעשה באתר עצמו</h2>
          <ul style={{ color: 'var(--text-dim)', lineHeight: 1.9, paddingInlineStart: 20 }}>
            <li>מבנה סמנטי ותמיכה בקוראי מסך</li>
            <li>ניגודיות צבעים העומדת ברמה AA</li>
            <li>אינדיקציית פוקוס ברורה ותמיכה מלאה בניווט מקלדת</li>
            <li>כיבוד הגדרת &quot;הפחתת תנועה&quot; (prefers-reduced-motion) במכשיר</li>
            <li>תמיכה מלאה בעברית, אנגלית וערבית, כולל כיווניות RTL</li>
          </ul>

          {statement.browsersTested && (
            <p style={{ color: 'var(--text-dim)', marginTop: 16 }}>
              <strong>נבדק בדפדפנים: </strong>
              {statement.browsersTested}
            </p>
          )}

          {hasPhysicalNotes && (
            <>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: 24 }}>נגישות פיזית בדוכן</h2>
              {statement.entranceAccess && <p style={{ color: 'var(--text-dim)' }}>{statement.entranceAccess}</p>}
              {statement.restroomAccess && <p style={{ color: 'var(--text-dim)' }}>{statement.restroomAccess}</p>}
              {statement.generalNote && <p style={{ color: 'var(--text-dim)' }}>{statement.generalNote}</p>}
            </>
          )}

          {statement.exemptionNote && (
            <p style={{ color: 'var(--text-dim)', marginTop: 16, fontSize: '0.85rem' }}>{statement.exemptionNote}</p>
          )}

          {hasContact && (
            <>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: 24 }}>פנייה בנושא נגישות</h2>
              <p style={{ color: 'var(--text-dim)' }}>
                {statement.contactName}
                {statement.contactPhone && (
                  <>
                    {' · '}
                    <a href={`tel:${statement.contactPhone}`} className="ltr-isolate" style={{ color: 'var(--neon-2)' }}>
                      {statement.contactPhone}
                    </a>
                  </>
                )}
                {statement.contactEmail && (
                  <>
                    {' · '}
                    <a href={`mailto:${statement.contactEmail}`} className="ltr-isolate" style={{ color: 'var(--neon-2)' }}>
                      {statement.contactEmail}
                    </a>
                  </>
                )}
              </p>
            </>
          )}

          <p style={{ marginTop: 32, fontSize: '0.78rem' }}>
            <a
              href="https://www.gov.il/he/departments/policies/disability_accessibility_regulations"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-faint)' }}
            >
              לתקנות הנגישות הרשמיות באתר הממשלה
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          </p>
        </div>
      </main>
    </PublicBackdrop>
  )
}
