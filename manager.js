"use strict";

// Menu manager. Edits a working copy of a branch's menu and saves it through
// SarcafeMenu (localStorage). Display-only menus read the same store, so the
// preview reflects edits on this device. Export downloads the data to commit.

const STRINGS = {
  moveUp: "הזזה למעלה",
  moveDown: "הזזה למטה",
  deleteCategory: "מחיקת קטגוריה",
  deleteItem: "מחיקת פריט",
  icon: "אייקון",
  categoryName: "שם הקטגוריה",
  addItem: "הוספת פריט",
  nameHe: "שם הפריט",
  price: "מחיר",
  noteHe: "הערה",
  addNote: "הוספת הערה",
  removeNote: "הסרת הערה",
  saved: "נשמר ✓",
  exported: "הקובץ יוצא ✓",
  editLabel: "עריכת תפריט",
  confirmDeleteCategory: "למחוק את הקטגוריה וכל הפריטים שבה?",
  confirmReset:
    "לאפס את התפריט לברירת המחדל? כל השינויים שנשמרו במכשיר זה יימחקו.",
  confirmLeave: "יש שינויים שלא נשמרו. לעזוב בכל זאת?",
};

const PREVIEW_PAGES = {
  maor: "menu-maor.html",
  givatHaviva: "menu-givat-haviva.html",
};

const branchSelect = document.querySelector("#branchSelect");
const branchButtons = document.querySelector("#branchButtons");
const editor = document.querySelector("#editor");
const editorTitle = document.querySelector("#editorTitle");
const categoriesEl = document.querySelector("#categories");
const statusEl = document.querySelector("#status");

let currentBranch = null;
let draft = null;
let dirty = false;
let flashTimer = null;

function markDirty() {
  dirty = true;
  updateStatus();
}

function updateStatus() {
  if (!statusEl) return;

  if (dirty) {
    statusEl.textContent = "יש שינויים שלא נשמרו";
    statusEl.className = "manager-status is-dirty";
    return;
  }

  const saved = currentBranch && SarcafeMenu.hasOverride(currentBranch);
  statusEl.textContent = saved ? "נשמר במכשיר זה" : "ברירת מחדל";
  statusEl.className = "manager-status";
}

function flash(message) {
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.className = "manager-status is-ok";

  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(updateStatus, 1600);
}

// --- Small builders -------------------------------------------------------

function ctrlButton(glyph, label, onClick, disabled = false, variant = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `m-ctrl${variant ? ` m-ctrl--${variant}` : ""}`;
  button.innerHTML = `<span aria-hidden="true">${glyph}</span>`;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function textField(label, value, onInput, opts = {}) {
  const wrap = document.createElement("label");
  wrap.className = `m-field${opts.className ? ` ${opts.className}` : ""}`;

  const span = document.createElement("span");
  span.className = "m-field__label";
  span.textContent = label;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "m-input";
  input.value = value ?? "";
  if (opts.dir) input.dir = opts.dir;
  if (opts.inputmode) input.inputMode = opts.inputmode;
  input.addEventListener("input", () => onInput(input.value));

  wrap.append(span, input);
  return wrap;
}

// --- Rendering ------------------------------------------------------------

function renderBranchSelect() {
  branchButtons.replaceChildren(
    ...SarcafeMenu.listBranches().map((branch) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "branch-button";

      const name = document.createElement("span");
      name.textContent = branch.name.he;

      const small = document.createElement("small");
      small.textContent = STRINGS.editLabel;

      button.append(name, small);
      button.addEventListener("click", () => selectBranch(branch.key));
      return button;
    })
  );
}

function renderCategories() {
  categoriesEl.replaceChildren(
    ...draft.categories.map((category, index) =>
      renderCategoryCard(category, index)
    )
  );
}

function renderCategoryCard(category, index) {
  const card = document.createElement("section");
  card.className = "m-category";

  const head = document.createElement("div");
  head.className = "m-category__head";

  const controls = document.createElement("div");
  controls.className = "m-controls";
  controls.append(
    ctrlButton("▲", STRINGS.moveUp, () => moveCategory(index, -1), index === 0),
    ctrlButton(
      "▼",
      STRINGS.moveDown,
      () => moveCategory(index, 1),
      index === draft.categories.length - 1
    ),
    ctrlButton(
      "🗑",
      STRINGS.deleteCategory,
      () => deleteCategory(index),
      false,
      "danger"
    )
  );

  const icon = document.createElement("input");
  icon.type = "text";
  icon.className = "m-input m-input--icon";
  icon.value = category.icon || "";
  icon.maxLength = 4;
  icon.setAttribute("aria-label", STRINGS.icon);
  icon.addEventListener("input", () => {
    category.icon = icon.value;
    markDirty();
  });

  const titleHe = document.createElement("input");
  titleHe.type = "text";
  titleHe.className = "m-input m-input--title";
  titleHe.value = category.title?.he || "";
  titleHe.placeholder = STRINGS.categoryName;
  titleHe.addEventListener("input", () => {
    category.title.he = titleHe.value;
    markDirty();
  });

  head.append(controls, icon, titleHe);

  const subtitles = document.createElement("div");
  subtitles.className = "m-grid-2";
  subtitles.append(
    textField(
      "English",
      category.title?.en,
      (value) => {
        category.title.en = value;
        markDirty();
      },
      { dir: "ltr" }
    ),
    textField("العربية", category.title?.ar, (value) => {
      category.title.ar = value;
      markDirty();
    })
  );

  const items = document.createElement("div");
  items.className = "m-items";
  category.items.forEach((item, itemIndex) => {
    items.append(renderItemRow(category, item, itemIndex));
  });

  const addItem = document.createElement("button");
  addItem.type = "button";
  addItem.className = "m-add";
  addItem.textContent = `＋ ${STRINGS.addItem}`;
  addItem.addEventListener("click", () => addItemTo(category));

  card.append(head, subtitles, items, addItem);
  return card;
}

function renderItemRow(category, item, index) {
  const row = document.createElement("div");
  row.className = "m-item";

  const controls = document.createElement("div");
  controls.className = "m-controls m-controls--column";
  controls.append(
    ctrlButton(
      "▲",
      STRINGS.moveUp,
      () => moveItem(category, index, -1),
      index === 0
    ),
    ctrlButton(
      "▼",
      STRINGS.moveDown,
      () => moveItem(category, index, 1),
      index === category.items.length - 1
    ),
    ctrlButton(
      "🗑",
      STRINGS.deleteItem,
      () => deleteItem(category, index),
      false,
      "danger"
    )
  );

  const main = document.createElement("div");
  main.className = "m-item__main";

  const line1 = document.createElement("div");
  line1.className = "m-item__line";
  line1.append(
    textField(STRINGS.nameHe, item.he, (value) => {
      item.he = value;
      markDirty();
    }),
    textField(
      STRINGS.price,
      item.price,
      (value) => {
        item.price = value;
        markDirty();
      },
      { inputmode: "decimal", className: "m-field--price" }
    )
  );

  const line2 = document.createElement("div");
  line2.className = "m-grid-2";
  line2.append(
    textField(
      "English",
      item.en,
      (value) => {
        item.en = value;
        markDirty();
      },
      { dir: "ltr" }
    ),
    textField("العربية", item.ar, (value) => {
      item.ar = value;
      markDirty();
    })
  );

  main.append(line1, line2, renderNoteSection(item));
  row.append(controls, main);
  return row;
}

function renderNoteSection(item) {
  const wrap = document.createElement("div");
  wrap.className = "m-note";

  if (item.note) {
    const grid = document.createElement("div");
    grid.className = "m-grid-3";
    grid.append(
      textField(STRINGS.noteHe, item.note.he, (value) => {
        item.note.he = value;
        markDirty();
      }),
      textField(
        "Note (EN)",
        item.note.en,
        (value) => {
          item.note.en = value;
          markDirty();
        },
        { dir: "ltr" }
      ),
      textField("ملاحظة", item.note.ar, (value) => {
        item.note.ar = value;
        markDirty();
      })
    );

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "m-link";
    remove.textContent = `× ${STRINGS.removeNote}`;
    remove.addEventListener("click", () => {
      delete item.note;
      markDirty();
      renderCategories();
    });

    wrap.append(grid, remove);
  } else {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "m-link";
    add.textContent = `＋ ${STRINGS.addNote}`;
    add.addEventListener("click", () => {
      item.note = { he: "", en: "", ar: "" };
      markDirty();
      renderCategories();
    });

    wrap.append(add);
  }

  return wrap;
}

// --- Mutations ------------------------------------------------------------

function selectBranch(key) {
  currentBranch = key;
  draft = SarcafeMenu.getMenu(key);
  dirty = false;

  editorTitle.textContent = draft.name?.he || key;
  branchSelect.classList.add("is-hidden");
  editor.classList.remove("is-hidden");

  renderCategories();
  updateStatus();
  window.scrollTo({ top: 0 });
}

function backToBranches() {
  if (dirty && !window.confirm(STRINGS.confirmLeave)) return;

  currentBranch = null;
  draft = null;
  dirty = false;

  editor.classList.add("is-hidden");
  branchSelect.classList.remove("is-hidden");
}

function moveCategory(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= draft.categories.length) return;

  const list = draft.categories;
  [list[index], list[target]] = [list[target], list[index]];
  markDirty();
  renderCategories();
}

function deleteCategory(index) {
  if (!window.confirm(STRINGS.confirmDeleteCategory)) return;

  draft.categories.splice(index, 1);
  markDirty();
  renderCategories();
}

function addCategory() {
  draft.categories.push({
    id: `c${Date.now().toString(36)}`,
    icon: "🍽️",
    title: { he: "", en: "", ar: "" },
    items: [],
  });
  markDirty();
  renderCategories();

  const last = categoriesEl.querySelector(".m-category:last-child .m-input--title");
  last?.focus();
}

function addItemTo(category) {
  category.items.push({ he: "", en: "", ar: "", price: "" });
  markDirty();
  renderCategories();
}

function moveItem(category, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= category.items.length) return;

  const list = category.items;
  [list[index], list[target]] = [list[target], list[index]];
  markDirty();
  renderCategories();
}

function deleteItem(category, index) {
  category.items.splice(index, 1);
  markDirty();
  renderCategories();
}

// --- Save / export --------------------------------------------------------

function normalizePrice(value) {
  if (typeof value === "number") return value;

  const text = String(value ?? "").trim();
  if (text === "") return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);

  return text;
}

function cleanNote(note) {
  if (!note) return null;

  const he = (note.he || "").trim();
  const en = (note.en || "").trim();
  const ar = (note.ar || "").trim();

  if (!he && !en && !ar) return null;
  return { he, en, ar };
}

// A normalized copy for saving/exporting; leaves the live draft untouched so
// editing can continue with the raw values still in the inputs.
function buildPayload() {
  const payload = JSON.parse(JSON.stringify(draft));

  payload.categories.forEach((category) => {
    category.items.forEach((item) => {
      item.price = normalizePrice(item.price);

      const note = cleanNote(item.note);
      if (note) {
        item.note = note;
      } else {
        delete item.note;
      }
    });
  });

  return payload;
}

function save() {
  SarcafeMenu.saveMenu(currentBranch, buildPayload());
  dirty = false;
  updateStatus();
  flash(STRINGS.saved);
}

function resetToDefault() {
  if (!window.confirm(STRINGS.confirmReset)) return;

  SarcafeMenu.resetMenu(currentBranch);
  draft = SarcafeMenu.getDefaultMenu(currentBranch);
  dirty = false;
  renderCategories();
  updateStatus();
}

function exportJson() {
  const payload = buildPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sarcafe-${currentBranch}-menu.json`;
  link.click();
  URL.revokeObjectURL(url);

  flash(STRINGS.exported);
}

function preview() {
  // The menu page reads from storage, so persist first.
  save();
  window.open(PREVIEW_PAGES[currentBranch] || "index.html", "_blank");
}

// --- Wiring ---------------------------------------------------------------

document.querySelector("#backBtn")?.addEventListener("click", backToBranches);
document.querySelector("#saveBtn")?.addEventListener("click", save);
document.querySelector("#previewBtn")?.addEventListener("click", preview);
document.querySelector("#exportBtn")?.addEventListener("click", exportJson);
document.querySelector("#resetBtn")?.addEventListener("click", resetToDefault);
document
  .querySelector("#addCategoryBtn")
  ?.addEventListener("click", addCategory);

window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

renderBranchSelect();
