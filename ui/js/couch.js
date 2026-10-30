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
  return rows.filter(([, gs]) => gs.length).map(([title, games]) => ({ title, games }));
}

// ---------- markup ----------
function caseHTML(g, i) {
  const fav = (S.config.favorites || []).includes(g.appid);
  const m = C.meta(g.appid);
  return `<div class="cc${g.installed ? "" : " ni"}" data-i="${i}" data-appid="${g.appid}">
    <div class="cc-shell">
      <div class="cc-band"><span class="cc-logo">CINDER</span><span class="cc-pc">PC</span></div>
      <div class="cc-art" data-name="${esc(C.gname(g.name))}"><img alt="" loading="lazy" decoding="async" src="/art/${g.appid}/portrait" data-fallback="/art/${g.appid}/header"></div>
      <div class="cc-spine"></div><div class="cc-gloss"></div>
      ${fav ? '<span class="cc-fav">★</span>' : ""}${m.status === "completed" ? '<span class="cc-done">100%</span>' : ""}
    </div>
  </div>`;
}

function shell() {
  return `
    <div class="cbg"><div class="cbg-l" data-l="0"></div><div class="cbg-l" data-l="1"></div><div class="cbg-scan"></div></div>
    <header class="ctop">
      <div class="cbrand"><span class="cdot"></span>Cinder</div>
      <div class="ctop-r"><span class="cpad" id="cpad"></span><span class="cclock" id="cclock"></span>
        <button class="cx" id="couch-exit" title="Leave couch mode (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    </header>
    <section class="cinfo" id="cinfo"></section>
    <section class="crows" id="crows"></section>
    <footer class="chints">
      <span><i class="bA">A</i>Open</span><span><i class="bY">Y</i>Play</span><span><i class="bX">X</i>Favorite</span>
      <span><i class="bB">B</i>Leave</span>
    </footer>
    <div class="csheet" id="csheet" hidden></div>`;
}

function renderRows() {
  const w = CASE_W();
  root().style.setProperty("--cw", `${w}px`);
  $("#crows").innerHTML = K.rows.map((r, ri) => `
    <div class="crow" data-r="${ri}">
      <h3>${esc(r.title)} <span>${r.games.length}</span></h3>
      <div class="ctrack">${r.games.map((g, i) => caseHTML(g, i)).join("")}</div>
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
  }
  if (dc) {
    const len = K.rows[K.row].games.length;
    const c = K.col[K.row] || 0;
    const n = Math.max(0, Math.min(len - 1, c + dc));
    if (n === c) return bump();
    K.col[K.row] = n;
  }
  place(false);
}

function bump() {
  const el = $("#crows .crow.on .cc.on");
  if (!el) return;
  el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
}

// ---------- the focused game ----------
function paintInfo() {
  const g = cur();
  const info = $("#cinfo");
  if (!g || !info) return;
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

function openSheet() {
  const g = cur();
  if (!g) return;
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
  C.launch(g.appid);
  if (K.sheet) closeSheet();
}

// ---------- input ----------
function press(btn) {
  K.idle = Date.now();
  root().classList.remove("idle");
  if (K.sheet) {
    const n = $("#csheet").querySelectorAll("[data-sb]").length;
    if (btn === "left" || btn === "up") K.sheetFocus = Math.max(0, K.sheetFocus - 1);
    else if (btn === "right" || btn === "down") K.sheetFocus = Math.min(n - 1, K.sheetFocus + 1);
    else if (btn === "a") { const b = $("#csheet").querySelectorAll("[data-sb]")[K.sheetFocus]; if (b) sheetAct(b.dataset.sb); return; }
    else if (btn === "b") return closeSheet();
    else if (btn === "y") return play(S.games.find((x) => x.appid === K.sheet));
    else if (btn === "start") return close();
    $("#csheet").querySelectorAll("[data-sb]").forEach((b, i) => b.classList.toggle("focus", i === K.sheetFocus));
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
    case "y": return play(cur());
    case "x": { const g = cur(); if (g) toggleFav(g.appid); return; }
    case "b": case "start": return close();
  }
}

const KEYS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Enter: "a", " ": "y",
  Escape: "b", Backspace: "b", f: "x", F: "x", PageUp: "lb", PageDown: "rb" };

function onKey(e) {
  if (!K.open) return;
  if (e.key === "F11") { e.preventDefault(); return close(); }
  const b = KEYS[e.key];
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  press(b);
}

// Standard gamepad mapping.
const PAD = { 0: "a", 1: "b", 2: "x", 3: "y", 4: "lb", 5: "rb", 9: "start", 12: "up", 13: "down", 14: "left", 15: "right" };
const DIRS = new Set(["up", "down", "left", "right"]);

function pollPad(t) {
  if (!K.open) return;
  K.raf = requestAnimationFrame(pollPad);
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const pad = pads[0];
  $("#cpad").classList.toggle("on", !!pad);
  // Only while Cinder itself has focus: buttons pressed in a game must never reach couch mode.
  if (!pad || document.hidden || !document.hasFocus()) { K.prevButtons = ["a", "b", "x", "y", "start"]; return; }
  const down = new Set();
  pad.buttons.forEach((b, i) => { if (b.pressed && PAD[i]) down.add(PAD[i]); });
  const [ax, ay] = pad.axes;
  if (ax < -0.55) down.add("left"); else if (ax > 0.55) down.add("right");
  if (ay < -0.55) down.add("up"); else if (ay > 0.55) down.add("down");
  // Buttons fire once per press.
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
    const pad = navigator.getGamepads && [...navigator.getGamepads()].find(Boolean);
    if (!pad) { clearInterval(lazy); lazy = 0; return; }
    if ((pad.buttons[9] && pad.buttons[9].pressed) || (pad.buttons[16] && pad.buttons[16].pressed)) open();
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
  el.innerHTML = shell();
  el.hidden = false;
  document.body.classList.add("couch-on");
  renderRows();
  tick();
  K.clock = setInterval(tick, 15000);
  K.prevButtons = ["start", "a"];  // the press that opened couch mode doesn't also act
  K.raf = requestAnimationFrame(pollPad);
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
  K.open = false;
  cancelAnimationFrame(K.raf);
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
    const sb = e.target.closest("[data-sb]");
    if (sb) return sheetAct(sb.dataset.sb);
    if (K.sheet && !e.target.closest(".cs-body, .cs-art")) return closeSheet();
    const cc = e.target.closest(".cc");
    if (cc) {
      const ri = +cc.closest(".crow").dataset.r, i = +cc.dataset.i;
      if (ri === K.row && i === (K.col[ri] || 0)) return openSheet();
      K.row = ri; K.col[ri] = i; place(false);
    }
  });
  root().addEventListener("dblclick", (e) => { const cc = e.target.closest(".cc"); if (cc) play(cur()); });
  // Mouse wheel / trackpad moves along the shelf.
  let wheelAt = 0;
  root().addEventListener("wheel", (e) => {
    if (!K.open || K.sheet) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelAt < 70) return;
    wheelAt = now;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) move(0, (e.deltaX || e.deltaY) > 0 ? 1 : -1);
    else move((e.deltaY > 0 ? 1 : -1), 0);
  }, { passive: false });
}

C.couch = { open, close, isOpen: () => K.open };
bind();
})();
