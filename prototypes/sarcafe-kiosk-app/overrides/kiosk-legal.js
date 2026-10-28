/*
 * Sarcafe kiosk app: the privacy notice, the terms of use, the short notice and the consent wording.
 *
 * Written to the requirements of Israeli law for this activity (Protection of Privacy Law 5741-1981 including
 * Amendment 13, the Data Security Regulations 5777-2017, Communications Law s. 30A on advertising messages) and to
 * what the system really does. It was not reviewed by a lawyer; docs/SARCAFE_KIOSK_LEGAL_NOTES.md says what each part
 * rests on and what the owner has to keep true. Who the business is comes from kiosk-business.js.
 *
 * The version ids below are stored with every sign-up and must change whenever any wording here changes; the server
 * accepts only the versions in src/lib/kiosk/waitlist.ts, so both are updated together
 * (npm run check:kiosk-waitlist fails if they drift apart).
 */
(() => {
  const VERSIONS = {
    privacy: 'kiosk-privacy-he-v4-2026-10-28',
    consent: 'kiosk-consent-he-v4-2026-10-28',
    terms: 'kiosk-terms-he-v3-2026-10-28',
  };
  window.SARCAFE_LEGAL_VERSIONS = VERSIONS;

  const B = window.SARCAFE_BUSINESS || {};
  const val = (key) => (typeof B[key] === 'string' ? B[key].trim() : '');
  const esc = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (text) => `<span class="legal-fill">[${text}]</span>`;
  let missing = 0;
  const need = (value, label) => { if (value) return esc(value); missing += 1; return fill(label); };

  const owner = [val('ownerFirstName'), val('ownerLastName')].filter(Boolean).join(' ');
  const LEGAL_NAME = `${need(val('businessName'), 'שם העסק')}, ח.פ. <bdi dir="ltr">${need(val('companyId'), 'מספר ח.פ.')}</bdi>`;
  const OWNER = need(owner, 'שם פרטי ושם משפחה של האחראי/ת');
  const phone = val('phone');
  const CONTACT = `בטלפון <bdi dir="ltr">${need(phone, 'מספר טלפון')}</bdi>${val('email') ? `, בדוא״ל <bdi dir="ltr">${esc(val('email'))}</bdi>` : ''}${val('address') ? `, או בדואר אל ${esc(val('address'))}` : ''}`;

  const incomplete = missing > 0; // some business detail is still a [bracket]

  const privacy = `
    <h1>הודעת פרטיות לרשימת המתעניינים במועדון</h1>
    <p class="legal-lead">הודעה זו מוצגת לפני שמוסרים פרטים. היא מסבירה מה נאסף, למה, למי זה עשוי להגיע ומה הזכויות שלכם. אפשר לעיין בתפריט ולהשתמש בקיוסק בלי להירשם בכלל.</p>
    <div class="privacy-sections">
      <section><h2>1. מי אחראי למידע</h2><p>בעל השליטה במאגר המידע הוא ${LEGAL_NAME}, המפעיל/ה את שרקפה בגבעת חביבה. האחראי/ת על המאגר: ${OWNER}. לכל פנייה בנושא פרטיות: ${CONTACT}.</p></section>
      <section><h2>2. איזה מידע נאסף</h2><p>שם פרטי ומספר טלפון נייד. כתובת דוא״ל, רק אם בחרתם למסור אותה. כדי להוכיח את ההרשמה וההסכמה נשמרים גם: הסניף, מועד ההרשמה, גרסאות הנוסחים שאישרתם, האם אישרתם דברי פרסומת, ומזהה אקראי של הבקשה למניעת רישום כפול.</p><p>לא נאסף מספר זהות, תאריך לידה, פרטי תשלום, מיקום, אנשי קשר או מזהה פרסום. הפרטים אינם נשמרים בטאבלט, והקיוסק אינו משתמש בעוגיות, בכלי ניתוח או במעקב.</p></section>
      <section><h2>3. למה אנחנו משתמשים בו</h2><p>בהסכמתכם, לצורך: ניהול רשימת המתעניינים; יצירת קשר כשייפתח מועדון לקוחות דיגיטלי; מניעת רישומים כפולים ושימוש לרעה; טיפול בפניות שלכם; ושמירת הוכחה להסכמה. לא נשתמש בפרטים למטרה אחרת. דברי פרסומת יישלחו רק למי שאישר/ה אותם בנפרד.</p></section>
      <section><h2>4. האם חייבים למסור</h2><p>לא. אין חובה חוקית למסור את המידע; המסירה היא בהסכמתכם ובמידה שתבחרו. בלי שם פרטי, מספר נייד ואישור הודעה זו לא נוכל לצרף אתכם לרשימה. אי־מסירה לא פוגעת בשימוש בקיוסק או בקבלת שירות בעגלה.</p></section>
      <section><h2>5. למי המידע עשוי להגיע</h2><p>הרשימה גלויה לבעלי העסק בלבד, ומוגנת בהרשאות. לצוות הטכנולוגיה שמתחזק את המערכת עשויה להיות גישה טכנית במידה הנדרשת לתחזוקה ולאבטחה, והוא מחויב לסודיות.</p><p>המידע נשמר ומעובד אצל ספקי תשתית ענן שפועלים עבורנו ולפי הוראותינו ותנאי העיבוד שלהם: <bdi dir="ltr">Supabase</bdi> (מסד הנתונים, בשרתים באיחוד האירופי) ו־<bdi dir="ltr">Vercel</bdi> (הרצת האתר והמערכת). בעת העיבוד ייתכן שהמידע יעבור זמנית דרך שרתים מחוץ לישראל. מדינות האיחוד האירופי מוכרות על ידי ישראל כמעניקות הגנה הולמת על מידע אישי, וכל העברה אחרת נעשית בהתאם לדין. המידע לא יימכר ולא יימסר לצד שלישי לצרכיו, אלא אם נדרש על פי דין או צו שיפוטי.</p></section>
      <section><h2>6. אבטחה</h2><p>המידע נשלח בחיבור מוצפן, נשמר במאגר שאינו פתוח לציבור, והגישה אליו מוגבלת לבעלי הרשאה מזוהים. הרשימה נמחקת אוטומטית כמפורט להלן. אין מערכת חסינה לחלוטין; אם יתרחש אירוע אבטחה חמור במאגר, נדווח עליו לרשות להגנת הפרטיות ולמי שנפגעו, כנדרש בדין.</p></section>
      <section><h2>7. כמה זמן נשמר</h2><p>הפרטים נמחקים אוטומטית 12 חודשים לאחר ההתעניינות האחרונה שלכם, אלא אם הצטרפתם בינתיים למועדון פעיל. אפשר לבקש מחיקה מוקדמת בכל עת. נשמר תיעוד מינימלי של ההסכמה ושל ביטולה, בלי פרטים מזהים, כדי להוכיח שפעלנו כדין.</p></section>
      <section><h2>8. הזכויות שלכם</h2><p>לפי חוק הגנת הפרטיות אפשר לבקש לעיין במידע שמוחזק עליכם, לתקן מידע שאינו נכון, שלם, ברור או מעודכן, ולבקש למחוק אותו או להפסיק להשתמש בו. פנו אלינו ${CONTACT}. נשיב לא יאוחר מ־30 ימים, לאחר אימות סביר של זהות הפונה. אם אינכם מרוצים מהמענה, אפשר לפנות לרשות להגנת הפרטיות במשרד המשפטים.</p></section>
      <section><h2>9. דברי פרסומת</h2><p>נשלח הודעות שיווקיות (מסרון, דוא״ל) רק אם אישרתם זאת במפורש ובנפרד, בהתאם לסעיף 30א לחוק התקשורת. כל הודעה תזהה את עצמה כפרסומת, תציין מי שולח אותה ותכלול דרך פשוטה להסרה. אפשר לבטל את ההסכמה בכל עת, ללא תשלום, גם בפנייה אלינו ${CONTACT}. הביטול חל על שיווק עתידי, ועל ביצועו נשמר רק התיעוד המינימלי האמור.</p></section>
      <section><h2>10. גיל</h2><p>הרישום מיועד לבני 18 ומעלה, והמסמן את תיבת האישור מצהיר שהוא כזה. מי שטרם מלאו לו/ה 18 מתבקש/ת לא להירשם. אם יתברר שנרשם קטין, הפרטים יימחקו.</p></section>
      <section><h2>11. שינויים בהודעה</h2><p>אם נשנה את ההודעה באופן מהותי נעדכן אותה, ובמקום שהדין דורש, נבקש הסכמה חדשה. הגרסה שאישרתם נשמרת ולא משתנה בדיעבד. גרסה זו: <bdi dir="ltr">${VERSIONS.privacy}</bdi>.</p></section>
    </div>
    ${incomplete ? '<p class="legal-warning">חסרים פרטי העסק (מסומנים בצהוב). יש להשלים אותם בקובץ kiosk-business.js לפני שימוש בפועל.</p>' : ''}
    <button class="back-link" type="button" data-legal-back>חזרה</button>`;

  const terms = `
    <h1>תנאי שימוש ורשימת המתעניינים</h1>
    <p class="legal-lead">תנאים אלה חלים על השימוש בקיוסק ועל ההרשמה לרשימת המתעניינים. אין בהם כדי לפגוע בזכויות שהדין מעניק לכם כצרכנים ואינן ניתנות להתנאה.</p>
    <div class="privacy-sections">
      <section><h2>1. מה זו ההרשמה</h2><p>ההרשמה היא בקשה לקבל עדכון כשייפתח מועדון לקוחות דיגיטלי אפשרי. כרגע אין מועדון פעיל, אין חברות, ואין התחייבות שהמועדון ייפתח, ומתי. נקודות, הטבות, פרסים או הגרלות יוצעו, אם בכלל, רק לפי תקנון נפרד שיפורסם מראש ובהתאם לדין.</p></section>
      <section><h2>2. מי יכול להירשם</h2><p>בני 18 ומעלה, עם פרטים נכונים ושלהם. אין לרשום מספר טלפון או כתובת של אדם אחר.</p></section>
      <section><h2>3. אין חובת הרשמה או קנייה</h2><p>אפשר לעיין בתפריט ולקנות בעגלה בלי להירשם. ההרשמה והסכמה לדברי פרסומת הן רשות, וכל אחת מהן נפרדת.</p></section>
      <section><h2>4. התפריט והמחירים בקיוסק</h2><p>התפריט, המחירים והזמינות מוצגים לנוחותכם ומתעדכנים מעת לעת. ייתכנו שינויים או פריטים שאזלו; המחיר והזמינות בעת ההזמנה בדלפק הם הקובעים, ובכל פער נפעל לפי הדין.</p></section>
      <section><h2>5. שימוש תקין</h2><p>אין להשתמש בקיוסק באופן שמשבש את פעולתו, פוגע בו או בצד שלישי, או מנסה לגשת למידע שאינו מיועד לכם.</p></section>
      <section><h2>6. קניין רוחני</h2><p>השם, הסימנים, התמונות, העיצוב והתכנים של שרקפה שמורים לבעליהם, ואין להעתיקם או להשתמש בהם ללא רשות.</p></section>
      <section><h2>7. אחריות</h2><p>הקיוסק ניתן במצבו, וייתכנו הפסקות או תקלות. אין באמור כדי לפטור אותנו מאחריות שאי אפשר לפטור ממנה לפי הדין.</p></section>
      <section><h2>8. שינוי והפסקה</h2><p>אנו רשאים לעדכן תנאים אלה או להפסיק את רשימת המתעניינים. שינוי מהותי יפורסם, ומי שנרשם יוכל לבקש להסיר את פרטיו בכל עת.</p></section>
      <section><h2>9. פרטיות</h2><p>הטיפול בפרטים האישיים מוסדר בהודעת הפרטיות, שהיא חלק בלתי נפרד מתנאים אלה.</p></section>
      <section><h2>10. דין ושיפוט</h2><p>על תנאים אלה יחול הדין הישראלי, וסמכות השיפוט נתונה לבתי המשפט המוסמכים בישראל. פרטי בעל העסק: ${LEGAL_NAME}. לפניות: ${CONTACT}.</p></section>
      <section><h2>11. גרסה</h2><p>גרסה זו: <bdi dir="ltr">${VERSIONS.terms}</bdi>.</p></section>
    </div>
    ${incomplete ? '<p class="legal-warning">חסרים פרטי העסק (מסומנים בצהוב). יש להשלים אותם בקובץ kiosk-business.js לפני שימוש בפועל.</p>' : ''}
    <button class="back-link" type="button" data-legal-back>חזרה</button>`;
  window.SARCAFE_LEGAL_COMPLETE = !incomplete;

  // ---- put the texts into the page --------------------------------------------------------------
  const privacyCopy = document.querySelector('.panel-privacy .privacy-copy');
  if (privacyCopy) privacyCopy.innerHTML = privacy;

  const kioskScreen = document.querySelector('.kiosk-screen');
  if (kioskScreen && !document.querySelector('.panel-terms')) {
    const panel = document.createElement('section');
    panel.className = 'panel panel-privacy panel-terms';
    panel.dataset.panel = 'terms';
    panel.hidden = true;
    panel.innerHTML = `<div class="privacy-copy">${terms}</div>`;
    document.querySelector('.panel-privacy').insertAdjacentElement('afterend', panel);
  }

  // footer: privacy and terms side by side
  const footerPrivacy = document.querySelector('.kiosk-footer [data-screen="privacy"]');
  if (footerPrivacy && !document.querySelector('.kiosk-footer [data-screen="terms"]')) {
    const termsButton = document.createElement('button');
    termsButton.type = 'button';
    termsButton.dataset.screen = 'terms';
    termsButton.textContent = 'תנאי שימוש';
    footerPrivacy.insertAdjacentElement('afterend', termsButton);
    footerPrivacy.parentElement.classList.add('has-terms');
  }

  // the prototype's "demo only, nothing is sent or saved" lines are no longer true: say what really happens
  const footerNote = document.querySelector('.kiosk-footer > span');
  if (footerNote) footerNote.textContent = 'ההרשמה לרשימת המתעניינים היא מרצון ובהסכמה';
  const quickNote = document.querySelector('.quick-form-copy p');
  if (quickNote) quickNote.textContent = 'המספר ישמש רק לרישום לרשימת המתעניינים, אחרי שתאשרו בשלב הבא.';

  // the short notice that stands next to the form, before anything is agreed to (Protection of Privacy Law s. 11)
  const consentForm = document.querySelector('.consent-form');
  if (consentForm && !consentForm.querySelector('.short-notice')) {
    const notice = document.createElement('p');
    notice.className = 'short-notice';
    notice.innerHTML = `הפרטים נמסרים מרצונכם ויועברו אל ${LEGAL_NAME} לצורך רישום לרשימת המתעניינים במועדון לקוחות דיגיטלי אפשרי, יצירת קשר בקשר להשקתו וניהול הרשימה. נבקש שם פרטי ומספר נייד; דוא״ל הוא רשות. אין חובה חוקית למסור, אבל בלי השדות הנדרשים לא נוכל לצרף אתכם. המידע יהיה נגיש לבעלי העסק ולספקי תשתית שמפעילים את המערכת עבורנו, ויימחק אוטומטית כעבור 12 חודשים. ההרשמה אינה חברות ואינה מבטיחה הטבה. לזכויותיכם (עיון, תיקון, מחיקה) ולפרטים נוספים: הודעת הפרטיות.`;
    consentForm.querySelector('.identity-fields').insertAdjacentElement('beforebegin', notice);
  }

  // the two consent boxes (the required one is not pre-ticked and covers privacy, terms and age)
  const required = consentForm && consentForm.querySelector('.required-check span');
  if (required) required.innerHTML = '<strong>קראתי את הודעת הפרטיות ואת תנאי השימוש, ואני בן/בת 18 ומעלה,</strong> ואני מבקש/ת להירשם לרשימת המתעניינים במועדון הלקוחות הדיגיטלי האפשרי של שרקפה. ידוע לי שההרשמה היא מרצוני, אינה חברות ואינה מבטיחה הטבה, ושבלי הפרטים הנדרשים לא ניתן לצרף אותי לרשימה.';
  const marketing = consentForm && consentForm.querySelector('.marketing-check span');
  if (marketing) marketing.innerHTML = '<strong>אני מסכים/ה לקבל מסרונים ודואר אלקטרוני שיווקיים משרקפה</strong>, לרבות עדכונים, הצעות והטבות. ההסכמה אינה חובה, אינה מסומנת מראש ואפשר לחזור ממנה בכל עת, ללא תשלום.';
  const privacyLink = consentForm && consentForm.querySelector('.privacy-link');
  if (privacyLink && !consentForm.querySelector('.terms-link')) {
    privacyLink.textContent = 'הודעת הפרטיות המלאה';
    const termsLink = document.createElement('button');
    termsLink.type = 'button';
    termsLink.className = 'privacy-link terms-link';
    termsLink.dataset.screen = 'terms';
    termsLink.textContent = 'תנאי השימוש';
    privacyLink.insertAdjacentElement('afterend', termsLink);
  }

  // "back" on privacy / terms returns to wherever the person opened them from (the prototype always jumped to sign-up)
  let cameFrom = 'consent';
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-screen="privacy"], [data-screen="terms"]')) return;
    const now = document.body.dataset.screen;
    if (now !== 'privacy' && now !== 'terms') cameFrom = now; // remembered at the moment of the tap
  }, true);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-legal-back], .panel-privacy .back-link')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = (cameFrom === 'welcome' || cameFrom === 'inactivity') ? 'choice' : cameFrom;
    document.querySelector(`.screen-picker [data-screen="${target}"]`)?.click();
  }, true);
})();
