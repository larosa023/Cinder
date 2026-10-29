/* Game lists: your Steam collections (read-only) plus Cinder lists you make. */
(() => {
"use strict";
const { $, esc, S } = C;
const LS = { steam: [], active: null, editing: null };

const cinderLists = () => S.config.lists || [];
const newId = () => "l-" + Math.random().toString(36).slice(2, 10);

async function loadSteam() {
  const before = JSON.stringify(LS.steam);
  try { LS.steam = (await C.api("/api/collections")).steam || []; } catch { return; }  // keep what we had
  if (LS.active && !find(LS.active)) { LS.active = null; C.library.render(); return; }
  // A Steam collection you're viewing changed in Steam: show its new games.
  if (LS.active && !String(LS.active).startsWith("l-") && JSON.stringify(LS.steam) !== before) C.library.render();
}

function find(id) {
  return cinderLists().find((l) => l.id === id) || LS.steam.find((l) => l.id === id) || null;
}

/** The active list's games (a Set), or null when showing everything. */
function activeSet() {
  const l = LS.active && find(LS.active);
  return l ? new Set(l.appids) : null;
}

function save(lists) {
  S.config.lists = lists;
  C.saveConfig({ lists });
}

// ---------- the Lists dropdown in the library ----------
function rowHTML(l, editable) {
  const on = LS.active === l.id ? " on" : "";
  if (LS.editing === l.id) {
    return `<div class="list-row editing"><input class="text sm" data-rename="${esc(l.id)}" value="${esc(l.name)}" maxlength="60"></div>`;
  }
  return `<div class="list-row${on}" data-list="${esc(l.id)}">
    <span class="name">${esc(l.name)}</span>
    <span class="cnt">${l.dynamic ? "auto" : l.appids.length}</span>
    ${editable ? `<button class="icon-btn xs" data-edit="${esc(l.id)}" title="Rename"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/></svg></button>
      <button class="icon-btn xs" data-del="${esc(l.id)}" title="Delete list"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></button>` : ""}
  </div>`;
}

function renderMenu() {
  const mine = cinderLists(), steam = LS.steam;
  $("#lists-menu").innerHTML = `
    <div class="list-row${LS.active ? "" : " on"}" data-list=""><span class="name">All games</span></div>
    <h4>Your lists</h4>
    ${mine.map((l) => rowHTML(l, true)).join("") || '<p class="hint">No lists yet.</p>'}
    ${LS.editing === "new" ? '<div class="list-row editing"><input class="text sm" data-rename="new" placeholder="List name" maxlength="60"></div>'
      : '<button class="link" data-new>+ New list</button>'}
    ${steam.length ? `<h4>Steam collections</h4>${steam.map((l) => rowHTML(l, false)).join("")}
      <p class="hint">Edit these in Steam; Cinder picks up changes automatically.</p>` : ""}`;
  const input = $("#lists-menu [data-rename]");
  if (input) { input.focus(); input.select(); }
}

function toggleMenu(force) {
  const m = $("#lists-menu");
  const open = force ?? m.hidden;
  LS.editing = null;
  if (open) {
    renderMenu();
    const b = $("#btn-lists").getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(b.left, innerWidth - 300))}px`;
    m.style.top = `${b.bottom + 6}px`;
    loadSteam().then(() => { if (!m.hidden) renderMenu(); });
  }
  m.hidden = !open;
}

function select(id) {
  LS.active = id || null;
  toggleMenu(false);
  renderChip();
  C.library.render();
  C.library.ensureAch();
}

function renderChip() {
  const l = LS.active && find(LS.active);
  $("#list-chip").hidden = !l;
  if (l) $("#list-chip-name").textContent = l.name;
  $("#btn-lists").classList.toggle("on", !!l);
}

function commitName(id, name) {
  name = name.trim();
  LS.editing = null;
  if (!name) return renderMenu();
  const lists = cinderLists().map((l) => ({ ...l }));
  if (id === "new") {
    const l = { id: newId(), name, appids: LS.pendingAdd ? [LS.pendingAdd] : [] };
    lists.push(l);
    if (LS.pendingAdd) C.toast(`Added to ${name}`);
    LS.pendingAdd = null;
  } else {
    const l = lists.find((x) => x.id === id);
    if (l) l.name = name;
  }
  save(lists);
  renderMenu();
  renderChip();
}

// ---------- "Add to list" picker (right-click / game page) ----------
function picker(appid, x, y) {
  const m = $("#list-picker");
  const lists = cinderLists();
  m.innerHTML = `<h4>Add to list</h4>
    ${lists.map((l) => `<label class="pick-row"><input type="checkbox" data-pick="${esc(l.id)}" ${l.appids.includes(appid) ? "checked" : ""}> ${esc(l.name)}</label>`).join("")
      || '<p class="hint">You don\'t have any lists yet.</p>'}
    <div class="pick-new"><input class="text sm" id="pick-new" placeholder="New list…" maxlength="60"><button class="btn sm" id="pick-add">Add</button></div>`;
  m.dataset.appid = appid;
  m.hidden = false;
  m.style.left = `${Math.min(x, innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = `${Math.min(y, innerHeight - m.offsetHeight - 8)}px`;
}

function setMembership(appid, id, on) {
  const lists = cinderLists().map((l) => {
    if (l.id !== id) return l;
    const set = new Set(l.appids);
    if (on) set.add(appid); else set.delete(appid);
    return { ...l, appids: [...set] };
  });
  save(lists);
  if (LS.active === id) C.library.render();
}

function bind() {
  $("#btn-lists").addEventListener("click", () => toggleMenu());
  $("#list-chip-x").addEventListener("click", () => select(null));
  const menu = $("#lists-menu");
  menu.addEventListener("click", (e) => {
    const t = e.target;
    const edit = t.closest("[data-edit]");
    if (edit) { e.stopPropagation(); LS.editing = edit.dataset.edit; return renderMenu(); }
    const del = t.closest("[data-del]");
    if (del) {
      e.stopPropagation();
      const l = find(del.dataset.del);
      if (l && confirm(`Delete the list "${l.name}"? The games stay in your library.`)) {
        save(cinderLists().filter((x) => x.id !== l.id));
        if (LS.active === l.id) select(null); else renderMenu();
      }
      return;
    }
    if (t.closest("[data-new]")) { LS.editing = "new"; return renderMenu(); }
    const row = t.closest("[data-list]");
    if (row && !t.closest("input")) select(row.dataset.list);
  });
  menu.addEventListener("keydown", (e) => {
    const inp = e.target.closest("[data-rename]");
    if (!inp) return;
    if (e.key === "Enter") commitName(inp.dataset.rename, inp.value);
    if (e.key === "Escape") { e.stopPropagation(); LS.editing = null; renderMenu(); }
  });
  const pk = $("#list-picker");
  pk.addEventListener("change", (e) => {
    const cb = e.target.closest("[data-pick]");
    if (cb) setMembership(+pk.dataset.appid, cb.dataset.pick, cb.checked);
  });
  const addNew = () => {
    const name = $("#pick-new").value.trim();
    if (!name) return;
    const appid = +pk.dataset.appid;
    save([...cinderLists(), { id: newId(), name, appids: [appid] }]);
    C.toast(`Added to ${name}`);
    pk.hidden = true;
  };
  pk.addEventListener("click", (e) => { if (e.target.closest("#pick-add")) addNew(); });
  pk.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "pick-new") addNew(); });
  document.addEventListener("mousedown", (e) => {
    if (!menu.hidden && !e.target.closest("#lists-menu, #btn-lists")) toggleMenu(false);
    if (!pk.hidden && !e.target.closest("#list-picker")) pk.hidden = true;
  });
  window.addEventListener("focus", () => loadSteam().then(renderChip));
}

C.lists = { init: bind, loadSteam, activeSet, picker, renderChip, active: () => LS.active && find(LS.active) };
})();
