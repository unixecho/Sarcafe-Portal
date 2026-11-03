/*
 * Sarcafe kiosk app: English and Arabic for the menu the kiosk already has, until the server sends its own.
 *
 * The menu the dashboard publishes carries its English and Arabic names, and /api/kiosk/menu passes them on (each
 * item's `tr`). A kiosk that still holds an older Hebrew-only snapshot, or the menu shipped inside the app, has no
 * `tr`, so the language layer (kiosk-i18n.js) looks words up here instead: Hebrew text -> [English, Arabic]. The
 * names come from the published Givat Haviva menu where it has them. A word missing here simply stays in Hebrew.
 * Data only: nothing here runs.
 */
window.SARCAFE_MENU_GLOSSARY = {
  // categories
  'קפה חם': ['Hot Coffee', 'قهوة ساخنة'],
  'שתייה קרה': ['Cold Beverages', 'مشروبات باردة'],
  'כריכים וטוסטים': ['Sandwiches & Toasts', 'ساندويتشات وتوست'],
  'מאפים': ['Pastries', 'معجنات'],
  'פיצה': ['Pizza', 'بيتزا'],
  'שתייה קלה': ['Soft Drinks', 'مشروبات غازية'],
  'גלידות': ['Ice Cream', 'مثلجات'],
  'שייק פירות טבעי': ['Natural Fruit Shakes', 'شيك فواكه طبيعي'],
  'עוגיות': ['Cookies', 'كوكيز'],

  // hot coffee
  'מנת אספרסו': ['Espresso Shot', 'إسبريسو فردي'],
  'אספרסו כפול': ['Double Espresso', 'إسبريسو مزدوج'],
  'הפוך קטן': ['Small Latte', 'لاتيه صغير'],
  'הפוך גדול': ['Large Latte', 'لاتيه كبير'],
  'אמריקנו קטן': ['Small Americano', 'أمريكانو صغير'],
  'אמריקנו גדול': ['Large Americano', 'أمريكانو كبير'],
  'קפה שחור': ['Black Coffee', 'قهوة سوداء'],
  'חליטת צמחים מיוחדת': ['Special Herbal Tea', 'شاي أعشاب مميز'],
  'תוספת חלב סויה': ['Soy Milk Add-On', 'إضافة حليب الصويا'],
  'תוספת חלב שיבולת שועל': ['Oat Milk Add-On', 'إضافة حليب الشوفان'],

  // cold drinks
  'קפה קר': ['Cold Coffee', 'قهوة باردة'],
  'קפה קר עם חלב וקרח': ['Cold coffee with milk and ice', 'قهوة باردة مع حليب وثلج'],
  'אייס קפה': ['Blended Iced Coffee', 'آيس كافيه'],
  'אייס קפה על בסיס תערובת, עם חלב ומים': ['Blended iced coffee with milk and water', 'آيس كافيه على أساس خليط، مع حليب وماء'],
  'אייס וניל': ['Iced Vanilla', 'آيس فانيلا'],
  'אייס שוקולד': ['Iced Chocolate', 'آيس شوكولاتة'],
  'אמריקנו קר': ['Cold Americano', 'أمريكانو بارد'],
  'תה קר': ['Iced Tea', 'شاي مثلج'],

  // sandwiches and toasts
  'כריכים': ['Sandwiches', 'ساندويتشات'],
  'טוסטים': ['Toasts', 'توست'],
  'קפרזה': ['Caprese', 'كابريزي'],
  "מוצרלה וצ'דר": ['Mozzarella & cheddar', 'موتزاريلا وشيدر'],
  "קסטן פטריות וצ'דר": ['Mushroom & cheddar', 'فطر وشيدر'],
  'גבינה ועגבניה': ['Cheese & tomato', 'جبنة وبندورة'],

  // pastries
  'מאפה רגיל': ['Regular Pastry', 'معجنة عادية'],
  'גבינית': ['Cheese pastry', 'معجنة بالجبنة'],
  'דניש קינמון': ['Cinnamon danish', 'دانش بالقرفة'],
  'רוגעלך גדול': ['Large rugelach', 'روغلاخ كبير'],
  'מאפה אוכמניות': ['Blueberry pastry', 'معجنة بالتوت الأزرق'],
  'גבינה מלוחה': ['Salty cheese', 'جبنة مالحة'],
  'מאפה שקדים': ['Almond pastry', 'معجنة باللوز'],
  'מאפה שווה': ['Handmade Specialty Pastry', 'معجنة مميزة مصنوعة يدويًا'],
  'בעבודת יד — שישי ושבת': ['Handmade — Fri & Sat', 'مصنوعة يدويًا — الجمعة والسبت'],
  'שוקולד בראוניז': ['Chocolate brownies', 'براونيز بالشوكولاتة'],
  'גבינה מלוחה ועגבניות צלויות': ['Salty cheese & roasted tomatoes', 'جبنة مالحة وبندورة مشوية'],
  'פרעצל / בייגלה': ['Pretzel / Beigale', 'بريتزل / بيغلة'],

  // pizza
  'פיצה אישית': ['Personal Pizza', 'بيتزا شخصية'],
  'פיצה גדולה': ['Large Pizza', 'بيتزا كبيرة'],

  // soft drinks
  'פחית שתייה': ['Soda Can', 'علبة مشروب غازي'],
  'פיוז טי': ['Fuze Tea', 'فيوز تي'],
  'מיץ תפוזים פריגת': ['Prigat Orange Juice', 'عصير برتقال بريغات'],
  'סודה': ['Soda Water', 'صودا'],
  'מים': ['Water', 'مياه'],

  // ice cream
  'ארטיק קרח': ['Ice Popsicle', 'مصاصة ثلج'],
  'לה פרוטה': ['La Fruita', 'لا فروتا'],
  'גומיגם': ['Gummy Gum', 'غومي غام'],
  "קראנץ' נוגט נסטלה": ['Nestlé Crunch Nougat', 'كرانش نوغا نستله'],
  'מילקה': ['Milka', 'ميلكا'],
  'קורנטו': ['Cornetto', 'كورنيتو'],
  'גלידת אוראו': ['Oreo Ice Cream', 'بوظة أوريو'],

  // shakes
  'שייק': ['Shake', 'شيك'],
  'עם מים או מגוון סוגי חלב; חלב טבעוני בתוספת 2 ₪': ['With water or a choice of milks; plant milk +2 ₪', 'مع ماء أو أنواع مختلفة من الحليب؛ الحليب النباتي بإضافة 2 ₪'],
  'תות, אוכמניות, דובדבן ורכז תפוח': ['Strawberry, blueberry, cherry & apple concentrate', 'فراولة، توت أزرق، كرز ومركّز تفاح'],
  'אננס, מנגו, פסיפלורה ורכז תפוח': ['Pineapple, mango, passion fruit & apple concentrate', 'أناناس، مانجو، باشن فروت ومركّز تفاح'],
  'תות, תמר ובננה': ['Strawberry, date & banana', 'فراولة، تمر وموز'],
  'מנגו, אננס, קיווי ורכז תפוח': ['Mango, pineapple, kiwi & apple concentrate', 'مانجو، أناناس، كيوي ومركّز تفاح'],
  'בננה תמר': ['Banana & date', 'موز وتمر'],

  // cookies
  '3 שוקולדים': ['Triple Chocolate', 'ثلاثي الشوكولاتة'],
  "שוקולד צ'יפס": ['Chocolate Chip', 'رقائق الشوكولاتة'],
  'בלונדיז': ['Blondies', 'بلونديز'],
};
