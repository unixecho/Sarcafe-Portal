"use strict";

// Main language is Hebrew. English and Arabic are supported.
// Edit branch links here when the final URLs are ready.
// Maps tip: use Google Maps, Waze, or Apple Maps links.

const PAYBOX_PHONE_NUMBER = "0507437395";

const branchConfig = {
  givatHaviva: {
    name: {
      he: "גבעת חביבה",
      en: "Givat Haviva Branch",
      ar: "فرع جفعات حبيبة",
    },

    navigation: {
      googleMaps:
        "https://www.google.com/search?client=tablet-android-samsung-ss&hs=8gMV&sca_esv=4a0395b1eb6eb655&sxsrf=ANbL-n7xzN2UPQ0yQNTy1S8MNHPHpXWQ8Q:1780816439201&si=AL3DRZEsmMGCryMMFSHJ3StBhOdZ2-6yYkXd_doETEE1OR-qOeNC0svfKpdfz7r2d5Gv3xxio0TeM0ffKucL3b3hpR3CtxfCsNPVU51Loi5DrhiQ6D6yfcBC-HEmQfDo-_mo069DNVTiO2sDni4zdMhdtIrbmroIOg%3D%3D&q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%92%D7%91%D7%A2%D7%AA+%D7%97%D7%91%D7%99%D7%91%D7%94+Reviews&sa=X&ved=2ahUKEwjq8ZKayvSUAxX0UkEAHfCmA5YQ0bkNegQIIRAF&biw=1691&bih=878&dpr=1.75#lrd=",
      waze:
        "https://www.waze.com/live-map/directions?to=ll.32.458484%2C35.021689",
      appleMaps: "https://maps.apple/p/eB5XbpUbv.RmXQ",
    },

    menu: "https://sarcafe.s.gy/GivaatHavivaMenu",
    instagram: "https://www.instagram.com/sarcafe_givat.haviva/",
    review:
      "https://www.google.com/search?client=tablet-android-samsung-ss&hs=8gMV&sca_esv=4a0395b1eb6eb655&sxsrf=ANbL-n7xzN2UPQ0yQNTy1S8MNHPHpXWQ8Q:1780816439201&si=AL3DRZEsmMGCryMMFSHJ3StBhOdZ2-6yYkXd_doETEE1OR-qOeNC0svfKpdfz7r2d5Gv3xxio0TeM0ffKucL3b3hpR3CtxfCsNPVU51Loi5DrhiQ6D6yfcBC-HEmQfDo-_mo069DNVTiO2sDni4zdMhdtIrbmroIOg%3D%3D&q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%92%D7%91%D7%A2%D7%AA+%D7%97%D7%91%D7%99%D7%91%D7%94+Reviews&sa=X&ved=2ahUKEwjq8ZKayvSUAxX0UkEAHfCmA5YQ0bkNegQIIRAF&biw=1691&bih=878&dpr=1.75#lrd=0x151d0ff513e8629d:0xa96e0271dcb22bc9,3,,,,",

    bit:
      "https://www.bitpay.co.il/app/me/E651C59A-1BFE-BEC5-4393-DC2A3AB120825472",
    paybox: "#",
  },

  maor: {
    name: {
      he: "מאור",
      en: "Maor Settlement Branch",
      ar: "فرع ماعور",
    },

    navigation: {
      googleMaps:
        "https://www.google.com/search?q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%9E%D7%90%D7%95%D7%A8+&client=tablet-android-samsung-ss&hs=VMh&sca_esv=4a0395b1eb6eb655&biw=1691&bih=878&sxsrf=ANbL-n5lYaGJbz0mYll-zEZQxSHKIta6Zw%3A1780816448953&ei=QBolapDtOaeZhbIP5bXgsQg&ved=0ahUKEwiQjeaeyvSUAxWnTEEAHeUaOIYQ4dUDCBA&uact=5&oq=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%9E%D7%90%D7%95%D7%A8+&gs_lp=Egxnd3Mtd2l6LXNlcnAiFNep16jXp9ek15Qg157XkNeV16ggMggQABiABBjLATIOEC4YgAQYywEYxwEYrwEyBhAAGBYYHjIGEAAYFhgeMgYQABgWGB4yCBAAGIAEGKIEMggQABiJBRiiBDIIEAAYgAQYogQyBRAAGO8FMgUQABjvBUi0hQFQ-AtYuExwBXgBkAEAmAHiAaAB-BqqAQYwLjIwLjG4AQPIAQD4AQGYAhegAo51wgIKEAAYRxjWBBiwA8ICCBAAGBYYHhgKwgIEECMYJ8ICChAAGIAEGMsBGArCAg4QLhivARjHARjLARiABMICBBAAGB7CAg0QLhgTGK8BGMcBGIAEwgIHEAAYgAQYE8ICCBAAGBYYHhgTwgIcEC4YExivARjHARiABBiXBRjcBBjeBBjgBNgBAcICHRAuGK8BGMcBGMsBGIAEGJcFGNwEGN4EGOAE2AEBwgIdEC4YgAQYywEYxwEYrwEYlwUY3AQY3gQY4ATYAQGYAwDiAwUSATEgQIgGAZAGCLoGBggBEAEYFJIHCjUuMTQuMi45LTKgB6KWAbIHBjAuMTQuMrgHkRbCBwgwLjEuNy4xNcgHygGACAE&sclient=gws-wiz-serp",
      waze: "https://waze.com/ul/hsvbbkw6z7",
      appleMaps: "https://maps.apple/p/qpTdR-CW92-k85",
    },

    menu: "https://sarcafe.s.gy/MaorMenu",
    instagram: "https://www.instagram.com/sarcafe_maor/",
    review:
      "https://www.google.com/search?client=tablet-android-samsung-ss&hs=YhMV&sca_esv=4a0395b1eb6eb655&sxsrf=ANbL-n7WBcEx4otrLxlW5mdY5Hc3IS-9GA:1780817990838&si=AL3DRZEsmMGCryMMFSHJ3StBhOdZ2-6yYkXd_doETEE1OR-qORq9ZRxUEGQjlwXHLY-hWlLKbVyKvZCKqbFZD0CiApiXy7ngKHZS3tp6qD365pwpMFnIZXyTH2i7VYL4-FsrQZ1ILbXFKYuAwJBe9odLsvctXY6pLg%3D%3D&q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%9E%D7%90%D7%95%D7%A8+Reviews&sa=X&ved=2ahUKEwjJpYP-z_SUAxWc1wIHHQ4QJBQQ0bkNegQIJRAF&biw=1691&bih=878&dpr=1.75#lrd=0x151d11a50c80e89b:0x96d561f512db6ca9,3,,,,",

    bit:
      "https://www.bitpay.co.il/app/me/E651C59A-1BFE-BEC5-4393-DC2A3AB120825472",
    paybox: "#",
  },
};

const translations = {
  he: {
    htmlLang: "he",
    dir: "rtl",
    title: "Sarcafe | פורטל קפה",
    description:
      "פורטל מהיר של Sarcafe: בחירת סניף, ניווט, תפריט, אינסטגרם והשארת ביקורת.",

    languageButton: "בחירת שפה",
    languageMenuAria: "בחירת שפה",

    eyebrow: "פורטל קפה",
    welcomeTitle: "ברוכים הבאים ל־Sarcafe",
    chooseBranch: "בחרו סניף כדי להמשיך.",
    chooseBranchAria: "בחירת סניף של Sarcafe",
    branchLabel: "סניף",

    changeBranch: "← החלפת סניף",
    changeBranchAria: "חזרה לבחירת סניף",
    selectedBranch: "הסניף שנבחר",
    quickLinks: "קישורים מהירים למיקום הזה.",
    branchActionsAria: "פעולות לסניף",

    actions: {
      navigation: "ניווט אלינו",
      menu: "תפריט דיגיטלי",
      instagram: "אינסטגרם",
      review: "השארת ביקורת",
      payment: "תשלום",
    },

    navigationOptions: {
      googleMaps: "Google Maps",
      waze: "Waze",
      appleMaps: "Apple Maps",
    },

    paymentOptions: {
      bit: "Bit",
      paybox: "PayBox",
    },

    paused: "ידני",
    unavailable: "לא זמין",
    missingLink: "הקישור עדיין לא הוגדר",
    navigationExpanded: "אפשרויות ניווט נפתחו",
    navigationCollapsed: "אפשרויות ניווט נסגרו",
    paymentExpanded: "אפשרויות תשלום נפתחו",
    paymentCollapsed: "אפשרויות תשלום נסגרו",
    paymentUnavailable: "PayBox לא זמין לתשלום אוטומטי כרגע",
    payboxManual: `נא להזין ידנית ב־PayBox: ${PAYBOX_PHONE_NUMBER}`,
  },

  en: {
    htmlLang: "en",
    dir: "ltr",
    title: "Sarcafe | Coffee Portal",
    description:
      "Sarcafe quick portal: choose a branch, navigate, view menu, Instagram, and leave a review.",

    languageButton: "Choose language",
    languageMenuAria: "Choose language",

    eyebrow: "Coffee truck portal",
    welcomeTitle: "Welcome to Sarcafe",
    chooseBranch: "Choose your branch to continue.",
    chooseBranchAria: "Choose a Sarcafe branch",
    branchLabel: "Branch",

    changeBranch: "← Change branch",
    changeBranchAria: "Go back to branch selection",
    selectedBranch: "Selected branch",
    quickLinks: "Quick links for this location.",
    branchActionsAria: "Branch actions",

    actions: {
      navigation: "Navigate to Us",
      menu: "Digital Menu",
      instagram: "Instagram",
      review: "Leave a Review",
      payment: "Payment",
    },

    navigationOptions: {
      googleMaps: "Google Maps",
      waze: "Waze",
      appleMaps: "Apple Maps",
    },

    paymentOptions: {
      bit: "Bit",
      paybox: "PayBox",
    },

    paused: "Manual",
    unavailable: "Unavailable",
    missingLink: "This link is not configured yet",
    navigationExpanded: "Navigation options expanded",
    navigationCollapsed: "Navigation options collapsed",
    paymentExpanded: "Payment options expanded",
    paymentCollapsed: "Payment options collapsed",
    paymentUnavailable: "PayBox automatic payment is currently unavailable",
    payboxManual: `Please insert this number manually in PayBox: ${PAYBOX_PHONE_NUMBER}`,
  },

  ar: {
    htmlLang: "ar",
    dir: "rtl",
    title: "Sarcafe | بوابة القهوة",
    description:
      "بوابة Sarcafe السريعة: اختيار الفرع، التنقل، القائمة، إنستغرام وترك تقييم.",

    languageButton: "اختيار اللغة",
    languageMenuAria: "اختيار اللغة",

    eyebrow: "بوابة عربة القهوة",
    welcomeTitle: "أهلاً بكم في Sarcafe",
    chooseBranch: "اختاروا الفرع للمتابعة.",
    chooseBranchAria: "اختيار فرع Sarcafe",
    branchLabel: "فرع",

    changeBranch: "← تغيير الفرع",
    changeBranchAria: "العودة إلى اختيار الفرع",
    selectedBranch: "الفرع المختار",
    quickLinks: "روابط سريعة لهذا الموقع.",
    branchActionsAria: "إجراءات الفرع",

    actions: {
      navigation: "التنقل إلينا",
      menu: "القائمة الرقمية",
      instagram: "إنستغرام",
      review: "ترك تقييم",
      payment: "الدفع",
    },

    navigationOptions: {
      googleMaps: "Google Maps",
      waze: "Waze",
      appleMaps: "Apple Maps",
    },

    paymentOptions: {
      bit: "Bit",
      paybox: "PayBox",
    },

    paused: "يدوي",
    unavailable: "غير متاح",
    missingLink: "لم يتم إعداد هذا الرابط بعد",
    navigationExpanded: "تم فتح خيارات التنقل",
    navigationCollapsed: "تم إغلاق خيارات التنقل",
    paymentExpanded: "تم فتح خيارات الدفع",
    paymentCollapsed: "تم إغلاق خيارات الدفع",
    paymentUnavailable: "الدفع التلقائي عبر PayBox غير متاح حالياً",
    payboxManual: `يرجى إدخال الرقم يدوياً في PayBox: ${PAYBOX_PHONE_NUMBER}`,
  },
};

const TRANSITION_MS = 280;
const LANG_MENU_MS = 220;
const EXPANDABLE_MS = 220;
const DEFAULT_LANGUAGE = "he";
const LANGUAGE_STORAGE_KEY = "sarcafe-language";

const branchPanel = document.querySelector("#branchPanel");
const actionsPanel = document.querySelector("#actionsPanel");
const actionList = document.querySelector("#actionList");
const actionsTitle = document.querySelector("#actionsTitle");
const backButton = document.querySelector("#backButton");
const branchButtons = document.querySelectorAll("[data-branch]");

const languageToggle = document.querySelector("#languageToggle");
const languageMenu = document.querySelector("#languageMenu");
const languageOptions = document.querySelectorAll("[data-lang]");
const metaDescription = document.querySelector('meta[name="description"]');

let currentBranchKey = null;
let currentLanguage = getInitialLanguage();
let languageCloseTimer = null;
let navigationOptionsOpen = false;
let paymentOptionsOpen = false;

const quickActions = [
  { key: "menu", icon: "📖" },
  { key: "instagram", icon: "📸" },
  { key: "review", icon: "⭐" },
];

const navigationOptions = [
  { key: "googleMaps", icon: "🗺️", primary: true },
  { key: "waze", icon: "🚗" },
  { key: "appleMaps", icon: "🍎" },
];

function isRealLink(url) {
  return typeof url === "string" && url.trim() !== "" && url.trim() !== "#";
}

function normalizeUrl(href) {
  if (!isRealLink(href)) return "#";

  const cleanHref = href.trim();

  if (
    cleanHref.startsWith("https://") ||
    cleanHref.startsWith("http://") ||
    cleanHref.startsWith("mailto:") ||
    cleanHref.startsWith("tel:") ||
    cleanHref.startsWith("waze://") ||
    cleanHref.startsWith("maps://")
  ) {
    return cleanHref;
  }

  if (cleanHref.startsWith("www.")) {
    return `https://${cleanHref}`;
  }

  return cleanHref;
}

function getInitialLanguage() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("lang");
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);

  if (translations[fromUrl]) return fromUrl;
  if (translations[stored]) return stored;

  return DEFAULT_LANGUAGE;
}

function t(key) {
  return translations[currentLanguage][key];
}

function getBranchName(branchKey) {
  return (
    branchConfig[branchKey]?.name?.[currentLanguage] ||
    branchConfig[branchKey]?.name?.he ||
    "Sarcafe"
  );
}

function openLanguageMenu() {
  if (!languageMenu || !languageToggle) return;

  window.clearTimeout(languageCloseTimer);

  languageToggle.setAttribute("aria-expanded", "true");
  languageToggle.classList.add("is-open");

  languageMenu.hidden = false;
  languageMenu.classList.remove("is-closing");
  languageMenu.classList.add("is-open");
}

function closeLanguageMenu() {
  if (!languageMenu || !languageToggle || languageMenu.hidden) return;

  window.clearTimeout(languageCloseTimer);

  languageToggle.setAttribute("aria-expanded", "false");
  languageToggle.classList.remove("is-open");

  languageMenu.classList.remove("is-open");
  languageMenu.classList.add("is-closing");

  languageCloseTimer = window.setTimeout(() => {
    languageMenu.hidden = true;
    languageMenu.classList.remove("is-closing");
  }, LANG_MENU_MS);
}

function toggleLanguageMenu() {
  if (!languageMenu || !languageToggle) return;

  const isOpen = languageToggle.getAttribute("aria-expanded") === "true";

  if (isOpen) {
    closeLanguageMenu();
  } else {
    openLanguageMenu();
  }
}

function applyLanguage(lang) {
  if (!translations[lang]) return;

  currentLanguage = lang;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);

  const copy = translations[currentLanguage];

  document.documentElement.lang = copy.htmlLang;
  document.documentElement.dir = copy.dir;
  document.title = copy.title;

  metaDescription?.setAttribute("content", copy.description);
  languageMenu?.setAttribute("aria-label", copy.languageMenuAria);

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;

    if (copy[key]) {
      element.textContent = copy[key];
    }
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    const key = element.dataset.i18nAriaLabel;

    if (copy[key]) {
      element.setAttribute("aria-label", copy[key]);
    }
  });

  document.querySelectorAll("[data-branch-name]").forEach((element) => {
    element.textContent = getBranchName(element.dataset.branchName);
  });

  languageOptions.forEach((option) => {
    const isSelected = option.dataset.lang === currentLanguage;

    option.classList.toggle("is-selected", isSelected);
    option.setAttribute("aria-pressed", String(isSelected));
  });

  if (currentBranchKey) {
    renderActions(currentBranchKey);
  }
}

function createExternalLink({
  label,
  icon,
  href,
  primary = false,
  ariaSuffix = "",
}) {
  const link = document.createElement("a");
  const normalizedHref = normalizeUrl(href);

  link.className = `action-button${primary ? " action-button--primary" : ""}`;
  link.href = normalizedHref;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  if (!isRealLink(href)) {
    link.addEventListener("click", (event) => event.preventDefault());
    link.setAttribute("aria-label", `${label}: ${t("missingLink")}`);
  } else if (ariaSuffix) {
    link.setAttribute("aria-label", `${label}: ${ariaSuffix}`);
  }

  link.innerHTML = `
    <span class="action-button__label">
      <span aria-hidden="true">${icon}</span>
      ${label}
    </span>
    <span class="action-button__arrow" aria-hidden="true">↗</span>
  `;

  return link;
}

function setExpandableState({
  wrapper,
  toggle,
  options,
  isOpen,
  expandedText,
  collapsedText,
}) {
  wrapper.classList.toggle("is-open", isOpen);
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.setAttribute("aria-label", isOpen ? collapsedText : expandedText);

  if (isOpen) {
    options.hidden = false;
    options.classList.remove("is-closing");
    options.classList.add("is-opening");
  } else {
    options.classList.remove("is-opening");
    options.classList.add("is-closing");

    window.setTimeout(() => {
      options.hidden = true;
      options.classList.remove("is-closing");
    }, EXPANDABLE_MS);
  }
}

function createNavigationArea(branch) {
  const wrapper = document.createElement("div");
  wrapper.className = `payment-area nav-area${
    navigationOptionsOpen ? " is-open" : ""
  }`;

  const navToggle = document.createElement("button");
  navToggle.className = "action-button payment-toggle action-button--primary";
  navToggle.type = "button";
  navToggle.setAttribute("aria-expanded", String(navigationOptionsOpen));
  navToggle.setAttribute("aria-controls", "navigationOptions");
  navToggle.setAttribute(
    "aria-label",
    navigationOptionsOpen ? t("navigationCollapsed") : t("navigationExpanded")
  );

  navToggle.innerHTML = `
    <span class="action-button__label">
      <span aria-hidden="true">🗺️</span>
      ${translations[currentLanguage].actions.navigation}
    </span>
    <span class="payment-chevron" aria-hidden="true">⌄</span>
  `;

  const navOptions = document.createElement("div");
  navOptions.className = "payment-options nav-options";
  navOptions.id = "navigationOptions";
  navOptions.hidden = !navigationOptionsOpen;

  const optionButtons = navigationOptions.map((option) =>
    createExternalLink({
      label: translations[currentLanguage].navigationOptions[option.key],
      icon: option.icon,
      href: branch.navigation?.[option.key],
      primary: option.primary,
    })
  );

  navOptions.append(...optionButtons);
  wrapper.append(navToggle, navOptions);

  navToggle.addEventListener("click", () => {
    navigationOptionsOpen = !navigationOptionsOpen;

    setExpandableState({
      wrapper,
      toggle: navToggle,
      options: navOptions,
      isOpen: navigationOptionsOpen,
      expandedText: t("navigationExpanded"),
      collapsedText: t("navigationCollapsed"),
    });
  });

  return wrapper;
}

function createActionLink(action, branch) {
  return createExternalLink({
    label: translations[currentLanguage].actions[action.key],
    icon: action.icon,
    href: branch[action.key],
    primary: false,
  });
}

function createPaymentArea(branch) {
  const wrapper = document.createElement("div");
  wrapper.className = `payment-area${paymentOptionsOpen ? " is-open" : ""}`;

  const paymentToggle = document.createElement("button");
  paymentToggle.className = "action-button payment-toggle";
  paymentToggle.type = "button";
  paymentToggle.setAttribute("aria-expanded", String(paymentOptionsOpen));
  paymentToggle.setAttribute("aria-controls", "paymentOptions");
  paymentToggle.setAttribute(
    "aria-label",
    paymentOptionsOpen ? t("paymentCollapsed") : t("paymentExpanded")
  );

  paymentToggle.innerHTML = `
    <span class="action-button__label">
      <span aria-hidden="true">💳</span>
      ${translations[currentLanguage].actions.payment}
    </span>
    <span class="payment-chevron" aria-hidden="true">⌄</span>
  `;

  const paymentOptions = document.createElement("div");
  paymentOptions.className = "payment-options";
  paymentOptions.id = "paymentOptions";
  paymentOptions.hidden = !paymentOptionsOpen;

  const bitLink = createExternalLink({
    label: translations[currentLanguage].paymentOptions.bit,
    icon: "⚡",
    href: branch.bit,
    primary: true,
  });

  const payboxManual = document.createElement("button");
  payboxManual.className =
    "action-button payment-option action-button--disabled";
  payboxManual.type = "button";
  payboxManual.setAttribute("aria-disabled", "true");
  payboxManual.setAttribute(
    "aria-label",
    `${t("paymentUnavailable")}. ${t("payboxManual")}`
  );

  payboxManual.addEventListener("click", (event) => event.preventDefault());

  payboxManual.innerHTML = `
    <span class="action-button__label action-button__label--stacked">
      <span>
        <span aria-hidden="true">📦</span>
        ${translations[currentLanguage].paymentOptions.paybox}
      </span>
      <small class="manual-note">${t("payboxManual")}</small>
    </span>
    <span class="status-tag">${t("paused")}</span>
  `;

  paymentOptions.append(bitLink, payboxManual);
  wrapper.append(paymentToggle, paymentOptions);

  paymentToggle.addEventListener("click", () => {
    paymentOptionsOpen = !paymentOptionsOpen;

    setExpandableState({
      wrapper,
      toggle: paymentToggle,
      options: paymentOptions,
      isOpen: paymentOptionsOpen,
      expandedText: t("paymentExpanded"),
      collapsedText: t("paymentCollapsed"),
    });
  });

  return wrapper;
}

function renderActions(branchKey) {
  const branch = branchConfig[branchKey];

  if (!branch || !actionList || !actionsTitle) return;

  currentBranchKey = branchKey;
  actionsTitle.textContent = getBranchName(branchKey);

  actionList.replaceChildren(
    createNavigationArea(branch),
    ...quickActions.map((action) => createActionLink(action, branch)),
    createPaymentArea(branch)
  );
}

function showPanel(panel) {
  if (!panel) return;

  panel.classList.remove("is-hidden");
  panel.classList.add("is-entering");

  window.requestAnimationFrame(() => {
    panel.classList.remove("is-entering");
  });
}

function hidePanel(panel, callback) {
  if (!panel) return;

  panel.classList.add("is-leaving");

  window.setTimeout(() => {
    panel.classList.add("is-hidden");
    panel.classList.remove("is-leaving");

    if (typeof callback === "function") {
      callback();
    }
  }, TRANSITION_MS);
}

function selectBranch(branchKey, skipTransition = false) {
  if (!branchConfig[branchKey]) return;

  navigationOptionsOpen = false;
  paymentOptionsOpen = false;
  renderActions(branchKey);

  if (skipTransition) {
    branchPanel?.classList.add("is-hidden");
    showPanel(actionsPanel);
    return;
  }

  hidePanel(branchPanel, () => showPanel(actionsPanel));
}

function showBranchSelection() {
  hidePanel(actionsPanel, () => {
    currentBranchKey = null;
    navigationOptionsOpen = false;
    paymentOptionsOpen = false;
    actionList?.replaceChildren();
    showPanel(branchPanel);

    const url = new URL(window.location.href);
    url.searchParams.delete("s");
    window.history.replaceState({}, "", url);
  });
}

function readBranchFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("s");

  return value && branchConfig[value] ? value : null;
}

branchButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const branchKey = button.dataset.branch;
    selectBranch(branchKey);
  });
});

backButton?.addEventListener("click", showBranchSelection);

languageToggle?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleLanguageMenu();
});

languageOptions.forEach((option) => {
  option.addEventListener("click", (event) => {
    event.stopPropagation();

    applyLanguage(option.dataset.lang);
    closeLanguageMenu();
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".language-switcher")) {
    closeLanguageMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLanguageMenu();
    languageToggle?.focus();
  }
});

if (languageMenu) {
  languageMenu.hidden = true;
  languageMenu.classList.remove("is-open", "is-closing");
}

if (languageToggle) {
  languageToggle.setAttribute("aria-expanded", "false");
  languageToggle.classList.remove("is-open");
}

applyLanguage(currentLanguage);

const directBranch = readBranchFromUrl();

if (directBranch) {
  selectBranch(directBranch, true);
}
