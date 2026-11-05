// The tool index: every page and action a person can reach from the home screen, what people call it, and who may see it.
// PURE (no React, no icons, no Supabase): the finder, the shortcuts, the API that records use and scripts/check-tools.mjs read it.
// The routes are the real ones; `roles` mirrors the access rules in src/middleware.ts (OP_ONLY / MENU_EDITOR / STAFF prefixes):
//   op       an owner (isOp)                         — every /owner page
//   manager  owner or general manager                — the menu-editor pages and the manager's schedule
//   staff    anyone signed in to the staff app      — their own shifts, checklists, profile
//   dev      the developer (badge 'developer')       — the developer's tools
// An entry is shown when the person has ANY of its roles. Never offer a page the person would be refused at.

export type ToolRole = 'op' | 'manager' | 'staff' | 'dev'
export type ToolAction = 'compose' | 'look' | 'push' | 'signout'
export type ToolEntry = {
  id: string
  label: string
  hint: string
  href: string
  group: string
  roles: ToolRole[]
  kind: 'page' | 'action'
  keywords: string[]
  /** more relevant at the start / the end of the day */
  ctx?: 'morning' | 'evening'
  /** how common it is for its roles (0-10): the order before there is any history */
  base?: number
  action?: ToolAction
  /** shown in the lists but not open yet ("בקרוב"); never offered by the finder */
  soon?: string
}

const OP: ToolRole[] = ['op']
const MGR: ToolRole[] = ['op', 'manager']
// A person's own shift tools (their shifts, checklists, payslip): employees and general managers (who also have 'staff'), not owners.
const STAFF: ToolRole[] = ['staff']
const ALL: ToolRole[] = ['op', 'manager', 'staff']
const DEV: ToolRole[] = ['dev']

export const TOOLS: ToolEntry[] = [
  // ── הצוות והמשמרות
  { id: 'staff-list', label: 'העובדים שלי', hint: 'קליטה, קישורי הצטרפות, היסטוריה ותלושי שכר', href: '/owner/staff', group: 'הצוות והמשמרות', roles: OP, kind: 'page', base: 6, keywords: ['עובדים', 'צוות', 'קליטה', 'הצטרפות', 'תלוש', 'שכר', 'עובד חדש', 'staff', 'employees', 'payroll'] },
  { id: 'add-staff', label: 'הוספת עובד חדש', hint: 'שליחת קישור הצטרפות לעובד', href: '/owner/staff', group: 'הצוות והמשמרות', roles: OP, kind: 'action', base: 3, keywords: ['קליטה', 'עובד חדש', 'קישור הצטרפות', 'גיוס', 'הזמנה', 'invite'] },
  { id: 'schedule-manage', label: 'סידור עבודה', hint: 'אילוצים, שיבוצים ואישור החלפות', href: '/owner/schedule', group: 'הצוות והמשמרות', roles: MGR, kind: 'page', base: 10, keywords: ['משמרות', 'שיבוץ', 'אילוצים', 'החלפה', 'לוח', 'סידור', 'שבוע', 'rota', 'schedule', 'shifts'] },
  { id: 'approve-swap', label: 'אישור בקשות החלפה וחופש', hint: 'בקשות שמחכות להחלטה של מנהל', href: '/owner/schedule?tab=requests', group: 'הצוות והמשמרות', roles: MGR, kind: 'action', base: 5, keywords: ['החלפה', 'לאשר', 'חופש', 'בקשה', 'בקשות', 'אישור', 'swap', 'approve', 'time off'] },
  { id: 'checklists-track', label: 'צ׳קליסטים ודיווחים', hint: 'מעקב משמרות ודיווחים. הטפסים עצמם בניהול הסניף', href: '/owner/checklists', group: 'הצוות והמשמרות', roles: OP, kind: 'page', base: 7, ctx: 'evening', keywords: ['רשימה', 'פתיחה', 'סגירה', 'מי הגיש', 'דיווח', 'checklist'] },
  { id: 'compose', label: 'הודעה לצוות או למשמרת', hint: 'התראה לכולם, למשמרת מסוימת או לעובד אחד', href: '/staff#team-message', group: 'הצוות והמשמרות', roles: MGR, kind: 'action', base: 5, action: 'compose', keywords: ['הודעה', 'התראה', 'שלח', 'להודיע', 'משלוח', 'משלוח חלב', 'מגיע משלוח', 'עדכון לצוות', 'תזכורת לצוות', 'ישיבה', 'להגיע מוקדם', 'notify', 'broadcast', 'message'] },
  { id: 'on-shift', label: 'מי במשמרת עכשיו', hint: 'המשמרת הקודמת, הנוכחית והבאה בכל סניף', href: '/staff/schedule', group: 'הצוות והמשמרות', roles: ALL, kind: 'page', base: 7, keywords: ['מי עובד', 'מי איתי', 'משמרת עכשיו', 'מי פה', 'on shift'] },
  // ── שירות והזמנות
  { id: 'issues', label: 'חוסרים ופערים', hint: 'מה חסר, מה לא עובד ומה לא הוגש בסניף', href: '/owner/issues', group: 'שירות והזמנות', roles: MGR, kind: 'page', base: 8, ctx: 'morning', keywords: ['חסר', 'תקלה', 'שבור', 'מלאי', 'חוסר', 'לא עובד', 'issues', 'shortage'] },
  { id: 'pos-quick', label: 'הזמנות מהירות', hint: 'קבלת הזמנות ומעקב בזמן אמת', href: '/staff/pos', group: 'שירות והזמנות', roles: MGR, kind: 'page', base: 6, keywords: ['הזמנה', 'קופה', 'לקוח', 'order', 'pos'] },
  { id: 'pos-events', label: 'ניהול קופת אירועים', hint: 'עמדות, הזמנות ופעילות באירוע', href: '/owner/pos', group: 'שירות והזמנות', roles: MGR, kind: 'page', base: 3, keywords: ['אירוע', 'פסטיבל', 'עמדה', 'קופה', 'event'] },
  { id: 'tablet-avail', label: 'זמינות פריטים', hint: 'עדכון המלאי במהלך השירות', href: '/owner/tablet', group: 'שירות והזמנות', roles: MGR, kind: 'page', base: 8, keywords: ['אזל', 'מלאי', 'זמין', 'פריט', 'טאבלט', 'נגמר', 'stock', 'sold out', 'availability'] },
  { id: 'mark-soldout', label: 'סימון פריט כאזל', hint: 'להוריד פריט מהתפריט עד שיחזור למלאי', href: '/owner/tablet', group: 'שירות והזמנות', roles: MGR, kind: 'action', base: 6, keywords: ['אזל', 'נגמר', 'הורדה מהתפריט', 'אין', 'חלב', 'קרואסון', 'sold out'] },
  { id: 'pos-soon', label: 'הזמנות מהירות', hint: 'קבלת הזמנות ומעקב בזמן אמת', href: '/staff/pos', group: 'במהלך השירות', roles: ['staff'], kind: 'page', soon: 'בקרוב · בפיתוח', keywords: [] },
  { id: 'my-pos', label: 'קופת אירועים ועמדות', hint: 'הזמנות האירוע והעמדה שבה עובדים', href: '/pos', group: 'במהלך השירות', roles: ['staff'], kind: 'page', soon: 'בפסטיבל הבא :)', keywords: [] },
  // ── תפריט והעסק
  { id: 'menu-editor', label: 'התפריט שלי', hint: 'פריטים, מחירים ופרסום שינויים', href: '/owner/editor', group: 'תפריט והעסק', roles: MGR, kind: 'page', base: 7, keywords: ['תפריט', 'מחיר', 'פריט', 'קטגוריה', 'מנה', 'שתייה', 'menu', 'price'] },
  { id: 'publish-menu', label: 'פרסום שינויים בתפריט', hint: 'לקוחות רואים את הגרסה החדשה אחרי הפרסום', href: '/owner/editor', group: 'תפריט והעסק', roles: MGR, kind: 'action', base: 6, keywords: ['פרסם', 'טיוטה', 'עדכון תפריט', 'לפרסם', 'publish', 'draft'] },
  { id: 'reviews', label: 'ביקורות', hint: 'חוויות שהלקוחות משתפים', href: '/owner/reviews', group: 'תפריט והעסק', roles: MGR, kind: 'page', base: 4, keywords: ['גוגל', 'ביקורת', 'כוכבים', 'דירוג', 'review', 'rating'] },
  { id: 'feedback', label: 'משוב מלקוחות', hint: 'הודעות והצעות לשיפור', href: '/owner/feedback', group: 'תפריט והעסק', roles: OP, kind: 'page', base: 5, keywords: ['הצעה', 'תלונה', 'הודעה מלקוח', 'פידבק', 'feedback'] },
  { id: 'waitlist', label: 'נרשמים למועדון', hint: 'מי נרשם בקיוסק או באתר, בהסכמתו', href: '/owner/waitlist', group: 'תפריט והעסק', roles: OP, kind: 'page', base: 4, keywords: ['מועדון', 'מתעניינים', 'נרשם', 'ליד', 'חברי מועדון', 'loyalty', 'waitlist', 'signup'] },
  { id: 'export-waitlist', label: 'ייצוא נרשמים לקובץ', hint: 'הורדת רשימת הנרשמים כקובץ CSV', href: '/owner/waitlist', group: 'תפריט והעסק', roles: OP, kind: 'action', base: 1, keywords: ['csv', 'אקסל', 'ייצוא', 'הורדה', 'קובץ', 'excel', 'export'] },
  { id: 'kiosk', label: 'תוכן הקיוסק', hint: 'הכרטיסים, הזמנים, ימים חריגים והטאבלטים', href: '/owner/kiosk', group: 'תפריט והעסק', roles: OP, kind: 'page', base: 4, keywords: ['קיוסק', 'טאבלט לקוחות', 'מודעה', 'פרסומת', 'שעות פתיחה', 'יום חריג', 'סוללה', 'kiosk'] },
  { id: 'kiosk-poll', label: 'תוצאות סקר הלקוחות', hint: 'הצבעות מקוד ה־QR, כוכבים והצעות כתובות', href: '/owner/kiosk/feedback', group: 'תפריט והעסק', roles: OP, kind: 'page', base: 3, keywords: ['סקר', 'הצבעה', 'qr', 'כוכבים', 'poll', 'survey'] },
  { id: 'links', label: 'קישורים ושיתוף', hint: 'הפורטל, תפריטים וקודי QR', href: '/owner/links', group: 'תפריט והעסק', roles: MGR, kind: 'page', base: 3, keywords: ['qr', 'קוד', 'פורטל', 'קישור', 'שיתוף', 'אינסטגרם', 'waze', 'link'] },
  { id: 'audit', label: 'יומן פעילות', hint: 'שינויים שבוצעו במערכת', href: '/owner/audit', group: 'תפריט והעסק', roles: MGR, kind: 'page', base: 2, keywords: ['שינויים', 'היסטוריה', 'מי שינה', 'לוג', 'audit', 'log'] },
  { id: 'intro', label: 'מסך פתיחה', hint: 'הדלקה וכיבוי, והשורות שמופיעות', href: '/owner/intro', group: 'תפריט והעסק', roles: OP, kind: 'page', base: 1, keywords: ['פתיחה', 'אנימציה', 'splash', 'intro'] },
  { id: 'a11y', label: 'נגישות', hint: 'הצהרת הנגישות של העסק', href: '/owner/accessibility', group: 'תפריט והעסק', roles: OP, kind: 'page', base: 1, keywords: ['הצהרת נגישות', 'תקנות', 'נגיש', 'accessibility'] },
  { id: 'branches', label: 'ניהול סניפים', hint: 'הגדרות, צ׳קליסטים וצוות לכל סניף', href: '/owner/branches', group: 'תפריט והעסק', roles: OP, kind: 'page', base: 5, keywords: ['סניף', 'הוספת סניף', 'גבעת חביבה', 'מאור', 'עגלה', 'branch'] },
  // ── המשמרת שלי
  { id: 'my-schedule', label: 'משמרות ובקשות', hint: 'מתי אני עובד, אילוצים והחלפות', href: '/staff/schedule', group: 'המשמרת שלי', roles: STAFF, kind: 'page', base: 10, keywords: ['משמרת', 'מתי אני עובד', 'סידור', 'לוח', 'משמרות', 'שבוע', 'schedule', 'my shifts'] },
  { id: 'constraints', label: 'הגשת אילוצים', hint: 'ימים ושעות שאי אפשר לעבוד בהם', href: '/staff/schedule?tab=availability', group: 'המשמרת שלי', roles: STAFF, kind: 'action', base: 6, keywords: ['אילוץ', 'חופש', 'יום חופש', 'בקשת חופש', 'לא יכול', 'זמינות', 'חופשה', 'availability', 'time off'] },
  { id: 'swap', label: 'בקשת החלפת משמרת', hint: 'לבקש מעמית להחליף איתי', href: '/staff/schedule?tab=requests', group: 'המשמרת שלי', roles: STAFF, kind: 'action', base: 6, keywords: ['החלפה', 'להחליף', 'מחליף', 'לא יכול להגיע', 'swap', 'cover'] },
  { id: 'checklist-open', label: 'צ׳קליסט פתיחה', hint: 'בדיקות לפני שפותחים את העגלה', href: '/staff/checklists', group: 'המשמרת שלי', roles: STAFF, kind: 'action', base: 8, ctx: 'morning', keywords: ['פתיחה', 'בוקר', 'רשימה', 'opening', 'checklist'] },
  { id: 'checklist-close', label: 'צ׳קליסט סגירה', hint: 'בדיקות לפני שסוגרים ומסירה למשמרת הבאה', href: '/staff/checklists', group: 'המשמרת שלי', roles: STAFF, kind: 'action', base: 8, ctx: 'evening', keywords: ['סגירה', 'ערב', 'מסירה', 'סוף משמרת', 'closing', 'handover'] },
  { id: 'report-issue', label: 'דיווח על תקלה או חוסר', hint: 'מכונה שבורה, חומר שנגמר, משהו שצריך טיפול', href: '/staff/checklists', group: 'המשמרת שלי', roles: STAFF, kind: 'action', base: 5, keywords: ['תקלה', 'שבור', 'נגמר', 'חסר', 'דווח', 'מכונה', 'report', 'broken'] },
  { id: 'workshop', label: 'סדנת קפה מקצועית', hint: 'מדריך לעובדי עגלות הקפה', href: '/staff/workshop', group: 'לימוד והחשבון', roles: ALL, kind: 'page', base: 3, keywords: ['הדרכה', 'קפה', 'אספרסו', 'מצגת', 'למידה', 'workshop', 'barista', 'training'] },
  // ── החשבון
  { id: 'profile', label: 'הפרופיל שלי', hint: 'פרטי חשבון, קוד כניסה והיסטוריה אישית', href: '/staff/profile', group: 'לימוד והחשבון', roles: ALL, kind: 'page', base: 4, keywords: ['חשבון', 'פרטים', 'שם', 'טלפון', 'אימייל', 'גוגל', 'profile', 'account'] },
  { id: 'payslip', label: 'התלוש שלי', hint: 'תלושי שכר לפי חודש', href: '/staff/profile', group: 'לימוד והחשבון', roles: STAFF, kind: 'action', base: 5, keywords: ['תלוש', 'שכר', 'משכורת', 'payslip', 'salary'] },
  { id: 'login-code', label: 'קוד הכניסה שלי', hint: 'קוד בן שש ספרות לכניסה בלי גוגל', href: '/staff/profile', group: 'לימוד והחשבון', roles: STAFF, kind: 'action', base: 2, keywords: ['קוד', 'סיסמה', 'כניסה', 'לא מצליח להיכנס', 'pin', 'password'] },
  { id: 'look', label: 'מראה האפליקציה', hint: 'ניאון, זכוכית, קרמה ועוד', href: '/staff/profile', group: 'לימוד והחשבון', roles: ALL, kind: 'action', base: 2, action: 'look', keywords: ['ערכת נושא', 'כהה', 'בהיר', 'זכוכית', 'עיצוב', 'צבעים', 'theme', 'dark', 'light'] },
  { id: 'push', label: 'התראות לטלפון', hint: 'משמרות, חוסרים והודעות גם כשהאפליקציה סגורה', href: '/staff/profile', group: 'לימוד והחשבון', roles: ALL, kind: 'action', base: 3, action: 'push', keywords: ['התראה', 'הודעות', 'פוש', 'צלצול', 'notifications', 'push', 'alerts'] },
  { id: 'signout', label: 'התנתקות', hint: 'יציאה מהחשבון במכשיר הזה', href: '/login', group: 'לימוד והחשבון', roles: ALL, kind: 'action', base: 1, action: 'signout', keywords: ['יציאה', 'לצאת', 'להתנתק', 'logout', 'sign out'] },
  // ── מפתח
  { id: 'dev-mode', label: 'מצב מפתח', hint: 'בדיקות, בריאות המערכת וכלי מפתח', href: '/staff/dev?view=dev', group: 'כלי מפתח', roles: DEV, kind: 'page', base: 5, keywords: ['בדיקות', 'בריאות', 'מפתח', 'dev', 'debug', 'health'] },
  { id: 'qa-review', label: 'סקירת QA של הבוקר', hint: 'תוצאות הבדיקות האוטומטיות, אבטחה ועמידות', href: '/staff/dev/qa', group: 'כלי מפתח', roles: DEV, kind: 'page', base: 6, ctx: 'morning', keywords: ['qa', 'בדיקות', 'טסטים', 'אבטחה', 'רגרסיה', 'דוח', 'tests', 'report'] },
  { id: 'dev-alerts', label: 'מרכז ההתראות', hint: 'כל ההתראות של החשבון, לפי סוג', href: '/staff/dev?view=alerts', group: 'כלי מפתח', roles: DEV, kind: 'page', base: 3, keywords: ['התראות', 'בדיקת התראה', 'push test', 'alerts'] },
]

export const TOOL_IDS = new Set(TOOLS.map((t) => t.id))
export const toolById = (id: string) => TOOLS.find((t) => t.id === id)

/** The roles of one person, from the same facts the guards use. */
export function toolRolesFor(person: { op: boolean; manager: boolean; developer: boolean }): ToolRole[] {
  const roles: ToolRole[] = person.op ? ['op', 'manager'] : person.manager ? ['manager', 'staff'] : ['staff']
  if (person.developer) roles.push('dev')
  return roles
}
export const toolVisible = (entry: ToolEntry, roles: readonly ToolRole[]) => entry.roles.some((r) => roles.includes(r))

/** The home screen's tool lists per kind of home, in the order of the existing dashboards. */
export const HOME_TOOL_GROUPS: Record<'owner' | 'manager' | 'employee' | 'dev', { title: string; ids: string[] }[]> = {
  owner: [
    { title: 'הצוות והמשמרות', ids: ['staff-list', 'schedule-manage', 'checklists-track'] },
    { title: 'שירות והזמנות', ids: ['pos-quick', 'pos-events', 'tablet-avail'] },
    { title: 'תפריט והעסק', ids: ['menu-editor', 'reviews', 'feedback', 'waitlist', 'kiosk', 'links', 'audit', 'intro', 'a11y'] },
  ],
  manager: [
    { title: 'ניהול במשמרת', ids: ['schedule-manage', 'issues', 'menu-editor', 'tablet-avail', 'pos-events'] },
    { title: 'המשמרת שלי', ids: ['my-schedule', 'constraints', 'swap', 'checklist-open', 'checklist-close'] },
    { title: 'לימוד והחשבון', ids: ['workshop', 'payslip', 'profile'] },
  ],
  employee: [
    { title: 'המשמרת שלי', ids: ['my-schedule', 'constraints', 'swap', 'checklist-open', 'checklist-close', 'report-issue'] },
    { title: 'במהלך השירות', ids: ['pos-soon', 'my-pos'] },
    { title: 'לימוד והחשבון', ids: ['workshop', 'payslip', 'profile'] },
  ],
  dev: [
    { title: 'כלי מפתח', ids: ['qa-review', 'dev-mode', 'dev-alerts'] },
  ],
}
