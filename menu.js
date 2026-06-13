"use strict";

// Digital menu page logic. Display only — there is no ordering.
// The branch is read from <body data-branch="...">, content from menu-data.js.
// Shares the language storage key with the portal so the choice carries over.

const LANG_MENU_MS = 220;
const DEFAULT_LANGUAGE = "he";
const LANGUAGE_STORAGE_KEY = "sarcafe-language";
const PLACEHOLDER_IMAGE = "menu-item-placeholder.svg";

const menuTranslations = {
  he: {
    htmlLang: "he",
    dir: "rtl",
    titleSuffix: "תפריט דיגיטלי",
    description: "התפריט הדיגיטלי של Sarcafe: קטגוריות, פריטים ומחירים.",

    languageButton: "בחירת שפה",
    languageMenuAria: "בחירת שפה",

    eyebrow: "תפריט דיגיטלי",
    viewOnly: "התפריט לתצוגה בלבד — מזמינים ומשלמים בדוכן.",
    categoriesAria: "קטגוריות בתפריט",
    backToPortal: "→ לפורטל",
    backToPortalAria: "חזרה לפורטל Sarcafe",
    footerNote: "המחירים בשקלים חדשים וכוללים מע\"מ.",
    shekel: "₪",
  },

  en: {
    htmlLang: "en",
    dir: "ltr",
    titleSuffix: "Digital Menu",
    description: "Sarcafe digital menu: categories, items, and prices.",

    languageButton: "Choose language",
    languageMenuAria: "Choose language",

    eyebrow: "Digital menu",
    viewOnly: "This menu is for display only — order and pay at the truck.",
    categoriesAria: "Menu categories",
    backToPortal: "← Back to portal",
    backToPortalAria: "Back to the Sarcafe portal",
    footerNote: "Prices are in NIS and include VAT.",
    shekel: "₪",
  },

  ar: {
    htmlLang: "ar",
    dir: "rtl",
    titleSuffix: "القائمة الرقمية",
    description: "قائمة Sarcafe الرقمية: الفئات، الأصناف والأسعار.",

    languageButton: "اختيار اللغة",
    languageMenuAria: "اختيار اللغة",

    eyebrow: "القائمة الرقمية",
    viewOnly: "القائمة للعرض فقط — الطلب والدفع عند العربة.",
    categoriesAria: "فئات القائمة",
    backToPortal: "→ إلى البوابة",
    backToPortalAria: "العودة إلى بوابة Sarcafe",
    footerNote: "الأسعار بالشيكل الجديد وتشمل ضريبة القيمة المضافة.",
    shekel: "₪",
  },
};

const branchKey = document.body.dataset.branch;
const branchMenu = MENUS[branchKey];

const menuTitle = document.querySelector("#menuTitle");
const categoryNav = document.querySelector("#categoryNav");
const menuSections = document.querySelector("#menuSections");
const portalLink = document.querySelector("#portalLink");
const metaDescription = document.querySelector('meta[name="description"]');

const languageToggle = document.querySelector("#languageToggle");
const languageMenu = document.querySelector("#languageMenu");
const languageOptions = document.querySelectorAll("[data-lang]");

let currentLanguage = getInitialLanguage();
let languageCloseTimer = null;

function getInitialLanguage() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("lang");
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);

  if (menuTranslations[fromUrl]) return fromUrl;
  if (menuTranslations[stored]) return stored;

  return DEFAULT_LANGUAGE;
}

function t(key) {
  return menuTranslations[currentLanguage][key];
}

function localized(field) {
  return field?.[currentLanguage] || field?.he || "";
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

function createMenuItem(item) {
  const row = document.createElement("li");
  row.className = "menu-item";

  const thumb = document.createElement("img");
  thumb.className = "menu-item__thumb";
  thumb.src = item.image || PLACEHOLDER_IMAGE;
  thumb.alt = "";
  thumb.loading = "lazy";

  const info = document.createElement("div");
  info.className = "menu-item__info";

  const name = document.createElement("p");
  name.className = "menu-item__name";
  name.textContent = localized(item);
  info.append(name);

  if (item.note) {
    const note = document.createElement("p");
    note.className = "menu-item__note";
    note.textContent = localized(item.note);
    info.append(note);
  }

  const price = document.createElement("span");
  price.className = "menu-item__price";
  price.textContent = `${item.price} ${t("shekel")}`;

  row.append(thumb, info, price);

  return row;
}

function createCategorySection(category) {
  const section = document.createElement("section");
  section.className = "menu-category";
  section.id = `category-${category.id}`;

  const heading = document.createElement("h2");
  heading.className = "menu-category__title";
  heading.innerHTML = `
    <span class="menu-category__icon" aria-hidden="true">${category.icon}</span>
  `;
  heading.append(localized(category.title));

  const list = document.createElement("ul");
  list.className = "menu-item-list";
  list.append(...category.items.map(createMenuItem));

  section.append(heading, list);

  return section;
}

function createCategoryChip(category) {
  const chip = document.createElement("button");
  chip.className = "category-chip";
  chip.type = "button";

  chip.innerHTML = `<span aria-hidden="true">${category.icon}</span>`;
  chip.append(localized(category.title));

  chip.addEventListener("click", () => {
    document
      .querySelector(`#category-${category.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  return chip;
}

function renderMenu() {
  if (!branchMenu || !menuSections || !categoryNav) return;

  menuSections.replaceChildren(
    ...branchMenu.categories.map(createCategorySection)
  );

  categoryNav.replaceChildren(
    ...branchMenu.categories.map(createCategoryChip)
  );
}

function applyLanguage(lang) {
  if (!menuTranslations[lang]) return;

  currentLanguage = lang;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);

  const copy = menuTranslations[currentLanguage];
  const branchName = localized(branchMenu?.name) || "Sarcafe";

  document.documentElement.lang = copy.htmlLang;
  document.documentElement.dir = copy.dir;
  document.title = `Sarcafe ${branchName} | ${copy.titleSuffix}`;

  metaDescription?.setAttribute("content", copy.description);
  languageMenu?.setAttribute("aria-label", copy.languageMenuAria);

  if (menuTitle) {
    menuTitle.textContent = branchName;
  }

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

  languageOptions.forEach((option) => {
    const isSelected = option.dataset.lang === currentLanguage;

    option.classList.toggle("is-selected", isSelected);
    option.setAttribute("aria-pressed", String(isSelected));
  });

  renderMenu();
}

if (portalLink && branchKey) {
  portalLink.href = `index.html?s=${branchKey}`;
}

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
