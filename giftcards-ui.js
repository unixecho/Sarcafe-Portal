"use strict";
/* Escape user-typed values before any innerHTML interpolation.
   The form fields (name, email) are attacker-controlled input — even in a demo,
   because demo code has a way of becoming production code. */
function gcEscape(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* Shared ticket renderer — the one visual signature reused on every page. */
function gcRenderTicket(card) {
  let stamp = "";
  if (card.status === "pending") stamp = '<div class="gc-stamp pending">ממתין לאישור</div>';
  if (card.status === "denied") stamp = '<div class="gc-stamp denied">נדחה</div>';
  if (card.status === "active") stamp = '<div class="gc-stamp active">פעיל</div>';
  return `
    <div class="gc-ticket">
      ${stamp}
      <div class="gc-ticket-info">
        <div class="gc-cardid mono">#${gcEscape(card.id)}</div>
        <div class="gc-name">${gcEscape(card.first)} ${gcEscape(card.last)}</div>
        <div class="gc-ticket-balance">${Number(card.balance)}<small>₪ יתרה</small></div>
        <div class="gc-cardid">${gcEscape(card.email)}${card.recipientEmail ? " · מתנה ל: " + gcEscape(card.recipientEmail) : ""}</div>
      </div>
      <div class="gc-ticket-perf"></div>
      <div class="gc-ticket-stub">
        <img class="gc-qr-img" src="${GC.qrUrl(card.id)}" alt="קוד QR לכרטיס ${card.id}">
        <div class="gc-qr-label mono">/c/${card.id}</div>
      </div>
    </div>`;
}
