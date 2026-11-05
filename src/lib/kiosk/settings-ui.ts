import type { KioskDeviceSettings } from '@/lib/kiosk/device-settings'

// How each tablet setting is shown on the kiosk dashboard (/owner/kiosk/control): the same words as the tablet's own control panel
// (prototypes/sarcafe-kiosk-app/overrides/kiosk-admin.js), so the owner reads one vocabulary in both places. The bounds themselves
// are SETTINGS_SPEC (device-settings.ts): the server checks every save against it.

export type SettingUi =
  | { kind: 'bool'; label: string; hint?: string }
  | { kind: 'enum'; label: string; hint?: string; options: [string, string][] }
  | { kind: 'int'; label: string; hint?: string; step: number; unit: string; nullable?: string }
  | { kind: 'langs'; label: string; hint?: string }

type Section = { [S in keyof KioskDeviceSettings]: { title: string; hint?: string; fields: Partial<Record<keyof KioskDeviceSettings[S], SettingUi>> } }

export const LANG_NAMES: Record<string, string> = { he: 'עברית', en: 'English', ar: 'العربية' }

export const SETTINGS_UI: Section = {
  display: {
    title: 'מה מוצג בכותרת ובמסך הפתיחה',
    fields: {
      showEmployees: { kind: 'bool', label: 'להציג מי במשמרת', hint: 'שמות פרטיים בלבד, מהמשמרות שפורסמו.' },
      showClosing: { kind: 'bool', label: 'להציג מתי סוגרים', hint: 'כתוב "סגירה ב־" והשעה.' },
      closingSource: { kind: 'enum', label: 'מאיפה לקחת את שעת הסגירה', options: [['shift_then_hours', 'משמרת, ואחרת שעות'], ['shift', 'סוף המשמרת'], ['hours', 'שעות הפעילות']] },
      showBranch: { kind: 'bool', label: 'להציג את שם הסניף' },
      showItemCount: { kind: 'bool', label: 'להציג את מספר הפריטים בתפריט', hint: 'בכותרת, כשאין מקום למשמרת.' },
      showCredit: { kind: 'bool', label: 'שורת "פרויקט שנוצר ביוזמת ג׳ון"', hint: 'מתחת למסך הפתיחה.' },
      clubEnabled: { kind: 'bool', label: 'להציג את מועדון הלקוחות', hint: 'כבוי: אין הרשמה בקיוסק.' },
    },
  },
  ads: {
    title: 'מודעות',
    fields: {
      arrows: { kind: 'bool', label: 'חצים בצדדים' },
      swipe: { kind: 'bool', label: 'החלקה עם האצבע' },
      autoPlay: { kind: 'bool', label: 'מעבר אוטומטי', hint: 'כבוי: נשארים על המודעה עד שנוגעים.' },
      loop: { kind: 'bool', label: 'להמשיך בסיבוב', hint: 'אחרי האחרונה חוזרים לראשונה, ולהפך.' },
      transition: { kind: 'enum', label: 'איך עוברים בין מודעות', options: [['slide', 'החלקה'], ['fade', 'מעבר הדרגתי']] },
      tapAction: { kind: 'enum', label: 'מה קורה בלחיצה על מודעה', options: [['ad', 'הפעולה של המודעה'], ['main', 'תמיד המסך הראשי']] },
      slideSeconds: { kind: 'int', label: 'כמה זמן כל מודעה', step: 1, unit: 'שנ׳', nullable: 'לפי הסניף' },
    },
  },
  timing: {
    title: 'זמנים',
    fields: {
      idleSeconds: { kind: 'int', label: 'זמן בלי פעילות עד האזהרה', step: 10, unit: 'שנ׳', nullable: 'לפי הסניף' },
      graceSeconds: { kind: 'int', label: 'זמן האזהרה "עדיין כאן?"', step: 5, unit: 'שנ׳', nullable: 'לפי הסניף' },
      successSeconds: { kind: 'int', label: 'כמה זמן מסך האישור נשאר', hint: 'אחרי הרשמה.', step: 5, unit: 'שנ׳' },
      contentRefreshMinutes: { kind: 'int', label: 'כל כמה זמן לרענן מודעות והגדרות', step: 5, unit: 'דק׳' },
    },
  },
  language: {
    title: 'שפות',
    fields: {
      enabled: { kind: 'langs', label: 'שפות פעילות', hint: 'שפת ברירת המחדל חייבת להיות פעילה.' },
      default: { kind: 'enum', label: 'שפת ברירת המחדל', hint: 'הקיוסק מתחיל בה וחוזר אליה אחרי כל ביקור.', options: [['he', 'עברית'], ['en', 'English'], ['ar', 'العربية']] },
      showSwitch: { kind: 'bool', label: 'להציג את מתג השפות' },
    },
  },
  battery: {
    title: 'סוללה והתראות למפתח',
    hint: 'ההתראה נשלחת למפתח בלבד, רק כשהטאבלט לא בטעינה: ברמה שנקבעה ובכל ירידה של 5% מתחתיה.',
    fields: {
      display: { kind: 'enum', label: 'איפה הטעינה מוצגת לצוות', options: [['tray', 'מגירה מלמעלה'], ['corner', 'תג בפינה'], ['hidden', 'מוסתר']] },
      alertEnabled: { kind: 'bool', label: 'להתריע כשהטעינה יורדת' },
      alertPercent: { kind: 'int', label: 'להתחיל להתריע מ־', step: 5, unit: '%' },
      criticalEnabled: { kind: 'bool', label: 'התראה דחופה נוספת' },
      criticalPercent: { kind: 'int', label: 'התראה דחופה מתחת ל־', step: 5, unit: '%' },
    },
  },
}
