// The employee's first-run tour — the "demo" at the end of the onboarding wizard (2026-10-16). PURE: no React, no Supabase.
// scripts/check-onboarding-wizard.mjs runs this file.
//
// Modelled on the Ayeka Bar tour: a miniature of the real home screen on top, the row each slide is about lit, the words
// below. Each slide that is about a row of the home screen carries that row's id; the check compares the labels here with
// the real screen (EmployeeDashboardView) so the miniature cannot drift from it. Hebrew only, like the rest of staff.

export type TourRowId = 'shift' | 'orders' | 'events' | 'profile'

/** The rows of the home screen the tour shows, in the order the screen has them. `he` equals the real row's label. */
export const TOUR_ROWS: readonly { id: TourRowId; he: string }[] = [
  { id: 'shift', he: 'המשמרת הבאה שלך' },
  { id: 'orders', he: 'הזמנות מהירות' },
  { id: 'events', he: 'קופת אירועים ועמדות' },
  { id: 'profile', he: 'הפרופיל שלי' },
]

export interface TourSlide {
  key: 'overview' | 'checklists' | 'schedule' | 'orders' | 'profile' | 'alerts'
  /** the row to light in the miniature; null = the whole screen (overview) or none (alerts) */
  row: TourRowId | null
  title: string
  lead: string
  points: readonly string[]
}

export const TOUR_SLIDES: readonly TourSlide[] = [
  {
    key: 'overview', row: null,
    title: 'זה אזור הצוות שלכם',
    lead: 'כל מה שצריך למשמרת במקום אחד. נעבור על זה בקצרה, כדקה.',
    points: [
      'למעלה: עדכונים והתראות שמחכים לכם.',
      'מתחת: כרטיס המשמרת. ממנו נכנסים לצ׳קליסט כשהמשמרת פעילה, ולסידור ולאילוצים.',
      'מנהלים רואים כאן גם כלי ניהול, לפי התפקיד.',
    ],
  },
  {
    key: 'checklists', row: 'shift',
    title: 'צ׳קליסטים למשמרת',
    lead: 'פתיחה, החלפת משמרת וסגירה. הכפתורים בכרטיס המשמרת, וכל צ׳קליסט נפתח בזמן שלו.',
    points: [
      'פתיחה והחלפה נפתחות כשהמשמרת מתחילה. סגירה נפתחת חצי שעה לפני הסוף.',
      'אם שניים עובדים באותה משמרת, אחד ממלא וזה מספיק. המנהל/ת יכולים לבחור מי.',
      'מה שלא תקין (חסר, מקולקל) מסמנים בצ׳קליסט, וזה מגיע ישר לבעלים.',
    ],
  },
  {
    key: 'schedule', row: 'shift',
    title: 'משמרות ואילוצים',
    lead: 'לוחצים על כרטיס המשמרת: הסידור שפורסם, ומה שלא מתאים לכם בשבוע הבא.',
    points: [
      'בכל יום בוחרים אחד: לא יכול/ה משמרת בוקר, לא יכול/ה משמרת ערב, או יום חופש כל היום.',
      'המנהל/ת קובעים כמה ימי חופש אפשר לבקש בשבוע (בדרך כלל 2). יום חופש מחכה לאישור שלהם.',
      'אפשר להוסיף הערה למנהל/ת, ולבקש להחליף משמרת עם עמית/ה.',
      'ההגשה לשבוע הבא נסגרת ביום שלישי בחצות.',
    ],
  },
  {
    key: 'orders', row: 'orders',
    title: 'הזמנות וקופת אירועים',
    lead: 'מה שעובדים איתו בזמן שירות.',
    points: [
      'הזמנות מהירות: מקבלים הזמנות מלקוחות ומעקב בזמן אמת.',
      'קופת אירועים: העמדה שבה עובדים באירוע, עם הקוד האישי שלכם.',
    ],
  },
  {
    key: 'profile', row: 'profile',
    title: 'הפרופיל שלי',
    lead: 'הפרטים שלכם, תלושי השכר והקוד האישי.',
    points: [
      'צופים בתלושי שכר ישר באפליקציה, ומורידים כמה ביחד.',
      'מחליפים קוד אישי, ומקשרים חשבון Google אם עוד לא.',
      'רק אתם והנהלה רואים את התלושים שלכם.',
    ],
  },
  {
    key: 'alerts', row: null,
    title: 'ההתראות פעילות',
    lead: 'כך תדעו על שינוי בסידור, על צ׳קליסט שמחכה ועל בקשת החלפה, גם כשהטלפון נעול.',
    points: [
      'אפשר לשלוח לעצמכם התראת בדיקה כאן למטה, כדי לראות איך זה נראה.',
      'בסיום תגיעו ישר לאזור הצוות.',
    ],
  },
]

export const clampSlide = (i: number): number => Math.max(0, Math.min(TOUR_SLIDES.length - 1, Math.trunc(Number.isFinite(i) ? i : 0)))
export const isLastSlide = (i: number): boolean => clampSlide(i) === TOUR_SLIDES.length - 1
