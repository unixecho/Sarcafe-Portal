import type { Str } from '../i18n'

// POS strings — area: board (the PUBLIC ready board, read from three metres away).
export const boardStrings = {
  'board.ready': { he: 'מוכן לאיסוף', en: 'Ready for pickup' },
  'board.preparing': { he: 'בהכנה: {n}', en: 'Preparing: {n}' },
  'board.empty': { he: 'כשהזמנה תהיה מוכנה, היא תופיע כאן.', en: 'When an order is ready it will appear here.' },
  'board.reconnecting': { he: 'מתחבר מחדש…', en: 'Reconnecting…' },
  'board.card': { he: '{name}, הזמנה {ticket}, {point}', en: '{name}, order {ticket}, {point}' },
  'board.sound.enable': { he: 'הפעלת צליל', en: 'Turn on sound' },
  'board.sound.on': { he: 'הצליל פועל', en: 'Sound is on' },
  'board.fullscreen': { he: 'מסך מלא', en: 'Full screen' },
  'board.fullscreen.exit': { he: 'יציאה ממסך מלא', en: 'Exit full screen' },
  'board.invalid.title': { he: 'הקישור אינו תקף', en: 'This link is not valid' },
  'board.invalid.body': { he: 'בקשו מהמנהל/ת קישור חדש ללוח ההזמנות.', en: 'Ask a manager for a new link to the ready board.' },
  'board.title': { he: 'הזמנות מוכנות', en: 'Ready orders' },
  'board.loading': { he: 'טוען…', en: 'Loading…' },
} as const satisfies Record<string, Str>
