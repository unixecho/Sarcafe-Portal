import { WEB_LEGAL_VERSIONS, type LoyaltyLang } from './signup-shared'

// Every word on /loyaltysignup, in Hebrew, English and Arabic: the form, its messages, the short notice, the two consent boxes, the
// privacy notice and the terms. The Hebrew is the original; English and Arabic say the same thing. NOT reviewed by a lawyer or a
// native Arabic speaker (see docs/SARCAFE_KIOSK_LEGAL_NOTES.md, which lists what the system really does and what has to stay true:
// 12-month automatic deletion, owner-only access, separate marketing consent, no cookies or tracking, no IP stored).
// Whenever any wording of a language changes, change that language's three ids in signup-shared.ts.
// The business facts are the kiosk's (prototypes/sarcafe-kiosk-app/overrides/kiosk-business.js); scripts/check-loyalty-signup.mjs
// fails if the two copies drift apart.

export const BUSINESS = {
  ownerName: 'שרי איסרליס',
  names: { he: 'שרקפה (Sarcafe)', en: 'Sarcafe (שרקפה)', ar: 'ساركافيه (Sarcafe)' } as Record<LoyaltyLang, string>,
  phone: '0507437395',
}

export type Section = readonly [heading: string, body: string]

export type LoyaltyCopy = {
  name: string
  dir: 'rtl' | 'ltr'
  htmlTitle: string
  title: string
  lead: string
  benefits: readonly string[]
  clubNote: string
  nameLabel: string
  phoneLabel: string
  phoneHint: string
  emailLabel: string
  optional: string
  shortNotice: string
  required: string
  marketing: string
  submit: string
  sending: string
  readPrivacy: string
  readTerms: string
  langAria: string
  successTitle: string
  successText: string
  successRepeat: string
  errName: string
  errPhone: string
  errEmail: string
  errConsent: string
  errRate: string
  errGeneric: string
  errExpired: string
  errOffline: string
  reload: string
  footer: string
  privacyTitle: string
  privacyLead: string
  privacy: readonly Section[]
  termsTitle: string
  termsLead: string
  terms: readonly Section[]
}

const V = WEB_LEGAL_VERSIONS

const he: LoyaltyCopy = {
  name: 'עברית',
  dir: 'rtl',
  htmlTitle: 'שרקפה | הצטרפות למועדון הלקוחות',
  title: 'מועדון הלקוחות של שרקפה',
  lead: 'המועדון עדיין בהקמה. השאירו שם ומספר נייד, ונעדכן אתכם כשייפתח.',
  benefits: ['צוברים נקודות', 'מממשים הטבות ופרסים', 'משתתפים בהגרלות עתידיות', 'עדכונים בניוזלטר, רק בהסכמה נפרדת'],
  clubNote: 'ההרשמה היא בקשה לקבל עדכון: אין עדיין מועדון פעיל, ואין התחייבות להטבה כלשהי.',
  nameLabel: 'שם פרטי',
  phoneLabel: 'מספר נייד',
  phoneHint: 'מספר נייד ישראלי, למשל 054-1234567',
  emailLabel: 'דוא״ל',
  optional: 'לא חובה',
  shortNotice: 'הפרטים נמסרים מרצונכם אל שרקפה לצורך רישום לרשימת המתעניינים במועדון לקוחות דיגיטלי אפשרי, יצירת קשר בקשר להשקתו וניהול הרשימה. שם פרטי ומספר נייד נדרשים; דוא״ל הוא רשות. אין חובה חוקית למסור, אבל בלי השדות הנדרשים לא נוכל לצרף אתכם. המידע נגיש לבעלי העסק ולספקי תשתית שמפעילים את המערכת עבורנו, ויימחק אוטומטית כעבור 12 חודשים.',
  required: 'קראתי את הודעת הפרטיות ואת תנאי השימוש, ואני בן/בת 18 ומעלה, ואני מבקש/ת להירשם לרשימת המתעניינים במועדון הלקוחות הדיגיטלי האפשרי של שרקפה. ידוע לי שההרשמה היא מרצוני, אינה חברות ואינה מבטיחה הטבה.',
  marketing: 'אני מסכים/ה לקבל מסרונים ודואר אלקטרוני שיווקיים משרקפה, לרבות עדכונים, הצעות והטבות. ההסכמה אינה חובה, אינה מסומנת מראש ואפשר לחזור ממנה בכל עת, ללא תשלום.',
  submit: 'הוסיפו אותי לרשימה',
  sending: 'שולחים…',
  readPrivacy: 'הודעת הפרטיות המלאה',
  readTerms: 'תנאי השימוש',
  langAria: 'שפה',
  successTitle: 'תודה, אתם ברשימה',
  successText: 'נעדכן אתכם רק כשיהיה משהו אמיתי לספר. אפשר לסגור את העמוד.',
  successRepeat: 'אם המספר כבר היה רשום, לא שינינו דבר, וההסכמות הקודמות שלכם נשארות כפי שהיו.',
  errName: 'כתבו שם פרטי.',
  errPhone: 'כתבו מספר נייד ישראלי בן 10 ספרות, שמתחיל ב־05.',
  errEmail: 'כתובת הדוא״ל לא נראית תקינה. אפשר גם להשאיר אותה ריקה.',
  errConsent: 'כדי להירשם צריך לאשר את הודעת הפרטיות ותנאי השימוש.',
  errRate: 'נשלחו יותר מדי בקשות. נסו שוב מאוחר יותר.',
  errGeneric: 'משהו השתבש ולא נשמר דבר. נסו שוב בעוד רגע.',
  errExpired: 'העמוד פתוח זמן רב מדי. טענו אותו מחדש ונסו שוב.',
  errOffline: 'אין חיבור לאינטרנט. הפרטים לא נשמרו. נסו שוב כשהחיבור חוזר.',
  reload: 'טעינה מחדש',
  footer: 'ההרשמה לרשימת המתעניינים היא מרצון ובהסכמה. העמוד אינו משתמש בעוגיות או במעקב.',
  privacyTitle: 'הודעת פרטיות לרשימת המתעניינים במועדון',
  privacyLead: 'הודעה זו מוצגת לפני שמוסרים פרטים: מה נאסף, למה, למי זה עשוי להגיע ומה הזכויות שלכם.',
  privacy: [
    ['1. מי אחראי למידע', `בעל השליטה במאגר המידע הוא ${BUSINESS.names.he}, המפעיל/ה את שרקפה בגבעת חביבה. האחראי/ת על המאגר: ${BUSINESS.ownerName}. לכל פנייה בנושא פרטיות: בטלפון ${BUSINESS.phone}.`],
    ['2. איזה מידע נאסף', 'שם פרטי ומספר טלפון נייד. כתובת דוא״ל, רק אם בחרתם למסור אותה. כדי להוכיח את ההרשמה וההסכמה נשמרים גם: הסניף, מועד ההרשמה, גרסאות הנוסחים שאישרתם, האם אישרתם דברי פרסומת, ומזהה אקראי של הבקשה למניעת רישום כפול. לא נאסף מספר זהות, תאריך לידה, פרטי תשלום, מיקום, אנשי קשר או מזהה פרסום. כתובת ה־IP שלכם אינה נשמרת: רק חתימה מוצפנת יומית שלה משמשת להגבלת בקשות, ונמחקת בתוך שעתיים.'],
    ['3. למה אנחנו משתמשים בו', 'בהסכמתכם, לצורך: ניהול רשימת המתעניינים; יצירת קשר כשייפתח מועדון לקוחות דיגיטלי; מניעת רישומים כפולים ושימוש לרעה; טיפול בפניות שלכם; ושמירת הוכחה להסכמה. לא נשתמש בפרטים למטרה אחרת. דברי פרסומת יישלחו רק למי שאישר/ה אותם בנפרד.'],
    ['4. האם חייבים למסור', 'לא. אין חובה חוקית למסור את המידע; המסירה היא בהסכמתכם. בלי שם פרטי, מספר נייד ואישור הודעה זו לא נוכל לצרף אתכם לרשימה. אי־מסירה לא פוגעת בשירות בעגלה.'],
    ['5. למי המידע עשוי להגיע', 'הרשימה גלויה לבעלי העסק בלבד, ומוגנת בהרשאות. לצוות הטכנולוגיה שמתחזק את המערכת עשויה להיות גישה טכנית במידה הנדרשת לתחזוקה ולאבטחה, והוא מחויב לסודיות. המידע נשמר ומעובד אצל ספקי תשתית ענן שפועלים עבורנו ולפי הוראותינו: Supabase (מסד הנתונים, בשרתים באיחוד האירופי) ו־Vercel (הרצת האתר). בעת העיבוד ייתכן שהמידע יעבור זמנית דרך שרתים מחוץ לישראל. המידע לא יימכר ולא יימסר לצד שלישי לצרכיו, אלא אם נדרש על פי דין או צו שיפוטי.'],
    ['6. אבטחה', 'המידע נשלח בחיבור מוצפן, נשמר במאגר שאינו פתוח לציבור, והגישה אליו מוגבלת לבעלי הרשאה מזוהים. העמוד אינו משתמש בעוגיות, בכלי ניתוח או במעקב (כלי הנגישות והניווט באתר עשויים לשמור במכשיר שלכם בלבד את העדפות התצוגה, את כתובת הדף שנפתח ואת מספר התמונה שהוצגה ברקע, ואינם שולחים אותם אלינו). גופן האתר נטען משירות Google Fonts, ולכן כתובת ה־IP ופרטי הדפדפן שלכם עשויים להיחשף ל־Google בעת טעינת העמוד, כמו בכל אתר שטוען גופן כזה. אין מערכת חסינה לחלוטין; אם יתרחש אירוע אבטחה חמור במאגר, נדווח עליו לרשות להגנת הפרטיות ולמי שנפגעו, כנדרש בדין.'],
    ['7. כמה זמן נשמר', 'הפרטים נמחקים אוטומטית 12 חודשים לאחר ההתעניינות האחרונה שלכם, אלא אם הצטרפתם בינתיים למועדון פעיל. אפשר לבקש מחיקה מוקדמת בכל עת. נשמר תיעוד מינימלי של ההסכמה ושל ביטולה, בלי פרטים מזהים, כדי להוכיח שפעלנו כדין.'],
    ['8. הזכויות שלכם', `לפי חוק הגנת הפרטיות אפשר לבקש לעיין במידע שמוחזק עליכם, לתקן מידע שאינו נכון, שלם, ברור או מעודכן, ולבקש למחוק אותו או להפסיק להשתמש בו. פנו אלינו בטלפון ${BUSINESS.phone}. נשיב לא יאוחר מ־30 ימים, לאחר אימות סביר של זהות הפונה. אם אינכם מרוצים מהמענה, אפשר לפנות לרשות להגנת הפרטיות במשרד המשפטים.`],
    ['9. דברי פרסומת', `נשלח הודעות שיווקיות (מסרון, דוא״ל) רק אם אישרתם זאת במפורש ובנפרד, בהתאם לסעיף 30א לחוק התקשורת. כל הודעה תזהה את עצמה כפרסומת, תציין מי שולח אותה ותכלול דרך פשוטה להסרה. אפשר לבטל את ההסכמה בכל עת, ללא תשלום, גם בפנייה אלינו בטלפון ${BUSINESS.phone}.`],
    ['10. גיל', 'הרישום מיועד לבני 18 ומעלה, והמסמן את תיבת האישור מצהיר שהוא כזה. אם יתברר שנרשם קטין, הפרטים יימחקו.'],
    ['11. שינויים וגרסה', `אם נשנה את ההודעה באופן מהותי נעדכן אותה, ובמקום שהדין דורש, נבקש הסכמה חדשה. הגרסה שאישרתם נשמרת ואינה משתנה בדיעבד. גרסה זו: ${V.he.privacy}.`],
  ],
  termsTitle: 'תנאי שימוש ורשימת המתעניינים',
  termsLead: 'תנאים אלה חלים על ההרשמה לרשימת המתעניינים דרך עמוד זה. אין בהם כדי לפגוע בזכויות שהדין מעניק לכם כצרכנים ואינן ניתנות להתנאה.',
  terms: [
    ['1. מה זו ההרשמה', 'ההרשמה היא בקשה לקבל עדכון כשייפתח מועדון לקוחות דיגיטלי אפשרי. כרגע אין מועדון פעיל, אין חברות, ואין התחייבות שהמועדון ייפתח, ומתי. נקודות, הטבות, פרסים או הגרלות יוצעו, אם בכלל, רק לפי תקנון נפרד שיפורסם מראש ובהתאם לדין.'],
    ['2. מי יכול להירשם', 'בני 18 ומעלה, עם פרטים נכונים ושלהם. אין לרשום מספר טלפון או כתובת של אדם אחר.'],
    ['3. אין חובת הרשמה או קנייה', 'אפשר לקנות בעגלה בלי להירשם. ההרשמה והסכמה לדברי פרסומת הן רשות, וכל אחת מהן נפרדת.'],
    ['4. שימוש תקין', 'אין להשתמש בעמוד באופן שמשבש את פעולתו, פוגע בו או בצד שלישי, או מנסה לגשת למידע שאינו מיועד לכם, לרבות שליחה אוטומטית של בקשות.'],
    ['5. אחריות', 'העמוד ניתן במצבו, וייתכנו הפסקות או תקלות. אין באמור כדי לפטור אותנו מאחריות שאי אפשר לפטור ממנה לפי הדין.'],
    ['6. שינוי והפסקה', 'אנו רשאים לעדכן תנאים אלה או להפסיק את רשימת המתעניינים. מי שנרשם יוכל לבקש להסיר את פרטיו בכל עת.'],
    ['7. פרטיות, דין ושיפוט', `הטיפול בפרטים האישיים מוסדר בהודעת הפרטיות, שהיא חלק בלתי נפרד מתנאים אלה. על התנאים יחול הדין הישראלי, וסמכות השיפוט נתונה לבתי המשפט המוסמכים בישראל. בעל העסק: ${BUSINESS.names.he}. לפניות: בטלפון ${BUSINESS.phone}. גרסה זו: ${V.he.terms}.`],
  ],
}

const en: LoyaltyCopy = {
  name: 'English',
  dir: 'ltr',
  htmlTitle: 'Sarcafe | Join the customer club',
  title: 'The Sarcafe customer club',
  lead: 'The club is still being set up. Leave your name and mobile number and we will tell you when it opens.',
  benefits: ['Earn points', 'Redeem perks and prizes', 'Join future raffles', 'Newsletter updates, only with a separate consent'],
  clubNote: 'Signing up is a request to be told: there is no active club yet and no promise of any perk.',
  nameLabel: 'First name',
  phoneLabel: 'Mobile number',
  phoneHint: 'An Israeli mobile number, for example 054-1234567',
  emailLabel: 'Email',
  optional: 'optional',
  shortNotice: 'You give these details voluntarily, and they will be passed to Sarcafe to add you to the interest list for a possible digital customer club, to contact you about its launch and to manage the list. A first name and a mobile number are required; email is optional. There is no legal obligation to give them, but without the required fields we cannot add you. The information will be accessible to the owners of the business and to the infrastructure providers who run the system for us, and will be deleted automatically after 12 months.',
  required: 'I have read the privacy notice and the terms of use, and I am 18 or older, and I ask to be added to the interest list for Sarcafe’s possible digital customer club. I know that signing up is voluntary, is not membership and does not promise any perk.',
  marketing: 'I agree to receive marketing text messages and emails from Sarcafe, including updates, offers and perks. This consent is optional, is not pre-ticked and can be withdrawn at any time, free of charge.',
  submit: 'Add me to the list',
  sending: 'Sending…',
  readPrivacy: 'The full privacy notice',
  readTerms: 'The terms of use',
  langAria: 'Language',
  successTitle: 'Thank you, you are on the list',
  successText: 'We will only get in touch when there is something real to tell. You can close this page.',
  successRepeat: 'If this number was already registered, nothing was changed and your earlier choices stay as they were.',
  errName: 'Please write your first name.',
  errPhone: 'Please write an Israeli mobile number of 10 digits, starting with 05.',
  errEmail: 'The email address does not look right. You can also leave it empty.',
  errConsent: 'To sign up you need to confirm the privacy notice and the terms of use.',
  errRate: 'Too many requests were sent. Please try again later.',
  errGeneric: 'Something went wrong and nothing was saved. Please try again in a moment.',
  errExpired: 'This page has been open too long. Reload it and try again.',
  errOffline: 'No internet connection. Your details were not saved. Try again when you are back online.',
  reload: 'Reload',
  footer: 'Joining the interest list is voluntary and by consent. This page uses no cookies or tracking.',
  privacyTitle: 'Privacy notice for the club interest list',
  privacyLead: 'This notice is shown before you give any details: what is collected, why, who may receive it and what your rights are.',
  privacy: [
    ['1. Who is responsible for the information', `The controller of the database is ${BUSINESS.names.en}, which operates Sarcafe at Givat Haviva. The person responsible for the database: ${BUSINESS.ownerName}. For any privacy request, call ${BUSINESS.phone}.`],
    ['2. What information is collected', 'Your first name and mobile phone number. An email address, only if you choose to give one. To prove the sign-up and the consent we also keep: the branch, the time of the sign-up, the versions of the texts you agreed to, whether you agreed to advertising messages, and a random request identifier that prevents a double sign-up. No ID number, date of birth, payment details, location, contacts or advertising identifier is collected. Your IP address is not stored: only a daily encrypted signature of it is used to limit requests, and it is deleted within two hours.'],
    ['3. Why we use it', 'With your consent, for: managing the interest list; contacting you when a digital customer club opens; preventing double sign-ups and misuse; handling your requests; and keeping proof of your consent. We will not use the details for any other purpose. Advertising messages will be sent only to those who agreed to them separately.'],
    ['4. Do you have to give it', 'No. There is no legal obligation to give this information; you give it with your consent. Without a first name, a mobile number and your confirmation of this notice we cannot add you to the list. Not giving it does not affect the service at the truck.'],
    ['5. Who may receive the information', 'The list is visible only to the owners of the business and is protected by access permissions. The technology team that maintains the system may have technical access to the extent needed for maintenance and security, and is bound by confidentiality. The information is stored and processed by cloud infrastructure providers acting for us and under our instructions: Supabase (the database, on servers in the European Union) and Vercel (running the website). During processing the information may pass temporarily through servers outside Israel. The information will not be sold or given to a third party for its own purposes, unless the law or a court order requires it.'],
    ['6. Security', 'The information is sent over an encrypted connection, stored in a database that is not open to the public, and access to it is limited to identified, authorised people. This page uses no cookies, analytics or tracking (the site’s accessibility tool and navigation may keep your display preferences, the address of the page you opened and which background picture was shown last on your own device only, and do not send them to us). The site’s font is loaded from Google Fonts, so your IP address and browser details may be disclosed to Google when the page loads, as on any site that loads such a font. No system is completely immune; if a serious security incident occurs in the database, we will report it to the Privacy Protection Authority and to those affected, as the law requires.'],
    ['7. How long it is kept', 'The details are deleted automatically 12 months after your last expression of interest, unless you have joined an active club in the meantime. You can ask for earlier deletion at any time. A minimal record of the consent and of its withdrawal is kept, without identifying details, to prove that we acted lawfully.'],
    ['8. Your rights', `Under the Protection of Privacy Law you can ask to inspect the information held about you, to correct information that is not correct, complete, clear or up to date, and to ask for it to be deleted or no longer used. Call us on ${BUSINESS.phone}. We will answer within 30 days at the latest, after reasonable verification of your identity. If you are not satisfied, you can turn to the Privacy Protection Authority at the Ministry of Justice.`],
    ['9. Advertising messages', `We will send marketing messages (text message, email) only if you agreed to this explicitly and separately, in accordance with section 30A of the Communications Law. Every message will identify itself as advertising, say who sends it and include a simple way to unsubscribe. You can withdraw your consent at any time, free of charge, also by calling ${BUSINESS.phone}.`],
    ['10. Age', 'Signing up is for people aged 18 and over, and whoever ticks the confirmation box declares that they are. If it turns out that a minor has signed up, the details will be deleted.'],
    ['11. Changes and version', `If we change this notice materially we will update it and, where the law requires, ask for new consent. The version you agreed to is kept and does not change retroactively. This version: ${V.en.privacy}.`],
  ],
  termsTitle: 'Terms of use and the interest list',
  termsLead: 'These terms apply to signing up for the interest list through this page. Nothing in them limits the rights the law gives you as a consumer that cannot be waived.',
  terms: [
    ['1. What the sign-up is', 'Signing up is a request to be told when a possible digital customer club opens. At the moment there is no active club, no membership, and no commitment that the club will open, or when. Points, perks, prizes or raffles will be offered, if at all, only under separate rules published in advance and in accordance with the law.'],
    ['2. Who can sign up', 'People aged 18 and over, with correct details of their own. Do not register another person’s phone number or address.'],
    ['3. No obligation to sign up or buy', 'You can buy at the truck without signing up. Signing up and consenting to advertising messages are optional, and each is separate.'],
    ['4. Proper use', 'Do not use the page in a way that disrupts its operation, harms it or a third party, or tries to access information not meant for you, including sending requests automatically.'],
    ['5. Liability', 'The page is provided as is, and there may be interruptions or faults. Nothing in this releases us from liability that cannot be excluded under the law.'],
    ['6. Changes and ending', 'We may update these terms or end the interest list. Anyone who signed up may ask to have their details removed at any time.'],
    ['7. Privacy, law and jurisdiction', `The handling of personal details is governed by the privacy notice, which is an integral part of these terms. These terms are governed by Israeli law, and the competent courts in Israel have jurisdiction. The business: ${BUSINESS.names.en}. Contact us at ${BUSINESS.phone}. This version: ${V.en.terms}.`],
  ],
}

const ar: LoyaltyCopy = {
  name: 'العربية',
  dir: 'rtl',
  htmlTitle: 'ساركافيه | الانضمام إلى نادي الزبائن',
  title: 'نادي زبائن ساركافيه',
  lead: 'النادي ما زال قيد الإعداد. اتركوا اسمكم ورقم هاتفكم المحمول وسنعلمكم عند افتتاحه.',
  benefits: ['تجميع نقاط', 'استبدال امتيازات وجوائز', 'المشاركة في سحوبات مستقبلية', 'تحديثات بالنشرة، فقط بموافقة منفصلة'],
  clubNote: 'التسجيل هو طلب لتلقي إشعار: لا يوجد نادٍ فعّال بعد، ولا وعد بأي امتياز.',
  nameLabel: 'الاسم الشخصي',
  phoneLabel: 'رقم الهاتف المحمول',
  phoneHint: 'رقم هاتف محمول إسرائيلي، مثلًا 054-1234567',
  emailLabel: 'البريد الإلكتروني',
  optional: 'اختياري',
  shortNotice: 'تُقدَّم هذه التفاصيل بإرادتكم وستُنقل إلى ساركافيه لغرض التسجيل في قائمة المهتمين بنادي زبائن رقمي محتمل، والتواصل بشأن إطلاقه، وإدارة القائمة. الاسم الشخصي ورقم الهاتف المحمول مطلوبان؛ والبريد الإلكتروني اختياري. لا يوجد واجب قانوني بتقديمها، لكن بدون الحقول المطلوبة لا يمكننا إضافتكم. ستكون المعلومات متاحة لأصحاب العمل ولمزوّدي البنية التحتية الذين يشغّلون النظام لصالحنا، وستُحذف تلقائيًا بعد 12 شهرًا.',
  required: 'قرأت إشعار الخصوصية وشروط الاستخدام، وعمري 18 عامًا فما فوق، وأطلب التسجيل في قائمة المهتمين بنادي الزبائن الرقمي المحتمل لساركافيه. أعلم أن التسجيل طوعي، وليس عضوية ولا يضمن أي امتياز.',
  marketing: 'أوافق على تلقي رسائل نصية قصيرة ورسائل بريد إلكتروني تسويقية من ساركافيه، بما في ذلك التحديثات والعروض والامتيازات. هذه الموافقة غير إلزامية، وغير محددة مسبقًا، ويمكن سحبها في أي وقت ودون مقابل.',
  submit: 'أضيفوني إلى القائمة',
  sending: 'جارٍ الإرسال…',
  readPrivacy: 'إشعار الخصوصية الكامل',
  readTerms: 'شروط الاستخدام',
  langAria: 'اللغة',
  successTitle: 'شكرًا، أنتم في القائمة',
  successText: 'سنتواصل معكم فقط عندما يكون هناك ما نخبركم به. يمكنكم إغلاق هذه الصفحة.',
  successRepeat: 'إذا كان الرقم مسجلًا من قبل، فلم نغيّر شيئًا، وتبقى اختياراتكم السابقة كما كانت.',
  errName: 'اكتبوا الاسم الشخصي.',
  errPhone: 'اكتبوا رقم هاتف محمول إسرائيليًا من 10 أرقام يبدأ بـ 05.',
  errEmail: 'عنوان البريد الإلكتروني لا يبدو صحيحًا. يمكنكم أيضًا تركه فارغًا.',
  errConsent: 'للتسجيل يلزم تأكيد إشعار الخصوصية وشروط الاستخدام.',
  errRate: 'أُرسلت طلبات كثيرة. حاولوا مرة أخرى لاحقًا.',
  errGeneric: 'حدث خطأ ولم يُحفظ شيء. حاولوا مرة أخرى بعد قليل.',
  errExpired: 'هذه الصفحة مفتوحة منذ وقت طويل. أعيدوا تحميلها وحاولوا مرة أخرى.',
  errOffline: 'لا يوجد اتصال بالإنترنت. لم تُحفظ التفاصيل. حاولوا مرة أخرى عند عودة الاتصال.',
  reload: 'إعادة التحميل',
  footer: 'الانضمام إلى قائمة المهتمين طوعي وبموافقة. لا تستخدم هذه الصفحة ملفات تعريف الارتباط أو التتبّع.',
  privacyTitle: 'إشعار الخصوصية لقائمة المهتمين بالنادي',
  privacyLead: 'يُعرض هذا الإشعار قبل تقديم أي تفاصيل: ما الذي يُجمع، ولماذا، ومَن قد يتلقاه، وما هي حقوقكم.',
  privacy: [
    ['1. مَن المسؤول عن المعلومات', `المتحكم في قاعدة البيانات هو ${BUSINESS.names.ar}، الذي يشغّل ساركافيه في جفعات حبيبة. المسؤول/ة عن قاعدة البيانات: ${BUSINESS.ownerName}. لأي طلب يتعلق بالخصوصية اتصلوا على ${BUSINESS.phone}.`],
    ['2. ما المعلومات التي تُجمع', 'الاسم الشخصي ورقم الهاتف المحمول. وعنوان البريد الإلكتروني، فقط إذا اخترتم تقديمه. ولإثبات التسجيل والموافقة نحفظ أيضًا: الفرع، وموعد التسجيل، وإصدارات النصوص التي وافقتم عليها، وما إذا وافقتم على تلقي رسائل إعلانية، ومعرّفًا عشوائيًا للطلب لمنع التسجيل المزدوج. لا يُجمع رقم هوية، أو تاريخ ميلاد، أو تفاصيل دفع، أو موقع، أو جهات اتصال، أو معرّف إعلاني. لا يُحفظ عنوان IP الخاص بكم: يُستخدم فقط توقيع مشفّر يومي منه لتحديد عدد الطلبات، ويُحذف خلال ساعتين.'],
    ['3. لماذا نستخدمها', 'بموافقتكم، من أجل: إدارة قائمة المهتمين؛ والتواصل معكم عند افتتاح نادي زبائن رقمي؛ ومنع التسجيلات المزدوجة وإساءة الاستخدام؛ ومعالجة طلباتكم؛ والاحتفاظ بإثبات الموافقة. لن نستخدم التفاصيل لأي غرض آخر. لن تُرسل رسائل إعلانية إلا لمن وافق عليها بشكل منفصل.'],
    ['4. هل يجب تقديمها', 'لا. لا يوجد واجب قانوني بتقديم هذه المعلومات؛ فتقديمها يتم بموافقتكم. بدون الاسم الشخصي ورقم الهاتف المحمول وتأكيد هذا الإشعار لا يمكننا إضافتكم إلى القائمة. عدم تقديمها لا يؤثر على تلقي الخدمة في العربة.'],
    ['5. مَن قد يتلقى المعلومات', 'القائمة مرئية لأصحاب العمل فقط، ومحمية بصلاحيات وصول. قد يكون لفريق التكنولوجيا الذي يصون النظام وصول تقني بالقدر اللازم للصيانة والأمان، وهو ملتزم بالسرية. تُحفظ المعلومات وتُعالَج لدى مزوّدي بنية تحتية سحابية يعملون لصالحنا ووفق تعليماتنا: Supabase (قاعدة البيانات، على خوادم في الاتحاد الأوروبي) وVercel (تشغيل الموقع). أثناء المعالجة قد تمر المعلومات مؤقتًا عبر خوادم خارج إسرائيل. لن تُباع المعلومات ولن تُسلَّم لطرف ثالث لأغراضه الخاصة، إلا إذا اقتضى ذلك القانون أو أمر قضائي.'],
    ['6. الأمان', 'تُرسل المعلومات عبر اتصال مشفّر، وتُحفظ في قاعدة بيانات غير مفتوحة للجمهور، ويقتصر الوصول إليها على أصحاب صلاحية معرَّفين. لا تستخدم هذه الصفحة ملفات تعريف الارتباط أو أدوات التحليل أو التتبّع (وقد تحفظ أداة الوصول والتنقل في الموقع تفضيلات العرض وعنوان الصفحة المفتوحة ورقم صورة الخلفية التي عُرضت آخر مرة على جهازكم فقط، ولا ترسلها إلينا). ويُحمَّل خط الموقع من خدمة Google Fonts، ولذلك قد ينكشف عنوان IP الخاص بكم وتفاصيل المتصفح لشركة Google عند تحميل الصفحة، كما في أي موقع يحمّل خطًا كهذا. لا يوجد نظام محصّن تمامًا؛ وإذا وقع حادث أمني خطير في قاعدة البيانات فسنبلغ عنه سلطة حماية الخصوصية والمتضررين، كما يقتضي القانون.'],
    ['7. مدة الحفظ', 'تُحذف التفاصيل تلقائيًا بعد 12 شهرًا من آخر إبداء اهتمام من جانبكم، إلا إذا انضممتم في هذه الأثناء إلى نادٍ فعّال. يمكنكم طلب الحذف المبكر في أي وقت. يُحفظ توثيق أدنى للموافقة ولسحبها، دون تفاصيل تعريفية، لإثبات أننا تصرفنا وفق القانون.'],
    ['8. حقوقكم', `بموجب قانون حماية الخصوصية يمكنكم طلب الاطلاع على المعلومات المحفوظة عنكم، وتصحيح المعلومات غير الصحيحة أو غير الكاملة أو غير الواضحة أو غير المحدَّثة، وطلب حذفها أو التوقف عن استخدامها. اتصلوا بنا على ${BUSINESS.phone}. سنرد في موعد أقصاه 30 يومًا، بعد التحقق المعقول من هويتكم. إذا لم تكونوا راضين، يمكنكم التوجه إلى سلطة حماية الخصوصية في وزارة العدل.`],
    ['9. الرسائل الإعلانية', `سنرسل رسائل تسويقية (رسائل نصية قصيرة، بريد إلكتروني) فقط إذا وافقتم على ذلك صراحةً وبشكل منفصل، وفقًا للبند 30أ من قانون الاتصالات. كل رسالة ستعرّف نفسها كإعلان، وتذكر الجهة المرسِلة، وتتضمن طريقة بسيطة لإلغاء الاشتراك. يمكنكم سحب موافقتكم في أي وقت ودون مقابل، بما في ذلك بالاتصال على ${BUSINESS.phone}.`],
    ['10. السن', 'التسجيل مخصص لمن هم في سن 18 عامًا فما فوق، ومن يحدد مربع التأكيد يصرّح بأنه كذلك. إذا تبيّن أن قاصرًا قد سجّل، فستُحذف تفاصيله.'],
    ['11. تغييرات والإصدار', `إذا غيّرنا الإشعار بشكل جوهري فسنحدّثه، وحيث يقتضي القانون سنطلب موافقة جديدة. الإصدار الذي وافقتم عليه يُحفظ ولا يتغيّر بأثر رجعي. هذا الإصدار: ${V.ar.privacy}.`],
  ],
  termsTitle: 'شروط الاستخدام وقائمة المهتمين',
  termsLead: 'تسري هذه الشروط على التسجيل في قائمة المهتمين عبر هذه الصفحة. وليس فيها ما يمسّ بالحقوق التي يمنحكم إياها القانون كمستهلكين والتي لا يجوز التنازل عنها.',
  terms: [
    ['1. ما هو التسجيل', 'التسجيل هو طلب لتلقي تحديث عند افتتاح نادي زبائن رقمي محتمل. لا يوجد حاليًا نادٍ فعّال، ولا عضوية، ولا التزام بأن النادي سيُفتتح، أو متى. النقاط أو الامتيازات أو الجوائز أو السحوبات ستُعرض، إن عُرضت أصلًا، فقط وفق نظام منفصل يُنشر مسبقًا ووفقًا للقانون.'],
    ['2. مَن يمكنه التسجيل', 'مَن هم في سن 18 عامًا فما فوق، بتفاصيل صحيحة تخصّهم. لا يجوز تسجيل رقم هاتف أو عنوان لشخص آخر.'],
    ['3. لا إلزام بالتسجيل أو بالشراء', 'يمكنكم الشراء من العربة دون التسجيل. التسجيل والموافقة على الرسائل الإعلانية اختياريان، وكل منهما منفصل عن الآخر.'],
    ['4. الاستخدام السليم', 'لا يجوز استخدام الصفحة بطريقة تعطّل عملها، أو تضرّ بها أو بطرف ثالث، أو تحاول الوصول إلى معلومات غير مخصصة لكم، بما في ذلك إرسال الطلبات تلقائيًا.'],
    ['5. المسؤولية', 'تُقدَّم الصفحة كما هي، وقد تحدث انقطاعات أو أعطال. وليس في ذلك ما يعفينا من مسؤولية لا يمكن الإعفاء منها وفقًا للقانون.'],
    ['6. التغيير والإيقاف', 'يحق لنا تحديث هذه الشروط أو إيقاف قائمة المهتمين. ويمكن لمن سجّل أن يطلب إزالة تفاصيله في أي وقت.'],
    ['7. الخصوصية والقانون والاختصاص', `يُنظِّم إشعارُ الخصوصية معالجةَ التفاصيل الشخصية، وهو جزء لا يتجزأ من هذه الشروط. يسري على هذه الشروط القانون الإسرائيلي، وتختص بالنظر فيها المحاكم المختصة في إسرائيل. صاحب المصلحة التجارية: ${BUSINESS.names.ar}. للتواصل معنا: ${BUSINESS.phone}. هذا الإصدار: ${V.ar.terms}.`],
  ],
}

export const COPY: Record<LoyaltyLang, LoyaltyCopy> = { he, en, ar }
