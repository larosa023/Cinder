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
};

function visible() {
  let g = S.games;
  if (L.filter === "installed") g = g.filter((x) => x.installed);
  else if (L.filter === "played") g = g.filter((x) => x.playtime > 0);
  else if (L.filter === "unplayed") g = g.filter((x) => !x.playtime);
  else if (L.filter === "updates") g = g.filter((x) => x.update_pending);
  if (L.q) {
    const q = L.q.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    g = g.filter((x) => String(x.appid) === q || words.every((w) => x.name.toLowerCase().includes(w)));
  }
  return [...g].sort(SORTS[S.config.sort] || SORTS.recent);
}

const wide = () => C.style && C.style.get().covers === "wide";

function cardHTML(g) {
  const art = wide()
    ? `<img loading="lazy" decoding="async" alt="" src="/art/${g.appid}/header">`
    : `<img loading="lazy" decoding="async" alt="" src="/art/${g.appid}/portrait" data-fallback="/art/${g.appid}/header">`;
  return `<button class="card${g.installed ? "" : " not-installed"}" data-appid="${g.appid}" title="${esc(g.name)}">
    <div class="art" data-name="${esc(g.name)}">${art}
      ${g.update_pending ? '<span class="badge">Update</span>' : ""}
      ${g.installed ? "" : '<span class="badge muted">Not installed</span>'}
      <span class="play" data-play="${g.appid}" title="${g.installed ? "Play" : "Install"}">${g.installed ? ICON.play : ICON.down}</span>
    </div>
    <div class="meta"><span class="name">${esc(g.name)}</span>
      <span class="sub">${g.playtime ? C.fmtPlay(g.playtime) + " played" : "Not played yet"}</span></div>
  </button>`;
}

function tileHTML(g) {
  return `<button class="tile" data-appid="${g.appid}" title="${esc(g.name)}">
    <img loading="lazy" alt="" src="/art/${g.appid}/header" data-fail="hide">
    <span class="shade"></span>
    <span class="t-meta"><span class="t-name">${esc(g.name)}</span>
      <span class="t-sub">${C.fmtAgo(g.lastplayed)} · ${C.fmtPlay(g.playtime)}</span></span>
  </button>`;
}

function render() {
  const list = visible();
  $("#grid").innerHTML = list.map(cardHTML).join("");
  $("#grid").classList.toggle("wide", wide());
  $("#count").textContent = list.length === S.games.length ? S.games.length : `${list.length} of ${S.games.length}`;
  $("#chip-installed").hidden = !S.games.some((g) => !g.installed);

  const recent = S.games.filter((g) => g.lastplayed && g.installed).sort(SORTS.recent).slice(0, 6);
  const showRecent = !L.q && L.filter === "all" && recent.length > 0;
  $("#recent").hidden = !showRecent;
  if (showRecent) $("#recent-row").innerHTML = recent.map(tileHTML).join("");

  const empty = $("#empty");
  if (list.length) { empty.hidden = true; return; }
  empty.hidden = false;
  if (!S.steam.found) empty.innerHTML = "<strong>Steam wasn't found</strong>Set the Steam folder in config.json, or reinstall Steam.";
  else if (!S.games.length) empty.innerHTML = "<strong>No installed games yet</strong>Install something in Steam and press F5.";
  else empty.innerHTML = `<strong>Nothing matches “${esc(L.q)}”</strong>Try a different search or filter.`;
}

async function load(quiet = false) {
  try {
    const { games } = await C.api("/api/library");
    S.games = games;
    render();
    C.style && C.style.refreshArt();
    if (!quiet) C.toast(`${games.length} games`);
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
  $("#d-name").textContent = g.name;
  $("#d-playtime").textContent = C.fmtPlay(g.playtime);
  $("#d-last").textContent = C.fmtAgo(g.lastplayed);
  $("#d-size").textContent = C.fmtSize(g.size);
  $("#d-appid").textContent = g.appid;
  $("#d-path").textContent = g.installdir;
  $("#d-play").innerHTML = g.installed ? `${ICON.play}${g.update_pending ? "Update & Play" : "Play"}` : `${ICON.down}Install`;
  $("#d-folder").hidden = $("#d-uninstall").hidden = $("#d-props").hidden = !g.installed;
  $("#detail").hidden = false;
  $("#d-play").focus();
}

function bind() {
  const onCard = (e) => {
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
  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    L.filter = b.dataset.filter;
    $$("#filters button").forEach((x) => x.classList.toggle("on", x === b));
    render();
  });
  $("#sort").addEventListener("change", (e) => {
    S.config.sort = e.target.value;
    render();
    C.saveConfig({ sort: e.target.value });
  });
  $("#d-play").addEventListener("click", () => { const id = L.current.appid; C.closeOverlays(); C.launch(id); });
  $("#d-folder").addEventListener("click", () => C.act("folder", { appid: L.current.appid }));
  $("#d-props").addEventListener("click", () => C.act("properties", { appid: L.current.appid }));
  $("#d-store").addEventListener("click", () => { const id = L.current.appid; C.closeOverlays(); C.go(`store/app/${id}`); });
  $("#d-uninstall").addEventListener("click", () => {
    C.act("uninstall", { appid: L.current.appid }).then((ok) => ok && C.toast("Steam will ask you to confirm the uninstall"));
  });
}

C.library = { load, render, openDetail, sorts: SORTS };
C.views.library = {
  placeholder: "Search your library",
  show() { render(); },
  search(q, enter) {
    L.q = q.trim();
    render();
    if (enter) { const first = visible()[0]; if (first) C.launch(first.appid); }
  },
  refresh() { return load(); },
  init: bind,
};
})();
