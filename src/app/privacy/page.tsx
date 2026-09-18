import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { readSetting } from '@/lib/settings/server'
import { DEFAULT_ACCESSIBILITY_STATEMENT, type AccessibilityStatement } from '@/lib/settings/keys'
import PublicBackdrop from '@/components/PublicBackdrop'

export const metadata = { title: 'Sarcafe | מדיניות פרטיות' }
// Data-fetching (readSetting → Supabase) at request time, not build time —
// matches every other data-backed route in this app. /accessibility is the
// one exception (ISR); this page skips that path rather than depend on it.
export const dynamic = 'force-dynamic'

// Every claim below describes what this codebase actually does — no
// data path is mentioned here that doesn't have a real counterpart in
// the app (the branch cookie, the feedback route's own "no IP stored"
// comment, order_access's hash-only storage, order_push_subscriptions'
// lifecycle). Reuses the same business contact the accessibility
// statement already collects (owner-set via /owner/accessibility)
// rather than inventing a second contact field for privacy inquiries.
export default async function PrivacyPolicyPage() {
  const statement = await readSetting<AccessibilityStatement>('accessibility_statement', DEFAULT_ACCESSIBILITY_STATEMENT)
  const hasContact = statement.contactName || statement.contactPhone || statement.contactEmail

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
            מדיניות פרטיות
          </h1>

          <p className="rise" style={{ color: 'var(--text-dim)', lineHeight: 1.7, animationDelay: delay() }}>
            המדיניות הזו מסבירה אילו מידע האתר של Sarcafe אוסף, למה, ולכמה זמן — בלשון פשוטה, בלי ז&quot;רגון משפטי
            מיותר.
          </p>

          <h2 style={sectionTitle}>מה אנחנו אוספים</h2>
          <ul style={list}>
            <li>
              <strong>גלישה בפורטל ובתפריט:</strong> לא נאסף שום מידע מזהה. אין קובצי Cookie למעקב או פרסום — רק
              עוגייה טכנית אחת שזוכרת איזה סניף בחרתם, כדי שלא תצטרכו לבחור מחדש בכל ביקור.
            </li>
            <li>
              <strong>&quot;הרשימה שלי&quot; בתפריט:</strong> הרשימה שאתם בונים כדי להראות לצוות מה בא לכם — נשמרת רק
              בדפדפן שלכם (במכשיר שלכם), לא נשלחת לשרת שלנו בשום שלב, ונמחקת מעצמה אחרי כמה שעות.
            </li>
            <li>
              <strong>טופס משוב:</strong> ההודעה שכתבתם, כתובת מייל ליצירת קשר אם בחרתם להשאיר אחת (זה תמיד
              אופציונלי), והעמוד שממנו נשלח המשוב. כתובת ה-IP שלכם משמשת לרגע אחד למניעת ספאם ואינה נשמרת.
            </li>
            <li>
              <strong>הזמנות בקופה:</strong> כשצוות המשאית פותח לכם הזמנה, נשמרים פרטי ההזמנה (פריטים, מחיר, שם
              ללקוח אם ניתן) — אין הרשמה, אין חשבון לקוח, ואין צורך במספר טלפון או מייל כדי להזמין.
            </li>
            <li>
              <strong>מעקב הזמנה (QR / קוד שחזור):</strong> הקוד שמודפס על הקבלה שלכם והקישור שב-QR נשמרים אצלנו
              רק כ&quot;טביעת אצבע&quot; מוצפנת (hash) — כלומר, גם אנחנו לא יכולים לשחזר מהמסד שלנו את הקוד עצמו.
              הגישה פגה אוטומטית תוך שעות ספורות.
            </li>
          </ul>

          <h2 style={sectionTitle}>הוספה למסך הבית והתראות</h2>
          <p style={{ color: 'var(--text-dim)', lineHeight: 1.7 }}>
            בעמוד מעקב ההזמנה תוצע לכם אפשרות להפעיל התראה שתשלח כשההזמנה מוכנה. זו בחירה מלאה שלכם — הדפדפן שלכם
            הוא שמבקש את האישור, לא האתר, ואפשר לבטל בכל רגע. באייפון, הפעלת התראות דורשת קודם להוסיף את העמוד
            למסך הבית (מגבלה של אפל, לא בחירה שלנו) — זה גם מה שהופך את השימוש לתחושה נעימה יותר של אפליקציה, לא
            רק אתר.
          </p>
          <p style={{ color: 'var(--text-dim)', lineHeight: 1.7 }}>
            אם תפעילו התראות, נשמר &quot;מנוי התראות&quot; טכני (לא מידע מזהה אישי) המקושר רק להזמנה הספציפית שלכם,
            ומשמש אך ורק כדי לעדכן שההזמנה שלכם מוכנה — לא לשיווק ולא למעקב. המנוי נמחק אוטומטית לאחר שתוקף המעקב
            להזמנה פג.
          </p>

          <h2 style={sectionTitle}>מי רואה את המידע</h2>
          <p style={{ color: 'var(--text-dim)', lineHeight: 1.7 }}>
            צוות Sarcafe, לצורך הכנת ההזמנה שלכם בלבד, וספקי התשתית שמפעילים את האתר עבורנו (אחסון מסד הנתונים
            ואירוח האתר). אנחנו לא מוכרים ולא משתפים מידע עם צדדים שלישיים לצורכי שיווק.
          </p>

          <h2 style={sectionTitle}>הזכויות שלכם</h2>
          <p style={{ color: 'var(--text-dim)', lineHeight: 1.7 }}>
            בהתאם לחוק הגנת הפרטיות, תשמ״א-1981, ניתן לפנות אלינו בכל שאלה על המידע שנשמר עליכם, כולל בקשה לעיין
            בו או למחוק אותו במידה שניתן.
          </p>

          {hasContact && (
            <>
              <h2 style={sectionTitle}>יצירת קשר</h2>
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

          <h2 style={sectionTitle}>עדכונים למדיניות</h2>
          <p style={{ color: 'var(--text-dim)', lineHeight: 1.7 }}>
            ייתכן שנעדכן את המדיניות הזו מדי פעם ככל שהשירות מתפתח. שינויים מהותיים יפורסמו בעמוד הזה.
          </p>

          <p style={{ marginTop: 24, fontSize: '0.78rem', color: 'var(--text-faint)' }}>עודכן לאחרונה: ספטמבר 2026</p>
        </div>
      </main>
    </PublicBackdrop>
  )
}

const sectionTitle = { fontSize: '1.05rem', fontWeight: 700, marginTop: 24 } as const
const list = { color: 'var(--text-dim)', lineHeight: 1.9, paddingInlineStart: 20, display: 'flex', flexDirection: 'column', gap: 10 } as const
