"use strict";
/*
 * DEMO-ONLY fake backend for the gift card pages.
 * Uses sessionStorage purely so separate real pages (gift-request.html,
 * portal.html, customer.html, staff-checkout.html) can share state while
 * you click through the demo in one browser tab.
 *
 * IMPORTANT: this file gets deleted when we wire the real feature.
 * It will be replaced by a real `giftcards-store.js` that talks to Supabase
 * (same function names below), the same way menu-store.js backs manager.js.
 * Keeping the API shape identical means the pages below barely change.
 */
const GC = (function () {
  const KEY = "sarcafe_giftcards_demo_v1";
  const STAFF_KEY = "sarcafe_demo_staff_session";

  const MENUS = {
    maor: { label: "מאור", categories: [
      { id:"food", icon:"🥪", title:"אוכל", items:[
        {n:"בורקס",p:35},{n:"טוסט",p:35},{n:"כריך גדול",p:35},{n:"כריך קטן",p:28},
        {n:"סלט גדול",p:45},{n:"סלט קטן",p:35},{n:"פיצה ללא גלוטן",p:35}]},
      { id:"popsicles", icon:"🍧", title:"ארטיקים", items:[{n:"ארטיק פלטאס",p:12}]},
      { id:"pastries", icon:"🥐", title:"מאפים", items:[
        {n:"מאפה גדול",p:15},{n:"מאפה שווה",p:30},{n:"פרעצל עם נוטלה",p:20},
        {n:"טארט תות",p:32},{n:"עוגת גבינה",p:25}]},
      { id:"cookies", icon:"🍪", title:"עוגיות", items:[
        {n:"אלפחורס",p:12},{n:"בלונדיס / בראוניס",p:15},{n:"כדור שוקולד/קוקוס",p:6},
        {n:"עוגייה בלגית",p:15},{n:"עוגיית שוקולד צ'יפס",p:12},{n:"שוקולד בלגי",p:12},{n:"שלושה שוקולדים",p:12}]},
      { id:"hotDrinks", icon:"☕", title:"שתייה חמה", items:[
        {n:"אמריקנו גדול",p:11},{n:"אמריקנו קטן",p:8},{n:"אספרסו כפול",p:11},{n:"אספרסו קצר/ארוך",p:8},
        {n:"הפוך גדול",p:15},{n:"הפוך קטן",p:13},{n:"חליטה",p:15},{n:"מאצ'ה",p:22},{n:"מקיאטו",p:8},
        {n:"נס קפה גדול",p:12},{n:"נס קפה קטן",p:10},{n:"סחלב",p:18},{n:"קורטדו",p:8},{n:"קפה שחור",p:8},
        {n:"שוקו גדול",p:14},{n:"שוקו קטן",p:12},{n:"שוקו מפנק גדול",p:17},{n:"שוקו מפנק קטן",p:15}]},
      { id:"coldDrinks", icon:"🧊", title:"שתייה קרה", items:[
        {n:"אייס קטן",p:8},{n:"אייס גדול",p:16},{n:"מים/סודה",p:8},{n:"מיץ טבעי",p:16},
        {n:"פחית",p:10},{n:"פחית גדולה",p:12},{n:"פיוז טי",p:12},{n:"קפה קר",p:16},{n:"שוקו קר",p:16},{n:"שייק",p:25}]}
    ]},
    givatHaviva: { label: "גבעת חביבה", categories: [
      { id:"hotCoffee", icon:"☕", title:"קפה חם", items:[
        {n:"מנת אספרסו",p:8},{n:"אספרסו כפול",p:11},{n:"הפוך קטן",p:13},{n:"הפוך גדול",p:15},
        {n:"אמריקנו קטן",p:13},{n:"אמריקנו גדול",p:15},{n:"קפה שחור",p:8},{n:"חליטת צמחים מיוחדת",p:15}]},
      { id:"coldBeverages", icon:"🧊", title:"שתייה קרה", items:[
        {n:"קפה קר",p:16},{n:"אייס קפה",p:16},{n:"אייס וניל",p:16},{n:"אייס שוקולד",p:16},
        {n:"אמריקנו קר",p:13},{n:"תה קר",p:15}]},
      { id:"sandwiches", icon:"🥪", title:"כריכים וטוסטים", items:[{n:"כריכים",p:24},{n:"טוסטים",p:32}]},
      { id:"pastries", icon:"🥐", title:"מאפים", items:[{n:"מאפה רגיל",p:15},{n:"מאפה שווה",p:30},{n:"פרעצל/בייגלה",p:15}]},
      { id:"pizza", icon:"🍕", title:"פיצה", items:[{n:"פיצה אישית",p:30},{n:"פיצה גדולה",p:45}]},
      { id:"softDrinks", icon:"🥤", title:"שתייה קלה", items:[
        {n:"פחית שתייה",p:10},{n:"פיוז טי",p:12},{n:"מיץ תפוזים פריגת",p:12},{n:"סודה",p:8},{n:"מים",p:8}]},
      { id:"iceCream", icon:"🍦", title:"גלידות", items:[
        {n:"ארטיק קרח",p:5},{n:"לה פרוטה",p:10},{n:"גומיגם",p:10},{n:"קראנץ' נוגט נסטלה",p:14},
        {n:"מילקה",p:14},{n:"קורנטו",p:15},{n:"גלידת אוראו",p:14}]}
    ]}
  };

  function load() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt/missing state */ }
    const seeded = {
      seq: 1000,
      cards: [
        { id:"SC-1000", first:"נועה", last:"לוי", phone:"050-1112233",
          email:"noa.levi@example.com", recipientEmail:null,
          balance:200, status:"active", createdAt:Date.now(), transactions:[] }
      ]
    };
    save(seeded);
    return seeded;
  }
  function save(state) { sessionStorage.setItem(KEY, JSON.stringify(state)); }

  function money(n) { return Number(n).toLocaleString("he-IL") + " ₪"; }
  function qrUrl(cardId) {
    const target = "https://sarcafe.app/c/" + cardId;
    return "https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=8&data=" + encodeURIComponent(target);
  }

  function createRequest(data) {
    const state = load();
    state.seq += 1;
    const card = {
      id: "SC-" + state.seq,
      first: data.first, last: data.last, phone: data.phone, email: data.email,
      recipientEmail: data.recipientEmail || null,
      balance: data.amount,
      status: "pending",
      createdAt: Date.now(),
      transactions: []
    };
    state.cards.push(card);
    save(state);
    return card;
  }
  function getCard(id) {
    return load().cards.find((c) => c.id === id) || null;
  }
  function listPending() { return load().cards.filter((c) => c.status === "pending"); }
  function listActive() { return load().cards.filter((c) => c.status === "active"); }
  function approve(id) {
    const state = load();
    const c = state.cards.find((x) => x.id === id);
    if (c) { c.status = "active"; save(state); }
    return c;
  }
  function deny(id) {
    const state = load();
    const c = state.cards.find((x) => x.id === id);
    if (c) { c.status = "denied"; save(state); }
    return c;
  }
  function charge(id, branch, items) {
    const state = load();
    const c = state.cards.find((x) => x.id === id);
    if (!c) return { ok:false, error:"כרטיס לא נמצא" };
    const total = items.reduce((s, i) => s + i.p, 0);
    if (total > c.balance) return { ok:false, error:"היתרה לא מספיקה" };
    c.balance -= total;
    c.transactions.push({
      branch, amount: total,
      itemsText: items.map((i) => i.n).join(", "),
      at: Date.now()
    });
    save(state);
    return { ok:true, card:c };
  }

  // demo-only stand-in for "is this browser a logged-in staff session?"
  // in production this is a real Supabase Auth session check, same as manager.js's boot().
  function isStaffSession() { return sessionStorage.getItem(STAFF_KEY) === "1"; }
  function setStaffSession(on) { sessionStorage.setItem(STAFF_KEY, on ? "1" : "0"); }

  // shared page-transition helper so every page navigates with the same feel
  function navigateTo(url) {
    const root = document.querySelector(".gc-page") || document.body;
    root.classList.add("gc-leaving");
    window.setTimeout(() => { window.location.href = url; }, 170);
  }

  // subtle "spotlight" position for the button hover glow, set on pointer move
  function wireButtonGlow(root) {
    (root || document).querySelectorAll(".gc-btn").forEach((btn) => {
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        btn.style.setProperty("--x", ((e.clientX - r.left) / r.width) * 100 + "%");
        btn.style.setProperty("--y", ((e.clientY - r.top) / r.height) * 100 + "%");
      });
    });
  }

  return {
    MENUS, money, qrUrl,
    createRequest, getCard, listPending, listActive, approve, deny, charge,
    isStaffSession, setStaffSession,
    navigateTo, wireButtonGlow
  };
})();
