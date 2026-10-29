/* Workshop tab: your mods per game, and browsing a game's Steam Workshop. */
(() => {
"use strict";
const { $, $$, esc, S, ICON } = C;
const el = () => $("#view-workshop");
const W = { games: null, game: null, appid: 0, tab: "installed", sort: "trend", q: "", browse: null, page: 1, busy: false, filter: "" };

const SORTS = [["trend", "Trending"], ["popular", "Most popular"], ["top", "Top rated"], ["recent", "Newest"], ["updated", "Recently updated"]];
const num = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n || 0));
const gameName = (appid) => { const g = S.games.find((x) => x.appid === appid); return g ? C.gname(g.name) : ""; };

// ---------- all games ----------
async function loadGames() {
  if (!W.games) el().innerHTML = C.loading("Looking for workshop items…");
  try {
    W.games = (await C.api("/api/workshop")).games;
    if (C.route.tab === "workshop" && !W.appid) renderGames();
  } catch (e) { el().innerHTML = C.failed(e.message); }
}

function renderGames() {
  const q = W.filter.toLowerCase();
  const games = W.games.filter((g) => !q || g.name.toLowerCase().includes(q));
  const total = W.games.reduce((n, g) => n + g.count, 0);
  const size = W.games.reduce((n, g) => n + g.size, 0);
  const others = S.games.filter((g) => g.installed && !g.shortcut && !W.games.some((w) => w.appid === g.appid))
    .sort((a, b) => (b.lastplayed || 0) - (a.lastplayed || 0)).slice(0, 12);
  el().innerHTML = `
    <div class="page-head"><h1>Workshop</h1>${W.games.length ? `<span class="scan">${total} items · ${C.fmtSize(size)}</span>` : ""}</div>
    ${W.games.length ? `<section class="psection"><h2>Your workshop games</h2>
      <div class="ws-games">${games.map((g) => `
        <button class="ws-game" data-app="${g.appid}">
          <img alt="" loading="lazy" src="/art/${g.appid}/header" data-fail="hide">
          ${g.updates ? `<span class="badge">${g.updates} update${g.updates > 1 ? "s" : ""}</span>` : ""}
          <span class="ws-gmeta"><span class="name">${esc(C.gname(g.name))}</span>
            <small>${g.subscribed ? `${g.subscribed} subscribed` : `${g.count} items`} · ${C.fmtSize(g.size)}</small></span>
        </button>`).join("")}</div></section>`
      : `<div class="state"><strong>No workshop items yet</strong>Pick a game below to browse its Steam Workshop.</div>`}
    ${others.length ? `<section class="psection"><h2>Browse another game's workshop</h2>
      <div class="ws-games small">${others.map((g) => `
        <button class="ws-game" data-app="${g.appid}" data-browse>
          <img alt="" loading="lazy" src="/art/${g.appid}/header" data-fail="hide">
          <span class="ws-gmeta"><span class="name">${esc(C.gname(g.name))}</span></span>
        </button>`).join("")}</div></section>` : ""}`;
}

// ---------- one game ----------
async function openGame(appid, tab) {
  if (W.appid !== appid) { W.game = null; W.browse = null; W.page = 1; W.q = ""; $("#search").value = ""; }
  W.appid = appid;
  W.tab = tab || W.tab;
  if (!W.game) el().innerHTML = C.loading("Loading workshop…");
  try {
    const g = await C.api(`/api/workshop/${appid}`);
    if (W.appid !== appid) return;
    W.game = g;
    if (!g.items.length && !tab) W.tab = "browse";
    renderGame();
    if (W.tab === "browse" && !W.browse) loadBrowse();
  } catch (e) { el().innerHTML = C.failed(e.message); }
}

async function loadBrowse(more = false) {
  if (W.busy) return;
  W.busy = true;
  const appid = W.appid;
  if (!more) { W.page = 1; W.browse = null; renderGame(); }
  try {
    const r = await C.api(`/api/workshop/${appid}/browse?sort=${W.sort}&q=${encodeURIComponent(W.q)}&page=${W.page}`);
    if (W.appid !== appid) return;
    W.browse = more && W.browse ? { ...r, items: [...W.browse.items, ...r.items.filter((x) => !W.browse.items.some((y) => y.id === x.id))] } : r;
  } catch (e) {
    W.browse = { items: [], error: e.message };
  } finally { W.busy = false; }
  renderGame();
}

function itemCard(it, mode) {
  const badges = mode === "installed"
    ? `${it.needs_update ? '<span class="badge">Update ready</span>' : it.subscribed ? '<span class="badge muted">Subscribed</span>' : '<span class="badge muted">Added by the game</span>'}`
    : it.have ? '<span class="badge muted">In your game</span>' : "";
  const sub = mode === "installed"
    ? `${C.fmtSize(it.size)}${it.installed_updated ? ` · updated ${C.fmtAgo(it.installed_updated)}` : ""}`
    : `${num(it.subs)} subscribers${it.size ? ` · ${C.fmtSize(it.size)}` : ""}`;
  return `<button class="ws-item" data-item="${it.id}">
    <span class="ws-thumb">${it.preview ? `<img alt="" loading="lazy" src="${esc(it.preview)}" data-fail="hide">` : ""}${badges}</span>
    <span class="ws-title">${esc(it.title)}</span>
    <small>${sub}</small>
  </button>`;
}

function renderGame() {
  const g = W.game;
  if (!g) return;
  const inst = g.items;
  const updates = inst.filter((i) => i.needs_update).length;
  const q = W.tab === "installed" ? W.filter.toLowerCase() : "";
  const shown = inst.filter((i) => !q || (i.title || "").toLowerCase().includes(q));
  let body;
  if (W.tab === "installed") {
    body = inst.length ? `<div class="ws-grid">${shown.map((i) => itemCard(i, "installed")).join("")}</div>`
      : `<div class="state"><strong>Nothing from the workshop yet</strong>Browse to find mods, maps and more.</div>`;
  } else {
    const b = W.browse;
    body = `<div class="chips ws-sorts">${SORTS.map(([v, l]) => `<button data-sort="${v}" class="${W.sort === v && !W.q ? "on" : ""}">${l}</button>`).join("")}
        ${W.q ? `<button class="on" data-clear>Search: ${esc(W.q)} ✕</button>` : ""}</div>
      ${!b ? C.loading("Loading the workshop…")
        : b.error ? C.failed(b.error)
        : !b.items.length ? `<div class="state"><strong>${W.q ? "No results" : "Nothing here"}</strong>${W.q ? "Try different words." : "This game may not have a Steam Workshop."}</div>`
        : `<div class="ws-grid">${b.items.map((i) => itemCard(i, "browse")).join("")}</div>
           ${b.more ? `<div class="ws-more"><button class="btn" data-more ${W.busy ? "disabled" : ""}>${W.busy ? "Loading…" : "Load more"}</button></div>` : ""}`}`;
  }
  el().innerHTML = `
    <div class="ws-hero">
      <img class="ws-bg" alt="" src="/art/${g.appid}/hero" data-fail="hide"><div class="ws-shade"></div>
      <div class="ws-hbody">
        <button class="link ws-back" data-back>‹ All workshop games</button>
        <h1>${esc(C.gname(g.name))}</h1>
        <div class="ws-hstats">${inst.length ? `<span><b>${inst.length}</b> items</span><span><b>${C.fmtSize(g.size)}</b> on disk</span>` : ""}
          ${updates ? `<span class="ws-upd"><b>${updates}</b> update${updates > 1 ? "s" : ""} ready</span>` : ""}</div>
        <div class="dlp-actions"><button class="btn" data-steam-ws>Open in Steam</button><button class="btn" data-gamepage>Game page</button></div>
      </div>
    </div>
    <nav class="d-tabs ws-tabs">
      <button data-wtab="installed" class="${W.tab === "installed" ? "on" : ""}">Your items <span class="count">${inst.length}</span></button>
      <button data-wtab="browse" class="${W.tab === "browse" ? "on" : ""}">Browse</button>
    </nav>
    ${g.error && W.tab === "installed" ? `<p class="ws-note">Couldn't get names and pictures from Steam (${esc(g.error)}).</p>` : ""}
    ${body}`;
}

// ---------- one item ----------
async function openItem(id) {
  const ov = $("#ws-item");
  ov.hidden = false;
  const box = $("#ws-item-body");
  box.innerHTML = C.loading("Loading item…");
  try {
    const { item: it } = await C.api(`/api/workshop/item/${id}`);
    box.innerHTML = `
      <div class="wsi-media">${it.preview ? `<img alt="" src="${esc(it.preview)}" data-fail="hide">` : ""}</div>
      <div class="wsi-body">
        <small class="wsi-game">${esc(it.game || gameName(it.appid))}</small>
        <h2>${esc(it.title)}</h2>
        <div class="wsi-stats">
          <span><b>${num(it.subs)}</b> subscribers</span><span><b>${num(it.favs)}</b> favorites</span>
          ${it.size ? `<span><b>${C.fmtSize(it.size)}</b></span>` : ""}
          ${it.updated ? `<span>Updated <b>${C.fmtDate(it.updated)}</b></span>` : ""}
          ${it.score != null ? `<span><b>${Math.round(it.score * 100)}%</b> positive</span>` : ""}
        </div>
        ${it.tags.length ? `<div class="tags">${it.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <div class="dlp-actions wsi-actions">
          ${it.needs_update ? `<button class="btn primary" data-ws-update="${it.id}" data-app="${it.appid}">${ICON.down}Update now</button>` : ""}
          <button class="btn ${it.have ? "" : "primary"}" data-ws-open="${it.id}" title="Opens the item in Steam, where you can subscribe or unsubscribe">${it.subscribed ? "Unsubscribe in Steam" : it.have ? "View in Steam" : "Subscribe in Steam"}</button>
          ${it.has_folder ? `<button class="btn" data-ws-folder="${it.id}">Open folder</button>` : ""}
        </div>
        ${it.have ? `<p class="ws-note">${it.subscribed ? "You're subscribed. Steam keeps it up to date." : "Installed by the game itself."}</p>`
          : '<p class="ws-note">Steam downloads it after you subscribe. It then shows up under Your items.</p>'}
        <div class="wsi-desc">${esc(it.desc || "No description.")}</div>
      </div>`;
  } catch (e) { box.innerHTML = C.failed(e.message, false); }
}

function bind() {
  el().addEventListener("click", async (e) => {
    const t = e.target;
    const app = t.closest("[data-app]");
    if (app && !t.closest(".ws-hero")) return C.go(`workshop/${app.dataset.app}${app.hasAttribute("data-browse") ? "/browse" : ""}`);
    const it = t.closest("[data-item]");
    if (it) return openItem(it.dataset.item);
    const wt = t.closest("[data-wtab]");
    if (wt) { W.tab = wt.dataset.wtab; renderGame(); if (W.tab === "browse" && !W.browse) loadBrowse(); return; }
    const so = t.closest("[data-sort]");
    if (so) { W.sort = so.dataset.sort; W.q = ""; $("#search").value = ""; return loadBrowse(); }
    if (t.closest("[data-clear]")) { W.q = ""; $("#search").value = ""; return loadBrowse(); }
    if (t.closest("[data-more]")) { W.page += 1; return loadBrowse(true); }
    if (t.closest("[data-back]")) return C.go("workshop");
    if (t.closest("[data-steam-ws]")) return C.act("workshop_browse_steam", { appid: W.appid });
    if (t.closest("[data-gamepage]")) { const id = W.appid; C.go("library"); return setTimeout(() => C.library.openDetail(id), 50); }
    if (t.closest("[data-retry]")) return W.appid ? openGame(W.appid) : loadGames();
  });
  $("#ws-item").addEventListener("click", async (e) => {
    const t = e.target;
    const o = t.closest("[data-ws-open]");
    if (o) { C.act("workshop_open", { id: o.dataset.wsOpen }); return C.toast("Opened in Steam. Subscribe or unsubscribe there"); }
    const f = t.closest("[data-ws-folder]");
    if (f) return C.act("workshop_folder", { id: f.dataset.wsFolder });
    const u = t.closest("[data-ws-update]");
    if (u) {
      u.disabled = true;
      if (await C.act("workshop_update", { id: u.dataset.wsUpdate, appid: +u.dataset.app })) C.toast("Steam is downloading the newest version");
      else u.disabled = false;
    }
  });
}

C.workshop = { open: (appid) => C.go(`workshop/${appid}`), openItem };
C.views.workshop = {
  placeholder: "Search",
  show(params) {
    const appid = +(params[0] || 0);
    if (!appid) { W.appid = 0; W.game = null; return W.games ? (renderGames(), loadGames()) : loadGames(); }
    openGame(appid, params[1] === "browse" ? "browse" : undefined);
  },
  search(q, enter) {
    if (W.appid && W.tab === "browse") { if (enter) { W.q = q.trim(); loadBrowse(); } return; }
    W.filter = q.trim();
    if (W.appid) renderGame(); else if (W.games) renderGames();
  },
  searchValue: () => "",
  refresh() { W.browse = null; return W.appid ? openGame(W.appid) : loadGames(); },
  init: bind,
};
})();
