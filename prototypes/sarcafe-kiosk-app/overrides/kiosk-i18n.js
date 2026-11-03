/*
 * Sarcafe kiosk app: Hebrew, English and Arabic.
 *
 * Hebrew is the kiosk's language and what every visit starts in. A small switch (עברית · English · العربية) sits at
 * the top of every screen; a tap changes the whole kiosk at once, the direction too (Hebrew and Arabic right to left,
 * English left to right). The choice belongs to the visitor: the privacy reset that ends every visit puts Hebrew back,
 * and a language picked on the welcome screen by someone who then walked away goes back to Hebrew after the same
 * idle time as a visit.
 *
 * This file loads first among the body layers. It owns every fixed word on the page (the prototype's HTML, the menu
 * badges) and offers the other layers:
 *
 *   window.KioskI18n = { lang, langs, names, dir(lang), t(key, ...args), set(lang, reason), onChange(fn),
 *                        menuText(hebrew), menuName(hebrew) }
 *
 * Layers that draw their own words (announcements, warning, sign-up messages, legal texts, keypad) call t() and
 * redraw in onChange. The menu: app.js renders window.SARCAFE_MENU; this layer swaps the shown words in that same
 * object (from the item's `tr` sent by the server, else kiosk-menu-i18n.js, else the Hebrew) and asks app.js to
 * render again. Every word goes in as text, never as HTML.
 *
 * Test hook: ?kioskLang=en|ar starts in that language (the kiosk has no address bar; ignored unless set).
 */
(() => {
  const LANGS = ['he', 'en', 'ar'];
  const NAMES = { he: 'עברית', en: 'English', ar: 'العربية' };
  const DIR = { he: 'rtl', en: 'ltr', ar: 'rtl' };
  const COL = { en: 0, ar: 1 }; // column in the glossary

  // ---- the words ----------------------------------------------------------------------------------------------
  // A value is a string, or a function of the arguments. '\n' is a line break where the screen had one.
  const T = {
    he: {
      title: 'שרקפה גבעת חביבה — חוויית קיוסק',
      langAria: 'שפה',
      homeAria: 'חזרה למסך הפתיחה',
      logoAlt: 'שרקפה',
      branch: 'גבעת חביבה',
      menuCount: (n) => `${n} פריטים בתפריט`,
      welcomeTagline: 'קפה טוב. אוכל טרי. רגע של שקט.',
      welcomeTitle: 'ברוכים הבאים\nלשרקפה',
      startCta: 'לחץ להתחיל',
      footnote: 'נגיעה אחת, וממשיכים לתפריט או להצטרפות מהירה',
      credit: 'פרויקט שנוצר ביוזמת ג׳ון, אחד מעובדי הרשת, לטובת הרשת ובאישורה. המידע שמוסרים כאן ניתן מרצון ובהסכמה.',
      choiceTitle: 'איך תרצו להמשיך?',
      choiceLead: 'שתי אפשרויות ברורות. אפשר לשנות בחירה בכל רגע.',
      choiceJoinTitle: 'להצטרף למועדון הלקוחות העתידי',
      choiceJoinText: 'נקודות, הטבות, פרסים, הגרלות ועדכונים — כשהמועדון ייפתח.',
      choiceMenuTitle: 'לצפות בתפריט',
      choiceMenuText: (n) => `${n} פריטים מהתפריט שפורסם בגבעת חביבה, עם מחירים וזמינות.`,
      backToChoice: 'חזרה לבחירה',
      joinTitle: 'מועדון שיחזיר לכם יותר מכל ביקור',
      joinLead: 'המועדון עדיין בהקמה. כשייפתח, תוכלו לצבור נקודות, להשתמש ביתרה שצברתם למימוש פרסים והטבות, ולהשתתף בהגרלות עתידיות.',
      benefitsAria: 'מה מתוכנן במועדון',
      benefits: ['צוברים נקודות', 'מממשים הטבות ופרסים', 'משתתפים בהגרלות עתידיות', 'מקבלים עדכונים בניוזלטר, בהסכמה נפרדת'],
      phoneTitle: 'נתחיל במספר הנייד',
      phoneLabel: 'מספר נייד',
      phoneSubmit: 'המשך לאישור קצר',
      phoneHelp: 'הצטרפות לעדכונים שיווקיים אינה חובה ולא מסומנת מראש.',
      phoneInvalid: 'כתבו מספר נייד ישראלי בן 10 ספרות, שמתחיל ב־05.',
      numpadAria: 'מקלדת ספרות',
      numpadClear: 'נקה',
      numpadBack: 'מחיקת ספרה',
      menuTitle: 'מה יש היום בשרקפה?',
      menuLead: 'גבעת חביבה · תפריט שפורסם במערכת · מזמינים בדלפק',
      menuJoin: 'רוצים לשמוע על המועדון?',
      tabsAria: 'קטגוריות התפריט',
      snapshot: 'צילום נתונים לקריאה בלבד מהתפריט שפורסם. עודכן במקור: ',
      recommended: 'כדאי לטעום',
      left: (n) => `נשארו ${n}`,
      soldOut: 'אזל',
      back: 'חזרה',
      consentTitle: 'כמעט סיימנו',
      consentLead: 'זה עדיין לא מועדון פעיל. זו רק בקשה לקבל עדכון כשנפתח.',
      phoneSummary: 'המספר לעדכון',
      change: 'שינוי',
      nameLabel: 'איך לפנות אליכם?',
      namePlaceholder: 'שם פרטי',
      emailLabel: 'דוא״ל ',
      optional: 'לא חובה',
      submitConsent: 'כן, הוסיפו אותי לרשימת המתעניינים',
      successTitle: 'זהו, אתם ברשימה',
      successText: 'נעדכן רק כשיהיה משהו אמיתי לספר. הפרטים כבר נוקו מהמסך.',
      successMenu: 'בינתיים, מה יש בתפריט?',
      errorTitle: 'התפריט עדיין כאן.\nההרשמה תחכה לחיבור.',
      errorText: 'לא נשמור את המספר על הטאבלט. אפשר לנסות שוב כשהרשת חוזרת או להמשיך לתפריט האחרון שנבדק.',
      errorRetry: 'לנסות שוב',
      errorMenu: 'לתפריט השמור',
      privacy: 'פרטיות',
      // the sign-up (kiosk-signup.js)
      needNameAndConsent: 'כדי להמשיך צריך שם פרטי ואישור הודעת הפרטיות ותנאי השימוש.',
      badEmail: 'כתובת הדוא״ל לא נראית תקינה. אפשר גם להשאיר אותה ריקה.',
      alreadyRegistered: 'המספר הזה כבר רשום ברשימה, ואין צורך להירשם שוב. אם הקלדתם מספר אחר בטעות, אפשר לשנות אותו.',
      notReceived: 'משהו בפרטים לא נקלט. בדקו את השם, המספר והדוא״ל ונסו שוב.',
      // the privacy-reset warning (kiosk-session.js)
      warnTitle: 'עדיין כאן?',
      warnText: 'לא זיהינו פעילות כבר זמן מה. המסך יתאפס כדי לשמור על פרטיותכם.',
      warnLeft: ['האיפוס בעוד ', ' שניות'],
      warnStay: 'אני עדיין כאן',
      warnReset: 'סיום ואיפוס',
      // the welcome screen (kiosk-attract.js)
      kinds: { location: 'סניף האם', feedback: 'משוב', loyalty: 'מועדון לקוחות', hours: 'שעות פתיחה', menu_highlight: 'מהתפריט', custom: 'שרקפה' },
      clubNote: 'המועדון בהקמה · ההטבות עוד לא פעילות',
      ctaJoin: 'לחצו להצטרפות לרשימה',
      ctaMenu: 'לחצו לתפריט',
      btnMenu: 'לתפריט שלנו',
      btnJoin: 'הצטרפו למועדון',
      adsAria: 'עדכונים משרקפה',
      carousel: 'קרוסלה',
      qrAria: 'קוד QR',
      today: 'היום ',
      closedToday: 'היום סגור',
      closed: 'סגור',
      day: (d) => `יום ${['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][d]}`,
    },

    en: {
      title: 'Sarcafe Givat Haviva — Kiosk',
      langAria: 'Language',
      homeAria: 'Back to the start screen',
      logoAlt: 'Sarcafe',
      branch: 'Givat Haviva',
      menuCount: (n) => `${n} items on the menu`,
      welcomeTagline: 'Good coffee. Fresh food. A quiet moment.',
      welcomeTitle: 'Welcome\nto Sarcafe',
      startCta: 'Tap to start',
      footnote: 'One tap and you are on to the menu or a quick sign-up',
      credit: 'A project created on the initiative of John, one of the chain’s employees, for the benefit of the chain and with its approval. Information given here is given voluntarily and with consent.',
      choiceTitle: 'How would you like to continue?',
      choiceLead: 'Two clear options. You can change your choice at any moment.',
      choiceJoinTitle: 'Join the future customer club',
      choiceJoinText: 'Points, perks, prizes, raffles and updates — once the club opens.',
      choiceMenuTitle: 'View the menu',
      choiceMenuText: (n) => `${n} items from the published Givat Haviva menu, with prices and availability.`,
      backToChoice: 'Back to the options',
      joinTitle: 'A club that gives you more from every visit',
      joinLead: 'The club is still being set up. Once it opens, you will be able to collect points, use your balance for prizes and perks, and take part in future raffles.',
      benefitsAria: 'What is planned for the club',
      benefits: ['Collect points', 'Redeem perks and prizes', 'Enter future raffles', 'Get newsletter updates, with separate consent'],
      phoneTitle: 'Let’s start with your mobile number',
      phoneLabel: 'Mobile number',
      phoneSubmit: 'Continue to a short confirmation',
      phoneHelp: 'Signing up for marketing updates is optional and never pre-ticked.',
      phoneInvalid: 'Enter a 10-digit Israeli mobile number that starts with 05.',
      numpadAria: 'Number keypad',
      numpadClear: 'Clear',
      numpadBack: 'Delete a digit',
      menuTitle: 'What’s on at Sarcafe today?',
      menuLead: 'Givat Haviva · The published menu · Order at the counter',
      menuJoin: 'Want to hear about the club?',
      tabsAria: 'Menu categories',
      snapshot: 'A read-only copy of the published menu. Last updated: ',
      recommended: 'Worth a taste',
      left: (n) => `${n} left`,
      soldOut: 'Sold out',
      back: 'Back',
      consentTitle: 'Almost done',
      consentLead: 'This is not an active club yet. It is only a request to hear from us when it opens.',
      phoneSummary: 'Number for updates',
      change: 'Change',
      nameLabel: 'What should we call you?',
      namePlaceholder: 'First name',
      emailLabel: 'Email ',
      optional: 'optional',
      submitConsent: 'Yes, add me to the interest list',
      successTitle: 'That’s it, you’re on the list',
      successText: 'We will only be in touch when there is something real to tell. Your details have already been cleared from the screen.',
      successMenu: 'Meanwhile, what’s on the menu?',
      errorTitle: 'The menu is still here.\nSign-up will wait for the connection.',
      errorText: 'We will not keep your number on the tablet. You can try again when the network is back, or continue to the last menu we checked.',
      errorRetry: 'Try again',
      errorMenu: 'To the saved menu',
      privacy: 'Privacy',
      needNameAndConsent: 'To continue we need a first name and your confirmation of the privacy notice and the terms of use.',
      badEmail: 'That email address does not look right. You can also leave it empty.',
      alreadyRegistered: 'This number is already on the list, so there is no need to sign up again. If you typed a different number by mistake, you can change it.',
      notReceived: 'Something in the details did not go through. Check the name, the number and the email and try again.',
      warnTitle: 'Still here?',
      warnText: 'We have not noticed any activity for a while. The screen will reset to protect your privacy.',
      warnLeft: ['Resetting in ', ' seconds'],
      warnStay: 'I’m still here',
      warnReset: 'Finish and reset',
      kinds: { location: 'Our main branch', feedback: 'Feedback', loyalty: 'Customer club', hours: 'Opening hours', menu_highlight: 'From the menu', custom: 'Sarcafe' },
      clubNote: 'The club is being set up · perks are not active yet',
      ctaJoin: 'Tap to join the list',
      ctaMenu: 'Tap for the menu',
      btnMenu: 'Our menu',
      btnJoin: 'Join the club',
      adsAria: 'News from Sarcafe',
      carousel: 'carousel',
      qrAria: 'QR code',
      today: 'Today ',
      closedToday: 'Closed today',
      closed: 'Closed',
      day: (d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d],
    },

    ar: {
      title: 'ساركافيه جفعات حبيبة — الكشك',
      langAria: 'اللغة',
      homeAria: 'العودة إلى شاشة البداية',
      logoAlt: 'ساركافيه',
      branch: 'جفعات حبيبة',
      menuCount: (n) => `عدد الأصناف في القائمة: ${n}`,
      welcomeTagline: 'قهوة طيبة. طعام طازج. لحظة هدوء.',
      welcomeTitle: 'أهلًا وسهلًا\nفي ساركافيه',
      startCta: 'اضغطوا للبدء',
      footnote: 'لمسة واحدة وتنتقلون إلى القائمة أو إلى تسجيل سريع',
      credit: 'مشروع أُنشئ بمبادرة جون، أحد موظفي السلسلة، لصالح السلسلة وبموافقتها. المعلومات التي تُقدَّم هنا تُعطى طوعًا وبموافقة.',
      choiceTitle: 'كيف تودّون المتابعة؟',
      choiceLead: 'خياران واضحان. يمكنكم تغيير اختياركم في أي لحظة.',
      choiceJoinTitle: 'الانضمام إلى نادي الزبائن المستقبلي',
      choiceJoinText: 'نقاط، امتيازات، جوائز، سحوبات وتحديثات — عند افتتاح النادي.',
      choiceMenuTitle: 'عرض القائمة',
      choiceMenuText: (n) => `أصناف القائمة المنشورة في جفعات حبيبة (${n})، مع الأسعار والتوفّر.`,
      backToChoice: 'العودة إلى الخيارات',
      joinTitle: 'نادٍ يمنحكم أكثر من كل زيارة',
      joinLead: 'النادي لا يزال قيد الإنشاء. عند افتتاحه ستتمكنون من جمع النقاط، واستخدام رصيدكم للحصول على جوائز وامتيازات، والمشاركة في سحوبات مستقبلية.',
      benefitsAria: 'ما المخطط له في النادي',
      benefits: ['اجمعوا النقاط', 'استبدلوا الامتيازات والجوائز', 'شاركوا في سحوبات مستقبلية', 'احصلوا على تحديثات النشرة الإخبارية، بموافقة منفصلة'],
      phoneTitle: 'لنبدأ برقم الهاتف المحمول',
      phoneLabel: 'رقم الهاتف المحمول',
      phoneSubmit: 'المتابعة إلى تأكيد قصير',
      phoneHelp: 'الاشتراك في التحديثات التسويقية اختياري وغير محدد مسبقًا.',
      phoneInvalid: 'أدخلوا رقم هاتف محمول إسرائيليًا من 10 أرقام يبدأ بـ 05.',
      numpadAria: 'لوحة الأرقام',
      numpadClear: 'مسح',
      numpadBack: 'حذف رقم',
      menuTitle: 'ماذا يوجد اليوم في ساركافيه؟',
      menuLead: 'جفعات حبيبة · القائمة المنشورة · الطلب عند المنضدة',
      menuJoin: 'هل تودّون السماع عن النادي؟',
      tabsAria: 'فئات القائمة',
      snapshot: 'نسخة للقراءة فقط من القائمة المنشورة. آخر تحديث: ',
      recommended: 'ننصح بتجربته',
      left: (n) => `تبقّى ${n}`,
      soldOut: 'نفدت الكمية',
      back: 'رجوع',
      consentTitle: 'أوشكنا على الانتهاء',
      consentLead: 'هذا ليس ناديًا فعّالًا بعد. إنه مجرد طلب لتلقي تحديث عند افتتاحه.',
      phoneSummary: 'الرقم للتحديثات',
      change: 'تغيير',
      nameLabel: 'بماذا نناديكم؟',
      namePlaceholder: 'الاسم الشخصي',
      emailLabel: 'البريد الإلكتروني ',
      optional: 'اختياري',
      submitConsent: 'نعم، أضيفوني إلى قائمة المهتمين',
      successTitle: 'تم، أنتم في القائمة',
      successText: 'سنتواصل معكم فقط عندما يكون هناك ما يستحق. تم مسح تفاصيلكم من الشاشة.',
      successMenu: 'في هذه الأثناء، ماذا يوجد في القائمة؟',
      errorTitle: 'القائمة لا تزال هنا.\nالتسجيل سينتظر عودة الاتصال.',
      errorText: 'لن نحتفظ برقمكم على الجهاز اللوحي. يمكنكم المحاولة مرة أخرى عند عودة الشبكة، أو المتابعة إلى آخر قائمة تم فحصها.',
      errorRetry: 'المحاولة مرة أخرى',
      errorMenu: 'إلى القائمة المحفوظة',
      privacy: 'الخصوصية',
      needNameAndConsent: 'للمتابعة نحتاج إلى الاسم الشخصي وتأكيدكم لإشعار الخصوصية وشروط الاستخدام.',
      badEmail: 'يبدو أن عنوان البريد الإلكتروني غير صحيح. يمكنكم أيضًا تركه فارغًا.',
      alreadyRegistered: 'هذا الرقم مسجّل بالفعل في القائمة، ولا حاجة للتسجيل مرة أخرى. إذا أدخلتم رقمًا آخر بالخطأ، يمكنكم تغييره.',
      notReceived: 'لم يتم استلام بعض التفاصيل. تحققوا من الاسم والرقم والبريد الإلكتروني وحاولوا مرة أخرى.',
      warnTitle: 'هل ما زلتم هنا؟',
      warnText: 'لم نلاحظ أي نشاط منذ فترة. ستُعاد الشاشة إلى البداية حفاظًا على خصوصيتكم.',
      warnLeft: ['إعادة الضبط خلال ', ' ثوانٍ'],
      warnStay: 'ما زلت هنا',
      warnReset: 'إنهاء وإعادة ضبط',
      kinds: { location: 'الفرع الرئيسي', feedback: 'رأيكم', loyalty: 'نادي الزبائن', hours: 'ساعات العمل', menu_highlight: 'من القائمة', custom: 'ساركافيه' },
      clubNote: 'النادي قيد الإنشاء · الامتيازات غير فعّالة بعد',
      ctaJoin: 'اضغطوا للانضمام إلى القائمة',
      ctaMenu: 'اضغطوا لعرض القائمة',
      btnMenu: 'قائمتنا',
      btnJoin: 'انضموا إلى النادي',
      adsAria: 'أخبار من ساركافيه',
      carousel: 'عرض متتابع',
      qrAria: 'رمز QR',
      today: 'اليوم ',
      closedToday: 'مغلق اليوم',
      closed: 'مغلق',
      day: (d) => ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][d],
    },
  };

  // The announcements the kiosk ships with, and the ones the dashboard starts with (migration 20261028171500).
  // An announcement whose Hebrew is exactly one of these shows its translation; one the owner wrote stays as written.
  const ANNOUNCEMENTS = {
    'סניף האם במאור': ['Our main branch in Maor', 'فرعنا الرئيسي في ماؤور'],
    'בואו לבקר את סניף האם שלנו במאור באווירת מושב חמה בימי ראשון עד שישי': [
      'Come and visit our main branch in Maor, with a warm village atmosphere, Sunday to Friday',
      'تعالوا لزيارة فرعنا الرئيسي في ماؤور بأجواء قروية دافئة، من الأحد حتى الجمعة'],
    'מה תרצו למצוא בעגלה?': ['What would you like to find at the truck?', 'ماذا تودّون أن تجدوا في العربة؟'],
    'מה תרצו שנגיש?': ['What would you like us to serve?', 'ماذا تودّون أن نقدّم؟'],
    'סרקו את קוד ה-QR כדי להצביע ולהשפיע על מה שיש לעגלה להציע — אנחנו רוצים לשמוע אתכם': [
      'Scan the QR code to vote and help shape what the truck offers — we want to hear from you',
      'امسحوا رمز QR للتصويت والمساهمة في تحديد ما تقدّمه العربة — نريد أن نسمع منكم'],
    'מועדון הלקוחות של שרקפה': ['The Sarcafe customer club', 'نادي زبائن ساركافيه'],
    'מועדון לקוחות — בקרוב': ['Customer club — coming soon', 'نادي الزبائن — قريبًا'],
    'מעוניינים במועדון לקוחות עם צבירת נקודות ואירועים? הירשמו בלחיצה על המסך': [
      'Interested in a customer club with points and events? Sign up with a tap on the screen',
      'مهتمون بنادي زبائن مع جمع النقاط وفعاليات؟ سجّلوا بلمسة على الشاشة'],
    'שעות הפתיחה': ['Opening hours', 'ساعات العمل'],
    'כדאי לטעום': ['Worth a taste', 'ننصح بتجربته'],
    'המומלצים שלנו': ['Our recommendations', 'توصياتنا'],
    'מהתפריט של היום': ['From today’s menu', 'من قائمة اليوم'],
  };

  // ---- state ----------------------------------------------------------------------------------------------------
  const root = document.documentElement;
  const body = document.body;
  let lang = 'he';
  const listeners = [];

  const word = (key, l) => (T[l] && key in T[l] ? T[l][key] : T.he[key]);
  function t(key, ...args) {
    const value = word(key, lang);
    return typeof value === 'function' ? value(...args) : value;
  }

  // Hebrew menu / announcement text -> the same in the current language ('' when not known)
  const SOLD_SUFFIX = ' — אזל';
  function lookup(table, he) {
    if (lang === 'he' || typeof he !== 'string') return '';
    const row = table[he];
    return row ? row[COL[lang]] || '' : '';
  }
  function menuText(he) {
    if (lang === 'he' || typeof he !== 'string') return he;
    if (he === T.he.soldOut) return t('soldOut');
    if (he.endsWith(SOLD_SUFFIX)) {
      const base = he.slice(0, -SOLD_SUFFIX.length);
      return `${lookup(window.SARCAFE_MENU_GLOSSARY || {}, base) || base} — ${t('soldOut')}`;
    }
    return lookup(window.SARCAFE_MENU_GLOSSARY || {}, he) || he;
  }
  const announcement = (he) => lookup(ANNOUNCEMENTS, he) || he;

  // ---- the menu app.js renders ------------------------------------------------------------------------------------
  // Each category/item keeps its Hebrew in `__he` the first time; the shown fields then follow the language.
  const keep = (obj, fields) => {
    if (!obj.__he) Object.defineProperty(obj, '__he', { value: fields(), enumerable: false });
    return obj.__he;
  };
  function localizeMenu() {
    const menu = window.SARCAFE_MENU;
    if (!menu || !Array.isArray(menu.categories)) return;
    menu.categories.forEach((category) => {
      if (!category) return;
      const heCat = keep(category, () => ({ title: category.title }));
      const trCat = lang !== 'he' && category.tr && category.tr[lang];
      category.title = lang === 'he' ? heCat.title : (trCat && typeof trCat.title === 'string' && trCat.title) || menuText(heCat.title);
      (category.items || []).forEach((item) => {
        if (!item) return;
        const he = keep(item, () => ({ name: item.name, note: item.note, types: Array.isArray(item.types) ? item.types.slice() : item.types }));
        const tr = lang !== 'he' && item.tr && item.tr[lang] && typeof item.tr[lang] === 'object' ? item.tr[lang] : null;
        if (lang === 'he') {
          item.name = he.name; item.note = he.note; item.types = Array.isArray(he.types) ? he.types.slice() : he.types;
          return;
        }
        item.name = (tr && typeof tr.name === 'string' && tr.name) || menuText(he.name);
        item.note = he.note === undefined ? undefined : ((tr && typeof tr.note === 'string' && tr.note) || menuText(he.note));
        if (Array.isArray(he.types)) {
          const trTypes = tr && Array.isArray(tr.types) && tr.types.length === he.types.length ? tr.types : null;
          item.types = he.types.map((type, i) => (trTypes && typeof trTypes[i] === 'string' && trTypes[i]) || menuText(type));
        }
      });
    });
  }
  // the name an item shows now, from its Hebrew name (the announcements' menu highlights come in Hebrew)
  function menuName(he) {
    const menu = window.SARCAFE_MENU;
    for (const category of (menu && menu.categories) || []) {
      for (const item of (category && category.items) || []) {
        if (item && item.__he && item.__he.name === he) return item.name;
      }
    }
    return menuText(he);
  }
  function itemCount() {
    const menu = window.SARCAFE_MENU;
    return ((menu && menu.categories) || []).reduce((sum, category) => sum + ((category && category.items) || []).length, 0);
  }

  // app.js draws the badges itself in Hebrew; they follow the language as soon as the list is drawn
  const content = document.querySelector('.menu-content');
  function badges() {
    if (!content) return;
    content.querySelectorAll('.badge').forEach((badge) => {
      const text = badge.textContent;
      const he = badge.dataset.he || text;
      if (!badge.dataset.he) badge.dataset.he = he;
      const left = /^נשארו (\d+)$/.exec(he);
      const shown = he === T.he.recommended ? t('recommended') : left ? t('left', Number(left[1])) : he;
      if (text !== shown) badge.textContent = shown;
    });
  }
  if (content) new MutationObserver(badges).observe(content, { childList: true });

  // app.js says "wrong number" in Hebrew; this listener runs right after it and says it in the visitor's language
  const quickForm = document.querySelector('.quick-form');
  if (quickForm) quickForm.addEventListener('submit', () => {
    const message = quickForm.querySelector('.quick-message');
    if (message && message.textContent && lang !== 'he') message.textContent = t('phoneInvalid');
  });

  function rerenderMenu() {
    localizeMenu();
    const tab = document.querySelector('.category-tabs [aria-selected="true"]') || document.querySelector('.category-tabs [data-category]');
    if (tab) tab.click(); // app.js draws the tabs and the list again from the (now translated) menu
  }

  // ---- the fixed words on the page ------------------------------------------------------------------------------
  const $ = (selector) => document.querySelectorAll(selector);
  const textNodes = (el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim());
  // the element's own words: its first (or only) text node; elements around it (icons, inputs) stay
  function setOwnText(el, text, which) {
    const nodes = textNodes(el);
    const node = which === 'last' ? nodes[nodes.length - 1] : nodes[0];
    if (node) { if (node.nodeValue !== text) node.nodeValue = text; return; }
    if (!el.children.length) { el.textContent = text; return; }
    el.append(document.createTextNode(text));
  }
  // words with a line break in them (the welcome title, the error title)
  function setLines(el, text) {
    const parts = text.split('\n');
    const nodes = [];
    parts.forEach((part, i) => { if (i) nodes.push(document.createElement('br')); nodes.push(document.createTextNode(part)); });
    el.replaceChildren(...nodes);
  }
  const each = (selector, fn) => $(selector).forEach(fn);

  function applyStatic() {
    root.lang = lang;
    root.dir = DIR[lang];
    document.title = t('title');

    each('.kiosk-header .home-icon', (el) => el.setAttribute('aria-label', t('homeAria')));
    each('.kiosk-header img, .welcome-logo img', (el) => { el.alt = t('logoAlt'); });
    each('.kiosk-header .branch, .welcome-topline > span', (el) => setOwnText(el, t('branch')));
    each('.menu-source', (el) => { el.textContent = t('menuCount', itemCount()); });

    each('.welcome-copy p', (el) => { el.textContent = t('welcomeTagline'); });
    each('.welcome-copy h1', (el) => setLines(el, t('welcomeTitle')));
    each('.start-cta > span', (el) => { el.textContent = t('startCta'); });
    each('.welcome-footnote', (el) => setOwnText(el, t('footnote')));
    each('.welcome-credit', (el) => { el.textContent = t('credit'); });

    each('.choice-heading h1', (el) => { el.textContent = t('choiceTitle'); });
    each('.choice-heading p', (el) => { el.textContent = t('choiceLead'); });
    each('.decision-loyalty .decision-copy strong', (el) => { el.textContent = t('choiceJoinTitle'); });
    each('.decision-loyalty .decision-copy small', (el) => { el.textContent = t('choiceJoinText'); });
    each('.decision-menu .decision-copy strong', (el) => { el.textContent = t('choiceMenuTitle'); });
    each('.decision-menu .decision-copy small', (el) => { el.textContent = t('choiceMenuText', itemCount()); });
    each('.menu-peek i', (el) => {
      const node = textNodes(el)[0];
      if (!node) return;
      if (!el.dataset.he) el.dataset.he = node.nodeValue.trim();
      node.nodeValue = `${menuName(el.dataset.he)} `;
    });

    each('.join-back', (el) => { el.textContent = t('backToChoice'); });
    each('.join-story h1', (el) => { el.textContent = t('joinTitle'); });
    each('.join-story > p', (el) => { el.textContent = t('joinLead'); });
    each('.benefit-list', (el) => el.setAttribute('aria-label', t('benefitsAria')));
    $('.benefit-list > span').forEach((el, i) => { if (t('benefits')[i]) setOwnText(el, t('benefits')[i]); });
    each('.quick-form-copy h2', (el) => { el.textContent = t('phoneTitle'); });
    each('.quick-form label[for="quick-phone"]', (el) => { el.textContent = t('phoneLabel'); });
    each('#quick-phone', (el) => el.setAttribute('aria-label', t('phoneLabel')));
    each('.quick-submit > span', (el) => { el.textContent = t('phoneSubmit'); });
    each('#quick-help', (el) => { el.textContent = t('phoneHelp'); });
    each('.quick-message', (el) => { if (el.textContent) el.textContent = t('phoneInvalid'); }); // the only message it shows
    each('.numpad', (el) => el.setAttribute('aria-label', t('numpadAria')));
    each('.numpad [data-key="clear"]', (el) => { el.textContent = t('numpadClear'); });
    each('.numpad [data-key="back"]', (el) => el.setAttribute('aria-label', t('numpadBack')));

    each('.menu-head h1', (el) => { el.textContent = t('menuTitle'); });
    each('.menu-head p', (el) => { el.textContent = t('menuLead'); });
    each('.join-shortcut', (el) => { el.textContent = t('menuJoin'); });
    each('.category-tabs', (el) => el.setAttribute('aria-label', t('tabsAria')));
    each('.snapshot-note', (el) => {
      const nodes = textNodes(el);
      if (nodes[0]) nodes[0].nodeValue = t('snapshot');
    });

    each('.consent-intro .back-link', (el) => { el.textContent = t('back'); });
    each('.consent-intro h1', (el) => { el.textContent = t('consentTitle'); });
    each('.consent-intro > p', (el) => { el.textContent = t('consentLead'); });
    each('.phone-summary > span', (el) => { el.textContent = t('phoneSummary'); });
    each('.phone-summary > button', (el) => { el.textContent = t('change'); });
    const nameLabel = document.querySelector('.consent-form [name="firstName"]');
    if (nameLabel) { setOwnText(nameLabel.parentElement, t('nameLabel')); nameLabel.placeholder = t('namePlaceholder'); }
    const emailInput = document.querySelector('.consent-form [name="email"]');
    if (emailInput) {
      setOwnText(emailInput.parentElement, t('emailLabel'));
      const small = emailInput.parentElement.querySelector('small');
      if (small) small.textContent = t('optional');
    }
    each('.submit-consent', (el) => { el.textContent = t('submitConsent'); });

    each('.panel-success h1', (el) => { el.textContent = t('successTitle'); });
    each('.panel-success p', (el) => { el.textContent = t('successText'); });
    each('.panel-success button', (el) => { el.textContent = t('successMenu'); });
    each('.error-layout h1', (el) => setLines(el, t('errorTitle')));
    each('.error-layout p', (el) => { el.textContent = t('errorText'); });
    each('.error-layout .dialog-primary', (el) => { el.textContent = t('errorRetry'); });
    each('.error-layout .dialog-secondary', (el) => { el.textContent = t('errorMenu'); });
    each('.kiosk-footer [data-screen="privacy"]', (el) => { el.textContent = t('privacy'); });

    syncSwitches();
  }

  // ---- the switch -------------------------------------------------------------------------------------------------
  const switches = [];
  function makeSwitch(cls) {
    const wrap = document.createElement('div');
    wrap.className = `lang-switch ${cls}`;
    wrap.setAttribute('role', 'group');
    LANGS.forEach((l) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.lang = l;
      button.lang = l;
      button.dir = DIR[l];
      button.textContent = NAMES[l];
      wrap.append(button);
    });
    wrap.addEventListener('click', (event) => {
      const button = event.target.closest('[data-lang]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation(); // a language tap is not a tap on the welcome screen behind it
      set(button.dataset.lang, 'visitor');
    });
    switches.push(wrap);
    return wrap;
  }
  function syncSwitches() {
    switches.forEach((wrap) => {
      wrap.setAttribute('aria-label', t('langAria'));
      wrap.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    });
  }
  const header = document.querySelector('.kiosk-header');
  if (header) header.append(makeSwitch('lang-switch-header'));
  const topline = document.querySelector('.welcome-topline');
  if (topline) topline.append(makeSwitch('lang-switch-welcome'));

  // ---- changing language ----------------------------------------------------------------------------------------
  function set(next, reason) {
    if (!LANGS.includes(next) || next === lang) { syncSwitches(); return; }
    const prev = lang;
    lang = next;
    localizeMenu();   // first, so the words drawn from the menu (counts, the peek on the choice screen) are this language's
    applyStatic();
    rerenderMenu();
    listeners.slice().forEach((fn) => { try { fn(lang, prev, reason || 'api'); } catch (_) { /* one layer must not stop the others */ } });
    armRevert();
  }

  // A language left on the welcome screen by someone who walked away goes back to Hebrew after the idle time.
  let revertTimer;
  function armRevert() {
    clearTimeout(revertTimer);
    const S = window.KioskSession;
    if (lang === 'he' || !S || S.state !== 'ATTRACT') return;
    revertTimer = setTimeout(() => set('he', 'idle'), S.settings.idleSeconds * 1000 * S.scale);
  }
  document.addEventListener('pointerdown', armRevert, { capture: true, passive: true });

  const initial = /[?&]kioskLang=(he|en|ar)\b/.exec(location.search);

  window.KioskI18n = {
    get lang() { return lang; },
    langs: LANGS.slice(),
    names: { ...NAMES },
    dir: (l) => DIR[l || lang],
    t,
    set,
    onChange(fn) {
      listeners.push(fn);
      return () => { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1); };
    },
    menuText,
    menuName,
    announcement,
    itemCount,
    // the session controller comes after this file; it hooks in here (see the end of kiosk-session.js)
    attachSession(S) {
      // every visit ends in Hebrew; a finished sign-up ('submitted') keeps the language for its confirmation
      S.registerClearer((why) => { if (why !== 'submitted') set('he', 'reset'); });
      S.onChange(armRevert);
    },
  };

  // the other layers are drawn after this file runs: put the start language on everything once they are
  window.addEventListener('DOMContentLoaded', () => {
    if (initial && initial[1] !== 'he') set(initial[1], 'start');
    else { applyStatic(); syncSwitches(); }
  });
})();
