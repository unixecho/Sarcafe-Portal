import { ShieldAlert } from 'lucide-react'
import type { BENEFITS_RETURNS } from '@/lib/identity/invitations'
import BenefitsSignIn from './BenefitsSignIn'

// Signed in, but THIS session is not a proven Google sign-in (FABLE-002 review R1): an employee code, a quick code, or an account
// session opened another way (password, magic link, recovery), even when the account has Google linked. The person is told what is
// needed and offered a fresh Google sign-in that returns to the same page. Nothing here redirects by itself, so a session that keeps
// failing the proof can never bounce between pages; signing out stays in the top bar's menu.
export type ReauthReason = 'employee_code' | 'quick' | 'other'

const TEXT: Record<ReauthReason, string> = {
  employee_code: 'כאן צריך התחברות מלאה עם Google. כניסה עם קוד עובד אינה מספיקה.',
  quick: 'כאן צריך התחברות מלאה עם Google. כניסה עם קוד מהיר אינה מספיקה.',
  other: 'החיבור הנוכחי אינו כניסה מאומתת עם Google (למשל כניסה בסיסמה או בקישור במייל, או חשבון שכתובתו לא אומתה על ידי Google), ולכן אי אפשר לנהל או לאשר כאן. התחברו שוב עם חשבון Google; זה לא משנה שום הרשאה.',
}

export default function BenefitsReauth({ returnTo, reason }: { returnTo: (typeof BENEFITS_RETURNS)[number]; reason: ReauthReason }) {
  return (
    <section className="gl-surf gl-card" role="alert" data-identity="reauth" data-reason={reason}>
      <h2 className="gl-card__title"><ShieldAlert size={18} aria-hidden="true" />צריך להתחבר עם Google</h2>
      <p className="gl-note">{TEXT[reason]}</p>
      <BenefitsSignIn returnTo={returnTo} label="התחברות מחדש עם Google" />
    </section>
  )
}

/** Which reauthentication a refused API call asks for, or null when the refusal is not about the session. */
export const reauthReason = (result: { status: number; code: string }): ReauthReason | null =>
  result.status !== 403 ? null
    : result.code === 'google_session_required' ? 'other'
      : result.code === 'quick_session' ? 'quick'
        : result.code === 'full_session_required' ? 'employee_code'
          : null
