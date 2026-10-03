import type { Str } from '../i18n'

// POS strings — area: register. Hebrew is REQUIRED (the product language); English is
// optional and falls back to Hebrew. Keys are namespaced 'register.xxx' so areas can
// never collide. Add yours here; do not edit another area's file.
//
// Written for a cashier with a customer waiting: short, concrete, no technical words
// (nothing says id, session, status, sync or permission). Where a rule exists, the string
// names what the PERSON can do about it ("חסר שם לקוח"), never the rule itself.
export const registerStrings = {
  // ---- screen frame -------------------------------------------------------------------
  'register.new': { he: 'הזמנה חדשה', en: 'New order' },
  'register.clear': { he: 'ניקוי ההזמנה', en: 'Clear the order' },
  'register.cancel': { he: 'ביטול', en: 'Cancel' },
  'register.cap': { he: 'אי אפשר להוסיף עוד סוגי פריטים להזמנה אחת. שלחו אותה והתחילו הזמנה חדשה.', en: 'No more different items fit in one order. Send it and start a new one.' },
  'register.closed': { he: 'האירוע סגור. אפשר להקליד, אבל אי אפשר לשלוח הזמנות.', en: 'The event is closed. You can type, but orders cannot be sent.' },
  'register.menu.label': { he: 'התפריט', en: 'Menu' },
  'register.menu.empty': { he: 'התפריט ריק כרגע.', en: 'The menu is empty right now.' },

  // ---- search + categories ---------------------------------------------------------------
  'register.search.label': { he: 'חיפוש בתפריט', en: 'Search the menu' },
  'register.search.placeholder': { he: 'חיפוש פריט (מקש /)', en: 'Search an item (press /)' },
  'register.search.clear': { he: 'ניקוי החיפוש', en: 'Clear the search' },
  'register.search.none': { he: 'לא נמצא "{q}". אפשר להוסיף אותו כפריט אחר.', en: 'Nothing found for "{q}". You can add it as another item.' },
  'register.strip.label': { he: 'קטגוריות', en: 'Categories' },

  // ---- tiles ---------------------------------------------------------------------------------
  'register.tile.soldOut': { he: 'אזל', en: 'Sold out' },
  'register.tile.noPoint': { he: 'ללא עמדה', en: 'No station' },
  'register.tile.noPointManager': { he: 'מנהל: חברו אותו לעמדה בהגדרות', en: 'Manager: connect it to a station in the setup' },
  'register.tile.notSold': { he: 'לא נמכר באירוע', en: 'Not sold at this event' },
  'register.tile.noPrice': { he: 'ללא מחיר', en: 'No price' },
  'register.tile.optionOut': { he: 'אפשרות חובה אזלה', en: 'A required option is out' },
  'register.tile.inOrder': { he: '{n} בהזמנה', en: '{n} in the order' },
  'register.tile.choose': { he: 'בחירה', en: 'Choose' },
  'register.tile.adjust': { he: 'התאמה', en: 'Adjust' },
  'register.tile.adjustFor': { he: 'התאמת {name}', en: 'Adjust {name}' },

  // ---- order start ------------------------------------------------------------------------------
  'register.start.title': { he: 'הזמנה חדשה', en: 'New order' },
  'register.start.sub': { he: 'למי ההזמנה? אחרי השם אפשר להתחיל להוסיף פריטים.', en: 'Who is the order for? After the name you can start adding items.' },
  'register.start.name': { he: 'שם הלקוח', en: 'Customer name' },
  'register.start.phone': { he: 'טלפון (לא חובה)', en: 'Phone (optional)' },
  'register.start.phonePlaceholder': { he: 'מומלץ — כדי שנדע למי ההזמנה', en: 'Recommended — so we know whose order it is' },
  'register.start.privacy': { he: 'המספר משמש רק כדי למצוא את ההזמנה, נמחק אחרי זמן קצר, ולא נשלחות הודעות.', en: 'The number is only used to find the order, is deleted after a short while, and no messages are sent.' },
  'register.start.needName': { he: 'חסר שם לקוח', en: 'Customer name is missing' },
  'register.start.badPhone': { he: 'מספר הטלפון לא נראה תקין', en: 'The phone number does not look right' },
  'register.start.go': { he: 'להזמנה', en: 'Start the order' },

  // ---- customize ----------------------------------------------------------------------------------
  'register.cz.required': { he: 'חובה', en: 'Required' },
  'register.cz.pickOne': { he: 'בחרו אחד', en: 'Pick one' },
  'register.cz.pickOneOpt': { he: 'אפשר לבחור אחד', en: 'You may pick one' },
  'register.cz.pickMin': { he: 'בחרו לפחות {n}', en: 'Pick at least {n}' },
  'register.cz.pickUpTo': { he: 'אפשר לבחור עד {n}', en: 'You may pick up to {n}' },
  'register.cz.instead': { he: 'במקום {name}', en: 'instead of {name}' },
  'register.cz.less': { he: 'פחות', en: 'Less' },
  'register.cz.more': { he: 'יותר', en: 'More' },
  'register.cz.type': { he: 'סוג', en: 'Type' },
  'register.cz.size': { he: 'גודל', en: 'Size' },
  'register.cz.sizeS': { he: 'קטן', en: 'Small' },
  'register.cz.sizeM': { he: 'בינוני', en: 'Medium' },
  'register.cz.sizeL': { he: 'גדול', en: 'Large' },
  'register.cz.sizeN': { he: 'אפשרות {n}', en: 'Option {n}' },
  'register.cz.left': { he: 'נותרו {n}', en: '{n} left' },
  'register.cz.note': { he: 'הערה לפריט', en: 'Note for this item' },
  'register.cz.notePlaceholder': { he: 'למשל: בלי הרבה קצף', en: 'For example: not too much foam' },
  'register.cz.forName': { he: 'ל:', en: 'For:' },
  'register.cz.forPlaceholder': { he: 'שם מי שהפריט מיועד לו', en: 'Who this item is for' },
  'register.cz.qty': { he: 'כמות', en: 'Quantity' },
  'register.cz.add': { he: 'הוספה', en: 'Add' },
  'register.cz.update': { he: 'עדכון', en: 'Update' },
  'register.cz.moreOptions': { he: 'עוד אפשרויות', en: 'More options' },
  'register.cz.unitPrice': { he: 'מחיר ליחידה', en: 'Price per unit' },
  'register.cz.needType': { he: 'חסר: בחירת סוג', en: 'Missing: pick a type' },
  'register.cz.needSize': { he: 'חסר: בחירת גודל', en: 'Missing: pick a size' },
  'register.cz.needGroup': { he: 'חסר: {name}', en: 'Missing: {name}' },

  // ---- other item ------------------------------------------------------------------------------------
  'register.custom.tile': { he: 'פריט אחר', en: 'Other item' },
  'register.custom.title': { he: 'פריט אחר', en: 'Other item' },
  'register.custom.name': { he: 'שם הפריט', en: 'Item name' },
  'register.custom.price': { he: 'מחיר (₪)', en: 'Price (₪)' },
  'register.custom.priceHint': { he: 'אפשר 12,5. אפשר גם 0, למשל מים.', en: 'You can type 12.5. 0 is fine too, for example water.' },
  'register.custom.point': { he: 'מי מכין את זה', en: 'Who makes it' },
  'register.custom.needName': { he: 'חסר שם לפריט', en: 'The item needs a name' },
  'register.custom.needPrice': { he: 'חסר מחיר', en: 'The price is missing' },
  'register.custom.badPrice': { he: 'המחיר לא תקין', en: 'The price is not valid' },
  'register.custom.needPoint': { he: 'בחרו מי מכין את זה', en: 'Choose who makes it' },

  // ---- the ticket ---------------------------------------------------------------------------------------
  'register.t.label': { he: 'ההזמנה', en: 'The order' },
  'register.t.empty': { he: 'הקישו על פריט כדי להוסיף אותו', en: 'Tap an item to add it' },
  'register.t.emptyStart': { he: 'התחילו הזמנה חדשה כדי להוסיף פריטים', en: 'Start a new order to add items' },
  'register.t.noPoint': { he: 'ללא עמדה', en: 'No station' },
  'register.t.total': { he: 'סך הכול', en: 'Total' },
  'register.t.addPhone': { he: 'הוספת טלפון', en: 'Add a phone number' },
  'register.t.addNote': { he: 'הערה להזמנה', en: 'Note for the order' },
  'register.t.orderNote': { he: 'הערה להזמנה כולה', en: 'Note for the whole order' },
  'register.t.orderNotePlaceholder': { he: 'למשל: יאספו ביחד', en: 'For example: they will collect together' },
  'register.hint.add': { he: 'להוסיף להזמנה #{n} של {name}?', en: 'Add to order #{n} for {name}?' },
  'register.line.soldOut': { he: 'אזל. הסירו אותו כדי לשלוח.', en: 'Sold out. Remove it to send.' },
  'register.line.edit': { he: 'עריכת {name}', en: 'Edit {name}' },
  'register.line.for': { he: 'ל: {name}', en: 'For: {name}' },
  'register.line.remove': { he: 'הסרה', en: 'Remove' },
  'register.line.removeNamed': { he: 'הסרת {name}', en: 'Remove {name}' },
  'register.line.lessNamed': { he: 'פחות {name}', en: 'One less {name}' },
  'register.line.moreNamed': { he: 'עוד {name}', en: 'One more {name}' },
  'register.line.gone': { he: 'הפריט כבר לא בתפריט. אפשר להסיר אותו.', en: 'This item is no longer on the menu. You can remove it.' },

  // ---- slip check ------------------------------------------------------------------------------------------
  'register.slip.title': { he: 'בדיקה מול הקבלה', en: 'Check against the slip' },
  'register.slip.ref': { he: 'מס׳ קבלה', en: 'Receipt no.' },
  'register.slip.total': { he: 'סכום בקבלה', en: 'Slip total' },
  'register.slip.match': { he: 'הסכום תואם לקבלה', en: 'The total matches the slip' },
  'register.slip.diff': { he: 'הפרש {amount}', en: 'Difference {amount}' },
  'register.slip.higher': { he: 'הקבלה גבוהה יותר', en: 'the slip is higher' },
  'register.slip.lower': { he: 'הקבלה נמוכה יותר', en: 'the slip is lower' },
  'register.slip.invalid': { he: 'הסכום בקבלה לא תקין', en: 'The slip total is not valid' },

  // ---- send ------------------------------------------------------------------------------------------------
  'register.send.go': { he: 'שליחה', en: 'Send' },
  'register.send.add': { he: 'הוספה להזמנה', en: 'Add to the order' },
  'register.send.sending': { he: 'שולחים…', en: 'Sending…' },
  'register.send.closed': { he: 'האירוע סגור', en: 'The event is closed' },
  'register.send.noLines': { he: 'אין פריטים', en: 'No items yet' },
  'register.send.noName': { he: 'חסר שם לקוח', en: 'Customer name is missing' },
  'register.send.badPhone': { he: 'מספר הטלפון לא תקין', en: 'The phone number is not valid' },
  'register.send.lineProblem': { he: 'יש פריט שאי אפשר להזמין. הסירו אותו.', en: 'One item cannot be ordered. Remove it.' },
  'register.send.offline': { he: 'אין חיבור. אי אפשר להוסיף להזמנה כרגע.', en: 'No connection. Adding to an order is not possible right now.' },
  'register.send.orderVoid': { he: 'ההזמנה בוטלה, אי אפשר להוסיף לה', en: 'The order was cancelled, nothing can be added' },
  'register.send.orderMissing': { he: 'ההזמנה לא נמצאה', en: 'The order was not found' },
  'register.problem.remove': { he: 'הסרת {name}', en: 'Remove {name}' },
  'register.problem.openOrder': { he: 'פתיחת ההזמנה', en: 'Open the order' },
  'register.problem.dismiss': { he: 'סגירה', en: 'Close' },

  // ---- after sending -----------------------------------------------------------------------------------------
  'register.sent.pending': { he: '{name} · שולחים…', en: '{name} · sending…' },
  'register.sent.ok': { he: 'נשלח', en: 'sent' },
  'register.sent.cancelled': { he: 'בוטלה', en: 'cancelled' },
  'register.sent.cancel': { he: 'ביטול', en: 'Cancel' },
  'register.sent.add': { he: 'הוספה להזמנה', en: 'Add to order' },
  'register.sent.updating': { he: 'מתעדכן…', en: 'Updating…' },
  'register.sent.dismiss': { he: 'סגירת ההודעה', en: 'Dismiss' },
  'register.sent.failed': { he: 'ההזמנה של {name} לא נשלחה.', en: "{name}'s order was not sent." },
  'register.sent.retry': { he: 'ניסיון חוזר', en: 'Try again' },
  'register.sent.edit': { he: 'חזרה לעריכה', en: 'Back to editing' },
  'register.sent.finishFirst': { he: 'יש הזמנה פתוחה. סיימו או נקו אותה קודם.', en: 'There is an order in progress. Finish or clear it first.' },

  // ---- add to an existing order --------------------------------------------------------------------------------
  'register.add.banner': { he: 'מוסיפים להזמנה {ticket} · {name}', en: 'Adding to order {ticket} · {name}' },
  'register.add.back': { he: 'הזמנה חדשה במקום', en: 'New order instead' },
  'register.add.done': { he: 'נוספו {n} פריטים להזמנה {ticket}', en: 'Added {n} items to order {ticket}' },
  'register.add.unknown': { he: 'לא בטוחים אם ההוספה נשלחה. פתחו את ההזמנה ובדקו לפני שמנסים שוב.', en: 'We are not sure the addition went through. Open the order and check before trying again.' },

  // ---- confirmations -------------------------------------------------------------------------------------------
  'register.clear.title': { he: 'לנקות את ההזמנה?', en: 'Clear the order?' },
  'register.clear.body': { he: 'כל הפריטים וההערות שהוקלדו יימחקו.', en: 'Everything you typed will be deleted.' },
  'register.clear.yes': { he: 'ניקוי', en: 'Clear' },
  'register.clear.no': { he: 'חזרה', en: 'Go back' },
  'register.mismatch.title': { he: 'הסכום שונה מהקבלה', en: 'The total differs from the slip' },
  'register.mismatch.body': {
    he: 'במערכת {system}, בקבלה {slip}. אם נתנו הנחה בעמדת האשראי זה בסדר. לשלוח בכל זאת?',
    en: 'The system says {system}, the slip says {slip}. A discount at the card terminal is fine. Send anyway?',
  },
  'register.mismatch.yes': { he: 'שליחה', en: 'Send' },
  'register.mismatch.no': { he: 'חזרה לבדיקה', en: 'Go back and check' },
  'register.undo.title': { he: 'לבטל את ההזמנה של {name}?', en: "Cancel {name}'s order?" },
  'register.undo.body': { he: 'כל מה שעוד לא נמסר יבוטל. אפשר להקליד אותה מחדש.', en: 'Everything not yet handed over will be cancelled. You can type it again.' },
  'register.undo.yes': { he: 'ביטול ההזמנה', en: 'Cancel the order' },
  'register.undo.no': { he: 'השארת ההזמנה', en: 'Keep the order' },

  // ---- phone bar -----------------------------------------------------------------------------------------------
  'register.bar.items': { he: '{n} פריטים', en: '{n} items' },
  'register.bar.continue': { he: 'המשך', en: 'Continue' },
} as const satisfies Record<string, Str>
