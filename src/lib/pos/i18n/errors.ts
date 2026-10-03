import type { Str } from '../i18n'

// POS strings — area: errors. Hebrew is REQUIRED (the product language); English is
// optional and falls back to Hebrew. Keys are namespaced 'errors.xxx' so areas can
// never collide. Add yours here; do not edit another area's file.
//
// One plain-language message for EVERY PosErrorCode and LineProblemCode in
// lib/pos/types.ts (+ 'network', which the client wrapper invents when the server
// never answered). They are read by an employee in the middle of a rush, so each
// one is short, kind, and says what to do NEXT. No code, no 'session', no
// 'permission', no 'sync' — if an employee could not repeat it to a colleague in a
// sentence, it does not belong here.
//
// Read them through errorText(t, code) (components/pos/shell/errorText.ts), which
// falls back to errors.generic for a code this file has never heard of — a server
// that learns a new code must degrade to a calm sentence, never to a raw string.
export const errorsStrings = {
  'errors.generic': {
    he: 'משהו לא עבד. נסו שוב בעוד רגע.',
    en: 'Something did not work. Please try again in a moment.',
  },
  'errors.network': {
    he: 'אין חיבור כרגע. נסו שוב כשהחיבור יחזור.',
    en: 'No connection right now. Try again when it is back.',
  },

  // ---- who you are / whether you may ---------------------------------------------
  'errors.unauthorized': {
    he: 'ההתחברות שלך פגה. התחברו שוב ותמשיכו מאותו מקום.',
    en: 'You were signed out. Sign in again and carry on from where you were.',
  },
  'errors.forbidden': {
    he: 'הפעולה הזו שמורה למנהלים. אפשר לבקש ממנהל או ממנהלת.',
    en: 'Only a manager can do this. Ask a manager to help.',
  },
  'errors.needs_handle': {
    he: 'קודם צריך לבחור איך נקרא לך.',
    en: 'First choose the name we should call you.',
  },

  // ---- the event ---------------------------------------------------------------------
  'errors.not_enabled': {
    he: 'הקופה לא פעילה באירוע הזה. פנו למנהל או למנהלת.',
    en: 'The register is not switched on for this event. Ask a manager.',
  },
  'errors.no_session': {
    he: 'האירוע עדיין לא נפתח, אז אי אפשר להזמין. פנו למנהל או למנהלת.',
    en: 'The event is not open yet, so orders cannot be sent. Ask a manager.',
  },

  // ---- the request itself --------------------------------------------------------------
  'errors.bad_request': {
    he: 'משהו בפרטים לא תקין. בדקו ונסו שוב.',
    en: 'Something in the details is not right. Check and try again.',
  },
  'errors.bad_customer': {
    he: 'שם הלקוח חסר או לא תקין. כתבו שם קצר ונסו שוב.',
    en: 'The customer name is missing or not valid. Type a short name and try again.',
  },
  'errors.bad_line': {
    he: 'אחד הפריטים בהזמנה לא תקין. הסירו אותו או בחרו אותו מחדש.',
    en: 'One of the items in the order is not valid. Remove it or pick it again.',
  },
  'errors.bad_point': {
    he: 'העמדה של אחד הפריטים כבר לא פעילה. פנו למנהל או למנהלת.',
    en: 'The station for one of the items is no longer working. Ask a manager.',
  },
  'errors.bad_reason': {
    he: 'צריך לבחור סיבה לפני שממשיכים.',
    en: 'Pick a reason before going on.',
  },

  // ---- the order -------------------------------------------------------------------------
  'errors.not_found': {
    he: 'לא מצאנו את ההזמנה. ייתכן שמישהו כבר טיפל בה.',
    en: 'We could not find that order. Someone may have already dealt with it.',
  },
  'errors.order_void': {
    he: 'ההזמנה כבר בוטלה, אז אי אפשר לשנות אותה.',
    en: 'That order was already cancelled, so it cannot be changed.',
  },
  'errors.conflict': {
    he: 'מישהו כבר עדכן את זה.',
    en: 'Someone already updated this.',
  },
  'errors.rate_limited': {
    he: 'לוחצים מהר מדי. חכו רגע ונסו שוב.',
    en: 'Going a bit too fast. Wait a moment and try again.',
  },
  'errors.internal_error': {
    he: 'משהו השתבש אצלנו. נסו שוב בעוד רגע.',
    en: 'Something went wrong on our side. Try again in a moment.',
  },

  // ---- one line of an order (LineProblemCode) ----------------------------------------------
  'errors.unknown_item': {
    he: 'הפריט הזה כבר לא בתפריט. בחרו משהו אחר.',
    en: 'That item is no longer on the menu. Pick something else.',
  },
  'errors.sold_out': {
    he: 'הפריט הזה אזל. בחרו משהו אחר או הסירו אותו.',
    en: 'That item is sold out. Pick something else or remove it.',
  },
  'errors.no_point': {
    he: 'אין עמדה שמכינה את הפריט הזה. פנו למנהל או למנהלת.',
    en: 'No station makes this item. Ask a manager.',
  },
  'errors.not_sold': {
    he: 'הפריט הזה לא נמכר באירוע הזה.',
    en: 'This item is not sold at this event.',
  },
  'errors.no_price': {
    he: 'לפריט הזה אין מחיר. פנו למנהל או למנהלת.',
    en: 'This item has no price. Ask a manager.',
  },
  'errors.needs_price_choice': {
    he: 'צריך לבחור מחיר, זה שמופיע בקבלה.',
    en: 'Choose a price, the one on the receipt.',
  },
  'errors.unknown_type': {
    he: 'האפשרות שבחרתם כבר לא קיימת. בחרו מחדש.',
    en: 'The option you picked no longer exists. Pick again.',
  },
  'errors.type_sold_out': {
    he: 'האפשרות שבחרתם אזלה. בחרו אחרת.',
    en: 'The option you picked is sold out. Pick another.',
  },
  'errors.needs_type': {
    he: 'צריך לבחור סוג לפני שמוסיפים.',
    en: 'Choose a kind before adding it.',
  },
  'errors.unknown_modifier': {
    he: 'אחת התוספות כבר לא קיימת. בחרו מחדש.',
    en: 'One of the extras no longer exists. Pick again.',
  },
  'errors.modifier_unavailable': {
    he: 'אחת התוספות אזלה. בחרו אחרת או הסירו אותה.',
    en: 'One of the extras is sold out. Pick another or remove it.',
  },
  'errors.modifier_required': {
    he: 'חסרה בחירה שחובה לעשות. סמנו אפשרות ונסו שוב.',
    en: 'A required choice is missing. Pick one and try again.',
  },
  'errors.modifier_too_many': {
    he: 'בחרתם יותר מדי אפשרויות. הורידו אחת.',
    en: 'You picked too many options. Take one off.',
  },
  'errors.modifier_too_few': {
    he: 'בחרתם מעט מדי אפשרויות. הוסיפו עוד.',
    en: 'You picked too few options. Add more.',
  },
  'errors.modifier_qty': {
    he: 'הכמות של אחת התוספות גבוהה מדי.',
    en: 'The amount of one of the extras is too high.',
  },
  'errors.bad_qty': {
    he: 'הכמות לא תקינה. בחרו מספר בין 1 ל־99.',
    en: 'That amount is not valid. Choose a number from 1 to 99.',
  },
  'errors.bad_custom': {
    he: 'הפריט שהקלדתם לא תקין. בדקו את השם, המחיר והעמדה.',
    en: 'The item you typed is not valid. Check the name, price and station.',
  },
} as const satisfies Record<string, Str>
