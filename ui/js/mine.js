/* Your own notes, ratings and status per game, plus launch options (game page). */
(() => {
"use strict";
const { $, $$, esc, S } = C;
const STATUSES = [["playing", "Playing"], ["backlog", "Backlog"], ["beaten", "Beaten"], ["completed", "100%"], ["dropped", "Dropped"]];
const STAR = '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
const M = { appid: 0, noteTimer: 0, lopts: "" };

S.meta = {};
const meta = (appid) => S.meta[appid] || {};
C.meta = meta;
C.STATUSES = STATUSES;
C.statusLabel = (st) => (STATUSES.find(([k]) => k === st) || [, ""])[1];
C.stars = (n) => (n ? `<span class="stars">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>` : "");

async function load() {
  try { S.meta = (await C.api("/api/meta")).games || {}; } catch { /* keep empty */ }
  C.library.render();
}

async function save(appid, fields) {
  const cur = { ...meta(appid), ...fields };
  S.meta[appid] = cur;  // show it right away
  try {
    const r = await C.api("/api/meta", { appid, ...fields });
    if (Object.keys(r.meta).length) S.meta[appid] = r.meta; else delete S.meta[appid];
  } catch (e) { C.toast(e.message, true); }
  if (C.route.tab === "library") C.library.render();
}

function paint() {
  const m = meta(M.appid);
  $("#d-rate").innerHTML = [1, 2, 3, 4, 5].map((n) =>
    `<button data-rate="${n}" class="${(m.rating || 0) >= n ? "on" : ""}" title="${n} star${n > 1 ? "s" : ""}">${STAR}</button>`).join("");
  $("#d-status").innerHTML = STATUSES.map(([k, l]) => `<button data-v="${k}" class="${m.status === k ? "on" : ""}">${l}</button>`).join("");
}

async function open(g) {
  M.appid = g.appid;
  clearTimeout(M.noteTimer);
  $("#d-note").value = meta(g.appid).note || "";
  paint();
  const row = $("#d-lopts-row");
  row.hidden = !!g.shortcut;
  if (g.shortcut) return;
  $("#d-lopts").value = "";
  $("#d-lopts-state").textContent = "";
  try {
    const r = await C.api(`/api/game/${g.appid}/launch_options`);
    if (M.appid !== g.appid) return;
    $("#d-lopts").value = M.lopts = r.options || "";
    $("#d-lopts-state").textContent = r.pending ? "Saved. Steam picks it up when it next closes" : "";
  } catch { /* leave empty */ }
}

async function saveLopts() {
  const appid = M.appid, v = $("#d-lopts").value.trim();
  const btn = $("#d-lopts-save");
  btn.disabled = true;
  try {
    const r = await C.api("/api/action", { action: "launch_options", appid, options: v });
    M.lopts = v;
    const msg = { live: "Saved in Steam", saved: "Saved in Steam", pending: "Saved. Steam picks it up when it next closes" }[r.state] || "Saved";
    $("#d-lopts-state").textContent = r.state === "pending" ? msg : "";
    C.toast(msg);
  } catch (e) { C.toast(e.message, true); } finally { btn.disabled = false; }
}

function bind() {
  $("#d-rate").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rate]");
    if (!b) return;
    const n = +b.dataset.rate;
    save(M.appid, { rating: meta(M.appid).rating === n ? 0 : n });  // click the same star again to clear
    paint();
  });
  $("#d-status").addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    save(M.appid, { status: meta(M.appid).status === b.dataset.v ? "" : b.dataset.v });
    paint();
  });
  $("#d-note").addEventListener("input", () => {
    clearTimeout(M.noteTimer);
    const appid = M.appid, v = $("#d-note").value;
    M.noteTimer = setTimeout(() => save(appid, { note: v }), 600);
  });
  $("#d-lopts-save").addEventListener("click", saveLopts);
  $("#d-lopts").addEventListener("keydown", (e) => { if (e.key === "Enter") saveLopts(); });
}

C.mine = { load, open, save, init: bind };
})();
