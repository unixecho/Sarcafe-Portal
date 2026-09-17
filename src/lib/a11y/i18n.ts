// Every string the accessibility widget shows, in all three languages the
// site speaks — same house rule as everywhere else: a new user-facing
// string goes into he, en AND ar in the same edit, or it doesn't go in.

import type { Lang } from '@/lib/menu/types'

type Tri = { he: string; en: string; ar: string }

export const A11Y_UI = {
  launcherLabel: { he: 'נגישות', en: 'Accessibility', ar: 'إمكانية الوصول' },
  panelTitle: { he: 'הגדרות נגישות', en: 'Accessibility settings', ar: 'إعدادات إمكانية الوصول' },

  fontScale: { he: 'גודל טקסט', en: 'Text size', ar: 'حجم النص' },
  spacing: { he: 'ריווח טקסט', en: 'Text spacing', ar: 'تباعد النص' },
  contrast: { he: 'ניגודיות', en: 'Contrast', ar: 'التباين' },
  contrastDefault: { he: 'רגיל', en: 'Default', ar: 'افتراضي' },
  contrastHigh: { he: 'ניגודיות גבוהה', en: 'High contrast', ar: 'تباين عالٍ' },
  contrastGrayscale: { he: 'גווני אפור', en: 'Grayscale', ar: 'تدرج رمادي' },
  contrastInvert: { he: 'היפוך צבעים', en: 'Invert colors', ar: 'عكس الألوان' },

  pauseAnimations: { he: 'עצירת אנימציות', en: 'Pause animations', ar: 'إيقاف الحركات' },
  readingGuide: { he: 'סרגל קריאה', en: 'Reading guide', ar: 'دليل القراءة' },
  highlightLinks: { he: 'הדגשת קישורים', en: 'Highlight links', ar: 'إبراز الروابط' },
  highlightHeadings: { he: 'הדגשת כותרות', en: 'Highlight headings', ar: 'إبراز العناوين' },
  bigCursor: { he: 'סמן גדול', en: 'Big cursor', ar: 'مؤشر كبير' },

  reset: { he: 'איפוס הגדרות', en: 'Reset settings', ar: 'إعادة ضبط الإعدادات' },
  close: { he: 'סגירה', en: 'Close', ar: 'إغلاق' },
  statement: { he: 'הצהרת נגישות', en: 'Accessibility statement', ar: 'بيان إمكانية الوصول' },
} satisfies Record<string, Tri>

export type A11yUiKey = keyof typeof A11Y_UI

export function at(key: A11yUiKey, lang: Lang): string {
  return A11Y_UI[key][lang]
}
