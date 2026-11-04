/*
 * Sarcafe kiosk app: the welcome (attract) screen. The kiosk's two jobs are the menu and the loyalty-club waitlist;
 * the announcements are secondary and only ever show while the session controller says ATTRACT (after a completed
 * reset, never over a form that holds someone's details).
 *
 *  - upper part: a bordered panel with rotating announcements (~7 s each; paused while the page is hidden or a finger
 *    is down; instant switch with reduced motion). A customer can go back to one they missed: two round arrow buttons
 *    on the sides (the one on the right points right, the one on the left points left; whichever way the next
 *    announcement lies in the language on screen) and a drag sideways. Going past the last one comes round to the first.
 *    Only two announcements move at a time (the one leaving and the one arriving), transform only.
 *  - lower part: two large buttons that never move, "לתפריט שלנו" and "הצטרפו למועדון"; one tap opens the feature
 *  - a tap on an announcement with an action ('join' / 'menu') opens it; a tap anywhere else stops the slideshow and
 *    shows the regular choice screen (the arrows and a drag are not taps)
 *  - what staff tune (arrows, drag, auto-play, loop, slide or fade, what a tap does, which announcements this tablet
 *    shows, the time on each) comes from KioskConfig (kiosk-config.js, the control panel)
 *
 * Content: GET <portal>/api/kiosk/content[?since=<version>] (derived from the menu endpoint the app already has).
 * Fetched at start, when the menu realtime ping arrives (kiosk-sync.js fires 'kiosk:menu-ping') and every 15 minutes,
 * only in ATTRACT. The last good answer is kept in localStorage (no personal data in it); without one, the built-in
 * defaults below are shown. Every remote string goes in through textContent, never as HTML; the QR code arrives as
 * a 0/1 module matrix and is drawn on a canvas. idleSeconds / graceSeconds go to the session controller.
 */
(() => {
  const S = window.KioskSession;
  const panel = document.querySelector('.panel-welcome');
  if (!S || !panel) return;

  const body = document.body;
  const CACHE_KEY = 'sarcafe.kiosk.content.v1';
  const REFRESH_MS = 15 * 60 * 1000;
  const PING_GAP_MS = 10000;
  const FEEDBACK_URL = 'https://sarcafe-portal.vercel.app/feedback';
  // QR of FEEDBACK_URL (error correction M, 29x29), made with the repo's `qrcode` package; check-kiosk-session.mjs
  // regenerates it and fails if this copy drifts.
  const FEEDBACK_QR = ['11111110011000001111001111111', '10000010001000111100001000001', '10111010110110111010101011101', '10111010100111110101001011101', '10111010110010001001101011101', '10000010111110110100101000001', '11111110101010101010101111111', '00000000111110001010000000000', '10111110011101110100001111100', '11110001011100001011111110001', '00110011101001011000010100000', '11011000011110001000100011010', '01110011100011100100100001100', '11001100110010000001111110001', '11010011011000010110000001100', '01000001101100110011011010010', '10011011001001111100100101100', '10101000110010001011111110101', '10101010011001010110100110100', '10001000100110110001100010010', '10110110110001111101111110111', '00000000100011001010100011111', '11111110001101011001101011100', '10000010101010110001100010011', '10111010111000010100111110111', '10111010100011001110010001111', '10111010100000010000011111110', '10000010001111001011101101010', '11111110110000000111000011100'];

  const DEFAULTS = {
    version: 'builtin',
    settings: { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7 },
    ads: [
      { id: 'location', kind: 'location', title: 'סניף האם במאור', body: 'בואו לבקר את סניף האם שלנו במאור באווירת מושב חמה בימי ראשון עד שישי', action: 'none', qr: null, imageUrl: null },
      { id: 'feedback', kind: 'feedback', title: 'מה תרצו למצוא בעגלה?', body: 'סרקו את קוד ה-QR כדי להצביע ולהשפיע על מה שיש לעגלה להציע — אנחנו רוצים לשמוע אתכם', action: 'none', qr: { url: FEEDBACK_URL, modules: FEEDBACK_QR }, imageUrl: null },
      { id: 'loyalty', kind: 'loyalty', title: 'מועדון הלקוחות של שרקפה', body: 'מעוניינים במועדון לקוחות עם צבירת נקודות ואירועים? הירשמו בלחיצה על המסך', action: 'join', qr: null, imageUrl: null },
      { id: 'hours', kind: 'hours', title: 'שעות הפתיחה', body: '', action: 'none', qr: null, imageUrl: null },
      { id: 'menu', kind: 'menu_highlight', title: 'כדאי לטעום', body: 'מהתפריט של היום', action: 'menu', qr: null, imageUrl: null },
    ],
    hours: null,
    highlights: [],
  };

  const KIND_LABEL = { location: 'סניף האם', feedback: 'משוב', loyalty: 'מועדון לקוחות', hours: 'שעות פתיחה', menu_highlight: 'מהתפריט', custom: 'שרקפה' };
  const KINDS = new Set(Object.keys(KIND_LABEL));
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  // the visitor's language (kiosk-i18n.js); without that layer, the Hebrew above. Announcement texts the owner wrote
  // stay as written; the built-in and starting ones, and every fixed word, follow the language.
  const I = window.KioskI18n;
  const tr = (key, hebrew, ...args) => (I ? I.t(key, ...args) : hebrew);
  const kindLabel = (kind) => (I ? I.t('kinds')[kind] : KIND_LABEL[kind]);
  const dayName = (d) => (I ? I.t('day', d) : `יום ${DAYS[d]}`);
  const said = (text) => (I && text ? I.announcement(text) : text);
  const dish = (name) => (I ? I.menuName(name) : name);

  // ---- strict validation of what the server sent (anything odd is dropped, never shown) ------------------------
  const isStr = (v, max) => typeof v === 'string' && v.length <= max;
  const optStr = (v, max) => v === null || v === undefined || isStr(v, max);
  const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const clamp = (v, min, max, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

  function cleanQr(qr) {
    if (!qr || typeof qr !== 'object' || !isStr(qr.url, 300) || !Array.isArray(qr.modules)) return null;
    const n = qr.modules.length;
    if (n < 21 || n > 177 || (n - 17) % 4 !== 0) return null;
    const pattern = new RegExp(`^[01]{${n}}$`);
    return qr.modules.every((row) => typeof row === 'string' && pattern.test(row)) ? { url: qr.url, modules: qr.modules.slice() } : null;
  }

  function cleanAd(ad) {
    if (!ad || typeof ad !== 'object' || !isStr(ad.id, 80) || !KINDS.has(ad.kind)) return null;
    if (!isStr(ad.title, 120) || !isStr(ad.body, 400)) return null;
    const action = ad.action === 'join' || ad.action === 'menu' ? ad.action : 'none';
    const imageUrl = isStr(ad.imageUrl, 500) && /^https:\/\/[^\s"'<>]+$/.test(ad.imageUrl) ? ad.imageUrl : null;
    return { id: ad.id, kind: ad.kind, title: ad.title, body: ad.body, action, qr: cleanQr(ad.qr), imageUrl };
  }

  function cleanHours(hours) {
    if (!hours || typeof hours !== 'object' || !Array.isArray(hours.week)) return null;
    const week = hours.week.filter((d) => d && Number.isInteger(d.day) && d.day >= 0 && d.day <= 6
      && ((d.open === null && d.close === null) || (isTime(d.open) && isTime(d.close))))
      .map((d) => ({ day: d.day, open: d.open, close: d.close }));
    const exceptions = (Array.isArray(hours.exceptions) ? hours.exceptions : []).filter((e) => e
      && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.closed === 'boolean'
      && (e.closed || (isTime(e.open) && isTime(e.close))) && optStr(e.note, 120))
      .map((e) => ({ date: e.date, closed: e.closed, open: e.open || null, close: e.close || null, note: e.note || null }));
    if (!week.length && !exceptions.length) return null;
    return { timezone: isStr(hours.timezone, 60) ? hours.timezone : 'Asia/Jerusalem', week, exceptions };
  }

  function cleanContent(c) {
    if (!c || typeof c !== 'object' || !isStr(c.version, 100) || !Array.isArray(c.ads)) return null;
    const s = c.settings && typeof c.settings === 'object' ? c.settings : {};
    return {
      version: c.version,
      settings: {
        idleSeconds: clamp(s.idleSeconds, 30, 300, 60),
        graceSeconds: clamp(s.graceSeconds, 5, 30, 10),
        slideSeconds: clamp(s.slideSeconds, 4, 30, 7),
      },
      kiosk: window.KioskConfig ? window.KioskConfig.sanitizeKiosk(c.kiosk) : null, // this tablet's own settings (kiosk-config.js)
      ads: c.ads.slice(0, 20).map(cleanAd).filter(Boolean),
      hours: cleanHours(c.hours),
      highlights: (Array.isArray(c.highlights) ? c.highlights : []).filter((h) => h && isStr(h.name, 80)
        && (h.price === null || h.price === undefined || (typeof h.price === 'number' && Number.isFinite(h.price)))
        && optStr(h.note, 120)).slice(0, 6).map((h) => ({ name: h.name, price: typeof h.price === 'number' ? h.price : null, note: h.note || null })),
    };
  }

  // ---- building the slides (textContent only) -------------------------------------------------------------------
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  function drawQr(modules) {
    const n = modules.length;
    const quiet = 4;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const k = Math.max(2, Math.floor((168 * dpr) / (n + quiet * 2)));   // whole device pixels per module: crisp edges
    const canvas = document.createElement('canvas');
    canvas.className = 'attract-qr';
    canvas.width = canvas.height = (n + quiet * 2) * k;
    canvas.style.width = canvas.style.height = `${canvas.width / dpr}px`;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', tr('qrAria', 'קוד QR'));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#171813';
    modules.forEach((row, y) => {
      for (let x = 0; x < n; x += 1) if (row.charCodeAt(x) === 49) ctx.fillRect((x + quiet) * k, (y + quiet) * k, k, k);
    });
    return canvas;
  }

  // "today" and the dates of the coming days in the business's time zone
  function dayInZone(tz, offsetDays) {
    const at = new Date(Date.now() + offsetDays * 86400000);
    let text;
    try { text = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at); }
    catch (_) { text = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(at); }
    const [y, m, d] = text.split('-').map(Number);
    return { iso: text, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), label: `${d}.${m}` };
  }

  const span = (open, close) => `${open}–${close}`;

  function hoursBlock(hours) {
    const wrap = el('div', 'attract-hours');
    const today = dayInZone(hours.timezone, 0);
    const todayException = hours.exceptions.find((e) => e.date === today.iso);
    const todayRegular = hours.week.find((d) => d.day === today.weekday);
    const todaySource = todayException || todayRegular;
    if (todaySource) {
      const open = todayException ? !todayException.closed : !!todayRegular.open;
      const line = el('p', 'attract-today', open ? tr('today', 'היום ') : tr('closedToday', 'היום סגור'));
      if (open) {
        const time = el('span', '', span(todaySource.open, todaySource.close));
        time.dir = 'ltr'; // a time range inside Hebrew text must not be reordered
        line.append(time);
      }
      if (todayException && todayException.note) line.append(el('small', '', ` · ${todayException.note}`));
      wrap.append(line);
    }
    if (hours.week.length) {
      const list = el('ul', 'attract-week');
      hours.week.slice().sort((a, b) => a.day - b.day).forEach((d) => {
        const item = el('li', d.day === today.weekday ? 'is-today' : '');
        item.append(el('span', '', dayName(d.day)), el('b', '', d.open ? span(d.open, d.close) : tr('closed', 'סגור')));
        item.lastChild.dir = 'ltr';
        list.append(item);
      });
      wrap.append(list);
    }
    // the coming exceptions (two weeks ahead), so a closure is announced before the day
    const ahead = [];
    for (let i = 1; i <= 14; i += 1) {
      const day = dayInZone(hours.timezone, i);
      const e = hours.exceptions.find((x) => x.date === day.iso);
      if (e) ahead.push({ day, e });
    }
    if (ahead.length) {
      const list = el('ul', 'attract-exceptions');
      ahead.slice(0, 3).forEach(({ day, e }) => {
        const item = el('li', '', `${dayName(day.weekday)} `);
        const date = el('span', '', day.label);
        date.dir = 'ltr';
        item.append(date, ': ');
        if (e.closed) item.append(tr('closed', 'סגור'));
        else { const time = el('span', '', span(e.open, e.close)); time.dir = 'ltr'; item.append(time); }
        if (e.note) item.append(` · ${e.note}`);
        list.append(item);
      });
      wrap.append(list);
    }
    return wrap;
  }

  function highlightItems(content) {
    if (content.highlights.length) return content.highlights;
    const menu = window.SARCAFE_MENU;
    const picked = [];
    ((menu && menu.categories) || []).forEach((category) => (category.items || []).forEach((item) => {
      if (item && item.recommended && typeof item.name === 'string') picked.push({ name: item.name, price: item.price, note: item.note || null });
    }));
    return picked.slice(0, 4);
  }

  function highlightsBlock(items) {
    const list = el('ul', 'attract-highlights');
    items.forEach((item) => {
      const row = el('li');
      row.append(el('span', '', dish(item.name)));
      if (item.price !== null && item.price !== undefined) {
        const price = el('b', '', `₪${item.price}`);
        price.dir = 'ltr';
        row.append(price);
      }
      list.append(row);
    });
    return list;
  }

  function buildSlide(ad, content) {
    let media = null;
    if (ad.kind === 'hours') {
      if (!content.hours) return null; // no hours from the dashboard: say nothing rather than guess
      media = hoursBlock(content.hours);
    } else if (ad.kind === 'menu_highlight') {
      const items = highlightItems(content);
      if (!items.length) return null;
      media = highlightsBlock(items);
    } else if (ad.qr) {
      media = el('figure', 'attract-qr-wrap');
      media.append(drawQr(ad.qr.modules), el('figcaption', '', ad.qr.url.replace(/^https?:\/\//, '')));
    } else if (ad.imageUrl) {
      const img = el('img', 'attract-image');
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove());
      img.src = ad.imageUrl;
      media = img;
    }

    const slide = el('article', 'attract-ad');
    slide.dataset.kind = ad.kind;
    slide.dataset.action = ad.action;
    slide.dataset.id = ad.id;
    const text = el('div', 'attract-text');
    text.append(el('span', 'attract-kicker', kindLabel(ad.kind)), el('h2', '', said(ad.title)));
    if (ad.body) text.append(el('p', '', said(ad.body)));
    if (ad.kind === 'loyalty') text.append(el('small', 'attract-note', tr('clubNote', 'המועדון בהקמה · ההטבות עוד לא פעילות')));
    if (ad.action !== 'none') text.append(el('span', 'attract-cta', ad.action === 'join' ? tr('ctaJoin', 'לחצו להצטרפות לרשימה') : tr('ctaMenu', 'לחצו לתפריט')));
    slide.append(text);
    if (media) { slide.classList.add('has-media'); slide.append(media); }
    return slide;
  }

  // ---- the layout ----------------------------------------------------------------------------------------------
  const C = window.KioskConfig;
  const cget = (path, fallback) => { const v = C ? C.get(path) : undefined; return v === undefined || v === null ? fallback : v; };

  const root = el('div', 'attract');
  const adsBox = el('section', 'attract-ads');
  const labelAds = () => {
    adsBox.setAttribute('aria-roledescription', tr('carousel', 'קרוסלה'));
    adsBox.setAttribute('aria-label', tr('adsAria', 'עדכונים משרקפה'));
  };
  labelAds();
  const dots = el('div', 'attract-dots');
  dots.setAttribute('aria-hidden', 'true');
  const actions = el('div', 'attract-actions');
  const svgOf = (viewBox, d, cls) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
  };
  const button = (cls, screenName, label, icon) => {
    const b = el('button', `attract-btn ${cls}`);
    b.type = 'button';
    b.dataset.screen = screenName; // app.js opens the screen; one tap
    b.append(el('span', '', label));
    b.append(svgOf('0 0 32 32', icon));
    return b;
  };
  actions.append(
    button('attract-menu', 'menu', tr('btnMenu', 'לתפריט שלנו'), 'M7 5h18v22H7zM11 11h10M11 16h10M11 21h6'),
    button('attract-join', 'join', tr('btnJoin', 'הצטרפו למועדון'), 'M16 3.5 20 12l8.5 1.2-6.2 6 1.5 8.4L16 23.5l-7.8 4.1 1.5-8.4-6.2-6L12 12 16 3.5Z'),
  );

  // the two arrows: physical sides, so the one on the right always points right and the one on the left points left
  const arrowRight = el('button', 'attract-arrow attract-arrow-right');
  const arrowLeft = el('button', 'attract-arrow attract-arrow-left');
  [arrowRight, arrowLeft].forEach((b) => { b.type = 'button'; });
  arrowRight.append(svgOf('0 0 24 24', 'M9 4.5 16.5 12 9 19.5'));
  arrowLeft.append(svgOf('0 0 24 24', 'M15 4.5 7.5 12 15 19.5'));
  const labelArrows = () => {
    // the side the NEXT announcement lies on depends on the reading direction of the language on screen
    const rtl = getComputedStyle(adsBox).direction === 'rtl';
    arrowRight.setAttribute('aria-label', rtl ? tr('adPrev', 'המודעה הקודמת') : tr('adNext', 'המודעה הבאה'));
    arrowLeft.setAttribute('aria-label', rtl ? tr('adNext', 'המודעה הבאה') : tr('adPrev', 'המודעה הקודמת'));
  };

  root.append(adsBox, actions);
  adsBox.append(dots, arrowRight, arrowLeft);
  panel.append(root);
  body.classList.add('has-attract');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const syncInstant = () => root.classList.toggle('is-instant', reduced.matches);
  syncInstant();
  reduced.addEventListener?.('change', syncInstant);
  const instant = () => reduced.matches;

  let content = DEFAULTS;
  let slides = [];
  let index = 0;
  let slideTimer;
  let renderPending = false;
  let busy = false;          // a slide is moving
  let queued = 0;            // one tap that came while it moved (+1 / -1)
  let moveTimer;
  let suppressClickUntil = 0;

  // which way "later" lies on screen: +1 to the right (left-to-right text), -1 to the left (Hebrew, Arabic)
  const END = () => (getComputedStyle(adsBox).direction === 'rtl' ? -1 : 1);
  const widthOf = () => adsBox.clientWidth || 1;
  const clearInline = (node) => { node.style.transition = ''; node.style.transform = ''; node.style.visibility = ''; node.style.zIndex = ''; };

  // what this tablet's settings say about the announcements right now
  const adsOn = () => {
    const hidden = new Set(cget('ads.hiddenIds', []));
    const club = cget('display.clubEnabled', true);
    return content.ads.filter((ad) => !hidden.has(ad.id) && !(ad.kind === 'loyalty' && !club));
  };
  const timing = () => {
    const kiosk = content.settings;
    return {
      idleSeconds: cget('timing.idleSeconds', kiosk.idleSeconds),
      graceSeconds: cget('timing.graceSeconds', kiosk.graceSeconds),
      slideSeconds: cget('ads.slideSeconds', kiosk.slideSeconds),
      successSeconds: cget('timing.successSeconds', 10),
    };
  };
  const mode = () => (cget('ads.transition', 'slide') === 'fade' ? 'fade' : 'slide');

  function paintControls() {
    const many = slides.length > 1;
    adsBox.dataset.mode = mode();
    adsBox.classList.toggle('has-arrows', many && !!cget('ads.arrows', true));
    adsBox.classList.toggle('is-single', !many);
    adsBox.hidden = slides.length === 0;
    const loop = !!cget('ads.loop', true);
    const rightDir = END();    // the button on the right goes toward the right
    const edge = (dirSign) => !loop && (index + dirSign < 0 || index + dirSign >= slides.length);
    arrowRight.disabled = edge(rightDir);
    arrowLeft.disabled = edge(-rightDir);
    labelArrows();
  }

  function render() {
    renderPending = false;
    abortMove();
    adsBox.querySelectorAll('.attract-ad').forEach((node) => node.remove());
    let built = adsOn().map((ad) => buildSlide(ad, content)).filter(Boolean);
    // nothing of the owner's can be shown (all switched off here, or none left): the announcements go away rather than show
    // the built-in ones the owner did not choose. Only a tablet that has never heard from the portal shows the built-in set.
    if (!built.length && content.version === 'builtin') built = DEFAULTS.ads.map((ad) => buildSlide(ad, DEFAULTS)).filter(Boolean);
    slides = built;
    slides.forEach((slide) => adsBox.insertBefore(slide, dots));
    dots.replaceChildren(...slides.map(() => el('i')));
    index = 0;
    activate(0);
    paintControls();
  }

  function activate(i) {
    index = slides.length ? ((i % slides.length) + slides.length) % slides.length : 0;
    slides.forEach((slide, n) => {
      clearInline(slide);
      slide.classList.toggle('is-active', n === index);
      slide.setAttribute('aria-hidden', String(n !== index));
    });
    [...dots.children].forEach((dot, n) => dot.classList.toggle('is-active', n === index));
  }

  const slideMs = () => timing().slideSeconds * 1000 * S.scale;
  function stopSlides() { clearTimeout(slideTimer); slideTimer = undefined; }
  function runSlides() {
    stopSlides();
    if (S.state !== 'ATTRACT' || document.hidden || slides.length < 2 || !cget('ads.autoPlay', true) || drag.active) return;
    slideTimer = setTimeout(() => step(1, 'auto'), slideMs());
  }

  const moveMs = () => Math.max(40, (document.documentElement.dataset.perf === 'lite' ? 260 : 380) * S.scale);

  // the index one step on, or -1 when there is none (the end, with going round switched off)
  function neighbour(dirSign) {
    const n = slides.length;
    const i = index + dirSign;
    if (i >= 0 && i < n) return i;
    return cget('ads.loop', true) ? ((i % n) + n) % n : -1;
  }

  function abortMove() {
    clearTimeout(moveTimer);
    busy = false;
    queued = 0;
    slides.forEach(clearInline);
  }

  // one step: +1 the next announcement, -1 the one before. reason: 'auto' (the timer) | 'tap' (an arrow)
  function step(dirSign, reason) {
    if (slides.length < 2 || S.state !== 'ATTRACT') return;
    if (busy) { if (reason === 'tap') queued = dirSign; return; }
    let dir = dirSign;
    if (reason === 'auto') dir = 1;
    // the timer always comes round; a tap stops at the end when going round is switched off
    const target = reason === 'auto' ? (index + 1) % slides.length : neighbour(dir);
    if (target < 0) return;
    stopSlides();
    animateTo(target, dir, 0, widthOf());
  }

  // Slide `target` in from the side it lies on while the current one leaves; `fromX` is how far the current one already
  // is from rest (a drag in progress), `w` the width. Fade mode only changes opacity.
  function animateTo(target, dirSign, fromX, w) {
    const from = slides[index];
    const to = slides[target];
    busy = true;
    const finish = () => {
      busy = false;
      activate(target);
      paintControls();
      if (queued) { const q = queued; queued = 0; step(q, 'tap'); return; }
      runSlides();
    };
    if (instant()) { finish(); return; }
    if (mode() === 'fade') {
      clearInline(from);
      clearInline(to);
      to.classList.add('is-active');
      from.classList.remove('is-active');
      moveTimer = setTimeout(finish, 820 * S.scale);
      return;
    }
    const loc = dirSign * END() * w;           // where the arriving one waits
    to.style.transition = 'none';
    to.style.visibility = 'visible';
    to.style.transform = `translate3d(${fromX + loc}px,0,0)`;
    to.style.zIndex = '2';
    void adsBox.offsetWidth;                   // start from there
    const ms = moveMs();
    const ease = `transform ${ms}ms cubic-bezier(.22,.8,.3,1)`;
    from.style.transition = ease;
    to.style.transition = ease;
    from.style.transform = `translate3d(${-loc}px,0,0)`;
    to.style.transform = 'translate3d(0,0,0)';
    moveTimer = setTimeout(finish, ms + 50);
  }

  // ---- dragging -------------------------------------------------------------------------------------------------------
  const drag = { id: null, x0: 0, y0: 0, t0: 0, dx: 0, active: false, dir: 0, to: -1 };

  function dragEnd(commit) {
    if (!drag.active) { drag.id = null; return; }
    const w = widthOf();
    const dx = drag.dx;
    const target = drag.to;
    const dir = drag.dir;
    drag.active = false;
    drag.id = null;
    suppressClickUntil = Date.now() + 400;       // the tap that ends a drag is not a tap on the screen
    if (commit && target >= 0) {
      busy = false;
      animateTo(target, dir, dx, w);
      return;
    }
    // back where it was
    const from = slides[index];
    const other = target >= 0 ? slides[target] : null;
    const ease = `transform ${moveMs()}ms cubic-bezier(.22,.8,.3,1)`;
    busy = true;
    from.style.transition = ease;
    from.style.transform = 'translate3d(0,0,0)';
    if (other) {
      other.style.transition = ease;
      other.style.transform = `translate3d(${dir * END() * w}px,0,0)`;
    }
    moveTimer = setTimeout(() => { busy = false; slides.forEach(clearInline); activate(index); runSlides(); }, moveMs() + 50);
  }

  function dragMove(event) {
    if (event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x0;
    const dy = event.clientY - drag.y0;
    if (!drag.active) {
      if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) { drag.id = null; runSlides(); return; }   // a vertical gesture is not ours
      if (Math.abs(dx) < 10) return;
      drag.active = true;
      busy = true;
      try { adsBox.setPointerCapture(event.pointerId); } catch (_) { /* the page still gets the moves */ }
    }
    const w = widthOf();
    // the finger moving right brings in what lies to the left of the current one, and the other way round
    const dirSign = -Math.sign(dx || 1) * END();
    if (dirSign !== drag.dir) {
      // the finger crossed its start: another neighbour
      if (drag.to >= 0) clearInline(slides[drag.to]);
      drag.dir = dirSign;
      drag.to = neighbour(dirSign);
      if (drag.to >= 0) {
        const other = slides[drag.to];
        other.style.visibility = 'visible';
        other.style.zIndex = '2';
      }
    }
    // with nothing beyond (going round off) the current one only gives a little, like a rubber band
    const shown = drag.to >= 0 ? dx : dx * 0.25;
    drag.dx = shown;
    const from = slides[index];
    from.style.transition = 'none';
    from.style.transform = `translate3d(${shown}px,0,0)`;
    if (drag.to >= 0) {
      const other = slides[drag.to];
      other.style.transition = 'none';
      other.style.transform = `translate3d(${shown + drag.dir * END() * w}px,0,0)`;
    }
  }

  adsBox.addEventListener('pointerdown', (event) => {
    if (!cget('ads.swipe', true) || event.target.closest('.attract-arrow') || S.state !== 'ATTRACT' || slides.length < 2 || busy) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag.id = event.pointerId;
    drag.x0 = event.clientX; drag.y0 = event.clientY; drag.t0 = performance.now(); drag.dx = 0;
    drag.active = false; drag.dir = 0; drag.to = -1;
    stopSlides();                                  // a finger on the screen: the show waits
  });
  adsBox.addEventListener('pointermove', dragMove);
  const release = (event) => {
    if (event.pointerId !== drag.id) return;
    if (!drag.active) { drag.id = null; runSlides(); return; }   // a plain tap: the click handler below decides
    const w = widthOf();
    const dt = Math.max(1, performance.now() - drag.t0);
    const fast = Math.abs(drag.dx) / dt > 0.45 && Math.abs(drag.dx) > 24;
    dragEnd(Math.abs(drag.dx) > w * 0.22 || fast);
  };
  adsBox.addEventListener('pointerup', release);
  adsBox.addEventListener('pointercancel', (event) => { if (event.pointerId === drag.id) dragEnd(false); });
  adsBox.addEventListener('lostpointercapture', (event) => { if (event.pointerId === drag.id && drag.active) release(event); });

  // ---- the arrows -----------------------------------------------------------------------------------------------------
  arrowRight.addEventListener('click', (event) => { event.stopPropagation(); step(END(), 'tap'); });
  arrowLeft.addEventListener('click', (event) => { event.stopPropagation(); step(-END(), 'tap'); });

  function apply(next) {
    content = next;
    if (C && next.kiosk) C.ingest(next.kiosk);
    S.configure(timing());
    if (S.state === 'ATTRACT') { render(); runSlides(); } else renderPending = true;
    window.dispatchEvent(new Event('kiosk:content')); // the header's closing time reads the hours
  }

  // ---- content: cache, fetch -----------------------------------------------------------------------------------
  let cfg = {};
  try { cfg = JSON.parse((window.SarcafeKiosk && window.SarcafeKiosk.config()) || '{}') || {}; } catch (_) { cfg = {}; }
  const baseContentUrl = typeof cfg.api === 'string' && /\/menu(\?.*)?$/.test(cfg.api) ? cfg.api.replace(/\/menu(\?.*)?$/, '/content') : '';
  // this tablet's name travels in the address (KioskConfig.device); a tablet that was never given one asks the way it always did
  const contentUrl = (since) => {
    if (!baseContentUrl) return '';
    const parts = [];
    if (C && C.device) parts.push(`device=${encodeURIComponent(C.device)}`);
    if (since) parts.push(`since=${encodeURIComponent(since)}`);
    return baseContentUrl + (parts.length ? `?${parts.join('&')}` : '');
  };

  try {
    const cached = cleanContent(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'));
    if (cached) content = cached;
  } catch (_) { /* no usable cache: the built-in announcements stay */ }

  let lastFetch = 0;
  let fetching = false;
  let pingPending = false;
  let refreshTimer;
  const refreshMs = () => cget('timing.contentRefreshMinutes', 15) * 60 * 1000;

  async function fetchContent(force) {
    if (!baseContentUrl || fetching || (S.state !== 'ATTRACT' && !force)) return;
    fetching = true;
    lastFetch = Date.now();
    pingPending = false;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);
    try {
      const since = content.version && content.version !== 'builtin' ? content.version : '';
      const res = await fetch(contentUrl(since), { cache: 'no-store', signal: abort.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.unchanged === true) return;
      const next = cleanContent(data);
      if (!next) return;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch (_) { /* full: show it anyway */ }
      apply(next);
    } catch (_) {
      // offline or a bad answer: keep what is on screen (cached or built-in)
    } finally {
      clearTimeout(timer);
      fetching = false;
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!baseContentUrl || S.state !== 'ATTRACT') return;
    refreshTimer = setTimeout(() => { fetchContent(); scheduleRefresh(); }, Math.max(0, lastFetch + refreshMs() - Date.now()));
  }

  window.addEventListener('kiosk:menu-ping', () => {
    if (S.state !== 'ATTRACT') { pingPending = true; return; }
    if (Date.now() - lastFetch >= PING_GAP_MS) fetchContent();
  });
  // the report in kiosk-device.js saw that the portal's settings for this tablet are newer than ours
  window.addEventListener('kiosk:settings-stale', () => { if (Date.now() - lastFetch >= 1000) fetchContent(true); });

  // ---- taps on the welcome screen ------------------------------------------------------------------------------
  const go = (name) => document.querySelector(`.screen-picker [data-screen="${name}"]`)?.click();
  panel.addEventListener('click', (event) => {
    if (S.state !== 'ATTRACT') return;
    if (Date.now() < suppressClickUntil) return;                  // the end of a drag
    if (event.target.closest('button[data-screen]')) return;      // the two buttons: app.js opens them (body has data-screen too)
    if (event.target.closest('.attract-arrow')) return;           // the arrows are not a tap on the screen
    if (event.target.closest('.lang-switch')) return;
    const ad = event.target.closest('.attract-ad');
    let action = ad && ad.dataset.action;
    if (cget('ads.tapAction', 'ad') === 'main') action = 'none'; // always the main screen
    if (action === 'join' && !cget('display.clubEnabled', true)) action = 'none';
    stopSlides();
    go(action === 'join' ? 'join' : action === 'menu' ? 'menu' : 'choice');
  });

  // ---- follow the session --------------------------------------------------------------------------------------
  function onState(next) {
    if (next === 'ATTRACT') {
      if (renderPending) render();
      runSlides();
      if (pingPending || Date.now() - lastFetch >= refreshMs()) fetchContent();
      scheduleRefresh();
    } else {
      stopSlides();
      abortMove();
      clearTimeout(refreshTimer);
    }
  }
  S.onChange(onState);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopSlides(); else runSlides(); });

  // another language: the two buttons at once, the slides now if the welcome screen shows, else when it shows next
  if (I) I.onChange(() => {
    actions.querySelector('.attract-menu span').textContent = tr('btnMenu', 'לתפריט שלנו');
    actions.querySelector('.attract-join span').textContent = tr('btnJoin', 'הצטרפו למועדון');
    labelAds();
    if (S.state === 'ATTRACT') { render(); runSlides(); } else renderPending = true;
  });

  // a setting changed (the control panel, or the portal's answer): what it touches is redone at once
  if (C) {
    let lastLook = JSON.stringify([cget('ads.hiddenIds', []), cget('display.clubEnabled', true)]);
    C.onChange(() => {
      S.configure(timing());
      const now = JSON.stringify([cget('ads.hiddenIds', []), cget('display.clubEnabled', true)]);
      if (now !== lastLook) {
        lastLook = now;
        if (S.state === 'ATTRACT') { render(); runSlides(); } else renderPending = true;
      } else if (S.state === 'ATTRACT' && !busy) {
        paintControls();
        runSlides();
      }
    });
  }

  S.configure(timing());
  render();
  onState(S.state);
  const publicAds = () => content.ads.map((ad) => ({ id: ad.id, kind: ad.kind, title: ad.title }));
  window.__kioskAttract = {
    get version() { return content.version; },
    get slides() { return slides.length; },
    get index() { return index; },
    step,
    fetchContent,
  };
  // for the other layers: the header's closing time uses the branch's hours, the control panel lists the announcements
  window.KioskContent = { get hours() { return content.hours; }, get version() { return content.version; }, get ads() { return publicAds(); } };
})();
