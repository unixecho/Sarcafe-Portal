"use strict";

// Menu content for the Sarcafe digital menus.
// Main language is Hebrew. English and Arabic are supported.
//
// Each category: { id, icon, title: { he, en, ar }, items: [...] }
// Each item: { he, en, ar, price, note?: { he, en, ar }, image?: "path/to/photo.jpg" }
//
// Images: real photos are not ready yet. Every item currently falls back to
// menu-item-placeholder.svg — to add a photo, drop the file in the repo and
// set the item's `image` field.

const MAOR_CATEGORIES = [
  {
    id: "food",
    icon: "🥪",
    title: { he: "אוכל", en: "Food", ar: "طعام" },
    items: [
      { he: "בורקס", en: "Bourekas", ar: "بوريكاس", price: 35 },
      { he: "טוסט", en: "Toast", ar: "توست", price: 35 },
      { he: "כריך גדול", en: "Large Sandwich", ar: "ساندويتش كبير", price: 35 },
      { he: "כריך קטן", en: "Small Sandwich", ar: "ساندويتش صغير", price: 28 },
      { he: "סלט גדול", en: "Large Salad", ar: "سلطة كبيرة", price: 45 },
      { he: "סלט קטן", en: "Small Salad", ar: "سلطة صغيرة", price: 35 },
      {
        he: "פיצה ללא גלוטן",
        en: "Gluten-Free Pizza",
        ar: "بيتزا خالية من الغلوتين",
        price: 35,
      },
    ],
  },

  {
    id: "popsicles",
    icon: "🍧",
    title: { he: "ארטיקים", en: "Ice Pops", ar: "مصاصات مثلجة" },
    items: [
      {
        he: "ארטיק פלטאס",
        en: "Paletas Ice Pop",
        ar: "مصاصة مثلجة باليتاس",
        price: 12,
      },
    ],
  },

  {
    id: "pastries",
    icon: "🥐",
    title: { he: "מאפים", en: "Pastries", ar: "معجنات" },
    items: [
      { he: "מאפה גדול", en: "Large Pastry", ar: "معجنة كبيرة", price: 15 },
      { he: "מאפה שווה", en: "Pastry Deal", ar: "معجنة بسعر مميز", price: 30 },
      {
        he: "ברעצל עם נוטלה",
        en: "Pretzel with Nutella",
        ar: "بريتزل مع نوتيلا",
        price: 20,
      },
      { he: "טארט תות", en: "Strawberry Tart", ar: "تارت فراولة", price: 32 },
      { he: "עוגת גבינה", en: "Cheesecake", ar: "كعكة الجبن", price: 25 },
    ],
  },

  {
    id: "cookies",
    icon: "🍪",
    title: { he: "עוגיות", en: "Cookies", ar: "كوكيز" },
    items: [
      { he: "אלפחורס", en: "Alfajores", ar: "ألفاخوريس", price: 12 },
      {
        he: "בלונדיס / בראוניס",
        en: "Blondies / Brownies",
        ar: "بلونديز / براونيز",
        price: 15,
      },
      {
        he: "כדור שוקולד / קוקוס / סוכריות / תמר",
        en: "Chocolate / Coconut / Sprinkles / Date Ball",
        ar: "كرة شوكولاتة / جوز هند / حلوى / تمر",
        price: 6,
      },
      { he: "עוגייה בלגית", en: "Belgian Cookie", ar: "كوكيز بلجيكي", price: 15 },
      {
        he: "עוגיית שוקולד צ'יפס",
        en: "Chocolate Chip Cookie",
        ar: "كوكيز برقائق الشوكولاتة",
        price: 12,
      },
      {
        he: "שוקולד בלגי",
        en: "Belgian Chocolate",
        ar: "شوكولاتة بلجيكية",
        price: 12,
      },
      {
        he: "שלושה שוקולדים",
        en: "Triple Chocolate",
        ar: "ثلاثي الشوكولاتة",
        price: 12,
      },
      { he: "סטרופוואפל", en: "Stroopwafel", ar: "ستروب وافل", price: 15 },
    ],
  },

  {
    id: "hotDrinks",
    icon: "☕",
    title: { he: "שתייה חמה", en: "Hot Drinks", ar: "مشروبات ساخنة" },
    items: [
      { he: "אמריקנו גדול", en: "Large Americano", ar: "أمريكانو كبير", price: 11 },
      { he: "אמריקנו קטן", en: "Small Americano", ar: "أمريكانو صغير", price: 8 },
      { he: "אספרסו כפול", en: "Double Espresso", ar: "إسبريسو مزدوج", price: 11 },
      {
        he: "אספרסו קצר / ארוך",
        en: "Espresso Short / Long",
        ar: "إسبريسو قصير / طويل",
        price: 8,
      },
      { he: "הפוך גדול", en: "Large Latte (Hafuch)", ar: "لاتيه كبير", price: 15 },
      { he: "הפוך קטן", en: "Small Latte (Hafuch)", ar: "لاتيه صغير", price: 13 },
      { he: "חליטה", en: "Herbal Infusion", ar: "شاي أعشاب", price: 15 },
      { he: "מאצ'ה", en: "Matcha", ar: "ماتشا", price: 22 },
      { he: "מקיאטו", en: "Macchiato", ar: "ماكياتو", price: 8 },
      {
        he: "נס קפה גדול",
        en: "Large Instant Coffee",
        ar: "نسكافيه كبير",
        price: 12,
      },
      {
        he: "נס קפה קטן",
        en: "Small Instant Coffee",
        ar: "نسكافيه صغير",
        price: 10,
      },
      {
        he: "סחלב",
        en: "Sahlab",
        ar: "سحلب",
        price: 18,
        note: {
          he: "בחורף בלבד",
          en: "Winter only",
          ar: "في الشتاء فقط",
        },
      },
      { he: "קורטדו", en: "Cortado", ar: "كورتادو", price: 8 },
      { he: "קפה שחור", en: "Black Coffee", ar: "قهوة سوداء", price: 8 },
      { he: "שוקו גדול", en: "Large Hot Chocolate", ar: "شوكو كبير", price: 14 },
      { he: "שוקו קטן", en: "Small Hot Chocolate", ar: "شوكو صغير", price: 12 },
      {
        he: "שוקו מפנק גדול",
        en: "Large Deluxe Hot Chocolate",
        ar: "شوكو فاخر كبير",
        price: 17,
      },
      {
        he: "שוקו מפנק קטן",
        en: "Small Deluxe Hot Chocolate",
        ar: "شوكو فاخر صغير",
        price: 15,
      },
      {
        he: "תוספת חלב טבעוני",
        en: "Vegan Milk Add-On",
        ar: "إضافة حليب نباتي",
        price: 2,
      },
    ],
  },

  {
    id: "coldDrinks",
    icon: "🧊",
    title: { he: "שתייה קרה", en: "Cold Drinks", ar: "مشروبات باردة" },
    items: [
      { he: "אייס קטן", en: "Small Ice Slush", ar: "آيس صغير", price: 8 },
      { he: "אייס גדול", en: "Large Ice Slush", ar: "آيس كبير", price: 16 },
      { he: "מים / סודה", en: "Water / Soda", ar: "مياه / صودا", price: 8 },
      { he: "מיץ טבעי", en: "Fresh Juice", ar: "عصير طبيعي", price: 16 },
      { he: "פחית", en: "Soft Drink Can", ar: "علبة مشروب", price: 10 },
      { he: "פחית גדולה", en: "Large Can", ar: "علبة كبيرة", price: 12 },
      { he: "פיוז טי", en: "Fuze Tea", ar: "فيوز تي", price: 12 },
      { he: "קפה קר", en: "Cold Coffee", ar: "قهوة باردة", price: 16 },
      { he: "שוקו קר", en: "Cold Chocolate Milk", ar: "شوكو بارد", price: 16 },
      { he: "שייק", en: "Shake", ar: "شيك", price: 25 },
      {
        he: "תוספת חלב טבעוני",
        en: "Vegan Milk Add-On",
        ar: "إضافة حليب نباتي",
        price: 2,
      },
    ],
  },
];

const MENUS = {
  maor: {
    name: {
      he: "מאור",
      en: "Maor",
      ar: "ماعور",
    },
    categories: MAOR_CATEGORIES,
  },

  // Placeholder: the Giv'at Haviva menu uses the Maor list until the
  // branch's own menu is provided. Replace `categories` with its own
  // array when it arrives.
  givatHaviva: {
    name: {
      he: "גבעת חביבה",
      en: "Givat Haviva",
      ar: "جفعات حبيبة",
    },
    categories: MAOR_CATEGORIES,
  },
};
