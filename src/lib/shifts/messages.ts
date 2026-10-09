// Every refusal the scheduling database or server can give, in plain Hebrew
// that says WHAT went wrong and WHAT TO DO — never a code, a status or "could
// not perform that action". The database returns { ok:false, reason, details };
// dispatch-write.ts turns that into an ApiError whose message is built here, so
// the screen can show it verbatim.

import { formatDayLabel, formatShiftLabel } from './time'

export type Details = Record<string, unknown>

type Clash = { name?: string; with?: { label?: string; date?: string; start?: string; end?: string } }

function clashText(c: Clash | undefined): string {
  const w = c?.with
  if (!w) return ''
  return w.label ?? (w.date && w.start && w.end ? formatShiftLabel(w.date, w.start, w.end) : '')
}

function nameOf(d: Details): string {
  return typeof d.name === 'string' && d.name ? d.name : 'העובד/ת'
}

function conflictsText(d: Details): string {
  const list = Array.isArray(d.conflicts) ? (d.conflicts as Clash[]) : []
  if (list.length === 0) return 'יש התנגשות עם משמרת אחרת. בדקו את השעות ונסו שוב.'
  const lines = list.slice(0, 3).map((c) => `${c.name ?? 'העובד/ת'} כבר משובץ/ת ב${clashText(c)}`)
  const more = list.length > 3 ? ` ועוד ${list.length - 3}` : ''
  return `${lines.join('. ')}${more}. אי אפשר לשבץ אדם בשתי משמרות חופפות — בחרו שעות אחרות או הסירו אותו/ה מהמשמרת השנייה.`
}

const SIMPLE: Record<string, string> = {
  forbidden: 'אין לך הרשאה לבצע את הפעולה הזו.',
  not_found: 'לא מצאנו את מה שחיפשתם — ייתכן שהוא נמחק או שונה בינתיים. רעננו ונסו שוב.',
  stale: 'מישהו אחר עדכן את המשמרת בינתיים, אז לא שמרנו כדי לא לדרוס את השינוי שלו. סגרו, רעננו ונסו שוב.',
  bad_request: 'משהו בפרטים לא תקין. בדקו ונסו שוב.',
  bad_time: 'שעות המשמרת לא תקינות — שעת הסיום חייבת להיות שונה משעת ההתחלה.',
  bad_date: 'התאריך חייב להיות בתוך השבוע שנבחר.',
  not_published: 'הלוח של השבוע הזה עדיין לא פורסם, אז אי אפשר לבקש עליו כלום.',
  past: 'המשמרת כבר התחילה או עברה.',
  not_pending: 'הבקשה כבר טופלה על ידי מישהו אחר.',
  requests_closed: 'הגשת בקשות וזמינות לשבוע הזה נסגרה ביום שלישי בחצות. לשינוי מאוחר פנו למנהל/ת. אפשר עדיין לבקש החלפה בלוח שפורסם.',
  requests_not_open: 'המשמרת הזו לא פתוחה לבקשות הצטרפות. אפשר לבקש החלפה או למסור משמרת שכבר שובצתם אליה.',
  requests_pending: 'טפלו קודם בבקשות העובדים לשבוע הזה. לאחר אישור או דחייה אפשר להשלים את המקומות החסרים.',
  planning_open: 'בקשות העובדים עדיין פתוחות עד יום שלישי בחצות. אפשר לשבץ ידנית עכשיו ולהשלים אוטומטית אחרי סגירת ההגשה.',
  duplicate_request: 'כבר שלחתם בקשה למשמרת הזו. אפשר לראות אותה בלשונית "הבקשות שלי".',
  overlapping_request: 'כבר ביקשתם משמרת בשעות חופפות. בטלו אותה קודם אם אתם רוצים לבקש את זו.',
  duplicate_swap: 'כבר קיימת בקשת החלפה פתוחה על המשמרת הזו.',
  already_assigned: 'כבר משובץ/ת במשמרת הזו.',
  shift_gone: 'המשמרת נמחקה, ולכן הבקשה בוטלה.',
  assignment_changed: 'השיבוץ השתנה מאז שהבקשה נשלחה, ולכן אי אפשר להמשיך איתה. אפשר להגיש בקשה חדשה.',
  bad_target: 'אי אפשר להחליף עם העובד/ת שבחרתם — בחרו מישהו אחר.',
  source_empty: 'בשבוע שממנו מעתיקים אין משמרות.',
  inactive_staff: 'אי אפשר לשבץ עובד/ת שאינו/ה פעיל/ה. אפשר להפעיל אותו/ה מחדש בלשונית "צוות".',
  not_schedulable: 'העובד/ת מוגדר/ת כלא זמין/ה לשיבוץ במשמרות. אפשר לשנות זאת בהגדרות הצוות.',
  wrong_branch: 'העובד/ת הזה/ו משויך/ת לסניף אחר.',
  self: 'אי אפשר לבצע את זה על עצמכם.',
  last_owner: 'לא ניתן להשבית את הבעלים האחרון — לא יהיה מי שינהל את המערכת.',
  is_owner: 'אי אפשר למחוק בעלים. אפשר להשבית אותו/ה במקום.',
  has_history: 'יש לעובד/ת היסטוריה (משמרות, בקשות או הזמנות), ולכן אי אפשר למחוק. אפשר להשבית — ההיסטוריה תישמר.',
  needs_confirmation: 'יש דברים שכדאי לבדוק לפני האישור.',
  rate_limited: 'יותר מדי פעולות בבת אחת — חכו רגע ונסו שוב.',
}

/** The Hebrew sentence for a database refusal. */
export function scheduleMessage(reason: string, details: Details = {}): string {
  switch (reason) {
    case 'conflict':
      return conflictsText(details)
    case 'busy': {
      const who = typeof details.name === 'string' ? details.name : 'את/ה'
      return `${who} כבר משובץ/ת ב${clashText(details as Clash)}. אי אפשר להיות בשתי משמרות חופפות.`
    }
    case 'target_busy':
      return `${nameOf(details)} כבר עובד/ת ב${clashText(details as Clash)}, ולכן אי אפשר להחליף איתו/ה. בחרו מישהו אחר.`
    case 'actor_busy':
      return `אתם כבר משובצים ב${clashText(details as Clash)}, ולכן אי אפשר לקחת את המשמרת התמורה. בחרו משמרת אחרת.`
    case 'target_already_on_shift':
      return `${nameOf(details)} כבר עובד/ת במשמרת הזו.`
    case 'target_not_schedulable':
      return `${nameOf(details)} לא מוגדר/ת כזמין/ה לשיבוץ בסניף הזה.`
    case 'unavailable_day': {
      const date = typeof details.date === 'string' ? details.date : null
      return `סימנתם שאתם לא זמינים${date ? ` ב${formatDayLabel(date)}` : ' ביום הזה'}. עדכנו קודם את הזמינות שלכם בלשונית "זמינות".`
    }
    case 'shift_full':
      return 'המשמרת כבר מאוישת במלואה. אפשר לבקש החלפה עם מי שמשובץ/ת בה.'
    case 'duplicate_person':
      return `${nameOf(details)} מופיע/ה פעמיים ברשימה.`
    case 'inactive_staff':
      return details.name
        ? `${nameOf(details)} אינו/ה פעיל/ה, ולכן אי אפשר לשבץ אותו/ה.`
        : SIMPLE.inactive_staff!
    case 'already_assigned':
      return details.name ? `${nameOf(details)} כבר משובץ/ת במשמרת הזו.` : SIMPLE.already_assigned!
    case 'not_schedulable':
      return details.name ? `${nameOf(details)} מוגדר/ת כלא זמין/ה לשיבוץ במשמרות. אפשר לשנות זאת בהגדרות הצוות.` : SIMPLE.not_schedulable!
    case 'wrong_branch':
      return details.name ? `${nameOf(details)} משויך/ת לסניף אחר.` : SIMPLE.wrong_branch!
    default:
      return SIMPLE[reason] ?? 'הפעולה לא הצליחה. נסו שוב בעוד רגע.'
  }
}

/** The status each refusal travels with over HTTP. */
export function scheduleStatus(reason: string): number {
  switch (reason) {
    case 'forbidden':
      return 403
    case 'not_found':
    case 'shift_gone':
      return 404
    case 'rate_limited':
      return 429
    case 'stale':
    case 'conflict':
    case 'busy':
    case 'target_busy':
    case 'actor_busy':
    case 'not_pending':
    case 'duplicate_request':
    case 'overlapping_request':
    case 'duplicate_swap':
    case 'needs_confirmation':
    case 'assignment_changed':
    case 'shift_full':
    case 'already_assigned':
    case 'has_history':
      return 409
    default:
      return 400
  }
}

/** Confirmable issues a manager must see before approving ({code, message}). */
export function issuesOf(details: Details | undefined): { code: string; message: string }[] {
  const raw = details?.issues
  if (!Array.isArray(raw)) return []
  return raw.filter((i): i is { code: string; message: string } => !!i && typeof (i as { message?: unknown }).message === 'string')
}
