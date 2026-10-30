/* Storage tab: your drives, what's taking space, and moving or uninstalling games. */
(() => {
"use strict";
const { $, esc } = C;
const el = () => $("#view-storage");
const D = { data: null, drive: "", view: "big", q: "", menu: 0 };
const VIEWS = [["big", "Biggest"], ["stale", "Not played in 6 months"], ["never", "Never played"]];

async function load() {
  if (!D.data) el().innerHTML = C.loading("Measuring your drives…");
  try {
    D.data = await C.api("/api/storage");
    if (C.route.tab === "storage") render();
  } catch (e) { if (!D.data) el().innerHTML = C.failed(e.message); }
}

const pct = (a, b) => (b ? Math.max(0, Math.min(100, (100 * a) / b)) : 0);

function driveCard(d) {
  const used = d.total - d.free;
  const other = Math.max(0, used - d.games_size);
  const low = d.total && d.free / d.total < 0.1;
  return `<button class="sd${D.drive === d.path ? " on" : ""}${low ? " low" : ""}" data-drive="${esc(d.path)}">
    <div class="sd-top"><b>${esc(d.label)}</b><small>${esc(d.path)}</small></div>
    <div class="sd-bar" title="Games ${C.fmtSize(d.games_size)} · other files ${C.fmtSize(other)} · free ${C.fmtSize(d.free)}">
      <i class="g" style="width:${pct(d.games_size, d.total)}%"></i><i class="o" style="width:${pct(other, d.total)}%"></i></div>
    <div class="sd-meta"><span><b>${C.fmtSize(d.games_size)}</b> in ${d.count} game${d.count === 1 ? "" : "s"}</span>
      <span class="${low ? "warn" : ""}"><b>${C.fmtSize(d.free)}</b> free of ${C.fmtSize(d.total)}</span></div>
  </button>`;
}

function list() {
  const six = Date.now() / 1000 - 182 * 86400;
  let g = D.data.games;
  if (D.drive) g = g.filter((x) => x.library === D.drive);
  if (D.q) { const q = D.q.toLowerCase(); g = g.filter((x) => x.name.toLowerCase().includes(q)); }
  if (D.view === "stale") g = g.filter((x) => x.lastplayed && x.lastplayed < six);
  if (D.view === "never") g = g.filter((x) => !x.lastplayed && !x.playtime);
  return [...g].sort((a, b) => b.size - a.size);
}

function row(x) {
  const drv = D.data.drives.find((d) => d.path === x.library);
  const others = D.data.drives.filter((d) => d.path !== x.library && d.index >= 0);
  const open = D.menu === x.appid;
  return `<div class="srw" data-appid="${x.appid}">
    <img alt="" loading="lazy" src="/art/${x.appid}/header" data-fail="hide">
    <div class="srw-main"><span class="name">${esc(C.gname(x.name))}</span>
      <small>${x.lastplayed ? `Played ${C.fmtAgo(x.lastplayed)}` : "Never played"}${x.playtime ? ` · ${C.fmtPlay(x.playtime)}` : ""}</small></div>
    <span class="srw-drive">${esc(drv ? drv.label : "")}</span>
    <b class="srw-size">${C.fmtSize(x.size)}</b>
    <div class="srw-acts">
      ${others.length ? `<div class="srw-move"><button class="btn sm" data-move-menu="${x.appid}">Move ▾</button>
        ${open ? `<div class="menu srw-menu">${others.map((d) => {
          const fits = d.free > x.size * 1.05;
          return `<button data-move="${x.appid}" data-folder="${d.index}" ${fits ? "" : "disabled"}>
            <b>${esc(d.label)}</b><small>${fits ? `${C.fmtSize(d.free)} free` : "Not enough space"}</small></button>`;
        }).join("")}</div>` : ""}</div>` : ""}
      <button class="btn sm danger" data-uninstall="${x.appid}">Uninstall</button>
    </div>
  </div>`;
}

function render() {
  const d = D.data;
  const rows = list();
  const total = d.games.reduce((n, g) => n + g.size, 0);
  const shown = rows.reduce((n, g) => n + g.size, 0);
  el().innerHTML = `
    <div class="page-head"><h1>Storage</h1>
      <span class="scan">${d.games.length} games · ${C.fmtSize(total)} on ${d.drives.length} drive${d.drives.length === 1 ? "" : "s"}</span></div>
    ${d.bridge !== "on" ? '<p class="ws-note">Moving a game opens its properties in Steam. Connect Cinder to Steam (Downloads tab) to move games in one click.</p>' : ""}
    <div class="sdrives">${d.drives.map(driveCard).join("")}</div>
    <div class="lib-head">
      <div class="chips">${VIEWS.map(([k, l]) => `<button data-sview="${k}" class="${D.view === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${D.drive ? `<button class="chip-x" data-drive="">${esc((d.drives.find((x) => x.path === D.drive) || {}).label || "")} ✕</button>` : ""}
      <div class="spacer"></div><span class="scan">${rows.length} games · ${C.fmtSize(shown)}</span>
    </div>
    <div class="srws">${rows.slice(0, 300).map(row).join("") || '<div class="state">Nothing here.</div>'}</div>`;
}

function bind() {
  el().addEventListener("click", async (e) => {
    const t = e.target;
    const dr = t.closest("[data-drive]");
    if (dr) { D.drive = D.drive === dr.dataset.drive ? "" : dr.dataset.drive; return render(); }
    const sv = t.closest("[data-sview]");
    if (sv) { D.view = sv.dataset.sview; return render(); }
    const mm = t.closest("[data-move-menu]");
    if (mm) { D.menu = D.menu === +mm.dataset.moveMenu ? 0 : +mm.dataset.moveMenu; return render(); }
    const mv = t.closest("[data-move]");
    if (mv) {
      D.menu = 0;
      const appid = +mv.dataset.move;
      const g = D.data.games.find((x) => x.appid === appid);
      try {
        const r = await C.api("/api/action", { action: "move_game", appid, folder: mv.dataset.folder });
        C.toast(r.state === "moving" ? `Steam is moving ${g ? C.gname(g.name) : "the game"}. Progress is in Steam's Downloads` : "Opened the game's properties in Steam (Installed Files → Move)");
      } catch (err) { C.toast(err.message, true); }
      render();
      setTimeout(load, 5000);
      return;
    }
    const un = t.closest("[data-uninstall]");
    if (un) { if (await C.act("uninstall", { appid: +un.dataset.uninstall })) C.toast("Steam will ask you to confirm"); return; }
    if (t.closest("[data-retry]")) return load();
    const r = t.closest(".srw[data-appid]");
    if (r && !t.closest("button")) { const id = +r.dataset.appid; C.go("library"); setTimeout(() => C.library.openDetail(id), 50); }
  });
  document.addEventListener("mousedown", (e) => {
    if (D.menu && !e.target.closest(".srw-move")) { D.menu = 0; if (C.route.tab === "storage") render(); }
  });
}

C.views.storage = {
  placeholder: "Search games",
  show() { if (D.data) render(); load(); },
  search(q) { D.q = q.trim(); if (D.data) render(); },
  searchValue: () => D.q,
  refresh() { return load(); },
  init: bind,
};
})();
