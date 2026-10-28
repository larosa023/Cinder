(() => {
"use strict";

const TOKEN = window.CINDER_TOKEN;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = { games: [], config: {}, themes: [], user: null, steam: {}, q: "", filter: "all", current: null };

async function api(path, body) {
  const opts = { method: body === undefined ? "GET" : "POST", headers: { "X-Cinder-Token": TOKEN } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || r.statusText);
  return data;
}

// ---------- formatting ----------
const fmtPlay = (m) => !m ? "Never" : m < 60 ? `${m} min` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} hrs`;
function fmtAgo(ts) {
  if (!ts) return "Never";
  const s = Date.now() / 1000 - ts;
  if (s < 90) return "Just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 86400 * 2) return "Yesterday";
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtSize(b) {
  if (!b) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < 4) { b /= 1024; i++; }
  return `${b.toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
}
const sortKey = (n) => n.toLowerCase().replace(/^(the|a|an)\s+/, "");

let toastTimer;
function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (err ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2600);
}

// ---------- theming ----------
function applyTheme(id) {
  $("#theme-css").href = `/themes/${encodeURIComponent(id)}.css?v=${Date.now()}`;
  $$(".theme").forEach((b) => b.classList.toggle("on", b.dataset.theme === id));
}
function applySize(px) { document.documentElement.style.setProperty("--card-w", `${px}px`); }

// ---------- library ----------
const SORTS = {
  recent: (a, b) => (b.lastplayed - a.lastplayed) || sortKey(a.name).localeCompare(sortKey(b.name)),
  name: (a, b) => sortKey(a.name).localeCompare(sortKey(b.name)),
  playtime: (a, b) => (b.playtime - a.playtime) || sortKey(a.name).localeCompare(sortKey(b.name)),
  size: (a, b) => b.size - a.size,
  updated: (a, b) => b.lastupdated - a.lastupdated,
};

function visible() {
  let g = S.games;
  if (S.filter === "played") g = g.filter((x) => x.playtime > 0);
  else if (S.filter === "unplayed") g = g.filter((x) => !x.playtime);
  else if (S.filter === "updates") g = g.filter((x) => x.update_pending);
  if (S.q) {
    const q = S.q.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    g = g.filter((x) => {
      const n = x.name.toLowerCase();
      return String(x.appid) === q || words.every((w) => n.includes(w));
    });
  }
  return [...g].sort(SORTS[S.config.sort] || SORTS.recent);
}

const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>';

function cardHTML(g) {
  return `<button class="card" data-appid="${g.appid}" title="${esc(g.name)}">
    <div class="art" data-name="${esc(g.name)}">
      <img loading="lazy" decoding="async" alt="" src="/art/${g.appid}/portrait" data-fallback="/art/${g.appid}/header">
      ${g.update_pending ? '<span class="badge">Update</span>' : ""}
      <span class="play" data-play="${g.appid}" title="Play">${PLAY_SVG}</span>
    </div>
    <div class="meta"><span class="name">${esc(g.name)}</span>
      <span class="sub">${g.playtime ? fmtPlay(g.playtime) + " played" : "Not played yet"}</span></div>
  </button>`;
}

function tileHTML(g) {
  return `<button class="tile" data-appid="${g.appid}" title="${esc(g.name)}">
    <img loading="lazy" alt="" src="/art/${g.appid}/header" data-fail="hide">
    <span class="shade"></span>
    <span class="t-meta"><span class="t-name">${esc(g.name)}</span>
      <span class="t-sub">${fmtAgo(g.lastplayed)} · ${fmtPlay(g.playtime)}</span></span>
  </button>`;
}

function render() {
  const list = visible();
  $("#grid").innerHTML = list.map(cardHTML).join("");
  $("#count").textContent = list.length === S.games.length ? S.games.length : `${list.length} of ${S.games.length}`;

  const recent = S.games.filter((g) => g.lastplayed).sort(SORTS.recent).slice(0, 6);
  const showRecent = !S.q && S.filter === "all" && recent.length > 0;
  $("#recent").hidden = !showRecent;
  if (showRecent) $("#recent-row").innerHTML = recent.map(tileHTML).join("");

  const empty = $("#empty");
  if (list.length) { empty.hidden = true; return; }
  empty.hidden = false;
  if (!S.steam.found) {
    empty.innerHTML = "<strong>Steam wasn't found</strong>Set the Steam folder in config.json, or reinstall Steam.";
  } else if (!S.games.length) {
    empty.innerHTML = "<strong>No installed games yet</strong>Install something in Steam and press F5.";
  } else {
    empty.innerHTML = `<strong>Nothing matches “${esc(S.q)}”</strong>Try a different search or filter.`;
  }
}

async function loadLibrary(quiet = false) {
  try {
    const { games } = await api("/api/library");
    S.games = games;
    render();
    if (S.current) {
      const g = games.find((x) => x.appid === S.current.appid);
      if (g) S.current = g;
    }
    if (!quiet) toast(`${games.length} games`);
  } catch (e) { toast(e.message, true); }
}

// ---------- actions ----------
async function act(action, appid, extra = {}) {
  try {
    await api("/api/action", { action, appid, ...extra });
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

async function launch(appid) {
  const g = S.games.find((x) => x.appid === appid);
  const card = $(`.card[data-appid="${appid}"]`);
  if (card) { card.classList.remove("launching"); void card.offsetWidth; card.classList.add("launching"); }
  if (await act("launch", appid)) {
    toast(`Launching ${g ? g.name : appid}…`);
    setTimeout(refreshStatus, 3000);
  }
}

// ---------- detail ----------
function openDetail(appid) {
  const g = S.games.find((x) => x.appid === appid);
  if (!g) return;
  S.current = g;
  const d = $("#detail");
  $("#d-hero").style.display = "";
  $("#d-hero").src = `/art/${g.appid}/hero`;
  $(".d-title").classList.remove("no-logo");
  $("#d-logo").src = `/art/${g.appid}/logo`;
  $("#d-name").textContent = g.name;
  $("#d-playtime").textContent = fmtPlay(g.playtime);
  $("#d-last").textContent = fmtAgo(g.lastplayed);
  $("#d-size").textContent = fmtSize(g.size);
  $("#d-appid").textContent = g.appid;
  $("#d-path").textContent = g.installdir;
  $("#d-play").innerHTML = `${PLAY_SVG}${g.update_pending ? "Update & Play" : "Play"}`;
  d.hidden = false;
  $("#d-play").focus();
}

function closeOverlays() {
  $$(".overlay").forEach((o) => (o.hidden = true));
  S.current = null;
}

// ---------- settings ----------
function renderThemes() {
  $("#themes").innerHTML = S.themes.map((t) => `
    <button class="theme" data-theme="${esc(t.id)}" title="${esc(t.author ? "by " + t.author : t.name)}">
      <div class="swatch">${(t.swatch.length ? t.swatch : ["#333", "#666"]).map((c) =>
        `<i style="background:${esc(c)}"></i>`).join("")}</div>
      <span>${esc(t.name)}</span>
    </button>`).join("");
  $$(".theme").forEach((b) => b.classList.toggle("on", b.dataset.theme === S.config.theme));
}

function renderSteam() {
  const s = S.steam;
  const dot = $("#steam-dot");
  dot.classList.toggle("on", !!s.running);
  dot.title = s.running ? "Steam is running" : "Steam is not running";
  $("#steam-info").textContent = !s.found ? "Steam folder not found"
    : `${s.running ? "Running" : "Not running"} · ${s.frozen ? "updates blocked" : "updates allowed"} · ${s.path}`;
  $("#set-freeze").checked = !!s.frozen;
}

function renderUser() {
  const u = S.user;
  $("#user-name").textContent = u ? u.name : "Not signed in";
  const av = $("#avatar");
  if (u && u.has_avatar) { av.style.backgroundImage = "url(/avatar)"; av.textContent = ""; }
  else { av.style.backgroundImage = ""; av.textContent = u ? u.name[0].toUpperCase() : "?"; }
}

async function saveConfig(changes) {
  try {
    const r = await api("/api/config", changes);
    S.config = r.config;
    if (r.steam) { S.steam = r.steam; renderSteam(); }
    if (r.message) toast(r.message);
  } catch (e) {
    toast(e.message, true);
    renderSteam();
  }
}

async function refreshStatus() {
  try {
    const { steam } = await api("/api/status");
    S.steam = steam;
    renderSteam();
  } catch { /* server gone */ }
}

// ---------- events ----------
function bind() {
  const search = $("#search");
  search.addEventListener("input", () => { S.q = search.value.trim(); render(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const first = visible()[0]; if (first) launch(first.appid); }
    if (e.key === "Escape") { search.value = ""; S.q = ""; render(); search.blur(); }
  });

  const onCardClick = (e) => {
    const play = e.target.closest("[data-play]");
    if (play) { e.stopPropagation(); return launch(+play.dataset.play); }
    const card = e.target.closest("[data-appid]");
    if (card) openDetail(+card.dataset.appid);
  };
  $("#grid").addEventListener("click", onCardClick);
  $("#recent-row").addEventListener("click", onCardClick);
  $("#grid").addEventListener("dblclick", (e) => {
    const card = e.target.closest("[data-appid]");
    if (card) { closeOverlays(); launch(+card.dataset.appid); }
  });

  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    S.filter = b.dataset.filter;
    $$("#filters button").forEach((x) => x.classList.toggle("on", x === b));
    render();
  });
  $("#sort").addEventListener("change", (e) => {
    S.config.sort = e.target.value;
    render();
    saveConfig({ sort: e.target.value });
  });

  $("#btn-refresh").addEventListener("click", () => loadLibrary());
  $("#btn-settings").addEventListener("click", () => { $("#settings").hidden = false; refreshStatus(); });
  $("#btn-user").addEventListener("click", () => act("steam_friends"));

  $$(".overlay").forEach((o) => o.addEventListener("click", (e) => {
    if (e.target === o || e.target.closest("[data-close]")) closeOverlays();
  }));

  $("#d-play").addEventListener("click", () => { const id = S.current.appid; closeOverlays(); launch(id); });
  $("#d-folder").addEventListener("click", () => act("folder", S.current.appid));
  $("#d-props").addEventListener("click", () => act("properties", S.current.appid));
  $("#d-store").addEventListener("click", () => act("store", S.current.appid));
  $("#d-uninstall").addEventListener("click", () => {
    act("uninstall", S.current.appid).then((ok) => ok && toast("Steam will ask you to confirm the uninstall"));
  });

  $("#themes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme]");
    if (!b) return;
    S.config.theme = b.dataset.theme;
    applyTheme(b.dataset.theme);
    saveConfig({ theme: b.dataset.theme });
  });
  $("#open-themes").addEventListener("click", () => act("themes_folder"));
  $("#set-freeze").addEventListener("change", (e) => saveConfig({ freeze_updates: e.target.checked }));
  $("#set-autostart").addEventListener("change", (e) => saveConfig({ autostart_steam: e.target.checked }));
  $("#set-frameless").addEventListener("change", (e) => saveConfig({ frameless: e.target.checked }));
  const size = $("#set-size");
  size.addEventListener("input", () => applySize(size.value));
  size.addEventListener("change", () => saveConfig({ card_size: +size.value }));
  $$("[data-act]").forEach((b) => b.addEventListener("click", async () => {
    if (await act(b.dataset.act)) { toast("Done"); setTimeout(refreshStatus, 2500); }
  }));

  document.addEventListener("keydown", (e) => {
    const typing = e.target.matches("input, select, textarea");
    if (e.key === "Escape") closeOverlays();
    else if (e.key === "F5") { e.preventDefault(); loadLibrary(); }
    else if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "f" && e.ctrlKey)) {
      e.preventDefault(); search.focus(); search.select();
    } else if (e.key === "," && e.ctrlKey) { $("#settings").hidden = false; }
  });

  // Image loading and fallbacks (error events don't bubble, so capture them).
  document.addEventListener("load", (e) => {
    if (e.target.tagName === "IMG") e.target.dataset.loaded = "1";
  }, true);
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG") return;
    if (img.dataset.fallback) {
      const fb = img.dataset.fallback;
      delete img.dataset.fallback;
      img.src = fb;
      return;
    }
    const fail = img.dataset.fail;
    if (fail === "hide") img.style.display = "none";
    else if (fail === "logo") img.closest(".d-title").classList.add("no-logo");
    else if (img.parentElement.classList.contains("art")) img.parentElement.classList.add("missing");
  }, true);

  window.addEventListener("focus", () => { loadLibrary(true); refreshStatus(); });
  setInterval(refreshStatus, 15000);

  // Native window controls (pywebview).
  const native = () => {
    document.body.classList.add("native");
    const w = window.pywebview.api;
    $("#win-min").onclick = () => w.minimize();
    $("#win-max").onclick = () => w.toggle_maximize();
    $("#win-close").onclick = () => w.close();
    $(".titlebar .drag").addEventListener("dblclick", () => w.toggle_maximize());
  };
  if (window.pywebview && window.pywebview.api) native();
  else window.addEventListener("pywebviewready", native);
}

async function init() {
  bind();
  try {
    const st = await api("/api/state");
    Object.assign(S, { config: st.config, themes: st.themes, user: st.user, steam: st.steam });
    $("#version").textContent = `v${st.version}`;
    applyTheme(S.config.theme);
    applySize(S.config.card_size);
    $("#sort").value = S.config.sort;
    $("#set-size").value = S.config.card_size;
    $("#set-autostart").checked = !!S.config.autostart_steam;
    $("#set-frameless").checked = !!S.config.frameless;
    renderThemes();
    renderUser();
    renderSteam();
  } catch (e) { toast(e.message, true); }
  await loadLibrary(true);
}

init();
})();
