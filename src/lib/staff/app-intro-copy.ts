// The staff app's opening screen (the installed Home Screen app): a few seconds of jokes while the app "works out who you are".
// Pure on purpose (no DOM, no React): the component feeds it what it knows at each moment and it returns the line to show,
// so the wording and the three situations can be checked without a browser.
//
// The three situations, told by what the app knows when it reaches the identity step:
//   signedIn      the server recognised the session (the staff layout reports it): greet the person by name.
//   remembered    nobody is signed in, but this phone remembers a name from an earlier sign-in.
//   stranger      nobody is signed in and nothing is remembered.
// Hebrew wording avoids gendered verbs: "אתם" (plural, the app's usual voice) and "זה אתם".

export type IntroWho = 'signedIn' | 'remembered' | 'stranger'

export const INTRO_NAME_KEY = 'sarcafe:staff-name:v1'
export const INTRO_SIGNED_KEY = 'sarcafe:staff-signed-in:v1'
export const INTRO_PLAYED_KEY = 'sarcafe:staff-intro-played:v1'
/** A name is shown on a big screen and comes from a person's profile: keep it short and strip anything that is not a name. */
export const INTRO_NAME_MAX = 24

export const INTRO_STEP_MS = 880
export const INTRO_OUT_MS = 380
/** The screen is the loading screen: it ends when the page is ready, but never before its first line has been readable, */
export const INTRO_MIN_MS = 700
/** and never later than this, ready or not. */
export const INTRO_MAX_MS = 15000

export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // Letters (any alphabet), marks, spaces, apostrophes and hyphens; no digits or symbols, so nothing odd is ever drawn.
  return raw.replace(/[^\p{L}\p{M} '’\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, INTRO_NAME_MAX)
}

export function whoIs(signedIn: boolean, savedName: string): IntroWho {
  if (signedIn) return 'signedIn'
  return savedName ? 'remembered' : 'stranger'
}

const FILLERS = [
  'מחמם את מכונת האספרסו…',
  'מסדר את הכוסות לפי גודל…',
  'מנקה אבק מהמנעול של הדלת…',
  'בודק שלא נשאר חלב ליד האגוזים…',
  'מעיר את מי שישן במשמרת בוקר…',
]

const CHECKING_SIGNED_IN = [
  'מחפש את השם שלכם בין כל העובדים…',
  'בודק מי מחזיק את הטלפון הזה… (לא מציץ, אני נשבע)',
  'משווה פרצוף למשמרת… רגע…',
]

export const FIRST_LINE = 'מברר לאיזה חשבון זה שייך…'

/** Index picks are passed in (0..1) so a caller can be random and a test can be exact. */
export function pick<T>(list: readonly T[], roll: number): T {
  return list[Math.min(list.length - 1, Math.max(0, Math.floor(roll * list.length)))]!
}

export type IntroStep = { text: string; tone: 'plain' | 'question' | 'greeting' }

/**
 * The lines in order. The first is the same for everyone and is known right away; the filler is random; the third (the
 * identity check) and the fourth (the greeting) depend on `who`, which is only known a moment after the app has started,
 * so the component asks for them lazily with the then-current answer.
 */
export function stepAt(index: number, who: IntroWho, name: string, rolls: { filler: number; checking: number }): IntroStep {
  const shown = cleanName(name)
  switch (index) {
    case 0: return { text: FIRST_LINE, tone: 'plain' }
    case 1: return { text: pick(FILLERS, rolls.filler), tone: 'plain' }
    case 2:
      return who === 'signedIn'
        ? { text: pick(CHECKING_SIGNED_IN, rolls.checking), tone: 'plain' }
        : { text: 'מוזר. אין חשבון מחובר. מי אתם בכלל? 🤨', tone: 'question' }
    default:
      if (who === 'signedIn') return { text: shown ? `אה, אני רואה שזה שוב אתם, ${shown} ☕` : 'אה, אני רואה שזה שוב אתם ☕', tone: 'greeting' }
      if (who === 'remembered') return { text: shown ? `רגע… אני כמעט זוכר אתכם. ${shown}, זה אתם? בואו נתחבר.` : 'רגע… אני כמעט זוכר אתכם. בואו נתחבר.', tone: 'greeting' }
      return { text: 'לא נורא, נכיר. תתחברו ואני כבר אזכור ☕', tone: 'greeting' }
  }
}

export const INTRO_STEPS = 4
