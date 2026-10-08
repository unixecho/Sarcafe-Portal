// The words of the intro, in the site's three languages. Pure — safe on server
// and client; exercised by scripts/check-intro.mjs.
//
// TEN LINES, one per visit. A visit plays a different one from the last (see
// pickLine in config.ts), so a regular who refreshes the portal every morning is
// not read the same sentence every time. LINE ONE is the owner's choice
// (2026-10-08): "מוכנים לקפה שכולם רוצים?", picked from three proposals, and it
// is what a device sees first. The harness pins its Hebrew verbatim, so a later
// "tidy-up" cannot quietly change what the owner chose. The other nine were
// written in the same spirit (a question or a short statement with one glowing
// word, then an invitation) and want the owner's read: strike or reword any of
// them. The ENGLISH and ARABIC are translations written alongside, worth a read
// by a native speaker before they are relied on.
//
// `*word*` marks the one word of the headline that glows amber. The markers
// never reach the screen: splitLine() strips them.
//
// Claims worth the owner's confirmation: line 5 names pastries and shakes, line 6
// says the coffee comes hot or cold. Both follow the products named in the
// staff checklists; reword if the menu changes.

import type { Lang } from '@/lib/menu/types'

export interface IntroLineText {
  /** The headline. Exactly one highlighted word. */
  line1: string
  /** The invitation. */
  line2: string
}

export interface IntroCopy extends IntroLineText {
  /** The hint for leaving early. */
  skip: string
}

/** The hint for leaving early — the same on every line. */
export const INTRO_SKIP: Record<Lang, string> = {
  he: 'הקישו כדי לדלג',
  en: 'Tap to skip',
  ar: 'انقر للتخطي',
}

export const INTRO_LINES: readonly Record<Lang, IntroLineText>[] = [
  // 1 — the owner's line, and a device's very first.
  {
    he: { line1: 'מוכנים לקפה ש*כולם* רוצים?', line2: 'בואו לשתות משהו טוב, לנשנש ולהישאר עוד קצת.' },
    en: { line1: 'Ready for the coffee *everyone* wants?', line2: 'Come for a good drink and a bite, and stay a while.' },
    ar: { line1: 'جاهزون للقهوة التي يريدها *الجميع*؟', line2: 'تعالوا لتشربوا شيئاً لذيذاً، وتتناولوا لقمة، وتبقوا قليلاً.' },
  },
  // 2
  {
    he: { line1: '*הקפה* שלכם כבר מחכה.', line2: 'בואו, נכין לכם משהו טוב.' },
    en: { line1: 'Your *coffee* is already waiting.', line2: "Come on over, we'll make you something good." },
    ar: { line1: '*قهوتكم* بانتظاركم.', line2: 'تعالوا، سنحضّر لكم شيئاً لذيذاً.' },
  },
  // 3
  {
    he: { line1: 'זמן ל*הפסקה*?', line2: 'קפה טוב, אנשים טובים, ובלי למהר.' },
    en: { line1: 'Time for a *break*?', line2: 'Good coffee, good people, no rush.' },
    ar: { line1: 'حان وقت *الاستراحة*؟', line2: 'قهوة طيبة، ناس طيبون، وبلا استعجال.' },
  },
  // 4
  {
    he: { line1: 'מי אומר לא ל*קפה* טוב?', line2: 'עצרו לרגע, ואנחנו נדאג לכל השאר.' },
    en: { line1: 'Who says no to good *coffee*?', line2: "Stop for a moment and we'll take care of the rest." },
    ar: { line1: 'من يقول لا *للقهوة* الطيبة؟', line2: 'توقفوا للحظة وسنهتم بكل الباقي.' },
  },
  // 5 — names pastries and shakes.
  {
    he: { line1: 'מתחשק לכם משהו *מתוק*?', line2: 'מאפים, שייקים קרים וקפה חם, הכול במקום אחד.' },
    en: { line1: 'Craving something *sweet*?', line2: 'Pastries, cold shakes and hot coffee, all in one place.' },
    ar: { line1: 'تشتهون شيئاً *حلواً*؟', line2: 'معجنات ومخفوقات باردة وقهوة ساخنة، كل شيء في مكان واحد.' },
  },
  // 6 — says the coffee comes hot or cold.
  {
    he: { line1: 'איך אתם אוהבים את ה*קפה* שלכם?', line2: 'חם או קר, חזק או עדין. יש אצלנו את שלכם.' },
    en: { line1: 'How do you like your *coffee*?', line2: 'Hot or cold, strong or gentle. We have yours.' },
    ar: { line1: 'كيف تحبون *قهوتكم*؟', line2: 'ساخنة أو باردة، قوية أو خفيفة. عندنا قهوتكم.' },
  },
  // 7
  {
    he: { line1: 'יום *עמוס*?', line2: 'קפצו לכוס קפה ותמשיכו הלאה עם כוחות מחודשים.' },
    en: { line1: 'Busy *day*?', line2: 'Pop in for a cup of coffee and carry on recharged.' },
    ar: { line1: 'يوم *مزدحم*؟', line2: 'مرّوا لفنجان قهوة وأكملوا يومكم بطاقة متجددة.' },
  },
  // 8
  {
    he: { line1: 'פגישה, שיחה, או סתם *רגע* לעצמכם?', line2: 'יש אצלנו קפה לכל אחד מהם.' },
    en: { line1: 'A meeting, a chat, or just a *moment* to yourself?', line2: 'We have a coffee for each of them.' },
    ar: { line1: 'لقاء أو حديث أو فقط *لحظة* لأنفسكم؟', line2: 'عندنا قهوة لكل واحد منها.' },
  },
  // 9
  {
    he: { line1: 'בכל שעה יש זמן ל*קפה*.', line2: 'בואו להצטרף אלינו ולהרגיש בבית.' },
    en: { line1: 'Any hour is a good hour for *coffee*.', line2: 'Come join us and feel at home.' },
    ar: { line1: 'كل ساعة هي وقت مناسب *للقهوة*.', line2: 'تعالوا انضموا إلينا واشعروا كأنكم في بيتكم.' },
  },
  // 10 — the tagline on the logo, "What everyone wants", said another way.
  {
    he: { line1: 'יש מקום ל*כולם*.', line2: 'כל מי שאוהב קפה טוב מוזמן לשבת איתנו.' },
    en: { line1: "There's room for *everyone*.", line2: 'Anyone who loves good coffee is welcome to sit with us.' },
    ar: { line1: 'يوجد مكان *للجميع*.', line2: 'كل من يحب القهوة الطيبة مدعو للجلوس معنا.' },
  },
]

/** The words of line `index` (0-based; wrapped, so a stale stored index can
 *  never fall off the end) in `lang`. */
export function introCopy(index: number, lang: Lang): IntroCopy {
  const n = INTRO_LINES.length
  const line = INTRO_LINES[((Math.floor(index) % n) + n) % n] as Record<Lang, IntroLineText>
  return { line1: line[lang].line1, line2: line[lang].line2, skip: INTRO_SKIP[lang] }
}

export interface IntroWord {
  text: string
  /** Glows amber. */
  hl: boolean
}

/** A line as the words the screen animates one by one. Punctuation stays on
 *  its word ("רוצים?" is one word, so the question mark can never be left
 *  behind on a line of its own), and the `*` markers are stripped. */
export function splitLine(line: string): IntroWord[] {
  return line
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => ({ text: w.replace(/\*/g, ''), hl: w.indexOf('*') !== -1 }))
    .filter((w) => w.text.length > 0)
}
