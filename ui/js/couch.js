/* Couch mode: a full-screen, controller-first view with your games as retro game cases.

   Controller: D-pad / left stick move · A open · Y play · X favorite · LB/RB jump · B back
   (B on the shelves, or Start, leaves couch mode). Keyboard: arrows, Enter, Space, F, Esc.
   Everything moves with transforms only, and nothing runs while couch mode is closed
   (apart from a slow check for a controller's Start button to open it). */
(() => {
"use strict";
const { $, esc, S, ICON } = C;
const root = () => $("#couch");

const K = {
  open: false, rows: [], row: 0, col: [], sheet: null, sheetFocus: 0,
  raf: 0, prevButtons: [], hold: { dir: "", next: 0, count: 0 }, bgFront: 0, bgFor: 0, clock: 0, idle: 0,
};
// Looks you can switch between while in couch mode (View button, T, or the palette at the top).
const THEMES = [
  { id: "case", name: "Retro case", desc: "Game cases with a label band", sw: ["#16181d", "var(--accent)", "#f2f3f5"] },
  { id: "cart", name: "Cartridge", desc: "16-bit carts on a CRT", sw: ["#8d8f96", "#ffd34e", "#2b1b4d"] },
  { id: "modern", name: "Modern", desc: "Clean, rounded, glassy", sw: ["#ffffff", "#9aa4b8", "#1b1f29"] },
  { id: "neon", name: "Synthwave", desc: "Neon grid and chrome", sw: ["#ff2fd0", "#00e5ff", "#1a0633"] },
  { id: "vhs", name: "VHS", desc: "Rental tapes on a worn-out VCR", sw: ["#0d0d0f", "#f2e8c9", "#d6262f"] },
  { id: "pocket", name: "Pocket", desc: "Four shades of handheld green", sw: ["#0f380f", "#306230", "#9bbc0f"] },
  { id: "jewel", name: "Jewel case", desc: "CD cases, disc slides out", sw: ["#0c1424", "#c9d6ea", "#8f7cff"] },
  { id: "comic", name: "Comic", desc: "Halftone, ink and POW!", sw: ["#ffd400", "#e4202a", "#111111"] },
  { id: "blueprint", name: "Blueprint", desc: "Drafted on the drawing board", sw: ["#0b3a75", "#e8f1ff", "#7fb2ff"] },
  { id: "shelf", name: "Bookshelf", desc: "Wood shelves, warm lamp light", sw: ["#2a170c", "#a8703a", "#f3c77a"] },
];
const themeOf = () => (THEMES.some((t) => t.id === S.config.couch_theme) ? S.config.couch_theme : "case");
const CASE_W = () => Math.round(Math.min(window.innerWidth, window.innerHeight * 1.9) * 0.118);  // case width in px
const GAP = 26;

// ---------- data ----------
function buildRows() {
  const hid = new Set(S.config.hidden || []);
  const fav = new Set(S.config.favorites || []);
  const all = S.games.filter((g) => !hid.has(g.appid));
  const byName = (a, b) => C.sortKey(a.name).localeCompare(C.sortKey(b.name));
  const installed = all.filter((g) => g.installed);
  const rows = [
    ["Continue playing", installed.filter((g) => g.lastplayed).sort((a, b) => b.lastplayed - a.lastplayed).slice(0, 20)],
    ["Favorites", all.filter((g) => fav.has(g.appid)).sort(byName)],
    ["Playing", all.filter((g) => C.meta(g.appid).status === "playing")],
    ["All installed", [...installed].sort(byName)],
    ["Backlog", all.filter((g) => C.meta(g.appid).status === "backlog")],
    ["Your top rated", all.filter((g) => (C.meta(g.appid).rating || 0) >= 4).sort((a, b) => C.meta(b.appid).rating - C.meta(a.appid).rating)],
  ];
  for (const l of (C.lists.all ? C.lists.all() : []).slice(0, 8)) {
    const set = new Set(l.appids || []);
    rows.push([l.name, all.filter((g) => set.has(g.appid)).sort(byName)]);
  }
  rows.push(["Not installed", all.filter((g) => !g.installed).sort(byName)]);
  // Downloads & updates goes second, right after what you've been playing.
  const dl = all.filter((g) => g.download || (g.installed && g.update_pending && !g.shortcut));
  if (dl.length) rows.splice(1, 0, ["Downloads & updates", dl.sort((a, b) => (!!b.download - !!a.download) || byName(a, b))]);
  const out = rows.filter(([, gs]) => gs.length).map(([title, games]) => ({ title, games, kind: "game" }));
  // Shelves that come from Steam (filled in once they load).
  const x = K.extra || {};
  const at = Math.min(out.length, 3);
  const more = [];
  if (x.friends && x.friends.length) more.push({ title: "Friends online", games: x.friends, kind: "friend" });
  if (x.wish && x.wish.length) more.push({ title: "Your wishlist", games: x.wish, kind: "wish" });
  for (const sec of x.store || []) more.push({ title: `Store · ${sec.title}`, games: sec.items, kind: "store" });
  out.splice(at, 0, ...more);
  return out;
}

// Store, wishlist and friends shelves: fetched when couch mode opens, kept for a few minutes.
async function loadExtras() {
  if (K.extraAt && Date.now() - K.extraAt < 300000) return;
  K.extraAt = Date.now();
  const x = {};
  await Promise.all([
    C.api("/api/store/home").then((h) => {
      const want = { specials: "Deals", top_sellers: "Top sellers", new_releases: "New releases" };
      x.store = (h.sections || []).filter((s) => want[s.id]).map((s) => ({ title: want[s.id], items: s.items.slice(0, 20) }));
    }).catch(() => {}),
    C.api("/api/wishlist").then((w) => { x.wish = (w.items || []).slice().sort((a, b) => ((b.price && b.price.discount) || 0) - ((a.price && a.price.discount) || 0)); }).catch(() => {}),
    C.api("/api/friends").then((f) => { x.friends = (f.friends || []).filter((p) => p.state === "ingame" || p.state === "online").sort((a, b) => (a.state !== "ingame") - (b.state !== "ingame")); }).catch(() => {}),
  ]);
  if (!K.open) return;
  K.extra = x;
  // Rebuild the shelves, staying on the same game.
  const here = cur(), title = K.rows[K.row] && K.rows[K.row].title;
  K.rows = buildRows();
  K.col = K.rows.map((r) => (r.title === title && here ? Math.max(0, r.games.indexOf(r.games.find((g) => keyOf(g) === keyOf(here)))) : 0));
  K.row = Math.max(0, K.rows.findIndex((r) => r.title === title));
  renderRows();
}
const keyOf = (g) => g.steamid || g.appid;
const kindOf = () => (K.rows[K.row] || {}).kind || "game";

// ---------- markup ----------
function itemHTML(kind, g, i) {
  if (kind === "friend") {
    return `<div class="cc cc-friend${g.state === "ingame" ? " ig" : ""}" data-i="${i}" data-sid="${esc(g.steamid)}">
      <div class="cc-shell">
        <div class="cc-band"><span class="cc-logo">CINDER</span><span class="cc-pc">${g.state === "ingame" ? "PLAY" : "ON"}</span></div>
        <div class="cc-art" data-name="${esc(g.name)}"><img alt="" loading="lazy" src="${esc(g.avatar)}" data-fail="hide"></div>
        <div class="cc-spine"></div><div class="cc-gloss"></div>
        <span class="cc-tag ${g.state === "ingame" ? "ig" : "on"}">${esc(g.state === "ingame" ? (g.game || "In game") : g.status || "Online")}</span>
      </div>
      <div class="cc-name">${esc(g.name)}</div>
    </div>`;
  }
  if (kind === "store" || kind === "wish") {
    const p = g.price;
    const tag = !p ? "" : p.free ? "Free" : `${p.discount > 0 ? `-${p.discount}% · ` : ""}${C.money(p.final, p.currency)}`;
    const low = kind === "wish" && g.lows && g.lows.steam_low && p && !p.free && p.final <= g.lows.steam_low.cents;
    return `<div class="cc" data-i="${i}" data-appid="${g.appid}">
      <div class="cc-shell">
        <div class="cc-band"><span class="cc-logo">CINDER</span><span class="cc-pc">PC</span></div>
        <div class="cc-art" data-name="${esc(C.gname(g.name))}"><img alt="" loading="lazy" decoding="async" src="/art/${g.appid}/portrait" data-fallback="/art/${g.appid}/header"></div>
        <div class="cc-spine"></div><div class="cc-gloss"></div>
        ${tag ? `<span class="cc-tag${p && p.discount > 0 ? " sale" : ""}">${esc(tag)}</span>` : ""}
        ${low ? '<span class="cc-tag low">Lowest ever</span>' : kind === "wish" && g.target ? '<span class="cc-tag low">🔔</span>' : ""}
      </div>
      <div class="cc-name">${esc(C.gname(g.name))}</div>
    </div>`;
  }
  return caseHTML(g, i);
}

function caseHTML(g, i) {
  const fav = (S.config.favorites || []).includes(g.appid);
  const m = C.meta(g.appid);
  return `<div class="cc${g.installed ? "" : " ni"}" data-i="${i}" data-appid="${g.appid}">
    <div class="cc-shell">
      <div class="cc-band"><span class="cc-logo">CINDER</span><span class="cc-pc">PC</span></div>
      <div class="cc-art" data-name="${esc(C.gname(g.name))}"><img alt="" loading="lazy" decoding="async" src="/art/${g.appid}/portrait" data-fallback="/art/${g.appid}/header"></div>
      <div class="cc-spine"></div><div class="cc-gloss"></div>
      ${fav ? '<span class="cc-fav">★</span>' : ""}${m.status === "completed" ? '<span class="cc-done">100%</span>' : ""}
      ${g.download ? `<span class="cc-tag dl">${esc(dlText(g.download))}</span><span class="cc-prog"><i style="width:${dlPct(g.download)}%"></i></span>`
        : g.installed && g.update_pending && !g.shortcut ? '<span class="cc-tag dl">Update ready</span>' : ""}
    </div>
    <div class="cc-name">${esc(C.gname(g.name))}</div>
  </div>`;
}

const dlPct = (d) => (d.total ? Math.round((100 * d.done) / d.total) : d.stage_total ? Math.round((100 * d.stage_done) / d.stage_total) : 0);
const dlText = (d) => ({ paused: "Paused", verifying: "Verifying", installing: "Installing", queued: "Queued" }[d.state] || `Downloading ${dlPct(d)}%`);

function shell() {
  return `
    <div class="cbg"><div class="cbg-l" data-l="0"></div><div class="cbg-l" data-l="1"></div><div class="cbg-scan"></div></div>
    <header class="ctop">
      <div class="cbrand"><span class="cdot"></span>Cinder</div>
      <div class="ctop-r"><span class="cpad" id="cpad"></span><span class="cclock" id="cclock"></span>
        <button class="cx" id="couch-theme" title="Themes (T or the View button)"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.7-1.3-.7-2.2 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/></svg></button>
        <button class="cx" id="couch-exit" title="Leave couch mode (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    </header>
    <section class="cinfo" id="cinfo"></section>
    <section class="crows" id="crows"></section>
    <footer class="chints">
      <span><i class="bA">A</i>Open</span><span><i class="bY">Y</i>Play</span><span><i class="bX">X</i>Favorite</span>
      <span><i class="bV">⧉</i>Theme</span><span><i class="bB">B</i>Leave</span>
    </footer>
    <div class="cthemes" id="cthemes" hidden></div>
    <div class="csheet" id="csheet" hidden></div>`;
}

function renderRows() {
  const w = CASE_W();
  root().style.setProperty("--cw", `${w}px`);
  $("#crows").innerHTML = K.rows.map((r, ri) => `
    <div class="crow" data-r="${ri}">
      <h3>${esc(r.title)} <span>${r.games.length}</span></h3>
      <div class="ctrack">${r.games.map((g, i) => itemHTML(r.kind, g, i)).join("")}</div>
    </div>`).join("");
  C.markLoaded && C.markLoaded($("#crows"));
  place(true);
}

// ---------- moving ----------
function cur() {
  const r = K.rows[K.row];
  return r ? r.games[K.col[K.row] || 0] : null;
}

function place(instant) {
  const w = CASE_W();
  const rowsEl = $("#crows");
  if (!rowsEl) return;
  rowsEl.classList.toggle("instant", !!instant);
  const rowH = w * 1.62 + 112;
  rowsEl.style.transform = `translate3d(0, ${-K.row * rowH}px, 0)`;
  rowsEl.querySelectorAll(".crow").forEach((rowEl, ri) => {
    const c = K.col[ri] || 0;
    rowEl.classList.toggle("on", ri === K.row);
    rowEl.classList.toggle("near", ri === K.row + 1);  // the next shelf peeks in; the ones above fade out
    const track = rowEl.querySelector(".ctrack");
    track.style.transform = `translate3d(${-c * (w + GAP)}px, 0, 0)`;
    const prev = track.querySelector(".cc.on");
    const next = track.children[c];
    if (prev !== next || ri !== K.row) prev && prev.classList.remove("on");
    if (ri === K.row && next) next.classList.add("on");
  });
  paintInfo();
}

function move(dr, dc) {
  if (!K.rows.length) return;
  if (dr) {
    const n = Math.max(0, Math.min(K.rows.length - 1, K.row + dr));
    if (n === K.row) return bump();
    K.row = n;
    sfx("move");
  }
  if (dc) {
    const len = K.rows[K.row].games.length;
    const c = K.col[K.row] || 0;
    const n = Math.max(0, Math.min(len - 1, c + dc));
    if (n === c) return bump();
    K.col[K.row] = n;
    if (!dr) sfx("move");
  }
  place(false);
}

function bump() {
  sfx("bump");
  const el = $("#crows .crow.on .cc.on");
  if (!el) return;
  el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
}

// ---------- the focused game ----------
function paintOther(g, kind, info) {
  if (kind === "friend") {
    info.innerHTML = `
      <div class="ci-logo"><h1>${esc(g.name)}</h1></div>
      <div class="ci-meta"><span class="ci-tag">${esc(g.state === "ingame" ? "In game" : g.status || "Online")}</span>${g.game ? `<span>Playing ${esc(g.game)}</span>` : ""}</div>`;
    clearTimeout(K.bgFor);
    if (g.game_appid) K.bgFor = setTimeout(() => setBg(g.game_appid), 140);
    return;
  }
  const p = g.price;
  const lo = g.lows && g.lows.steam_low;
  const owned = S.games.some((x) => x.appid === g.appid);
  const bits = [
    p ? (p.free ? "Free to play" : p.discount > 0 ? `-${p.discount}% · ${C.money(p.final, p.currency)} (was ${C.money(p.initial, p.currency)})` : C.money(p.final, p.currency)) : "",
    lo ? (p && !p.free && p.final <= lo.cents ? "Lowest price ever" : `Lowest ever ${C.money(lo.cents, lo.currency)}`) : "",
    g.target ? `Alert at ${C.money(g.target, p && p.currency)}` : "",
    owned ? "In your library" : "",
  ].filter(Boolean);
  info.innerHTML = `
    <div class="ci-logo"><img alt="" src="/art/${g.appid}/logo" data-fail="hide" onload="this.parentNode.classList.add('has')"><h1>${esc(C.gname(g.name))}</h1></div>
    <div class="ci-meta">${bits.map((b) => `<span>${esc(b)}</span>`).join("")}${kind === "wish" ? '<span class="ci-tag">Wishlist</span>' : ""}</div>`;
  C.markLoaded && C.markLoaded(info);
  if (C.reviews) C.reviews.summary(g.appid).then((sm) => {
    if (!sm || cur() !== g) return;
    const meta = info.querySelector(".ci-meta");
    if (meta) meta.insertAdjacentHTML("beforeend", `<span class="ci-rv">${C.reviews.badge(sm)}</span>`);
  });
  clearTimeout(K.bgFor);
  K.bgFor = setTimeout(() => setBg(g.appid), 140);
}

// The button hints follow what's picked (a friend's Y is Message, a store game's Y is Buy…).
function paintHints(kind) {
  const h = root().querySelector(".chints");
  if (!h || h.dataset.kind === kind) return;
  h.dataset.kind = kind;
  const y = { game: "Play", friend: "Message", store: "Buy", wish: "Buy" }[kind] || "Play";
  h.innerHTML = `<span><i class="bA">A</i>Open</span><span><i class="bY">Y</i>${y}</span>${kind === "game" ? '<span><i class="bX">X</i>Favorite</span>' : ""}
    <span><i class="bV">⧉</i>Theme</span><span><i class="bB">B</i>Leave</span>`;
}

function paintInfo() {
  const g = cur();
  const info = $("#cinfo");
  if (!g || !info) return;
  paintHints(kindOf());
  if (kindOf() !== "game") return paintOther(g, kindOf(), info);
  const m = C.meta(g.appid);
  const ach = C.library.achFor ? C.library.achFor(g) : null;
  const bits = [
    g.shortcut ? "Non-Steam game" : g.playtime ? `${C.fmtPlay(g.playtime)} played` : "Not played yet",
    g.lastplayed ? `Last played ${C.fmtAgo(g.lastplayed)}` : "",
    ach ? `${ach[0]}/${ach[1]} achievements` : "",
    g.installed ? (g.update_pending ? "Update ready" : "") : "Not installed",
  ].filter(Boolean);
  info.innerHTML = `
    <div class="ci-logo"><img alt="" src="/art/${g.appid}/logo" data-fail="hide" onload="this.parentNode.classList.add('has')"><h1>${esc(C.gname(g.name))}</h1></div>
    <div class="ci-meta">${bits.map((b) => `<span>${esc(b)}</span>`).join("")}${m.rating ? `<span class="ci-stars">${"★".repeat(m.rating)}</span>` : ""}
      ${m.status ? `<span class="ci-tag">${esc(C.statusLabel(m.status))}</span>` : ""}</div>`;
  C.markLoaded && C.markLoaded(info);
  if (!g.shortcut && C.reviews) C.reviews.summary(g.appid).then((s) => {
    if (!s || cur() !== g) return;
    const meta = info.querySelector(".ci-meta");
    if (meta) meta.insertAdjacentHTML("beforeend", `<span class="ci-rv">${C.reviews.badge(s)}</span>`);
  });
  // Background: crossfade to this game's hero art once you settle on it.
  clearTimeout(K.bgFor);
  K.bgFor = setTimeout(() => setBg(g.appid), 140);
}

function setBg(appid) {
  const layers = root().querySelectorAll(".cbg-l");
  if (!layers.length || layers[K.bgFront].dataset.app === String(appid)) return;
  const back = layers[1 - K.bgFront];
  const img = new Image();
  img.onload = img.onerror = () => {
    if (!K.open) return;
    back.style.backgroundImage = img.naturalWidth ? `url("${img.src}")` : "none";
    back.dataset.app = appid;
    back.classList.add("on");
    layers[K.bgFront].classList.remove("on");
    K.bgFront = 1 - K.bgFront;
  };
  img.src = `/art/${appid}/hero`;
}

// ---------- details sheet ----------
function sheetButtons(g) {
  const fav = (S.config.favorites || []).includes(g.appid);
  const m = C.meta(g.appid);
  const st = C.STATUSES.findIndex(([k]) => k === m.status);
  return [
    { id: "play", label: g.installed ? "Play" : "Install", icon: g.installed ? ICON.play : ICON.down, primary: true },
    g.installed && g.update_pending && !g.shortcut ? { id: "update", label: "Update", icon: ICON.down } : null,
    { id: "fav", label: fav ? "Favorited" : "Favorite", on: fav },
    { id: "status", label: st >= 0 ? C.STATUSES[st][1] : "Set status", on: st >= 0 },
    { id: "rate", label: m.rating ? "★".repeat(m.rating) : "Rate", on: !!m.rating },
    { id: "page", label: "Game page" },
  ].filter(Boolean);
}

function otherButtons(kind, g) {
  if (kind === "friend") return [
    { id: "msg", label: "Message", icon: ICON.chat, primary: true },
    { id: "profile", label: "View profile", icon: ICON.user },
    g.game_appid ? { id: "fgame", label: `Store page: ${g.game}` } : null,
  ].filter(Boolean);
  const lo = g.lows && g.lows.steam_low;
  const p = g.price;
  const owned = S.games.some((x) => x.appid === g.appid);
  return [
    owned ? { id: "oplay", label: "In your library: open it", icon: ICON.play, primary: true }
      : { id: "buy", label: p && p.free ? "Get it free in Steam" : "Buy in Steam", icon: ICON.cart, primary: true },
    kind === "store" && !owned ? { id: "wishadd", label: "Add to wishlist in Steam", icon: ICON.heart } : null,
    kind === "wish" && lo && !(p && p.final <= lo.cents) ? { id: "alert-low", label: `Alert me at ${C.money(lo.cents, lo.currency)} (lowest ever)` } : null,
    kind === "wish" && p && !p.free ? { id: "alert-half", label: `Alert me at ${C.money(Math.round((p.initial || p.final) / 2), p.currency)} (half off)` } : null,
    kind === "wish" && g.target ? { id: "alert-off", label: `Remove alert (${C.money(g.target, p && p.currency)})`, on: true } : null,
    { id: "spage", label: "Store page" },
  ].filter(Boolean);
}

function openOther(g, kind) {
  sfx("open");
  K.sheet = { kind, g };
  K.sheetFocus = 0;
  paintOtherSheet();
  const s = $("#csheet");
  s.hidden = false;
  requestAnimationFrame(() => s.classList.add("open"));
}

function paintOtherSheet() {
  const { kind, g } = K.sheet;
  const btns = otherButtons(kind, g);
  K.sheetFocus = Math.min(K.sheetFocus, btns.length - 1);
  const art = kind === "friend" ? (g.game_appid ? `/art/${g.game_appid}/header` : g.avatar) : `/art/${g.appid}/header`;
  $("#csheet").innerHTML = `
    <div class="cs-art"><img alt="" src="${esc(art)}" data-fail="hide"></div>
    <div class="cs-body">
      <h2>${esc(kind === "friend" ? g.name : C.gname(g.name))}</h2>
      ${kind === "friend" ? `<p class="cs-note">${esc(g.state === "ingame" ? `Playing ${g.game || "a game"}` : g.status || "Online")}</p>` : ""}
      <div class="cs-btns">${btns.map((b, i) => `<button data-sb="${b.id}" class="${b.primary ? "pri" : ""}${b.on ? " lit" : ""}${i === K.sheetFocus ? " focus" : ""}">${b.icon || ""}${esc(b.label)}</button>`).join("")}</div>
    </div>`;
}

async function otherAct(id) {
  const { kind, g } = K.sheet;
  if (id === "msg") { C.act("message", { steamid: g.steamid }); return C.toast("Opened chat in Steam"); }
  if (id === "profile") { const sid = g.steamid; close(); C.go(`profile/${sid}`); return; }
  if (id === "fgame") { const a = g.game_appid; close(); C.go(`store/app/${a}`); return; }
  if (id === "oplay") { const a = g.appid; closeSheet(); const r = K.rows.findIndex((x) => x.kind === "game" && x.games.some((y) => y.appid === a)); if (r >= 0) { K.row = r; K.col[r] = K.rows[r].games.findIndex((y) => y.appid === a); place(false); } return; }
  if (id === "buy" || id === "wishadd") { C.act("store", { appid: g.appid }); return C.toast("Opened in Steam"); }
  if (id === "spage") { const a = g.appid; close(); C.go(`store/app/${a}`); return; }
  if (id.startsWith("alert-")) {
    const p = g.price || {};
    const cents = id === "alert-low" ? g.lows.steam_low.cents : id === "alert-half" ? Math.round((p.initial || p.final) / 2) : null;
    await C.extras.setTarget(g.appid, cents);
    g.target = cents;
    paintOtherSheet();
    const el = root().querySelector(`.crow.on .cc[data-i="${K.col[K.row] || 0}"]`);
    if (el) el.outerHTML = itemHTML(kind, g, K.col[K.row] || 0);
    place(true);
    paintInfo();
  }
}

function openSheet() {
  const g = cur();
  if (!g) return;
  if (kindOf() !== "game") return openOther(g, kindOf());
  sfx("open");
  K.sheet = g.appid;
  K.sheetFocus = 0;
  paintSheet();
  const s = $("#csheet");
  s.hidden = false;
  requestAnimationFrame(() => s.classList.add("open"));
}

function paintSheet() {
  const g = S.games.find((x) => x.appid === K.sheet);
  if (!g) return closeSheet();
  const btns = sheetButtons(g);
  K.sheetFocus = Math.min(K.sheetFocus, btns.length - 1);
  const ach = C.library.achFor ? C.library.achFor(g) : null;
  $("#csheet").innerHTML = `
    <div class="cs-art"><img alt="" src="/art/${g.appid}/header" data-fail="hide"></div>
    <div class="cs-body">
      <h2>${esc(C.gname(g.name))}</h2>
      <div class="cs-stats">
        <div><span>Play time</span><b>${g.playtime ? C.fmtPlay(g.playtime) : "—"}</b></div>
        <div><span>Last played</span><b>${g.lastplayed ? C.fmtAgo(g.lastplayed) : "Never"}</b></div>
        <div><span>Achievements</span><b>${ach ? `${ach[0]} / ${ach[1]}` : "—"}</b></div>
        <div><span>Size</span><b>${g.size ? C.fmtSize(g.size) : "—"}</b></div>
      </div>
      ${C.meta(g.appid).note ? `<p class="cs-note">${esc(C.meta(g.appid).note)}</p>` : ""}
      <div class="cs-btns">${btns.map((b, i) => `<button data-sb="${b.id}" class="${b.primary ? "pri" : ""}${b.on ? " lit" : ""}${i === K.sheetFocus ? " focus" : ""}">${b.icon || ""}${esc(b.label)}</button>`).join("")}</div>
    </div>`;
  C.markLoaded && C.markLoaded($("#csheet"));
}

function closeSheet() {
  if (K.sheet) sfx("back");
  K.sheet = null;
  const s = $("#csheet");
  s.classList.remove("open");
  setTimeout(() => { if (!K.sheet) s.hidden = true; }, 220);
}

async function sheetAct(id) {
  const g = S.games.find((x) => x.appid === K.sheet);
  if (!g) return;
  if (id === "play") return play(g);
  if (id === "update") { C.updateGames([g.appid], C.gname(g.name)); return; }
  if (id === "fav") { await toggleFav(g.appid); return paintSheet(); }
  if (id === "status") {
    const order = ["", ...C.STATUSES.map(([k]) => k)];
    const i = order.indexOf(C.meta(g.appid).status || "");
    await C.mine.save(g.appid, { status: order[(i + 1) % order.length] });
    return paintSheet();
  }
  if (id === "rate") {
    const r = ((C.meta(g.appid).rating || 0) + 1) % 6;
    await C.mine.save(g.appid, { rating: r });
    return paintSheet();
  }
  if (id === "page") { const a = g.appid; close(); C.go("library"); setTimeout(() => C.library.openDetail(a), 80); }
}

async function toggleFav(appid) {
  const f = new Set(S.config.favorites || []);
  if (f.has(appid)) f.delete(appid); else f.add(appid);
  await C.saveConfig({ favorites: [...f] });
  const el = $(`#crows .cc[data-appid="${appid}"] .cc-shell`);
  root().querySelectorAll(`.cc[data-appid="${appid}"] .cc-shell`).forEach((sh) => {
    const star = sh.querySelector(".cc-fav");
    if (f.has(appid) && !star) sh.insertAdjacentHTML("beforeend", '<span class="cc-fav">★</span>');
    if (!f.has(appid) && star) star.remove();
  });
  if (el) C.toast(f.has(appid) ? "Added to favorites" : "Removed from favorites");
}

function play(g) {
  if (!g) return;
  const el = root().querySelector(`.crow.on .cc[data-appid="${g.appid}"]`);
  if (el) { el.classList.remove("go"); void el.offsetWidth; el.classList.add("go"); }
  sfx("play");
  C.launch(g.appid);
  if (K.sheet) closeSheet();
}

// ---------- sounds ----------
// Made on the fly with Web Audio (no sound files), with a small pack per theme.
const SFX = { ctx: null, master: null, muted: false, last: 0 };
function audio() {
  if (SFX.ctx) return SFX.ctx;
  try {
    SFX.ctx = new (window.AudioContext || window.webkitAudioContext)();
    SFX.master = SFX.ctx.createGain();
    SFX.master.gain.value = 0.16;
    SFX.master.connect(SFX.ctx.destination);
  } catch { SFX.ctx = null; }
  return SFX.ctx;
}
function tone(f, dur, { type = "sine", vol = 1, to = 0, at = 0, attack = 0.004, lp = 0, detune = 0 } = {}) {
  const c = SFX.ctx, t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (lp) { const fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = lp; o.connect(fl); node = fl; }
  node.connect(g); g.connect(SFX.master);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, { vol = 1, at = 0, type = "bandpass", f = 2000, q = 1 } = {}) {
  const c = SFX.ctx, t = c.currentTime + at;
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = vol;
  src.connect(fl); fl.connect(g); g.connect(SFX.master);
  src.start(t);
}
const PACKS = {
  case: {
    move: () => tone(740, 0.05, { vol: 0.35 }), bump: () => tone(150, 0.09, { vol: 0.5 }),
    open: () => { tone(520, 0.07, { vol: 0.4 }); tone(780, 0.1, { vol: 0.4, at: 0.05 }); },
    back: () => { tone(780, 0.07, { vol: 0.35 }); tone(520, 0.1, { vol: 0.35, at: 0.05 }); },
    play: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { vol: 0.35, at: i * 0.06 })),
  },
  cart: {
    move: () => tone(988, 0.04, { type: "square", vol: 0.18 }), bump: () => tone(110, 0.08, { type: "square", vol: 0.25 }),
    open: () => { tone(659, 0.05, { type: "square", vol: 0.2 }); tone(988, 0.08, { type: "square", vol: 0.2, at: 0.05 }); },
    back: () => { tone(988, 0.05, { type: "square", vol: 0.2 }); tone(494, 0.08, { type: "square", vol: 0.2, at: 0.05 }); },
    play: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.09, { type: "square", vol: 0.2, at: i * 0.055 })),
  },
  pocket: {
    move: () => tone(1318, 0.03, { type: "square", vol: 0.14 }), bump: () => tone(196, 0.06, { type: "square", vol: 0.2 }),
    open: () => tone(880, 0.09, { type: "square", vol: 0.16, to: 1760 }),
    back: () => tone(1760, 0.09, { type: "square", vol: 0.16, to: 880 }),
    play: () => [1046, 1318, 1568, 2093].forEach((f, i) => tone(f, 0.07, { type: "square", vol: 0.15, at: i * 0.07 })),
  },
  modern: {
    move: () => tone(1200, 0.03, { type: "triangle", vol: 0.22, lp: 3000 }), bump: () => tone(220, 0.07, { type: "triangle", vol: 0.3 }),
    open: () => tone(600, 0.12, { type: "triangle", vol: 0.3, to: 900, lp: 2500 }),
    back: () => tone(900, 0.12, { type: "triangle", vol: 0.3, to: 600, lp: 2500 }),
    play: () => { tone(440, 0.4, { type: "triangle", vol: 0.3, lp: 2200 }); tone(660, 0.4, { type: "triangle", vol: 0.22, at: 0.05, lp: 2200 }); tone(880, 0.5, { type: "triangle", vol: 0.18, at: 0.1, lp: 2200 }); },
  },
  neon: {
    move: () => { tone(880, 0.07, { type: "sawtooth", vol: 0.12, lp: 1800, detune: 8 }); tone(880, 0.07, { type: "sawtooth", vol: 0.06, lp: 1200, at: 0.09 }); },
    bump: () => tone(110, 0.12, { type: "sawtooth", vol: 0.2, lp: 600 }),
    open: () => tone(330, 0.25, { type: "sawtooth", vol: 0.18, to: 990, lp: 2400 }),
    back: () => tone(990, 0.25, { type: "sawtooth", vol: 0.16, to: 330, lp: 2000 }),
    play: () => [220, 277, 330, 440, 554, 659].forEach((f, i) => tone(f, 0.3, { type: "sawtooth", vol: 0.1, at: i * 0.05, lp: 2600, detune: 10 })),
  },
  vhs: {
    move: () => noise(0.035, { vol: 0.5, f: 1500, q: 0.7 }), bump: () => { tone(70, 0.12, { vol: 0.6 }); noise(0.05, { vol: 0.4, f: 400 }); },
    open: () => { tone(90, 0.14, { vol: 0.6, to: 60 }); noise(0.08, { vol: 0.5, f: 900, at: 0.02 }); },
    back: () => { noise(0.12, { vol: 0.5, f: 2500 }); tone(80, 0.1, { vol: 0.5, at: 0.06 }); },
    play: () => { tone(100, 0.2, { vol: 0.6, to: 55 }); noise(0.25, { vol: 0.3, f: 3000, at: 0.1, type: "highpass" }); tone(440, 0.3, { vol: 0.15, at: 0.25, to: 452 }); },
  },
  jewel: {
    move: () => { tone(1568, 0.25, { vol: 0.16 }); tone(1568 * 2.76, 0.12, { vol: 0.05 }); },
    bump: () => tone(392, 0.15, { vol: 0.25 }),
    open: () => { tone(1046, 0.5, { vol: 0.2 }); tone(1046 * 2.76, 0.3, { vol: 0.06 }); tone(1568, 0.5, { vol: 0.15, at: 0.07 }); },
    back: () => { tone(1568, 0.35, { vol: 0.15 }); tone(1046, 0.4, { vol: 0.15, at: 0.07 }); },
    play: () => [1046, 1318, 1568, 2093, 2637].forEach((f, i) => { tone(f, 0.6, { vol: 0.13, at: i * 0.07 }); tone(f * 2.76, 0.25, { vol: 0.04, at: i * 0.07 }); }),
  },
  comic: {
    move: () => tone(900, 0.06, { vol: 0.35, to: 380 }), bump: () => { tone(200, 0.1, { vol: 0.45, to: 90 }); },
    open: () => tone(300, 0.14, { vol: 0.35, to: 1200 }),
    back: () => tone(1200, 0.14, { vol: 0.3, to: 300 }),
    play: () => { tone(250, 0.35, { vol: 0.35, to: 1600 }); noise(0.15, { vol: 0.5, f: 1200, at: 0.3 }); },
  },
  blueprint: {
    move: () => noise(0.02, { vol: 0.6, f: 4500, type: "highpass" }), bump: () => noise(0.06, { vol: 0.5, f: 700 }),
    open: () => { noise(0.02, { vol: 0.6, f: 4500, type: "highpass" }); noise(0.02, { vol: 0.5, f: 4500, type: "highpass", at: 0.06 }); },
    back: () => noise(0.09, { vol: 0.4, f: 3000, type: "highpass" }),
    play: () => { for (let i = 0; i < 5; i++) noise(0.03, { vol: 0.45, f: 4000 + i * 300, type: "highpass", at: i * 0.05 }); tone(660, 0.3, { vol: 0.12, at: 0.28 }); },
  },
  shelf: {
    move: () => { tone(260, 0.06, { vol: 0.4, to: 200 }); noise(0.015, { vol: 0.3, f: 900 }); },
    bump: () => tone(120, 0.12, { vol: 0.5, to: 90 }),
    open: () => { tone(220, 0.08, { vol: 0.4 }); noise(0.18, { vol: 0.12, f: 5000, type: "highpass", at: 0.04 }); },
    back: () => { noise(0.14, { vol: 0.12, f: 5000, type: "highpass" }); tone(180, 0.08, { vol: 0.35, at: 0.08 }); },
    play: () => [392, 494, 587].forEach((f, i) => { tone(f, 0.5, { vol: 0.22, at: i * 0.09, type: "triangle", lp: 1800 }); }),
  },
};
function sfx(kind) {
  if (S.config.couch_sounds === false || SFX.muted || !K.open) return;
  const now = performance.now();
  if (kind === "move" && now - SFX.last < 45) return;  // held direction: don't machine-gun
  SFX.last = now;
  if (!audio()) return;
  if (SFX.ctx.state === "suspended") SFX.ctx.resume().catch(() => {});
  const pack = PACKS[root().dataset.theme] || PACKS.case;
  try { (pack[kind] || PACKS.case[kind] || (() => {}))(); } catch { /* audio hiccup */ }
}
function toggleMute() {
  SFX.muted = !SFX.muted;
  C.toast(SFX.muted ? "Couch sounds off (M to turn back on)" : "Couch sounds on");
}

// ---------- themes ----------
function applyTheme(id) {
  const el = root();
  el.dataset.theme = id;
  // Some looks are a different shape; let everything settle without sliding.
  requestAnimationFrame(() => place(true));
}

function openThemes() {
  if (K.sheet) closeSheet();
  K.themes = { was: themeOf(), i: Math.max(0, THEMES.findIndex((t) => t.id === themeOf())) };
  paintThemes();
  const p = $("#cthemes");
  p.hidden = false;
  requestAnimationFrame(() => p.classList.add("open"));
}

function paintThemes() {
  const t = K.themes;
  $("#cthemes").innerHTML = `<div class="ct-head"><b>Theme</b><small>◀ ▶ to try · A to keep · B to cancel</small></div>
    <div class="ct-list">${THEMES.map((th, i) => `
      <button class="ct${i === t.i ? " focus" : ""}${th.id === t.was ? " cur" : ""}" data-ct="${i}">
        <span class="ct-sw">${th.sw.map((c) => `<i style="background:${c}"></i>`).join("")}</span>
        <b>${esc(th.name)}</b><small>${esc(th.desc)}</small>
      </button>`).join("")}</div>`;
  applyTheme(THEMES[t.i].id);
}

function closeThemes(keep) {
  const t = K.themes;
  if (!t) return;
  K.themes = null;
  const id = keep ? THEMES[t.i].id : t.was;
  applyTheme(id);
  if (keep && id !== S.config.couch_theme) C.saveConfig({ couch_theme: id });
  const p = $("#cthemes");
  p.classList.remove("open");
  setTimeout(() => { if (!K.themes) p.hidden = true; }, 200);
}

function themePress(btn) {
  const t = K.themes;
  if (btn === "left" || btn === "up" || btn === "lb") t.i = (t.i - 1 + THEMES.length) % THEMES.length;
  else if (btn === "right" || btn === "down" || btn === "rb") t.i = (t.i + 1) % THEMES.length;
  else if (btn === "a" || btn === "view") { closeThemes(true); return sfx("open"); }
  else if (btn === "b" || btn === "start") { closeThemes(false); return sfx("back"); }
  else return;
  paintThemes();
  sfx("move");
}

// ---------- input ----------
function press(btn) {
  K.idle = Date.now();
  root().classList.remove("idle");
  if (btn === "mute") return toggleMute();
  if (K.themes) return themePress(btn);
  if (btn === "view") { sfx("open"); return openThemes(); }
  if (K.sheet) {
    const n = $("#csheet").querySelectorAll("[data-sb]").length;
    if (btn === "left" || btn === "up") K.sheetFocus = Math.max(0, K.sheetFocus - 1);
    else if (btn === "right" || btn === "down") K.sheetFocus = Math.min(n - 1, K.sheetFocus + 1);
    else if (btn === "a") { const b = $("#csheet").querySelectorAll("[data-sb]")[K.sheetFocus]; if (b) (typeof K.sheet === "object" ? otherAct : sheetAct)(b.dataset.sb); return; }
    else if (btn === "b") return closeSheet();
    else if (btn === "y") return typeof K.sheet === "object" ? null : play(S.games.find((x) => x.appid === K.sheet));
    else if (btn === "start") return close();
    $("#csheet").querySelectorAll("[data-sb]").forEach((b, i) => b.classList.toggle("focus", i === K.sheetFocus));
    sfx("move");
    return;
  }
  switch (btn) {
    case "left": return move(0, -1);
    case "right": return move(0, 1);
    case "up": return move(-1, 0);
    case "down": return move(1, 0);
    case "lb": return move(0, -6);
    case "rb": return move(0, 6);
    case "a": return openSheet();
    case "y": {
      const k = kindOf(), g = cur();
      if (k === "game") return play(g);
      if (k === "friend" && g) { C.act("message", { steamid: g.steamid }); return C.toast("Opened chat in Steam"); }
      if (g) { C.act("store", { appid: g.appid }); return C.toast("Opened in Steam"); }
      return;
    }
    case "x": { const g = cur(); if (g && kindOf() === "game") toggleFav(g.appid); return; }
    case "b": case "start": return close();
  }
}

const KEYS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Enter: "a", " ": "y",
  Escape: "b", Backspace: "b", f: "x", F: "x", PageUp: "lb", PageDown: "rb", t: "view", T: "view", m: "mute", M: "mute" };

function onKey(e) {
  if (!K.open) return;
  if (e.key === "F11") { e.preventDefault(); return close(); }
  const b = KEYS[e.key];
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  // Steam's desktop controller layout also types arrows / Enter / Esc for the same press: count it once.
  if (performance.now() - (K.padAt || 0) < 200) return;
  press(b);
}

// Standard gamepad mapping.
const PAD = { 0: "a", 1: "b", 2: "x", 3: "y", 4: "lb", 5: "rb", 8: "view", 9: "start", 12: "up", 13: "down", 14: "left", 15: "right" };
const DIRS = new Set(["up", "down", "left", "right"]);

// Controllers to read: ones Windows reports with the standard layout (Xbox, Elite, PlayStation…).
// Other devices that show up as "gamepads" (keyboard knobs, wheels, Steam's virtual pads with odd
// layouts) are only used when there's nothing else.
function readPads() {
  const all = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected !== false) : [];
  const std = all.filter((p) => p.mapping === "standard");
  return std.length ? std : all;
}

// Whether input should count: Cinder must be the window you're using. The page's own focus can be
// wrong after the window goes full screen, so ask Windows too (twice a second).
function active() {
  if (document.hidden) return false;
  if (document.hasFocus()) return true;
  return K.fg === true;
}
function watchForeground() {
  clearInterval(K.fgTimer);
  const api = window.pywebview && window.pywebview.api;
  if (!api || typeof api.foreground !== "function") { K.fg = null; return; }
  const ask = () => api.foreground().then((v) => { K.fg = !!v; }).catch(() => { K.fg = null; });
  ask();
  K.fgTimer = setInterval(ask, 500);
}

function logPads() {
  const all = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  C.log(`couch mode controllers: ${all.length ? all.map((p) => `[${p.index}] ${p.id} (${p.mapping || "no mapping"}, ${p.buttons.length} buttons)`).join("; ") : "none yet (press a button)"}`
    + ` · focus ${document.hasFocus()}`);
}

function pollPad(t) {
  if (!K.open) return;
  K.raf = requestAnimationFrame(pollPad);
  const pads = readPads();
  $("#cpad").classList.toggle("on", pads.length > 0);
  if (pads.length && !K.loggedPads) { K.loggedPads = true; logPads(); }
  // Only while Cinder itself is in front: buttons pressed in a game must never reach couch mode.
  if (!pads.length || !active()) { K.prevButtons = ["a", "b", "x", "y", "start"]; return; }
  const down = new Set();
  for (const pad of pads) {
    pad.buttons.forEach((b, i) => { if ((b.pressed || b.value > 0.5) && PAD[i]) down.add(PAD[i]); });
    const [ax = 0, ay = 0] = pad.axes;
    if (ax < -0.55) down.add("left"); else if (ax > 0.55) down.add("right");
    if (ay < -0.55) down.add("up"); else if (ay > 0.55) down.add("down");
  }
  // Buttons fire once per press.
  if (down.size) K.padAt = performance.now();
  for (const b of down) if (!DIRS.has(b) && !K.prevButtons.includes(b)) press(b);
  // Directions repeat while held, getting quicker.
  const dir = ["up", "down", "left", "right"].find((d) => down.has(d)) || "";
  const h = K.hold;
  if (dir !== h.dir) { h.dir = dir; h.count = 0; if (dir) { press(dir); h.next = t + 380; } }
  else if (dir && t >= h.next) { press(dir); h.count++; h.next = t + Math.max(55, 150 - h.count * 12); }
  K.prevButtons = [...down];
}

// Outside couch mode: a slow check so a controller's Start (or Guide) button opens it.
let lazy = 0;
function lazyPoll() {
  clearInterval(lazy);
  lazy = setInterval(() => {
    if (K.open || document.hidden || !document.hasFocus()) return;
    const pads = readPads();
    if (!pads.length) { clearInterval(lazy); lazy = 0; return; }
    if (pads.some((pad) => (pad.buttons[9] && pad.buttons[9].pressed) || (pad.buttons[16] && pad.buttons[16].pressed))) open();
  }, 250);
}

// ---------- open / close ----------
async function open() {
  if (K.open) return;
  K.open = true;
  K.rows = buildRows();
  K.row = 0;
  K.col = K.rows.map(() => 0);
  const el = root();
  el.dataset.theme = themeOf();
  el.innerHTML = shell();
  el.hidden = false;
  document.body.classList.add("couch-on");
  renderRows();
  tick();
  K.clock = setInterval(tick, 15000);
  K.prevButtons = ["start", "a"];  // the press that opened couch mode doesn't also act
  K.raf = requestAnimationFrame(pollPad);
  loadExtras();
  K.loggedPads = false;
  watchForeground();
  setTimeout(() => { if (K.open && !K.loggedPads) logPads(); }, 4000);
  requestAnimationFrame(() => el.classList.add("open"));
  if (window.pywebview && window.pywebview.api && window.pywebview.api.fullscreen) {
    try { await window.pywebview.api.fullscreen(true); } catch { /* stay windowed */ }
  } else if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  setTimeout(() => place(true), 250);  // after the window grows
}

async function close() {
  if (!K.open) return;
  if (K.themes) closeThemes(true);
  K.open = false;
  cancelAnimationFrame(K.raf);
  clearInterval(K.fgTimer);
  clearInterval(K.clock);
  clearTimeout(K.bgFor);
  const el = root();
  el.classList.remove("open");
  document.body.classList.remove("couch-on");
  if (window.pywebview && window.pywebview.api && window.pywebview.api.fullscreen) {
    try { await window.pywebview.api.fullscreen(false); } catch { /* ignore */ }
  } else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  setTimeout(() => { if (!K.open) { el.hidden = true; el.innerHTML = ""; } }, 260);
}

function tick() {
  const c = $("#cclock");
  if (c) c.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function bind() {
  $("#btn-couch").addEventListener("click", open);
  document.addEventListener("keydown", (e) => {
    if (!K.open && e.key === "F11") { e.preventDefault(); open(); return; }
    onKey(e);
  }, true);
  window.addEventListener("gamepadconnected", () => { if (!lazy) lazyPoll(); });
  window.addEventListener("focus", () => { if (!lazy && navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) lazyPoll(); });
  window.addEventListener("resize", () => { if (K.open) { root().style.setProperty("--cw", `${CASE_W()}px`); place(true); } });
  root().addEventListener("click", (e) => {
    if (e.target.closest("#couch-exit")) return close();
    if (e.target.closest("#couch-theme")) return K.themes ? closeThemes(true) : openThemes();
    const ct = e.target.closest("[data-ct]");
    if (ct) { if (K.themes.i === +ct.dataset.ct) return closeThemes(true); K.themes.i = +ct.dataset.ct; return paintThemes(); }
    if (K.themes && !e.target.closest("#cthemes")) return closeThemes(true);
    const sb = e.target.closest("[data-sb]");
    if (sb) return (typeof K.sheet === "object" ? otherAct : sheetAct)(sb.dataset.sb);
    if (K.sheet && !e.target.closest(".cs-body, .cs-art")) return closeSheet();
    const cc = e.target.closest(".cc");
    if (cc) {
      const ri = +cc.closest(".crow").dataset.r, i = +cc.dataset.i;
      if (ri === K.row && i === (K.col[ri] || 0)) return openSheet();
      K.row = ri; K.col[ri] = i; place(false);
    }
  });
  bindDrag();
  root().addEventListener("dblclick", (e) => { const cc = e.target.closest(".cc"); if (cc && kindOf() === "game") play(cur()); });
  // Mouse wheel / trackpad moves along the shelf.
  let wheelAt = 0;
  root().addEventListener("wheel", (e) => {
    if (!K.open || K.sheet || K.themes) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelAt < 70) return;
    wheelAt = now;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) move(0, (e.deltaX || e.deltaY) > 0 ? 1 : -1);
    else move((e.deltaY > 0 ? 1 : -1), 0);
  }, { passive: false });
}

// Mouse: click and drag a shelf sideways to scroll it (with a flick to keep going); drag up or down to switch shelves.
function bindDrag() {
  let d = null;
  let swallowClick = false;
  const el = root();
  el.addEventListener("pointerdown", (e) => {
    if (!K.open || K.sheet || K.themes || e.button !== 0) return;
    const rowEl = e.target.closest(".crow");
    if (!rowEl || e.target.closest("button:not(.cc), a, input")) return;
    const ri = +rowEl.dataset.r;
    const track = rowEl.querySelector(".ctrack");
    d = { id: e.pointerId, x: e.clientX, y: e.clientY, ri, track, col: ri === K.row ? (K.col[ri] || 0) : (K.col[ri] || 0),
          moved: false, vert: false, pts: [[e.clientX, performance.now()]] };
  });
  el.addEventListener("pointermove", (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      d.moved = true;
      d.vert = Math.abs(dy) > Math.abs(dx) * 1.3;
      try { el.setPointerCapture(d.id); } catch { /* fine */ }
      el.classList.add("grabbing");
      if (!d.vert) d.track.classList.add("dragging");
    }
    if (d.vert) {
      if (Math.abs(dy) > 70) { move(dy < 0 ? 1 : -1, 0); d.y = e.clientY; }
      return;
    }
    const step = CASE_W() + GAP;
    const n = (K.rows[d.ri] || { games: [] }).games.length;
    let off = -d.col * step + dx;
    const min = -(n - 1) * step;
    if (off > 0) off *= 0.35; else if (off < min) off = min + (off - min) * 0.35;  // a little give at the ends
    d.track.style.transform = `translate3d(${off}px, 0, 0)`;
    d.pts.push([e.clientX, performance.now()]);
    if (d.pts.length > 6) d.pts.shift();
  });
  const end = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const g = d;
    d = null;
    el.classList.remove("grabbing");
    g.track.classList.remove("dragging");
    if (!g.moved) return;
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 0);
    if (g.vert) return;
    const step = CASE_W() + GAP;
    const n = (K.rows[g.ri] || { games: [] }).games.length;
    const [x0, t0] = g.pts[0], [x1, t1] = g.pts[g.pts.length - 1];
    const v = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;  // px per ms
    const fling = Math.abs(v) > 0.4 ? v * 220 : 0;
    const c = Math.max(0, Math.min(n - 1, Math.round(g.col - (e.clientX - g.x + fling) / step)));
    K.row = g.ri;
    K.col[g.ri] = c;
    K.idle = Date.now();
    sfx("move");
    place(false);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  // The click that ends a drag shouldn't also open the game it lands on.
  el.addEventListener("click", (e) => { if (swallowClick) { e.stopImmediatePropagation(); e.preventDefault(); swallowClick = false; } }, true);
  el.addEventListener("dragstart", (e) => e.preventDefault());
}

C.couch = { open, close, isOpen: () => K.open };
bind();
})();
