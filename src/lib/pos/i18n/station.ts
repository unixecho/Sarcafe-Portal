import type { Str } from '../i18n'

// POS strings — area: station (the selling-point screen, its Done tray and the timeline).
// Hebrew is REQUIRED (the product language); English is optional and falls back to Hebrew.
// Keys are namespaced 'station.xxx' so areas can never collide.
//
// Wording rule: a person at a counter reads these with a tray in one hand. Plain words, no
// system words (no ids, no "status", no "sync"); a refusal says what to do instead.
export const stationStrings = {
  // ---- the one big button and each line's small chip ------------------------------------------
  'station.act.accept': { he: 'קבלה', en: 'Accept' },
  'station.act.ready': { he: 'מוכן', en: 'Ready' },
  'station.act.handover': { he: 'מסרתי', en: 'Handed over' },

  // ---- a line -------------------------------------------------------------------------------------
  'station.line.sent': { he: 'ממתין', en: 'Waiting' },
  'station.line.preparing': { he: 'בהכנה', en: 'Being prepared' },
  'station.line.ready': { he: 'מוכן', en: 'Ready' },
  'station.line.delivered': { he: 'נמסר', en: 'Handed over' },
  'station.line.later': { he: 'תוספת', en: 'Added' },
  'station.line.mine': { he: 'שלי', en: 'Mine' },
  'station.line.for': { he: 'ל: {name}', en: 'For: {name}' },
  'station.line.revert': { he: 'חזרה צעד אחורה: {what}', en: 'Take back one step: {what}' },
  'station.line.advance': { he: '{action}: {what}', en: '{action}: {what}' },

  // ---- a card ---------------------------------------------------------------------------------------
  'station.card.waited': { he: 'זמן המתנה', en: 'Waiting time' },
  'station.card.createdBy': { he: 'נוצרה ע״י', en: 'Created by' },
  'station.card.someOf': { he: '{n} מתוך {total} פריטים', en: '{n} of {total} items' },
  'station.card.waitingHandover': { he: 'ממתין למסירה', en: 'Waiting to be handed over' },

  // ---- the rest of the order, made elsewhere -------------------------------------------------------
  'station.cross.also': { he: 'גם ב: {list}', en: 'Also at: {list}' },
  'station.cross.waitingOne': { he: '{n} ממתין', en: '{n} waiting' },
  'station.cross.waitingMany': { he: '{n} ממתינים', en: '{n} waiting' },
  'station.cross.preparing': { he: '{n} בהכנה', en: '{n} being prepared' },
  'station.cross.readyOne': { he: '{n} מוכן', en: '{n} ready' },
  'station.cross.readyMany': { he: '{n} מוכנים', en: '{n} ready' },
  'station.cross.doneOne': { he: '{n} נמסר', en: '{n} handed over' },
  'station.cross.doneMany': { he: '{n} נמסרו', en: '{n} handed over' },

  // ---- cancelled after it was sent -------------------------------------------------------------------
  'station.ghost.text': { he: 'בוטל — אל תכינו', en: 'Cancelled — do not make it' },
  'station.ghost.dismiss': { he: 'הבנתי, להסיר את השורה: {what}', en: 'Understood, remove the row: {what}' },
  'station.ghost.ok': { he: 'הבנתי', en: 'Got it' },

  // ---- the overdue strip (singular and plural are SEPARATE strings on purpose) ---------------------------
  'station.overdue.one': { he: 'פריט ממתין מעל 5 דקות — לטפל עכשיו', en: 'An item has waited over 5 minutes — deal with it now' },
  'station.overdue.many': { he: '{n} פריטים ממתינים מעל 5 דקות — לטפל עכשיו', en: '{n} items have waited over 5 minutes — deal with them now' },

  // ---- done tray -----------------------------------------------------------------------------------------
  'station.done.handed': { he: 'נמסרה', en: 'Handed over' },
  'station.done.undo': { he: 'בטל', en: 'Undo' },
  'station.done.at': { he: 'נמסרה ב-', en: 'Handed over at' },
  'station.done.by': { he: 'נמסרה ע״י', en: 'Handed over by' },
  'station.done.tab': { he: 'הושלמו · {n}', en: 'Done · {n}' },
  'station.done.title': { he: 'הושלמו', en: 'Done' },
  'station.done.close': { he: 'סגירת הרשימה', en: 'Close the list' },
  'station.done.dropHere': { he: 'שחררו כאן כדי להעביר להושלמו', en: 'Let go here to move it to Done' },
  'station.done.empty': { he: 'עדיין לא הושלמה אף הזמנה', en: 'Nothing has been completed yet' },
  'station.done.notYet': {
    he: 'ההזמנה עדיין בטיפול. אפשר להעביר להושלמו רק אחרי שמסרתם הכול.',
    en: 'This order is still in progress. Once everything is handed over it can move to Done.',
  },

  // ---- check-in -------------------------------------------------------------------------------------------
  'station.checkin.loading': { he: 'בודקים אם אתם בעמדה…', en: 'Checking if you are at the station…' },
  'station.checkin.in': { he: 'אני בעמדה', en: 'I am here' },
  'station.checkin.out': { he: 'כניסה לעמדה', en: 'Start here' },
  'station.checkin.joinLabel': { he: 'לסמן שאני עובד/ת בעמדה הזו', en: 'Mark that I am working at this station' },
  'station.checkin.leaveLabel': { he: 'לסמן שיצאתי מהעמדה', en: 'Mark that I have left this station' },

  // ---- header + states -------------------------------------------------------------------------------------
  'station.timeline': { he: 'ציר זמן', en: 'Timeline' },
  'station.empty': { he: 'אין הזמנות פתוחות כרגע', en: 'No open orders right now' },
  'station.stale': { he: 'לא מצליחים להתעדכן. מוצג מה שיש.', en: 'Cannot update right now. Showing what we have.' },
  'station.loadFailed': { he: 'לא הצלחנו לטעון את ההזמנות.', en: 'We could not load the orders.' },
  'station.retry': { he: 'ניסיון נוסף', en: 'Try again' },

  // ---- the swipe to the timeline ------------------------------------------------------------------------------
  'station.swipe.title': { he: 'עבור לציר הזמן?', en: 'Go to the timeline?' },
  'station.swipe.body': { he: 'שם רואים מה כבר נמסר בעמדה הזו.', en: 'It shows what has already been handed over at this station.' },
  'station.swipe.yes': { he: 'כן', en: 'Yes' },
  'station.swipe.no': { he: 'לא', en: 'No' },

  // ---- keyboard -------------------------------------------------------------------------------------------------
  'station.key.wrong': { he: 'כרגע המקש הוא {n} — {action}', en: 'Right now the key is {n}: {action}' },

  // ---- timeline ---------------------------------------------------------------------------------------------------
  'station.tl.back': { he: 'חזרה', en: 'Back' },
  'station.tl.title': { he: 'ציר זמן', en: 'Timeline' },
  'station.tl.failed': { he: 'לא הצלחנו לטעון את ההיסטוריה.', en: 'We could not load the history.' },
  'station.tl.empty': { he: 'עדיין לא נמסרה כאן אף הזמנה', en: 'Nothing has been handed over here yet' },
  'station.tl.madeAt': { he: 'הוכן ב: {point}', en: 'Made at: {point}' },
  'station.tl.accepted': { he: 'קיבל/ה:', en: 'Accepted by' },
  'station.tl.readied': { he: 'הכין/ה:', en: 'Made ready by' },
  'station.tl.handed': { he: 'מסר/ה:', en: 'Handed over by' },
  'station.tl.history': { he: 'מה קרה בהזמנה', en: 'What happened to this order' },
  'station.tl.more': { he: 'עוד הזמנות', en: 'Show more' },
} as const satisfies Record<string, Str>
