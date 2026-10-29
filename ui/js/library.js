/* Library tab + the game page overlay. */
(() => {
"use strict";
const { $, $$, esc, S, ICON } = C;
const L = { q: "", filter: "all", current: null };

const SORTS = {
  recent: (a, b) => (b.lastplayed - a.lastplayed) || C.sortKey(a.name).localeCompare(C.sortKey(b.name)),
  name: (a, b) => C.sortKey(a.name).localeCompare(C.sortKey(b.name)),
  playtime: (a, b) => (b.playtime - a.playtime) || C.sortKey(a.name).localeCompare(C.sortKey(b.name)),
  size: (a, b) => b.size - a.size,
  updated: (a, b) => b.lastupdated - a.lastupdated,
  ach: (a, b) => achPct(b) - achPct(a) || C.sortKey(a.name).localeCompare(C.sortKey(b.name)),
};
const achPct = (g) => { const a = (L.ach || {})[g.appid]; return a ? a[0] / a[1] : -1; };

let favMemo = null;  // one Set per render instead of one per card
const favs = () => favMemo || new Set(S.config.favorites || []);
const hiddenSet = () => new Set(S.config.hidden || []);

function visible() {
  const fav = favs(), hid = hiddenSet();
  let g = S.games;
  if (L.filter === "hidden") g = g.filter((x) => hid.has(x.appid));
  else g = g.filter((x) => !hid.has(x.appid));
  const inList = C.lists && C.lists.activeSet();
  if (inList) g = g.filter((x) => inList.has(x.appid));
  if (L.filter === "favorites") g = g.filter((x) => fav.has(x.appid));
  else if (L.filter === "installed") g = g.filter((x) => x.installed);
  else if (L.filter === "played") g = g.filter((x) => x.playtime > 0);
  else if (L.filter === "unplayed") g = g.filter((x) => !x.playtime);
  else if (L.filter === "updates") g = g.filter((x) => x.update_pending);
  if (L.q) {
    const q = L.q.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    g = g.filter((x) => String(x.appid) === q || words.every((w) => x.name.toLowerCase().includes(w)));
  }
  const sort = SORTS[S.config.sort] || SORTS.recent;
  // Favorites stay at the top, whatever the sort.
  return [...g].sort((a, b) => (fav.has(b.appid) - fav.has(a.appid)) || sort(a, b));
}

const wide = () => layoutId() === "wide";

const TROPHY = '<svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/></svg>';

// Achievement progress per game ({appid: [unlocked, total]}), loaded only when cards show it.
let achTimer = 0;
const achFor = (g) => (L.ach || {})[g.appid];
function achWanted() {
  const st = C.style ? C.style.get() : {};
  return st.cardSub === "ach" || st.achBadge === "always" || layoutId() === "list" || S.config.sort === "ach"
    || (st.achBadge === "lists" && !!(C.lists && C.lists.active()));
}
const badgeOn = () => {
  const b = C.style ? C.style.get().achBadge : "lists";
  return b === "always" || (b === "lists" && !!(C.lists && C.lists.active()));
};
async function ensureAch() {
  if (!achWanted()) return;
  clearTimeout(achTimer);
  try {
    const r = await C.api("/api/achievements/summary");
    const sig = JSON.stringify(r.games || {});
    const changed = sig !== L.achSig;
    L.achSig = sig;
    L.ach = r.games || {};
    if (changed && C.route.tab === "library") render();
    if (r.scanning) achTimer = setTimeout(ensureAch, document.hidden || C.route.tab !== "library" ? 15000 : 5000);
  } catch { /* offline: cards just skip the badge */ }
}

function subText(g) {
  if (g.shortcut) return "Non-Steam game";
  const st = C.style ? C.style.get() : {};
  const play = g.playtime ? C.fmtPlay(g.playtime) + " played" : "Not played yet";
  switch (st.cardSub) {
    case "none": return "";
    case "last": return g.lastplayed ? C.fmtAgo(g.lastplayed) : "Never played";
    case "both": return g.playtime ? `${C.fmtPlay(g.playtime)} · ${g.lastplayed ? C.fmtAgo(g.lastplayed) : "—"}` : "Not played yet";
    case "size": return g.size ? C.fmtSize(g.size) : (g.installed ? "" : "Not installed");
    case "ach": {
      const a = achFor(g);
      return a ? `${a[0]} of ${a[1]} achievements` : (L.ach ? "No achievements" : "…");
    }
    default: return play;
  }
}

function achHTML(g) {
  if (g.shortcut || !badgeOn()) return "";
  const a = achFor(g);
  if (!a) return "";
  const pct = Math.round((100 * a[0]) / a[1]);
  const perfect = a[0] >= a[1] ? " perfect" : "";
  return `<span class="ach-badge${perfect}" title="${a[0]} of ${a[1]} achievements (${pct}%)">${TROPHY}${a[0]}/${a[1]}</span>
      <span class="ach-line${perfect}"><i style="width:${pct}%"></i></span>`;
}

function cardHTML(g) {
  const art = wide()
    ? `<img loading="lazy" decoding="async" alt="" src="/art/${g.appid}/header">`
    : `<img loading="lazy" decoding="async" alt="" src="/art/${g.appid}/portrait" data-fallback="/art/${g.appid}/header">`;
  const fav = favs().has(g.appid);
  const name = esc(C.gname(g.name));
  const sub = subText(g);
  return `<button class="card${g.installed ? "" : " not-installed"}${fav ? " fav" : ""}" data-appid="${g.appid}" title="${esc(g.name)}">
    <div class="art" data-name="${name}">${art}
      ${fav ? `<span class="star" title="Favorite">${STAR}</span>` : ""}
      ${g.update_pending && g.installed && !g.download ? `<span class="badge upd" data-update="${g.appid}" title="Update now">${ICON.down}Update</span>` : g.download ? `<span class="badge${g.download.state === "paused" ? " muted" : ""}">${g.download.state === "paused" ? "Paused" : g.installed ? "Updating" : "Downloading"}</span>` : g.update_pending ? '<span class="badge">Update</span>' : ""}
      ${g.installed ? "" : '<span class="badge muted">Not installed</span>'}
      ${achHTML(g)}
      <span class="play" data-play="${g.appid}" title="${g.installed ? "Play" : "Install"}">${g.installed ? ICON.play : ICON.down}</span>
    </div>
    <div class="meta"><span class="name">${name}</span>${sub ? `
      <span class="sub">${esc(sub)}</span>` : ""}</div>
  </button>`;
}

const STAR = '<svg viewBox="0 0 24 24" class="fill"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';

function tileHTML(g) {
  return `<button class="tile" data-appid="${g.appid}" title="${esc(g.name)}">
    <img loading="lazy" alt="" src="/art/${g.appid}/header" data-fail="hide">
    <span class="shade"></span>
    <span class="t-meta"><span class="t-name">${esc(C.gname(g.name))}</span>
      <span class="t-sub">${C.fmtAgo(g.lastplayed)} · ${C.fmtPlay(g.playtime)}</span></span>
  </button>`;
}

// ---------- library layouts ----------
// Each layout is one entry here: a button in the view switcher, a class for #grid, and a
// render function. Add a format by adding an entry.
const V = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const LAYOUTS = {
  grid: { label: "Covers", icon: V('<rect x="4" y="4" width="6" height="9" rx="1"/><rect x="14" y="4" width="6" height="9" rx="1"/><path d="M4 17h6M14 17h6M4 20h4M14 20h4"/>'),
    cls: "grid", item: (g) => cardHTML(g) },
  wide: { label: "Banners", icon: V('<rect x="3" y="5" width="8" height="5" rx="1"/><rect x="13" y="5" width="8" height="5" rx="1"/><rect x="3" y="14" width="8" height="5" rx="1"/><rect x="13" y="14" width="8" height="5" rx="1"/>'),
    cls: "grid wide", item: (g) => cardHTML(g) },
  tiles: { label: "Tiles", icon: V('<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/>'),
    cls: "grid tiles", item: tileCardHTML },
  list: { label: "List", icon: V('<path d="M9 6h11M9 12h11M9 18h11"/><rect x="3" y="4.5" width="3" height="3" rx=".5"/><rect x="3" y="10.5" width="3" height="3" rx=".5"/><rect x="3" y="16.5" width="3" height="3" rx=".5"/>'),
    cls: "lib-list", item: listRow, head: listHead, noZoom: true },
  shelves: { label: "Shelves", icon: V('<path d="M3 8h18M3 16h18"/><rect x="4" y="3" width="3" height="5"/><rect x="9" y="4" width="3" height="4"/><rect x="5" y="11" width="3" height="5"/><rect x="10" y="12" width="3" height="4"/><rect x="15" y="11" width="3" height="5"/>'),
    cls: "shelves", render: shelvesHTML },
};

function layoutId() {
  const v = C.style ? C.style.get().libView : "";
  return LAYOUTS[v] ? v : (C.style && C.style.get().covers === "wide" ? "wide" : "grid");
}

function tileCardHTML(g) {
  const fav = favs().has(g.appid);
  const sub = subText(g);
  return `<button class="card tilecard${g.installed ? "" : " not-installed"}${fav ? " fav" : ""}" data-appid="${g.appid}" title="${esc(g.name)}">
    <div class="art" data-name="${esc(C.gname(g.name))}"><img loading="lazy" decoding="async" alt="" src="/art/${g.appid}/header">
      <span class="shade"></span>
      ${fav ? `<span class="star" title="Favorite">${STAR}</span>` : ""}
      ${g.update_pending && g.installed && !g.download ? `<span class="badge upd" data-update="${g.appid}" title="Update now">${ICON.down}Update</span>` : g.installed ? "" : '<span class="badge muted">Not installed</span>'}
      ${achHTML(g)}
      <span class="t-meta"><span class="t-name">${esc(C.gname(g.name))}</span>${sub ? `<span class="t-sub">${esc(sub)}</span>` : ""}</span>
      <span class="play" data-play="${g.appid}" title="${g.installed ? "Play" : "Install"}">${g.installed ? ICON.play : ICON.down}</span>
    </div>
  </button>`;
}

const COLS = [["name", "Name"], ["playtime", "Play time"], ["recent", "Last played"], ["ach", "Achievements"], ["size", "Size"]];
function listHead() {
  const sort = S.config.sort || "recent";
  return `<div class="lrow lhead"><span></span>${COLS.map(([k, l]) =>
    `<button class="lcol-${k}${sort === k ? " on" : ""}" data-sortcol="${k}">${l}${sort === k ? " ▾" : ""}</button>`).join("")}<span></span></div>`;
}
function listRow(g) {
  {
    const a = (L.ach || {})[g.appid];
    const pct = a ? Math.round((100 * a[0]) / a[1]) : 0;
    const fav = favs().has(g.appid);
    const tags = [fav ? `<span class="ltag fav">${STAR}</span>` : "",
      g.update_pending && g.installed && !g.download ? `<span class="ltag upd" data-update="${g.appid}" title="Update now">Update</span>` : "",
      g.download ? `<span class="ltag">${g.download.state === "paused" ? "Paused" : "Updating"}</span>` : "",
      !g.installed ? '<span class="ltag dim">Not installed</span>' : "", g.shortcut ? '<span class="ltag dim">Non-Steam</span>' : ""].join("");
    return `<div class="lrow${g.installed ? "" : " not-installed"}" data-appid="${g.appid}" tabindex="0" title="${esc(g.name)}">
      <img loading="lazy" alt="" src="/art/${g.appid}/header" data-fail="hide">
      <span class="lcol-name"><span class="name">${esc(C.gname(g.name))}</span>${tags}</span>
      <span class="lcol-playtime">${g.playtime ? C.fmtPlay(g.playtime) : "—"}</span>
      <span class="lcol-recent">${g.lastplayed ? C.fmtAgo(g.lastplayed) : "Never"}</span>
      <span class="lcol-ach">${a ? `<span class="bar${a[0] >= a[1] ? " gold" : ""}"><i style="width:${pct}%"></i></span><small>${a[0]}/${a[1]}</small>` : g.shortcut ? "" : "<small>—</small>"}</span>
      <span class="lcol-size">${g.size ? C.fmtSize(g.size) : "—"}</span>
      <span class="lcol-act"><span class="lplay" data-play="${g.appid}" title="${g.installed ? "Play" : "Install"}">${g.installed ? ICON.play : ICON.down}</span></span>
    </div>`;
  }
}

function shelvesHTML(list) {
  const fav = favs();
  const month = Date.now() / 1000 - 30 * 86400;
  const shelves = [
    ["Favorites", list.filter((g) => fav.has(g.appid))],
    ["Updates ready", list.filter((g) => g.installed && g.update_pending)],
    ["Continue playing", list.filter((g) => g.installed && g.lastplayed > month).sort(SORTS.recent)],
    ["Installed", list.filter((g) => g.installed)],
    ["Haven't played yet", list.filter((g) => g.installed && !g.playtime)],
    ["Most played", list.filter((g) => g.playtime > 60).sort(SORTS.playtime)],
    ["Not installed", list.filter((g) => !g.installed)],
  ].filter(([, gs]) => gs.length);
  return shelves.map(([title, gs]) => `<section class="shelf">
      <h3>${title} <span class="count">${gs.length}</span></h3>
      <div class="shelf-row">${gs.slice(0, 60).map((g) => cardHTML(g)).join("")}</div>
    </section>`).join("");
}

function renderViews() {
  const cur = layoutId();
  const box = $("#lib-views");
  if (!box) return;
  if (!box.children.length) {
    box.innerHTML = Object.entries(LAYOUTS).map(([id, l]) =>
      `<button data-view="${id}" title="${l.label}">${l.icon}<span>${l.label}</span></button>`).join("");
  }
  $$("#lib-views [data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === cur));
  $("#lib-zoom-wrap").hidden = !!LAYOUTS[cur].noZoom;
}

// Cards are kept per game and only rebuilt when their markup changes, so searching,
// filtering and small updates don't recreate (and re-fade) hundreds of covers.
const pool = new Map();  // appid -> {html, el}
let poolLayout = "";
const tpl = document.createElement("template");

function patchGrid(grid, lay, layId, list) {
  if (poolLayout !== layId) { pool.clear(); poolLayout = layId; grid.textContent = ""; }
  const els = new Array(list.length);
  const fresh = [];
  list.forEach((g, i) => {
    const html = lay.item(g);
    const p = pool.get(g.appid);
    if (p && p.html === html) els[i] = p.el;
    else fresh.push([i, g.appid, html]);
  });
  if (fresh.length) {
    tpl.innerHTML = fresh.map((f) => f[2]).join("");
    const nodes = Array.from(tpl.content.children);
    fresh.forEach(([i, appid, html], k) => {
      const el = nodes[k];
      C.markLoaded(el);
      pool.set(appid, { html, el });
      els[i] = el;
    });
  }
  if (lay.head) {
    tpl.innerHTML = lay.head();
    els.unshift(tpl.content.firstElementChild);
  }
  const kids = grid.children;
  if (kids.length === els.length && els.every((el, i) => kids[i] === el)) return;  // nothing moved
  grid.replaceChildren(...els);
}

function render() {
  favMemo = new Set(S.config.favorites || []);
  try { renderNow(); } finally { favMemo = null; }
}

function renderNow() {
  const list = visible();
  const layId = layoutId();
  const lay = LAYOUTS[layId];
  const grid = $("#grid");
  if (grid.className !== lay.cls) grid.className = lay.cls;
  if (lay.item) patchGrid(grid, lay, layId, list);
  else { poolLayout = ""; pool.clear(); grid.innerHTML = lay.render(list); C.markLoaded(grid); }
  renderViews();
  $("#count").textContent = list.length === S.games.length ? S.games.length : `${list.length} of ${S.games.length}`;
  $("#chip-installed").hidden = !S.games.some((g) => !g.installed);
  $("#chip-favorites").hidden = !(S.config.favorites || []).length;
  $("#chip-hidden").hidden = !(S.config.hidden || []).length;
  if ((L.filter === "favorites" && $("#chip-favorites").hidden) || (L.filter === "hidden" && $("#chip-hidden").hidden)) {
    L.filter = "all";
    $$("#filters button").forEach((x) => x.classList.toggle("on", x.dataset.filter === "all"));
    return renderNow();
  }

  const hid = hiddenSet();
  const recent = S.games.filter((g) => g.lastplayed && g.installed && !hid.has(g.appid)).sort(SORTS.recent).slice(0, 6);
  const showRecent = !L.q && L.filter === "all" && recent.length > 0 && layoutId() !== "shelves";
  $("#recent").hidden = !showRecent;
  if (showRecent) {
    const html = recent.map(tileHTML).join("");
    const row = $("#recent-row");
    if (row._html !== html) { row.innerHTML = html; row._html = html; C.markLoaded(row); }
  }

  const empty = $("#empty");
  if (list.length) { empty.hidden = true; return; }
  empty.hidden = false;
  if (!S.steam.found) empty.innerHTML = "<strong>Steam wasn't found</strong>Set the Steam folder in config.json, or reinstall Steam.";
  else if (!S.games.length) empty.innerHTML = "<strong>No installed games yet</strong>Install something in Steam and press F5.";
  else if (L.filter === "favorites") empty.innerHTML = "<strong>No favorites yet</strong>Right-click a game and choose Favorite.";
  else if (C.lists && C.lists.active()) empty.innerHTML = C.lists.active().dynamic
    ? "<strong>This is an automatic Steam collection</strong>Its games are picked by filters that only Steam can apply. Open it in Steam to see them."
    : "<strong>This list is empty</strong>Right-click any game and choose Add to list.";
  else empty.innerHTML = `<strong>Nothing matches “${esc(L.q)}”</strong>Try a different search or filter.`;
}

let lastJSON = "", lastRaw = "";
function setGames(games, json) {
  if (json === lastJSON) return false;  // nothing changed: skip the re-render
  lastJSON = json;
  S.games = games;
  if (C.route.tab === "library") render();
  C.style && C.style.refreshArt();
  C.activity && C.activity.renderBadge();
  if (L.current) { const g = games.find((x) => x.appid === L.current.appid); if (g) { L.current = g; paintUpdate(g); } }
  return true;
}

/** Paint instantly from the last session's library, before Steam's files are read. */
function paintCached() {
  if (lastJSON) return;  // the live library already arrived
  try {
    const json = localStorage.getItem("cinder.library");
    if (json) setGames(JSON.parse(json), json);
  } catch { /* no cache */ }
}

async function load(quiet = false, soft = false) {
  try {
    const res = await fetch("/api/library" + (soft ? "?soft=1" : ""), { headers: { "X-Cinder-Token": window.CINDER_TOKEN } });
    const json = await res.text();
    const data = JSON.parse(json);
    if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
    if (json !== lastRaw) {  // unchanged responses skip parsing work, re-rendering and saving
      lastRaw = json;
      const games = JSON.stringify(data.games);
      if (setGames(data.games, games)) {
        try { localStorage.setItem("cinder.library", games); } catch { /* full or blocked */ }
      }
    }
    if (!quiet) C.toast(`${data.games.length} games`);
  } catch (e) { C.toast(e.message, true); }
}

C.launch = async (appid) => {
  const g = S.games.find((x) => x.appid === appid);
  if (g && !g.installed) {
    if (await C.act("install", { appid })) C.toast(`Steam will ask where to install ${g.name}`);
    return;
  }
  const card = $(`.card[data-appid="${appid}"]`);
  if (card) { card.classList.remove("launching"); void card.offsetWidth; card.classList.add("launching"); }
  if (await C.act("launch", { appid })) {
    C.toast(`Launching ${g ? g.name : appid}…`);
    setTimeout(C.refreshStatus, 3000);
  }
};

// ---------- game page ----------
function openDetail(appid) {
  const g = S.games.find((x) => x.appid === appid);
  if (!g) return;
  L.current = g;
  $("#d-hero").style.visibility = "";
  $("#d-hero").src = `/art/${g.appid}/hero`;
  $(".d-title").classList.remove("no-logo");
  $("#d-logo").style.visibility = "";
  $("#d-logo").src = `/art/${g.appid}/logo`;
  $("#d-name").textContent = C.gname(g.name);
  $("#d-playtime").textContent = C.fmtPlay(g.playtime);
  $("#d-last").textContent = C.fmtAgo(g.lastplayed);
  $("#d-size").textContent = C.fmtSize(g.size);
  $("#d-appid").textContent = g.appid;
  $("#d-path").textContent = g.installdir;
  $("#d-play").innerHTML = g.installed ? `${ICON.play}Play` : `${ICON.down}Install`;
  paintUpdate(g);
  $("#d-folder").hidden = $("#d-uninstall").hidden = $("#d-props").hidden = !g.installed;
  renderDetailToggles(g.appid);
  if (g.shortcut) { $("#d-size").textContent = "—"; $("#d-path").textContent = g.exe || g.installdir; }
  C.gamepage.open(g);
  $("#detail").hidden = false;
  $("#d-play").focus();
}

// ---------- favorites, hidden ----------
function toggleList(key, appid) {
  const set = new Set(S.config[key] || []);
  const on = !set.has(appid);
  if (on) set.add(appid); else set.delete(appid);
  S.config[key] = [...set];
  C.saveConfig({ [key]: S.config[key] });
  render();
  if (L.current && L.current.appid === appid) renderDetailToggles(appid);
  const g = S.games.find((x) => x.appid === appid);
  const name = g ? g.name : "Game";
  C.toast(key === "favorites" ? (on ? `${name} added to favorites` : `${name} removed from favorites`)
    : (on ? `${name} hidden (see it under Hidden)` : `${name} is back in your library`));
}

function renderDetailToggles(appid) {
  const fav = favs().has(appid), hid = hiddenSet().has(appid);
  $("#d-fav").innerHTML = `${STAR}${fav ? "Favorited" : "Favorite"}`;
  $("#d-fav").classList.toggle("on", fav);
  $("#d-hide").textContent = hid ? "Unhide" : "Hide";
}

// ---------- random pick ----------
function pickRandom() {
  const hid = hiddenSet();
  let pool = S.games.filter((g) => g.installed && !hid.has(g.appid));
  const unplayed = pool.filter((g) => !g.playtime);
  if (unplayed.length && Math.random() < 0.4) pool = unplayed;  // nudge toward the backlog
  if (!pool.length) return C.toast("Install a game first", true);
  const g = pool[Math.floor(Math.random() * pool.length)];
  openDetail(g.appid);
  C.toast(g.playtime ? `How about ${g.name}?` : `How about ${g.name}? You haven't played it yet`);
}

// ---------- updates ----------
async function updateOne(appid) {
  const g = S.games.find((x) => x.appid === appid);
  const ok = await C.updateGames([appid], g ? C.gname(g.name) : "the update");
  if (ok && g && !g.download) {
    g.download = { state: "queued" };
    render();
    if (L.current && L.current.appid === appid) paintUpdate(g);
  }
}

function paintUpdate(g) {
  const b = $("#d-update");
  b.hidden = !(g.installed && g.update_pending && !g.shortcut);
  b.disabled = !!g.download;
  b.innerHTML = `${ICON.down}${g.download ? "Updating…" : "Update"}`;
}

// ---------- right-click menu ----------
function cardMenu(e, appid) {
  const g = S.games.find((x) => x.appid === appid);
  if (!g) return;
  e.preventDefault();
  const fav = favs().has(appid), hid = hiddenSet().has(appid);
  const m = $("#card-menu");
  m.innerHTML = `
    <button data-cm="play">${g.installed ? ICON.play + "Play" : ICON.down + "Install"}</button>
    ${g.installed && g.update_pending && !g.shortcut ? `<button data-cm="update">${ICON.down}Update now</button>` : ""}
    <button data-cm="fav">${STAR}${fav ? "Remove from favorites" : "Favorite"}</button>
    <button data-cm="hide">${hid ? "Unhide" : "Hide from library"}</button>
    <button data-cm="list">Add to list…</button>
    <hr>
    <button data-cm="details">Details</button>
    ${g.shortcut ? "" : '<button data-cm="workshop">Workshop</button>'}
    ${g.shortcut ? '<button data-cm="folder">Open folder</button>' : `<button data-cm="store">Store page</button>
    ${g.installed ? '<button data-cm="folder">Open install folder</button><button data-cm="props">Steam properties</button>' : ""}`}`;
  m.dataset.appid = appid;
  m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.min(e.clientX, innerWidth - w - 8)}px`;
  m.style.top = `${Math.min(e.clientY, innerHeight - h - 8)}px`;
}

function bind() {
  const onContext = (e) => {
    const card = e.target.closest("[data-appid]");
    if (card) cardMenu(e, +card.dataset.appid);
  };
  $("#grid").addEventListener("contextmenu", onContext);
  $("#recent-row").addEventListener("contextmenu", onContext);
  $("#card-menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cm]");
    if (!b) return;
    const id = +$("#card-menu").dataset.appid;
    $("#card-menu").hidden = true;
    ({
      play: () => C.launch(id),
      update: () => updateOne(id),
      fav: () => toggleList("favorites", id),
      list: () => { const r = $("#card-menu").getBoundingClientRect(); C.lists.picker(id, r.left, r.top); },
      hide: () => toggleList("hidden", id),
      details: () => openDetail(id),
      workshop: () => C.go(`workshop/${id}`),
      store: () => C.go(`store/app/${id}`),
      folder: () => C.act("folder", { appid: id }),
      props: () => C.act("properties", { appid: id }),
    })[b.dataset.cm]();
  });
  const closeMenu = (e) => { if (!e.target.closest("#card-menu")) $("#card-menu").hidden = true; };
  document.addEventListener("mousedown", closeMenu);
  document.addEventListener("wheel", () => ($("#card-menu").hidden = true), { passive: true });
  $("#d-fav").addEventListener("click", () => toggleList("favorites", L.current.appid));
  $("#d-hide").addEventListener("click", () => toggleList("hidden", L.current.appid));
  $("#btn-random").addEventListener("click", pickRandom);
  $("#d-lists").addEventListener("click", (e) => {
    const r = e.target.getBoundingClientRect();
    C.lists.picker(L.current.appid, r.left, r.bottom + 6);
  });

  const onCard = (e) => {
    const upd = e.target.closest("[data-update]");
    if (upd) { e.stopPropagation(); return updateOne(+upd.dataset.update); }
    const play = e.target.closest("[data-play]");
    if (play) { e.stopPropagation(); return C.launch(+play.dataset.play); }
    const card = e.target.closest("[data-appid]");
    if (card) openDetail(+card.dataset.appid);
  };
  $("#grid").addEventListener("click", onCard);
  $("#recent-row").addEventListener("click", onCard);
  $("#grid").addEventListener("dblclick", (e) => {
    const card = e.target.closest("[data-appid]");
    if (card) { C.closeOverlays(); C.launch(+card.dataset.appid); }
  });
  $("#lib-views").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) C.style.set("libView", b.dataset.view);
  });
  const zoom = $("#lib-zoom");
  zoom.value = S.config.card_size || 180;
  zoom.addEventListener("input", () => {
    document.documentElement.style.setProperty("--card-w", `${zoom.value}px`);
    if ($("#set-size")) $("#set-size").value = zoom.value;
  });
  zoom.addEventListener("change", () => { S.config.card_size = +zoom.value; C.saveConfig({ card_size: +zoom.value }); });
  $("#grid").addEventListener("click", (e) => {
    const col = e.target.closest("[data-sortcol]");
    if (!col) return;
    e.stopPropagation();
    S.config.sort = col.dataset.sortcol;
    $("#sort").value = S.config.sort;
    if (S.config.sort === "ach") ensureAch();
    render();
    C.saveConfig({ sort: S.config.sort });
  }, true);
  $("#grid").addEventListener("keydown", (e) => {
    const r = e.target.closest(".lrow[data-appid]");
    if (r && e.key === "Enter") openDetail(+r.dataset.appid);
  });
  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    L.filter = b.dataset.filter;
    $$("#filters button").forEach((x) => x.classList.toggle("on", x === b));
    render();
  });
  $("#sort").addEventListener("change", (e) => {
    S.config.sort = e.target.value;
    if (e.target.value === "ach") ensureAch();
    render();
    C.saveConfig({ sort: e.target.value });
  });
  $("#d-update").addEventListener("click", () => updateOne(L.current.appid));
  $("#d-play").addEventListener("click", () => { const id = L.current.appid; C.closeOverlays(); C.launch(id); });
  $("#d-folder").addEventListener("click", () => C.act("folder", { appid: L.current.appid }));
  $("#d-props").addEventListener("click", () => C.act("properties", { appid: L.current.appid }));
  $("#d-store").addEventListener("click", () => { const id = L.current.appid; C.closeOverlays(); C.go(`store/app/${id}`); });
  $("#d-uninstall").addEventListener("click", () => {
    C.act("uninstall", { appid: L.current.appid }).then((ok) => ok && C.toast("Steam will ask you to confirm the uninstall"));
  });
}

C.library = { updateOne, load, render, paintCached, openDetail, sorts: SORTS, visible, ensureAch };
C.views.library = {
  placeholder: "Search your library",
  show() { render(); },
  searchValue: () => L.q,
  search(q, enter) {
    L.q = q.trim();
    clearTimeout(L.searchTimer);
    if (enter) { render(); const first = visible()[0]; if (first) C.launch(first.appid); return; }
    L.searchTimer = setTimeout(render, S.games.length > 300 ? 120 : 30);
  },
  refresh() { return load(); },
  init: bind,
};
})();
