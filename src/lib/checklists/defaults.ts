import type { ChecklistCategory, ChecklistDefinition, ChecklistIssueType, ChecklistKind } from './types'

const item = (
  id: string,
  label: string,
  issueType: ChecklistIssueType = 'other',
  kind: 'status' | 'action' | 'number' = 'status',
  help?: string,
  target?: number,
  unit?: string
) => ({ id, label, issueType, kind, required: true, ...(help ? { help } : {}), ...(target !== undefined ? { target } : {}), ...(unit ? { unit } : {}) })

const category = (id: string, title: string, items: ReturnType<typeof item>[]): ChecklistCategory => ({ id, title, items })

const opening: ChecklistDefinition = {
  categories: [
    category('start', 'מתחילים ומדליקים', [
      item('O01', 'כניסה לשעון הנוכחות בקופה', 'other', 'action'),
      item('O02-coffee', 'הדלקת מכונת הקפה', 'equipment', 'action'),
      item('O02-toaster', 'הדלקת הטוסטר', 'equipment', 'action'),
      item('O02-oven', 'הדלקת טאבון הפיצה', 'equipment', 'action'),
    ]),
    category('clean-order', 'ניקיון וסדר בעגלה', [
      item('O03', 'העגלה נקייה', 'cleanliness'),
      item('O04', 'העגלה מסודרת', 'other'),
      item('O09-coffee', 'עמדת הקפה מסודרת', 'other'),
      item('O09-toaster', 'עמדת הטוסטר מסודרת', 'other'),
      item('O09-pastry', 'עמדת המאפים מסודרת', 'other'),
    ]),
    category('ice', 'קרח ואייס', [
      item('O05-machine', 'מכונת הקרח והמלאי בה תקינים', 'equipment'),
      item('O05-empty', 'הקרח רוקן למיכל הראשי במקפיא', 'inventory', 'action'),
      item('O07-coffee-machine', 'יש אייס קפה במכונה', 'inventory'),
      item('O07-vanilla-machine', 'יש אייס וניל במכונה', 'inventory'),
      item('O07-coffee-spare', 'יש אייס קפה ספייר במקרר', 'inventory'),
      item('O07-vanilla-spare', 'יש אייס וניל ספייר במקרר', 'inventory'),
    ]),
    category('pastries', 'מאפים, כריכים וטוסטים', [
      item('O06', 'הוצאו 2 מאפים מכל סוג', 'inventory', 'action', 'אם חסר סוג מאפה, כתבו איזה סוג ולמה.'),
      item('O08-sandwich', 'הכריכים מסודרים לפי תאריך — הקרוב לפוג מקדימה', 'inventory', 'action'),
      item('O08-toast', 'הטוסטים מסודרים לפי תאריך — הקרוב לפוג מקדימה', 'inventory', 'action'),
      item('O18', 'יש אריזות תקינות למאפים', 'inventory'),
    ]),
    category('pizza', 'פיצה', [
      item('O11-double', 'יש פיצות זוגיות תקינות במקרר', 'inventory'),
      item('O11-single', 'יש פיצות אישיות תקינות במקרר', 'inventory'),
      item('O12-double', 'יש קופסאות לפיצה זוגית', 'inventory'),
      item('O12-single', 'יש קופסאות לפיצה אישית', 'inventory'),
    ]),
    category('cookies-shakes', 'עוגיות ושייקים', [
      item('O13-fridge', 'יש עוגיות תקינות במקרר', 'inventory'),
      item('O13-freezer', 'יש עוגיות תקינות במקפיא', 'inventory'),
      item('O14', 'מלאי השייקים במקפיא קיים ותקין', 'inventory', 'status', 'אפשר להוסיף כאן כל סוג שייק כבדיקה נפרדת.'),
    ]),
    category('cups', 'כוסות ומכסים', [
      item('O10-shots', 'יש כוסות שוטים בעמדת הקפה', 'inventory'),
      item('O10-small', 'יש כוסות הפוך קטן', 'inventory'),
      item('O10-large', 'יש כוסות הפוך גדול', 'inventory'),
      item('O10-ice', 'יש כוסות גדולות שקופות לאייס', 'inventory'),
      item('O10-lids', 'יש מכסים לכוסות האייס', 'inventory'),
      item('O16', 'יש 3 שרוולי ספייר מכל סוג כוס ומכסה', 'inventory'),
    ]),
    category('ingredients', 'חומרי הכנה וחלב', [
      item('O15-chocolate', 'יש תרכיז שוקו להכנה', 'inventory'),
      item('O15-sugar', 'יש מי סוכר', 'inventory'),
      item('O15-ketchup', 'יש קטשופ לפיצה', 'inventory'),
      item('O15-spice', 'יש תבלין לפיצה', 'inventory'),
      item('O15-powder', 'יש אבקת סוכר למאפים', 'inventory'),
      item('O17-regular', 'יש חלב רגיל', 'inventory'),
      item('O17-oat', 'יש חלב שיבולת שועל', 'inventory'),
      item('O17-soy-sweet', 'יש סויה במתיקות מעודנת', 'inventory'),
      item('O17-soy', 'יש סויה ללא תוספת סוכר', 'inventory'),
      item('O17-water', 'יש קנקן מים לאמריקנו', 'inventory'),
      item('O17-almond', 'יש חלב שקדים', 'inventory'),
    ]),
    category('drinks', 'שתייה קרה', [
      item('O19-fridge', 'מלאי הפחיות והשתייה במקרר קיים ותקין', 'inventory'),
      item('O19-spare', 'יש לפחות 3 משטחי שתייה מתחת לעמדת הטוסטים', 'inventory'),
    ]),
    category('register-area', 'קופה וסביבת העגלה', [
      item('O20', 'הצהרת פתיחת הקופה בוצעה', 'cash', 'action'),
      item('O21-area', 'סביבת העגלה מסודרת', 'other', 'action'),
      item('O21-seating', 'פינות הישיבה נקיות', 'cleanliness'),
    ]),
    category('ready', 'מוכנים לקבל קהל', [
      item('O22', 'החלונות נפתחו לקבלת קהל רק אחרי שהכול מוכן', 'other', 'action'),
    ]),
  ],
}

const handover: ChecklistDefinition = {
  categories: [
    category('inventory', 'מלאי להמשך המשמרת', [item('H01', 'מלאי כל מוצרי העגלה קיים ותקין', 'inventory', 'status', 'אם חסר משהו, כתבו בדיוק מה חסר ולמה.')]),
    category('handover-clean', 'ניקיון ומסירה', [
      item('H02', 'הכיור נקי', 'cleanliness'),
      item('H03-clean', 'העגלה נקייה', 'cleanliness'),
      item('H03-order', 'העגלה מסודרת', 'other'),
    ]),
  ],
}

function closingFor(branchSlug: string): ChecklistDefinition {
  const cashTarget = branchSlug === 'maor' ? 400 : 500
  const categories: ChecklistCategory[] = [
    category('clean-tools', 'ניקוי כלי העבודה', [
      item('C01', 'כלי ההגשה, הכוסות, הצלחות והסכו״ם נוקו', 'cleanliness', 'action'),
      item('C02', 'כדי החלב ומכונת הקפה נוקו, כולל המגרעת והידיות עם ראש 0', 'cleanliness', 'action'),
      item('C03', 'כל המטליות הוחלפו ונשארו נקיות למחר', 'cleanliness', 'action', 'אם אין נקיות: לשטוף בסבון ומים חמים ולתלות לייבוש.'),
    ]),
    category('power-off', 'כיבוי מכונות', [
      item('C04', 'מכונת הקפה כובתה', 'equipment', 'action'),
      item('C05', 'הטוסטר כובה', 'equipment', 'action'),
      item('C06', 'הטאבון כובה', 'equipment', 'action'),
    ]),
    category('next-shift', 'מלאי למשמרת הבאה', [
      item('C07-cups', 'מולא מלאי כוסות', 'inventory', 'action'),
      item('C07-cans', 'מולא מלאי פחיות במקרר', 'inventory', 'action'),
      item('C07-ice', 'מולא מלאי אייס', 'inventory', 'action'),
      item('C07-pizza', 'מולא מלאי פיצות ומגשי פיצה', 'inventory', 'action'),
      item('C07-sugar', 'מולא מלאי מי סוכר ושוקולית', 'inventory', 'action'),
    ]),
    category('inside-out', 'ניקיון פנים וחוץ', [
      item('C08', 'הפחים בפנים ובחוץ רוקנו', 'cleanliness', 'action'),
      item('C09', 'פינות הישיבה ופינת המשחקים סודרו', 'other', 'action'),
      item('C12', 'הרצפה נשטפה ביסודיות', 'cleanliness', 'action'),
    ]),
    category('locks', 'סגירת ציוד ופתחים', [
      item('C10', 'החלונות נסגרו וננעלו', 'equipment', 'action'),
      item('C11', 'מקפיא הארטיקים ומקרר השתייה כוסו וננעלו', 'equipment', 'action'),
    ]),
    category('register-exit', 'קופה ויציאה', [
      item('C13', `ספירת קופה — היעד הוא ${cashTarget} ₪`, 'cash', 'number', 'הזינו את הסכום בפועל. אם יש הפרש, כתבו סיבה.', cashTarget, '₪'),
      item('C14', 'יציאה משעון הנוכחות בקופה בוצעה', 'other', 'action'),
      item('C15', 'הדלת ננעלה', 'equipment', 'action'),
    ]),
  ]
  if (branchSlug === 'maor') {
    categories[3]!.items.push(item('C16', 'כל הכריות הוכנסו לאוהל מפני גשם ולכלוך', 'other', 'action'))
  }
  return { categories }
}

export function defaultChecklistDefinition(kind: ChecklistKind, branchSlug: string): ChecklistDefinition {
  if (kind === 'opening') return opening
  if (kind === 'handover') return handover
  return closingFor(branchSlug)
}

export const checklistName = (kind: ChecklistKind) =>
  kind === 'opening' ? 'פתיחת משמרת' : kind === 'handover' ? 'החלפת משמרת' : 'סגירת משמרת'
