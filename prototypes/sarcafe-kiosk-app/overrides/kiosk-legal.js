/*
 * Sarcafe kiosk app: the privacy notice, the terms of use, the short notice and the consent wording.
 *
 * Written to the requirements of Israeli law for this activity (Protection of Privacy Law 5741-1981 including
 * Amendment 13, the Data Security Regulations 5777-2017, Communications Law s. 30A on advertising messages) and to
 * what the system really does. It was not reviewed by a lawyer; docs/SARCAFE_KIOSK_LEGAL_NOTES.md says what each part
 * rests on and what the owner has to keep true. Who the business is comes from kiosk-business.js.
 *
 * Three languages (kiosk-i18n.js): the Hebrew is the original; the English and Arabic say the same thing. The visitor
 * reads and agrees to the texts in the language on screen, so each language has its own version ids, and the
 * sign-up sends the ids of the language shown (window.SARCAFE_LEGAL_VERSIONS follows the language).
 *
 * The version ids below are stored with every sign-up and must change whenever any wording here changes (in that
 * language); the server accepts only the versions in src/lib/kiosk/waitlist.ts (KIOSK_LEGAL_VERSIONS), so both are
 * updated together (npm run check:kiosk-waitlist fails if they drift apart).
 */
(() => {
  const VERSIONS_BY_LANG = {
    he: {
      privacy: 'kiosk-privacy-he-v5-2026-10-28',
      consent: 'kiosk-consent-he-v5-2026-10-28',
      terms: 'kiosk-terms-he-v4-2026-10-28',
    },
    en: {
      privacy: 'kiosk-privacy-en-v1-2026-11-03',
      consent: 'kiosk-consent-en-v1-2026-11-03',
      terms: 'kiosk-terms-en-v1-2026-11-03',
    },
    ar: {
      privacy: 'kiosk-privacy-ar-v1-2026-11-03',
      consent: 'kiosk-consent-ar-v1-2026-11-03',
      terms: 'kiosk-terms-ar-v1-2026-11-03',
    },
  };
  const I = window.KioskI18n;
  const current = () => (I && VERSIONS_BY_LANG[I.lang] ? I.lang : 'he');
  // the ids of the texts on screen right now (kiosk-signup.js sends these)
  Object.defineProperty(window, 'SARCAFE_LEGAL_VERSIONS', { configurable: true, get: () => ({ ...VERSIONS_BY_LANG[current()] }) });

  const B = window.SARCAFE_BUSINESS || {};
  const val = (key) => (typeof B[key] === 'string' ? B[key].trim() : '');
  const esc = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (text) => `<span class="legal-fill">[${text}]</span>`;
  let missing = 0;
  const need = (value, label) => { if (value) return esc(value); missing += 1; return fill(label); };

  const owner = [val('ownerFirstName'), val('ownerLastName')].filter(Boolean).join(' ');
  const LEGAL_NAME = need(val('businessName'), 'שם העסק');
  const OWNER = need(owner, 'שם פרטי ושם משפחה של האחראי/ת');
  const phone = val('phone');
  const PHONE = need(phone, 'מספר טלפון');
  const CONTACT = `בטלפון <bdi dir="ltr">${PHONE}</bdi>${val('email') ? `, בדוא״ל <bdi dir="ltr">${esc(val('email'))}</bdi>` : ''}${val('address') ? `, או בדואר אל ${esc(val('address'))}` : ''}`;

  const incomplete = missing > 0; // some business detail is still a [bracket]
  window.SARCAFE_LEGAL_COMPLETE = !incomplete;

  // the same facts for the English and Arabic texts; the owner's name stays as written (it names a real person)
  const OWNER_BDI = `<bdi>${OWNER}</bdi>`;
  const NAME_IN = {
    en: val('businessNameEn') ? esc(val('businessNameEn')) : LEGAL_NAME,
    ar: val('businessNameAr') ? esc(val('businessNameAr')) : LEGAL_NAME,
  };
  const CONTACT_IN = {
    en: `by phone at <bdi dir="ltr">${PHONE}</bdi>${val('email') ? `, by email at <bdi dir="ltr">${esc(val('email'))}</bdi>` : ''}${val('address') ? `, or by post to <bdi>${esc(val('address'))}</bdi>` : ''}`,
    ar: `عبر الهاتف <bdi dir="ltr">${PHONE}</bdi>${val('email') ? `، أو عبر البريد الإلكتروني <bdi dir="ltr">${esc(val('email'))}</bdi>` : ''}${val('address') ? `، أو بالبريد إلى <bdi>${esc(val('address'))}</bdi>` : ''}`,
  };

  // ---- the texts, per language --------------------------------------------------------------------------------
  function texts(lang) {
    const V = VERSIONS_BY_LANG[lang];
    if (lang === 'en') {
      const N = NAME_IN.en;
      const C = CONTACT_IN.en;
      return {
        privacy: `
    <h1>Privacy notice for the club interest list</h1>
    <p class="legal-lead">This notice is shown before you give any details. It explains what is collected, why, who may receive it and what your rights are. You can browse the menu and use the kiosk without signing up at all.</p>
    <div class="privacy-sections">
      <section><h2>1. Who is responsible for the information</h2><p>The controller of the database is ${N}, which operates Sarcafe at Givat Haviva. The person responsible for the database: ${OWNER_BDI}. For any privacy request, contact us ${C}.</p></section>
      <section><h2>2. What information is collected</h2><p>Your first name and mobile phone number. An email address, only if you choose to give one. To prove the sign-up and the consent we also keep: the branch, the time of the sign-up, the versions of the texts you agreed to, whether you agreed to advertising messages, and a random request identifier that prevents a double sign-up.</p><p>No ID number, date of birth, payment details, location, contacts or advertising identifier is collected. The details are not stored on the tablet, and the kiosk uses no cookies, analytics or tracking.</p></section>
      <section><h2>3. Why we use it</h2><p>With your consent, for: managing the interest list; contacting you when a digital customer club opens; preventing double sign-ups and misuse; handling your requests; and keeping proof of your consent. We will not use the details for any other purpose. Advertising messages will be sent only to those who agreed to them separately.</p></section>
      <section><h2>4. Do you have to give it</h2><p>No. There is no legal obligation to give this information; you give it with your consent and to the extent you choose. Without a first name, a mobile number and your confirmation of this notice we cannot add you to the list. Not giving it does not affect your use of the kiosk or the service at the truck.</p></section>
      <section><h2>5. Who may receive the information</h2><p>The list is visible only to the owners of the business and is protected by access permissions. The technology team that maintains the system may have technical access to the extent needed for maintenance and security, and is bound by confidentiality.</p><p>The information is stored and processed by cloud infrastructure providers acting for us, under our instructions and their processing terms: <bdi dir="ltr">Supabase</bdi> (the database, on servers in the European Union) and <bdi dir="ltr">Vercel</bdi> (running the website and the system). During processing the information may pass temporarily through servers outside Israel. Israel recognises the countries of the European Union as giving adequate protection to personal information, and any other transfer is made in accordance with the law. The information will not be sold or given to a third party for its own purposes, unless the law or a court order requires it.</p></section>
      <section><h2>6. Security</h2><p>The information is sent over an encrypted connection, stored in a database that is not open to the public, and access to it is limited to identified, authorised people. The list is deleted automatically as set out below. No system is completely immune; if a serious security incident occurs in the database, we will report it to the Privacy Protection Authority and to those affected, as the law requires.</p></section>
      <section><h2>7. How long it is kept</h2><p>The details are deleted automatically 12 months after your last expression of interest, unless you have joined an active club in the meantime. You can ask for earlier deletion at any time. A minimal record of the consent and of its withdrawal is kept, without identifying details, to prove that we acted lawfully.</p></section>
      <section><h2>8. Your rights</h2><p>Under the Protection of Privacy Law you can ask to inspect the information held about you, to correct information that is not correct, complete, clear or up to date, and to ask for it to be deleted or no longer used. Contact us ${C}. We will answer within 30 days at the latest, after reasonable verification of the requester’s identity. If you are not satisfied with the answer, you can turn to the Privacy Protection Authority at the Ministry of Justice.</p></section>
      <section><h2>9. Advertising messages</h2><p>We will send marketing messages (text message, email) only if you agreed to this explicitly and separately, in accordance with section 30A of the Communications Law. Every message will identify itself as advertising, say who sends it and include a simple way to unsubscribe. You can withdraw your consent at any time, free of charge, also by contacting us ${C}. Withdrawal applies to future marketing, and only the minimal record mentioned above is kept of it.</p></section>
      <section><h2>10. Age</h2><p>Signing up is for people aged 18 and over, and whoever ticks the confirmation box declares that they are. Anyone under 18 is asked not to sign up. If it turns out that a minor has signed up, the details will be deleted.</p></section>
      <section><h2>11. Changes to this notice</h2><p>If we change this notice materially we will update it and, where the law requires, ask for new consent. The version you agreed to is kept and does not change retroactively. This version: <bdi dir="ltr">${V.privacy}</bdi>.</p></section>
    </div>
    ${incomplete ? '<p class="legal-warning">Business details are missing (marked in yellow). They must be completed in kiosk-business.js before real use.</p>' : ''}
    <button class="back-link" type="button" data-legal-back>Back</button>`,
        terms: `
    <h1>Terms of use and the interest list</h1>
    <p class="legal-lead">These terms apply to the use of the kiosk and to signing up for the interest list. Nothing in them limits the rights the law gives you as a consumer that cannot be waived.</p>
    <div class="privacy-sections">
      <section><h2>1. What the sign-up is</h2><p>Signing up is a request to be told when a possible digital customer club opens. At the moment there is no active club, no membership, and no commitment that the club will open, or when. Points, perks, prizes or raffles will be offered, if at all, only under separate rules published in advance and in accordance with the law.</p></section>
      <section><h2>2. Who can sign up</h2><p>People aged 18 and over, with correct details of their own. Do not register another person’s phone number or address.</p></section>
      <section><h2>3. No obligation to sign up or buy</h2><p>You can browse the menu and buy at the truck without signing up. Signing up and consenting to advertising messages are optional, and each is separate.</p></section>
      <section><h2>4. The menu and prices on the kiosk</h2><p>The menu, prices and availability are shown for your convenience and are updated from time to time. There may be changes or items that have sold out; the price and availability when you order at the counter are what count, and any discrepancy will be handled according to the law.</p></section>
      <section><h2>5. Proper use</h2><p>Do not use the kiosk in a way that disrupts its operation, harms it or a third party, or tries to access information not meant for you.</p></section>
      <section><h2>6. Intellectual property</h2><p>Sarcafe’s name, marks, images, design and content belong to their owners and may not be copied or used without permission.</p></section>
      <section><h2>7. Liability</h2><p>The kiosk is provided as is, and there may be interruptions or faults. Nothing in this releases us from liability that cannot be excluded under the law.</p></section>
      <section><h2>8. Changes and ending</h2><p>We may update these terms or end the interest list. A material change will be published, and anyone who signed up may ask to have their details removed at any time.</p></section>
      <section><h2>9. Privacy</h2><p>The handling of personal details is governed by the privacy notice, which is an integral part of these terms.</p></section>
      <section><h2>10. Law and jurisdiction</h2><p>These terms are governed by Israeli law, and the competent courts in Israel have jurisdiction. The business: ${N}. Contact us ${C}.</p></section>
      <section><h2>11. Version</h2><p>This version: <bdi dir="ltr">${V.terms}</bdi>.</p></section>
    </div>
    ${incomplete ? '<p class="legal-warning">Business details are missing (marked in yellow). They must be completed in kiosk-business.js before real use.</p>' : ''}
    <button class="back-link" type="button" data-legal-back>Back</button>`,
        notice: `You give these details voluntarily, and they will be passed to ${N} to add you to the interest list for a possible digital customer club, to contact you about its launch and to manage the list. We ask for a first name and a mobile number; email is optional. There is no legal obligation to give them, but without the required fields we cannot add you. The information will be accessible to the owners of the business and to the infrastructure providers who run the system for us, and will be deleted automatically after 12 months. Signing up is not membership and does not promise any perk. For your rights (inspection, correction, deletion) and more details: the privacy notice.`,
        required: '<strong>I have read the privacy notice and the terms of use, and I am 18 or older,</strong> and I ask to be added to the interest list for Sarcafe’s possible digital customer club. I know that signing up is voluntary, is not membership and does not promise any perk, and that without the required details I cannot be added to the list.',
        marketing: '<strong>I agree to receive marketing text messages and emails from Sarcafe</strong>, including updates, offers and perks. This consent is optional, is not pre-ticked and can be withdrawn at any time, free of charge.',
        privacyLink: 'The full privacy notice',
        termsLink: 'The terms of use',
        termsFooter: 'Terms of use',
        footerNote: 'Joining the interest list is voluntary and by consent',
        quickNote: 'The number is used only to add you to the interest list, after you confirm in the next step.',
      };
    }
    if (lang === 'ar') {
      const N = NAME_IN.ar;
      const C = CONTACT_IN.ar;
      return {
        privacy: `
    <h1>إشعار الخصوصية لقائمة المهتمين بالنادي</h1>
    <p class="legal-lead">يُعرض هذا الإشعار قبل تقديم أي تفاصيل. وهو يوضح ما الذي يُجمع، ولماذا، ومَن قد يتلقاه، وما هي حقوقكم. يمكنكم تصفح القائمة واستخدام الكشك دون التسجيل إطلاقًا.</p>
    <div class="privacy-sections">
      <section><h2>1. مَن المسؤول عن المعلومات</h2><p>المتحكم في قاعدة البيانات هو ${N}، الذي يشغّل ساركافيه في جفعات حبيبة. المسؤول/ة عن قاعدة البيانات: ${OWNER_BDI}. لأي طلب يتعلق بالخصوصية تواصلوا معنا ${C}.</p></section>
      <section><h2>2. ما المعلومات التي تُجمع</h2><p>الاسم الشخصي ورقم الهاتف المحمول. وعنوان البريد الإلكتروني، فقط إذا اخترتم تقديمه. ولإثبات التسجيل والموافقة نحفظ أيضًا: الفرع، وموعد التسجيل، وإصدارات النصوص التي وافقتم عليها، وما إذا وافقتم على تلقي رسائل إعلانية، ومعرّفًا عشوائيًا للطلب لمنع التسجيل المزدوج.</p><p>لا يُجمع رقم هوية، أو تاريخ ميلاد، أو تفاصيل دفع، أو موقع، أو جهات اتصال، أو معرّف إعلاني. لا تُحفظ التفاصيل على الجهاز اللوحي، ولا يستخدم الكشك ملفات تعريف الارتباط أو أدوات التحليل أو التتبّع.</p></section>
      <section><h2>3. لماذا نستخدمها</h2><p>بموافقتكم، من أجل: إدارة قائمة المهتمين؛ والتواصل معكم عند افتتاح نادي زبائن رقمي؛ ومنع التسجيلات المزدوجة وإساءة الاستخدام؛ ومعالجة طلباتكم؛ والاحتفاظ بإثبات الموافقة. لن نستخدم التفاصيل لأي غرض آخر. لن تُرسل رسائل إعلانية إلا لمن وافق عليها بشكل منفصل.</p></section>
      <section><h2>4. هل يجب تقديمها</h2><p>لا. لا يوجد واجب قانوني بتقديم هذه المعلومات؛ فتقديمها يتم بموافقتكم وبالقدر الذي تختارونه. بدون الاسم الشخصي ورقم الهاتف المحمول وتأكيد هذا الإشعار لا يمكننا إضافتكم إلى القائمة. عدم تقديمها لا يؤثر على استخدامكم للكشك أو على تلقي الخدمة في العربة.</p></section>
      <section><h2>5. مَن قد يتلقى المعلومات</h2><p>القائمة مرئية لأصحاب العمل فقط، ومحمية بصلاحيات وصول. قد يكون لفريق التكنولوجيا الذي يصون النظام وصول تقني بالقدر اللازم للصيانة والأمان، وهو ملتزم بالسرية.</p><p>تُحفظ المعلومات وتُعالَج لدى مزوّدي بنية تحتية سحابية يعملون لصالحنا ووفق تعليماتنا وشروط المعالجة الخاصة بهم: <bdi dir="ltr">Supabase</bdi> (قاعدة البيانات، على خوادم في الاتحاد الأوروبي) و<bdi dir="ltr">Vercel</bdi> (تشغيل الموقع والنظام). أثناء المعالجة قد تمر المعلومات مؤقتًا عبر خوادم خارج إسرائيل. تعترف إسرائيل بدول الاتحاد الأوروبي على أنها توفّر حماية ملائمة للمعلومات الشخصية، وأي نقل آخر يتم وفقًا للقانون. لن تُباع المعلومات ولن تُسلَّم لطرف ثالث لأغراضه الخاصة، إلا إذا اقتضى ذلك القانون أو أمر قضائي.</p></section>
      <section><h2>6. الأمان</h2><p>تُرسل المعلومات عبر اتصال مشفّر، وتُحفظ في قاعدة بيانات غير مفتوحة للجمهور، ويقتصر الوصول إليها على أصحاب صلاحية معرَّفين. تُحذف القائمة تلقائيًا كما هو مفصّل أدناه. لا يوجد نظام محصّن تمامًا؛ وإذا وقع حادث أمني خطير في قاعدة البيانات فسنبلغ عنه سلطة حماية الخصوصية والمتضررين، كما يقتضي القانون.</p></section>
      <section><h2>7. مدة الحفظ</h2><p>تُحذف التفاصيل تلقائيًا بعد 12 شهرًا من آخر إبداء اهتمام من جانبكم، إلا إذا انضممتم في هذه الأثناء إلى نادٍ فعّال. يمكنكم طلب الحذف المبكر في أي وقت. يُحفظ توثيق أدنى للموافقة ولسحبها، دون تفاصيل تعريفية، لإثبات أننا تصرفنا وفق القانون.</p></section>
      <section><h2>8. حقوقكم</h2><p>بموجب قانون حماية الخصوصية يمكنكم طلب الاطلاع على المعلومات المحفوظة عنكم، وتصحيح المعلومات غير الصحيحة أو غير الكاملة أو غير الواضحة أو غير المحدَّثة، وطلب حذفها أو التوقف عن استخدامها. تواصلوا معنا ${C}. سنرد في موعد أقصاه 30 يومًا، بعد التحقق المعقول من هوية مقدّم الطلب. إذا لم تكونوا راضين عن الرد، يمكنكم التوجه إلى سلطة حماية الخصوصية في وزارة العدل.</p></section>
      <section><h2>9. الرسائل الإعلانية</h2><p>سنرسل رسائل تسويقية (رسائل نصية قصيرة، بريد إلكتروني) فقط إذا وافقتم على ذلك صراحةً وبشكل منفصل، وفقًا للبند 30أ من قانون الاتصالات. كل رسالة ستعرّف نفسها كإعلان، وتذكر الجهة المرسِلة، وتتضمن طريقة بسيطة لإلغاء الاشتراك. يمكنكم سحب موافقتكم في أي وقت ودون مقابل، بما في ذلك بالتواصل معنا ${C}. يسري السحب على التسويق المستقبلي، ولا يُحفظ عنه سوى التوثيق الأدنى المذكور.</p></section>
      <section><h2>10. السن</h2><p>التسجيل مخصص لمن هم في سن 18 عامًا فما فوق، ومن يحدد مربع التأكيد يصرّح بأنه كذلك. يُطلب ممن لم يبلغوا 18 عامًا عدم التسجيل. إذا تبيّن أن قاصرًا قد سجّل، فستُحذف تفاصيله.</p></section>
      <section><h2>11. تغييرات في الإشعار</h2><p>إذا غيّرنا الإشعار بشكل جوهري فسنحدّثه، وحيث يقتضي القانون سنطلب موافقة جديدة. الإصدار الذي وافقتم عليه يُحفظ ولا يتغيّر بأثر رجعي. هذا الإصدار: <bdi dir="ltr">${V.privacy}</bdi>.</p></section>
    </div>
    ${incomplete ? '<p class="legal-warning">تفاصيل المصلحة التجارية ناقصة (مميّزة باللون الأصفر). يجب إكمالها في الملف kiosk-business.js قبل الاستخدام الفعلي.</p>' : ''}
    <button class="back-link" type="button" data-legal-back>رجوع</button>`,
        terms: `
    <h1>شروط الاستخدام وقائمة المهتمين</h1>
    <p class="legal-lead">تسري هذه الشروط على استخدام الكشك وعلى التسجيل في قائمة المهتمين. وليس فيها ما يمسّ بالحقوق التي يمنحكم إياها القانون كمستهلكين والتي لا يجوز التنازل عنها.</p>
    <div class="privacy-sections">
      <section><h2>1. ما هو التسجيل</h2><p>التسجيل هو طلب لتلقي تحديث عند افتتاح نادي زبائن رقمي محتمل. لا يوجد حاليًا نادٍ فعّال، ولا عضوية، ولا التزام بأن النادي سيُفتتح، أو متى. النقاط أو الامتيازات أو الجوائز أو السحوبات ستُعرض، إن عُرضت أصلًا، فقط وفق نظام منفصل يُنشر مسبقًا ووفقًا للقانون.</p></section>
      <section><h2>2. مَن يمكنه التسجيل</h2><p>مَن هم في سن 18 عامًا فما فوق، بتفاصيل صحيحة تخصّهم. لا يجوز تسجيل رقم هاتف أو عنوان لشخص آخر.</p></section>
      <section><h2>3. لا إلزام بالتسجيل أو بالشراء</h2><p>يمكنكم تصفح القائمة والشراء من العربة دون التسجيل. التسجيل والموافقة على الرسائل الإعلانية اختياريان، وكل منهما منفصل عن الآخر.</p></section>
      <section><h2>4. القائمة والأسعار في الكشك</h2><p>تُعرض القائمة والأسعار والتوفّر لراحتكم، وتُحدَّث من حين لآخر. قد تحدث تغييرات أو تنفد بعض الأصناف؛ السعر والتوفّر وقت الطلب عند المنضدة هما المعتمدان، وفي حال وجود أي فرق سنتصرف وفقًا للقانون.</p></section>
      <section><h2>5. الاستخدام السليم</h2><p>لا يجوز استخدام الكشك بطريقة تعطّل عمله، أو تضرّ به أو بطرف ثالث، أو تحاول الوصول إلى معلومات غير مخصصة لكم.</p></section>
      <section><h2>6. الملكية الفكرية</h2><p>الاسم والعلامات والصور والتصميم والمحتويات الخاصة بساركافيه محفوظة لأصحابها، ولا يجوز نسخها أو استخدامها دون إذن.</p></section>
      <section><h2>7. المسؤولية</h2><p>يُقدَّم الكشك كما هو، وقد تحدث انقطاعات أو أعطال. وليس في ذلك ما يعفينا من مسؤولية لا يمكن الإعفاء منها وفقًا للقانون.</p></section>
      <section><h2>8. التغيير والإيقاف</h2><p>يحق لنا تحديث هذه الشروط أو إيقاف قائمة المهتمين. سيُنشر أي تغيير جوهري، ويمكن لمن سجّل أن يطلب إزالة تفاصيله في أي وقت.</p></section>
      <section><h2>9. الخصوصية</h2><p>يُنظِّم إشعارُ الخصوصية معالجةَ التفاصيل الشخصية، وهو جزء لا يتجزأ من هذه الشروط.</p></section>
      <section><h2>10. القانون والاختصاص القضائي</h2><p>يسري على هذه الشروط القانون الإسرائيلي، وتختص بالنظر فيها المحاكم المختصة في إسرائيل. صاحب المصلحة التجارية: ${N}. للتواصل معنا ${C}.</p></section>
      <section><h2>11. الإصدار</h2><p>هذا الإصدار: <bdi dir="ltr">${V.terms}</bdi>.</p></section>
    </div>
    ${incomplete ? '<p class="legal-warning">تفاصيل المصلحة التجارية ناقصة (مميّزة باللون الأصفر). يجب إكمالها في الملف kiosk-business.js قبل الاستخدام الفعلي.</p>' : ''}
    <button class="back-link" type="button" data-legal-back>رجوع</button>`,
        notice: `تُقدَّم هذه التفاصيل بإرادتكم وستُنقل إلى ${N} لغرض التسجيل في قائمة المهتمين بنادي زبائن رقمي محتمل، والتواصل بشأن إطلاقه، وإدارة القائمة. نطلب الاسم الشخصي ورقم الهاتف المحمول؛ والبريد الإلكتروني اختياري. لا يوجد واجب قانوني بتقديمها، لكن بدون الحقول المطلوبة لا يمكننا إضافتكم. ستكون المعلومات متاحة لأصحاب العمل ولمزوّدي البنية التحتية الذين يشغّلون النظام لصالحنا، وستُحذف تلقائيًا بعد 12 شهرًا. التسجيل ليس عضوية ولا يضمن أي امتياز. لحقوقكم (الاطلاع، التصحيح، الحذف) ولمزيد من التفاصيل: إشعار الخصوصية.`,
        required: '<strong>قرأت إشعار الخصوصية وشروط الاستخدام، وعمري 18 عامًا فما فوق،</strong> وأطلب التسجيل في قائمة المهتمين بنادي الزبائن الرقمي المحتمل لساركافيه. أعلم أن التسجيل طوعي، وليس عضوية ولا يضمن أي امتياز، وأنه بدون التفاصيل المطلوبة لا يمكن إضافتي إلى القائمة.',
        marketing: '<strong>أوافق على تلقي رسائل نصية قصيرة ورسائل بريد إلكتروني تسويقية من ساركافيه</strong>، بما في ذلك التحديثات والعروض والامتيازات. هذه الموافقة غير إلزامية، وغير محددة مسبقًا، ويمكن سحبها في أي وقت ودون مقابل.',
        privacyLink: 'إشعار الخصوصية الكامل',
        termsLink: 'شروط الاستخدام',
        termsFooter: 'شروط الاستخدام',
        footerNote: 'الانضمام إلى قائمة المهتمين طوعي وبموافقة',
        quickNote: 'سيُستخدم الرقم فقط لتسجيلكم في قائمة المهتمين، بعد أن تؤكدوا في الخطوة التالية.',
      };
    }
    // Hebrew: the original wording (its version ids above)
    return {
      privacy: `
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
      <section><h2>11. שינויים בהודעה</h2><p>אם נשנה את ההודעה באופן מהותי נעדכן אותה, ובמקום שהדין דורש, נבקש הסכמה חדשה. הגרסה שאישרתם נשמרת ולא משתנה בדיעבד. גרסה זו: <bdi dir="ltr">${V.privacy}</bdi>.</p></section>
    </div>
    ${incomplete ? '<p class="legal-warning">חסרים פרטי העסק (מסומנים בצהוב). יש להשלים אותם בקובץ kiosk-business.js לפני שימוש בפועל.</p>' : ''}
    <button class="back-link" type="button" data-legal-back>חזרה</button>`,
      terms: `
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
      <section><h2>11. גרסה</h2><p>גרסה זו: <bdi dir="ltr">${V.terms}</bdi>.</p></section>
    </div>
    ${incomplete ? '<p class="legal-warning">חסרים פרטי העסק (מסומנים בצהוב). יש להשלים אותם בקובץ kiosk-business.js לפני שימוש בפועל.</p>' : ''}
    <button class="back-link" type="button" data-legal-back>חזרה</button>`,
      notice: `הפרטים נמסרים מרצונכם ויועברו אל ${LEGAL_NAME} לצורך רישום לרשימת המתעניינים במועדון לקוחות דיגיטלי אפשרי, יצירת קשר בקשר להשקתו וניהול הרשימה. נבקש שם פרטי ומספר נייד; דוא״ל הוא רשות. אין חובה חוקית למסור, אבל בלי השדות הנדרשים לא נוכל לצרף אתכם. המידע יהיה נגיש לבעלי העסק ולספקי תשתית שמפעילים את המערכת עבורנו, ויימחק אוטומטית כעבור 12 חודשים. ההרשמה אינה חברות ואינה מבטיחה הטבה. לזכויותיכם (עיון, תיקון, מחיקה) ולפרטים נוספים: הודעת הפרטיות.`,
      required: '<strong>קראתי את הודעת הפרטיות ואת תנאי השימוש, ואני בן/בת 18 ומעלה,</strong> ואני מבקש/ת להירשם לרשימת המתעניינים במועדון הלקוחות הדיגיטלי האפשרי של שרקפה. ידוע לי שההרשמה היא מרצוני, אינה חברות ואינה מבטיחה הטבה, ושבלי הפרטים הנדרשים לא ניתן לצרף אותי לרשימה.',
      marketing: '<strong>אני מסכים/ה לקבל מסרונים ודואר אלקטרוני שיווקיים משרקפה</strong>, לרבות עדכונים, הצעות והטבות. ההסכמה אינה חובה, אינה מסומנת מראש ואפשר לחזור ממנה בכל עת, ללא תשלום.',
      privacyLink: 'הודעת הפרטיות המלאה',
      termsLink: 'תנאי השימוש',
      termsFooter: 'תנאי שימוש',
      footerNote: 'ההרשמה לרשימת המתעניינים היא מרצון ובהסכמה',
      quickNote: 'המספר ישמש רק לרישום לרשימת המתעניינים, אחרי שתאשרו בשלב הבא.',
    };
  }

  // ---- put the texts into the page --------------------------------------------------------------------------------
  const privacyCopy = document.querySelector('.panel-privacy .privacy-copy');
  const kioskScreen = document.querySelector('.kiosk-screen');
  let termsCopy = null;
  if (kioskScreen && !document.querySelector('.panel-terms')) {
    const panel = document.createElement('section');
    panel.className = 'panel panel-privacy panel-terms';
    panel.dataset.panel = 'terms';
    panel.hidden = true;
    panel.innerHTML = '<div class="privacy-copy"></div>';
    document.querySelector('.panel-privacy').insertAdjacentElement('afterend', panel);
    termsCopy = panel.querySelector('.privacy-copy');
  }

  // footer: privacy and terms side by side
  const footerPrivacy = document.querySelector('.kiosk-footer [data-screen="privacy"]');
  let termsButton = null;
  if (footerPrivacy && !document.querySelector('.kiosk-footer [data-screen="terms"]')) {
    termsButton = document.createElement('button');
    termsButton.type = 'button';
    termsButton.dataset.screen = 'terms';
    footerPrivacy.insertAdjacentElement('afterend', termsButton);
    footerPrivacy.parentElement.classList.add('has-terms');
  }

  // the prototype's "demo only, nothing is sent or saved" lines are no longer true: say what really happens
  const footerNote = document.querySelector('.kiosk-footer > span');
  const quickNote = document.querySelector('.quick-form-copy p');

  // the short notice that stands next to the form, before anything is agreed to (Protection of Privacy Law s. 11)
  const consentForm = document.querySelector('.consent-form');
  let notice = null;
  if (consentForm && !consentForm.querySelector('.short-notice')) {
    notice = document.createElement('p');
    notice.className = 'short-notice';
    consentForm.querySelector('.identity-fields').insertAdjacentElement('beforebegin', notice);
  }

  // the two consent boxes (the required one is not pre-ticked and covers privacy, terms and age)
  const required = consentForm && consentForm.querySelector('.required-check span');
  const marketing = consentForm && consentForm.querySelector('.marketing-check span');
  const privacyLink = consentForm && consentForm.querySelector('.privacy-link');
  let termsLink = null;
  if (privacyLink && !consentForm.querySelector('.terms-link')) {
    termsLink = document.createElement('button');
    termsLink.type = 'button';
    termsLink.className = 'privacy-link terms-link';
    termsLink.dataset.screen = 'terms';
    privacyLink.insertAdjacentElement('afterend', termsLink);
  }

  // Every legal word on the page, in one language. Only this file's own fixed templates go in as HTML: remote or
  // typed text never reaches them, and the business facts are escaped above.
  function show(lang) {
    const x = texts(lang);
    if (privacyCopy) privacyCopy.innerHTML = x.privacy;
    if (termsCopy) termsCopy.innerHTML = x.terms;
    if (termsButton) termsButton.textContent = x.termsFooter;
    if (footerNote) footerNote.textContent = x.footerNote;
    if (quickNote) quickNote.textContent = x.quickNote;
    if (notice) notice.innerHTML = x.notice;
    if (required) required.innerHTML = x.required;
    if (marketing) marketing.innerHTML = x.marketing;
    if (privacyLink) privacyLink.textContent = x.privacyLink;
    if (termsLink) termsLink.textContent = x.termsLink;
  }
  show(current());
  // a language change keeps the reading position at the top of the new text
  if (I) I.onChange((lang) => {
    show(lang);
    document.querySelectorAll('.panel-privacy').forEach((panel) => { panel.scrollTop = 0; });
  });

  // "back" on privacy / terms returns to wherever the person opened them from (the prototype always jumped to sign-up)
  let cameFrom = 'consent';
  // where this visitor came from is theirs: a privacy reset forgets it
  if (window.KioskSession) window.KioskSession.registerClearer(() => { cameFrom = 'consent'; });
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
