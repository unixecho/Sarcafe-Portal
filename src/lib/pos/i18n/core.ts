import type { Str } from '../i18n'

// POS strings — area: core (the shell: top bar, switcher, home, pills, gates, toasts).
// Hebrew is REQUIRED (the product language); English is optional and falls back to
// Hebrew. Keys are namespaced 'core.xxx' so areas can never collide. Add yours here;
// do not edit another area's file.
//
// Written for an employee, not a developer: nothing here says session, id, sync,
// status, realtime or permission. Where the system has a technical state, the
// string names what the PERSON can do about it ("ההזמנות נשמרות במכשיר").
export const coreStrings = {
  // ---- generic ---------------------------------------------------------------------
  'core.loading': { he: 'טוען…', en: 'Loading…' },
  'core.close': { he: 'סגירה', en: 'Close' },
  'core.building': { he: 'בבנייה', en: 'Under construction' },
  'core.building.sub': { he: 'המסך הזה יהיה זמין בקרוב.', en: 'This screen will be available soon.' },

  // ---- main navigation (the switcher) ---------------------------------------------------
  'core.nav.label': { he: 'ניווט ראשי', en: 'Main navigation' },
  'core.nav.register': { he: 'קופה', en: 'Register' },
  'core.nav.orders': { he: 'הזמנות', en: 'Orders' },
  'core.nav.stations': { he: 'עמדות', en: 'Stations' },
  'core.nav.backlog': { he: '{n} ממתינים בעמדה {name}', en: '{n} waiting at {name}' },
  'core.nav.backlogLate': {
    he: '{n} ממתינים בעמדה {name}, יש פריט שמחכה זמן רב',
    en: '{n} waiting at {name}, one has been waiting a long time',
  },

  // ---- top bar ------------------------------------------------------------------------------
  'core.top.me': { he: 'החשבון של {name}', en: "{name}'s account" },
  'core.top.manager': { he: 'ניהול האירוע', en: 'Manage the event' },
  'core.top.pickPost': { he: 'בחירת עמדה', en: 'Choose where to work' },
  'core.top.switchPost': { he: 'החלפת עמדה. עכשיו: {name}', en: 'Switch where you work. Now: {name}' },
  'core.top.postRegister': { he: 'קופה', en: 'Register' },
  'core.top.postOrders': { he: 'הזמנות', en: 'Orders' },
  'core.top.postHome': { he: 'בחירת עמדה', en: 'Choose where to work' },
  'core.lang.toggle': { he: 'החלפת שפה. עכשיו: עברית', en: 'Change language. Now: English' },
  'core.sound.on': { he: 'הצלילים פועלים. הקישו להשתקה', en: 'Sounds are on. Tap to mute' },
  'core.sound.off': { he: 'הצלילים מושתקים. הקישו להפעלה', en: 'Sounds are muted. Tap to turn on' },

  // ---- connection / menu ----------------------------------------------------------------------
  'core.conn.offline': { he: 'אין חיבור לאינטרנט', en: 'No internet connection' },
  'core.conn.offlineHint': {
    he: 'אין חיבור. הזמנות שמקלידים נשמרות במכשיר ויישלחו לבד כשהחיבור יחזור.',
    en: 'No connection. Orders you type are kept on this device and will be sent when it is back.',
  },
  'core.conn.connecting': { he: 'מתחבר…', en: 'Connecting…' },
  'core.conn.slow': { he: 'העדכונים מגיעים לאט', en: 'Updates are slow' },
  'core.conn.slowHint': {
    he: 'העדכונים מגיעים לאט. המסך מתרענן לבד כל כמה שניות. אפשר גם להקיש כאן.',
    en: 'Updates are slow. The screen refreshes itself every few seconds. You can also tap here.',
  },
  'core.conn.menuCached': { he: 'התפריט מהמכשיר', en: 'Menu from this device' },
  'core.conn.menuCachedHint': {
    he: 'לא הצלחנו לבדוק אם התפריט השתנה. מציגים את התפריט האחרון שנשמר.',
    en: 'We could not check whether the menu changed. Showing the last menu we saved.',
  },
  'core.conn.refresh': { he: 'הקישו לרענון', en: 'Tap to refresh' },

  // ---- orders waiting to be sent (the outbox) ---------------------------------------------------
  'core.outbox.pendingOne': { he: 'הזמנה אחת ממתינה לשליחה', en: '1 order waiting to be sent' },
  'core.outbox.pendingMany': { he: '{n} הזמנות ממתינות לשליחה', en: '{n} orders waiting to be sent' },
  'core.outbox.attentionOne': { he: 'הזמנה אחת צריכה טיפול', en: '1 order needs attention' },
  'core.outbox.attentionMany': { he: '{n} הזמנות צריכות טיפול', en: '{n} orders need attention' },
  'core.outbox.title': { he: 'הזמנות שעוד לא נשלחו', en: 'Orders not sent yet' },
  'core.outbox.sub': {
    he: 'ההזמנות האלה שמורות במכשיר. אף אחת לא הולכת לאיבוד.',
    en: 'These orders are kept on this device. None of them gets lost.',
  },
  'core.outbox.empty': { he: 'כל ההזמנות נשלחו.', en: 'Every order has been sent.' },
  'core.outbox.waiting': { he: 'ממתינה לשליחה', en: 'Waiting to be sent' },
  'core.outbox.sending': { he: 'נשלחת עכשיו…', en: 'Sending now…' },
  'core.outbox.problem': { he: 'צריכה טיפול', en: 'Needs attention' },
  'core.outbox.items': { he: '{n} פריטים', en: '{n} items' },
  'core.outbox.retry': { he: 'שליחה מחדש', en: 'Send again' },
  'core.outbox.discard': { he: 'מחיקה', en: 'Delete' },
  'core.outbox.discardTitle': { he: 'למחוק את ההזמנה של {name}?', en: 'Delete the order for {name}?' },
  'core.outbox.discardBody': {
    he: 'ההזמנה לא נשלחה לעמדות ולא תיכנס למערכת. אם הלקוח כבר שילם, הקלידו אותה מחדש.',
    en: 'The order was not sent to the stations and will not be recorded. If the customer already paid, type it in again.',
  },
  'core.outbox.discardYes': { he: 'כן, למחוק', en: 'Yes, delete it' },
  'core.outbox.discardNo': { he: 'להשאיר את ההזמנה', en: 'Keep the order' },
  'core.outbox.unnamed': { he: 'הזמנה ללא שם', en: 'Order without a name' },

  // ---- the event ---------------------------------------------------------------------------------
  'core.event.open': { he: 'פתוח', en: 'Open' },
  'core.event.openSince': { he: 'האירוע פתוח מ־{time}', en: 'The event has been open since {time}' },
  'core.event.closed': { he: 'סגור', en: 'Closed' },
  'core.event.closedHint': { he: 'האירוע סגור', en: 'The event is closed' },
  'core.event.training': { he: 'אימון', en: 'Practice' },
  'core.event.trainingHint': {
    he: 'מצב אימון: ההזמנות לא נספרות באמת',
    en: 'Practice mode: these orders do not count',
  },
  'core.event.trainingStrip': {
    he: 'מצב אימון. מתרגלים, ההזמנות האלה לא נספרות באמת.',
    en: 'Practice mode. Go ahead and practise, these orders do not really count.',
  },

  // ---- home: where do you work today ------------------------------------------------------------
  'core.home.title': { he: 'איפה עובדים היום?', en: 'Where are you working today?' },
  'core.home.sub': {
    he: 'בחרו מקום והמכשיר יזכור. תמיד אפשר להחליף מהסרגל העליון.',
    en: 'Pick a place and this device will remember it. You can always change it from the top bar.',
  },
  'core.home.registerHint': { he: 'מקלידים הזמנה מהקבלה', en: 'Type in an order from the receipt' },
  'core.home.stationHint': { he: 'מכינים ומוסרים הזמנות', en: 'Prepare and hand over orders' },
  'core.home.stationHintNoHandover': { he: 'מכינים, ומישהו אחר מוסר', en: 'Prepare, someone else hands over' },
  'core.home.mine': { he: 'העמדה שלך', en: 'Your station' },
  'core.home.waiting': { he: '{n} בתור', en: '{n} waiting' },
  'core.home.ordersTitle': { he: 'רק לראות הזמנות', en: 'Just look at the orders' },
  'core.home.ordersHint': { he: 'איפה ההזמנה של הלקוח?', en: "Where is the customer's order?" },
  'core.home.noPoints': {
    he: 'עוד לא הוגדרו עמדות. אפשר להקליד הזמנות בקופה, אבל מישהו צריך להגדיר עמדות כדי שיהיה מי שיכין. פנו למנהל או למנהלת.',
    en: 'No stations are set up yet. You can type orders at the register, but someone has to set up stations so there is someone to make them. Ask a manager.',
  },

  // ---- full-screen states ---------------------------------------------------------------------
  'core.closed.title': { he: 'האירוע עדיין סגור', en: 'The event is not open yet' },
  'core.closed.body': {
    he: 'ברגע שהאירוע ייפתח המסך יתעדכן לבד. אין צורך לרענן.',
    en: 'As soon as the event opens this screen updates by itself. No need to refresh.',
  },
  'core.closed.ask': { he: 'פנו למנהל או למנהלת האירוע.', en: 'Ask the event manager.' },
  'core.closed.managerHint': {
    he: 'אתם מנהלים: אפשר לפתוח את האירוע מכאן.',
    en: 'You are a manager: you can open the event from here.',
  },
  'core.closed.managerAction': { he: 'לניהול האירוע', en: 'Go to event management' },
  'core.closed.check': { he: 'בדיקה עכשיו', en: 'Check now' },
  'core.disabled.title': { he: 'הקופה לא פעילה באירוע הזה', en: 'The register is not switched on for this event' },
  'core.disabled.body': {
    he: 'מנהל או מנהלת צריכים להפעיל אותה קודם. המסך יתעדכן לבד.',
    en: 'A manager has to switch it on first. This screen updates by itself.',
  },
  'core.nobranch.title': { he: 'אין אירוע שאפשר לעבוד בו', en: 'There is no event to work in' },
  'core.nobranch.body': {
    he: 'לא מצאנו אירוע פעיל בשבילך. פנו למנהל או למנהלת.',
    en: 'We could not find an active event for you. Ask a manager.',
  },
  'core.gone.title': { he: 'העמדה הזו כבר לא פעילה', en: 'This station is no longer working' },
  'core.gone.body': { he: 'בחרו מקום אחר כדי להמשיך.', en: 'Choose another place to carry on.' },
  'core.gone.action': { he: 'בחירת מקום', en: 'Choose a place' },

  // ---- the nickname gate ----------------------------------------------------------------------
  'core.handle.title': { he: 'איך נקרא לך?', en: 'What should we call you?' },
  'core.handle.sub': {
    he: 'זה השם שהצוות יראה ליד כל דבר שאתם עושים.',
    en: 'This is the name your team will see next to everything you do.',
  },
  'core.handle.label': { he: 'השם שלך', en: 'Your name' },
  'core.handle.hint': {
    he: 'בין 2 ל־16 תווים: אותיות, ספרות, נקודה או מקף.',
    en: '2 to 16 characters: letters, digits, a dot or a dash.',
  },
  'core.handle.suggested': { he: 'זו הצעה שלנו. אפשר להחליף.', en: 'This is our suggestion. You can change it.' },
  'core.handle.tooShort': { he: 'קצר מדי. צריך לפחות 2 תווים.', en: 'Too short. At least 2 characters.' },
  'core.handle.tooLong': { he: 'ארוך מדי. עד 16 תווים.', en: 'Too long. Up to 16 characters.' },
  'core.handle.badChars': {
    he: 'אפשר רק אותיות, ספרות, נקודה, מקף וקו תחתון.',
    en: 'Only letters, digits, a dot, a dash and an underscore.',
  },
  'core.handle.taken': { he: 'השם הזה כבר תפוס, נסו אחר.', en: 'That name is already taken, try another.' },
  'core.handle.failed': { he: 'לא הצלחנו לשמור. נסו שוב.', en: 'We could not save it. Try again.' },
  'core.handle.save': { he: 'המשך', en: 'Continue' },
  'core.handle.saving': { he: 'שומר…', en: 'Saving…' },

  'core.signedOut.title': { he: 'צריך להיכנס מחדש', en: 'Please sign in again' },
  'core.signedOut.body': {
    he: 'ההתחברות שלכם הסתיימה. ההזמנות שהקלדתם שמורות במכשיר ויישלחו אחרי הכניסה.',
    en: 'Your sign-in ended. Orders you typed are kept on this device and will be sent after you sign in.',
  },
  'core.signedOut.action': { he: 'כניסה מחדש', en: 'Sign in again' },
  'core.signedOut.strip': { he: 'ההתחברות הסתיימה. צריך להיכנס מחדש.', en: 'Your sign-in ended. Please sign in again.' },

  // ---- toasts -------------------------------------------------------------------------------------
  'core.toast.dismiss': { he: 'סגירת ההודעה', en: 'Dismiss the message' },
  'core.toast.someoneElse': {
    he: 'מישהו כבר עדכן את זה. מרעננים את המסך.',
    en: 'Someone already updated this. Refreshing the screen.',
  },
  'core.toast.notUpdated': {
    he: 'לא הצלחנו לעדכן. נסו שוב.',
    en: 'We could not update that. Try again.',
  },
} as const satisfies Record<string, Str>
