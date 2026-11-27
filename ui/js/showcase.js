/* Showcase: your library as real game cases on a shelf.

   - The shelf: every game is a 3D case standing spine-out; the picked one turns to face you.
     Scroll with the wheel, arrow keys, or click and drag (flick to keep going). Hover the case
     to tilt it in the light. Flip it to read the back, or open it to see the disc.
   - Collections: your lists and Steam collections as a wall of tiles.
   - The 3D viewer (also on every game page): a big case you can spin with the mouse,
     open, flip, or leave turning on its own.
   Everything is CSS 3D transforms; only the cases near the middle exist in the page. */
(() => {
"use strict";
const { $, esc, S, ICON } = C;
const WINDOW = 16;                 // cases kept on each side of the picked one
const SC = { list: [], sel: 0, pos: 0, flipA: 0, raf: 0, last: 0, D: null, span: WINDOW, dragEnd: 0,
  els: new Map(), root: null, view: "shelf", flipped: false, open: false, key: "", bgFor: 0, titleAt: 0 };
const tint = new Map();            // appid -> spine colour, from the cover's average

// ---------- spine colours: the cover's average colour, darkened ----------
function loadTints() {
  try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem("cinder.tints") || "{}"))) tint.set(+k, v); } catch { /* fine */ }
}
let tintSave = 0;
function measureTint(appid, img) {
  if (tint.has(appid) || !img.naturalWidth) return;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, 8, 8);
    const d = x.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    const k = 0.42;  // darker, like a printed spine
    const col = `rgb(${Math.round((r / n) * k)},${Math.round((g / n) * k)},${Math.round((b / n) * k)})`;
    tint.set(appid, col);
    document.querySelectorAll(`.b3[data-appid="${appid}"]`).forEach((el) => el.style.setProperty("--tint", col));
    clearTimeout(tintSave);
    tintSave = setTimeout(() => { try { localStorage.setItem("cinder.tints", JSON.stringify(Object.fromEntries([...tint].slice(-800)))); } catch { /* full */ } }, 1500);
  } catch { /* tainted or not ready */ }
}

// A barcode that's different for every game.
function barcode(appid) {
  let s = "", x = appid * 2654435761 >>> 0, p = 0;
  for (let i = 0; i < 34; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    const w = 1 + (x >>> 29) % 3;
    s += `${i % 2 ? "transparent" : "#111"} ${p}px ${p + w}px,`;
    p += w;
  }
  return `linear-gradient(90deg, ${s.slice(0, -1)})`;
}

const plat = (g) => (g.shortcut ? "PC" : "STEAM");

// The parts only the picked case needs: inside cover, tray and disc, back cover.
function fiHTML(g) { return `<img alt="" src="/art/${g.appid}/hero" data-fail="hide"><span class="b3-clip"></span>`; }
function inHTML(g) {
  const name = esc(C.gname(g.name));
  return `<div class="b3-tray"><div class="b3-disc"><img alt="" src="/art/${g.appid}/portrait" data-fail="hide"><i></i></div></div>
      <div class="b3-booklet"><small>Includes</small><b>${name}</b><span>Installation guide · Steam key inside</span></div>`;
}
function backHTML(g) {
  const name = esc(C.gname(g.name));
  return `
      <div class="b3-bhero"><img alt="" src="/art/${g.appid}/hero" data-fail="hide"></div>
      <div class="b3-btxt"><b>${name}</b>
        <p>${g.playtime ? `You've played ${esc(C.fmtPlay(g.playtime))}${g.lastplayed ? `, last ${esc(C.fmtAgo(g.lastplayed))}` : ""}.` : "A game waiting to be played."}</p>
        <div class="b3-shots"><img alt="" src="/art/${g.appid}/header" data-fail="hide"><img alt="" src="/art/${g.appid}/logo" data-fail="hide" class="lg"></div>
        <i></i><i></i><i class="short"></i></div>
      <div class="b3-bfoot"><span class="b3-rate">${g.installed ? "INSTALLED" : "STEAM"}</span><span class="b3-bar" style="background:${barcode(g.appid)}"></span>
        <small>${g.appid}</small></div>`;
}

/** One game case. `full` adds the back cover and the inside (for the picked case and the viewer). */
function caseHTML(g, full) {
  const name = esc(C.gname(g.name));
  const col = tint.get(g.appid);
  return `<div class="b3${g.installed ? "" : " ni"}" data-appid="${g.appid}"${full ? ' data-full="1"' : ""}${col ? ` style="--tint:${col}"` : ""}>
    <div class="b3-door">
      <div class="b3-f">
        <div class="b3-band"><b>${plat(g)}</b><span>${g.shortcut ? "Non-Steam" : "DVD-ROM"}</span></div>
        <div class="b3-art"><img alt="" decoding="async" src="/art/${g.appid}/portrait" data-fallback="/art/${g.appid}/header" data-tintfor="${g.appid}"><span class="b3-ph">${name}</span></div>
        <i class="b3-sheen"></i>
      </div>
      <div class="b3-fi">${full ? fiHTML(g) : ""}</div>
    </div>
    <div class="b3-in">${full ? inHTML(g) : ""}</div>
    <div class="b3-b">${full ? backHTML(g) : ""}</div>
    <div class="b3-s"><b>${plat(g)}</b><span class="b3-sname">${name}</span><img alt="" class="b3-slogo" src="/art/${g.appid}/logo" data-fail="hide" onload="this.parentNode.classList.add('has-logo')"><i class="b3-smark"></i></div>
    <div class="b3-r"></div><div class="b3-t"></div><div class="b3-u"></div>
    <div class="b3-ref"><img alt="" decoding="async" src="/art/${g.appid}/portrait" data-fail="hide"></div>
  </div>`;
}

/** Give a shelf case its back and inside, in place (no new element, so nothing jumps or reloads). */
function fill(el, g) {
  if (el.dataset.full) return;
  el.dataset.full = "1";
  el.querySelector(".b3-fi").innerHTML = fiHTML(g);
  el.querySelector(".b3-in").innerHTML = inHTML(g);
  el.querySelector(".b3-b").innerHTML = backHTML(g);
  C.markLoaded && C.markLoaded(el);
}

// ---------- the shelf ----------
function mount(grid, list) {
  if (!tint.size) loadTints();
  const key = list.map((g) => g.appid).join(",");
  const fresh = !SC.root || !SC.root.isConnected || SC.root.parentNode !== grid;
  if (fresh) {
    grid.innerHTML = shellHTML();
    SC.root = grid.querySelector(".sc");
    SC.els.clear();
    bind();
  }
  const changed = key !== SC.key || fresh;
  if (changed) {
    const cur = SC.list[SC.sel];
    SC.list = list;
    SC.key = key;
    SC.sel = cur ? Math.max(0, list.findIndex((g) => g.appid === cur.appid)) : 0;
    if (SC.sel >= list.length) SC.sel = 0;
    for (const [id, el] of SC.els) if (!list.some((g) => g.appid === id)) { el.remove(); SC.els.delete(id); }
    SC.flipped = SC.open = false;
  }
  SC.list = list;   // same games, fresh details
  setView(SC.view);
  // A library refresh with the same games (playtime, downloads) must not snap a shelf that's moving.
  layout(changed);
}

function shellHTML() {
  return `<div class="sc">
    <div class="sc-bg"><i></i><i></i></div>
    <div class="sc-panel">
      <div class="sc-top">
        <div class="seg sc-views"><button data-scv="shelf">Shelf</button><button data-scv="bento">Collections</button></div>
        <div class="sc-tabs" id="sc-tabs"></div><span class="sc-pos" id="sc-pos"></span>
      </div>
      <div class="sc-mid">
        <div class="sc-stage" id="sc-stage"><div class="sc-spot"></div><div class="sc-track" id="sc-track"></div></div>
        <div class="sc-info" id="sc-info"></div>
      </div>
      <div class="sc-bento" id="sc-bento" hidden></div>
    </div>
    <div class="sc-keys"><span><kbd>←</kbd><kbd>→</kbd> Browse</span><span><kbd>PgUp</kbd><kbd>PgDn</kbd> Fast</span><span><kbd>Enter</kbd> Details</span>
      <span><kbd>Space</kbd> Play</span><span><kbd>F</kbd> Flip</span><span><kbd>O</kbd> Open</span><span><kbd>R</kbd> Random</span></div>
  </div>`;
}

// The library's own filters, as tabs inside the panel (like platform tabs on a console shelf).
function paintTabs() {
  const box = $("#sc-tabs");
  if (!box) return;
  const on = document.querySelector("#filters .on");
  box.innerHTML = [...document.querySelectorAll("#filters [data-filter]")].filter((b) => !b.hidden)
    .map((b) => `<button data-sctab="${b.dataset.filter}" class="${b === on ? "on" : ""}">${esc(b.textContent.trim())}</button>`).join("");
}

// Case size comes from the room there is: as big as fits, like the video's hero case.
function dims() {
  const sc = SC.root;
  const W = sc ? sc.clientWidth : 1400;
  const panel = sc && sc.querySelector(".sc-panel");
  const roomH = (panel ? panel.clientHeight : innerHeight - 220) - 60 - 170;   // tabs, title + buttons
  // Case + its floor reflection need about 1.75 × the case height.
  const w = Math.round(Math.max(150, Math.min(roomH / 1.4 / 1.75, W * 0.15, 440)));
  return { w, h: Math.round(w * 1.4), d: Math.round(w * 0.1) };
}

// Cover-flow, as one smooth function of how far a case is from the middle. While the shelf moves
// that distance is a fraction, so every case follows the same path at the same speed, whichever
// way you go and however fast. The cases turning in and out turn early, so they clear each other.
const ANGLE = 62;
function place(off, D) {
  const a = Math.abs(off), side = off < 0 ? -1 : 1;
  const gap = D.w * 0.74, step = D.w * 0.3, zc = D.w * 0.42, zn = -D.w * 0.12;
  if (a <= 1) {
    const turn = Math.sin(Math.min(1, a * 1.6) * Math.PI / 2);
    return { x: side * gap * a, z: zc + (zn - zc) * a, ry: -side * ANGLE * turn, lit: 1 - 0.2 * a };
  }
  const k = a - 1;
  return { x: side * (gap + k * step), z: zn - k * 4, ry: -side * ANGLE, lit: Math.max(0.4, 0.8 - k * 0.055) };
}

// The panel fills the window below the library header, whatever the screen size.
function fit() {
  if (!SC.root || !SC.root.isConnected) return;
  const top = SC.root.getBoundingClientRect().top + (document.getElementById("main")?.scrollTop || 0);
  SC.root.style.height = `${Math.max(520, innerHeight - top - 14)}px`;
}

/** Size everything for the room there is, then draw. `instant` jumps straight to the picked case. */
function layout(instant) {
  fit();
  if (!$("#sc-track") || SC.view !== "shelf") return;
  const D = SC.D = dims();
  SC.root.style.setProperty("--bw", D.w + "px");
  SC.root.style.setProperty("--bh", D.h + "px");
  SC.root.style.setProperty("--bd", D.d + "px");
  // Enough cases to run past both edges of the panel, so none ever pops in where you can see it.
  const half = (SC.root.clientWidth || 1400) / 2;
  SC.span = Math.max(5, Math.min(40, Math.ceil((half + D.w - D.w * 0.74) / (D.w * 0.3)) + 3));
  paintTabs();
  if (instant) { stop(); SC.pos = SC.sel; SC.flipA = SC.flipped ? 1 : 0; render(); }
  else kick();
  paintInfo();
}

/** Put every case where it belongs for the shelf's current (possibly in-between) position. */
function render() {
  const track = $("#sc-track");
  if (!track || !SC.D) return;
  const D = SC.D, n = SC.list.length, span = SC.span || WINDOW;
  const lo = Math.max(0, Math.floor(SC.pos - span)), hi = Math.min(n - 1, Math.ceil(SC.pos + span));
  const keep = new Set();
  const settled = Math.abs(SC.pos - SC.sel) < 0.35;
  for (let i = lo; i <= hi; i++) {
    const g = SC.list[i];
    keep.add(g.appid);
    let el = SC.els.get(g.appid);
    if (!el) {
      const tmp = document.createElement("div");
      tmp.innerHTML = caseHTML(g, false);
      el = tmp.firstElementChild;
      track.appendChild(el);
      SC.els.set(g.appid, el);
      C.markLoaded && C.markLoaded(el);
      const img = el.querySelector("[data-tintfor]");
      if (img) (img.complete ? measureTint(g.appid, img) : img.addEventListener("load", () => measureTint(g.appid, img), { once: true }));
    }
    const picked = i === SC.sel;
    if (picked && settled) fill(el, g);
    const off = i - SC.pos;
    const p = place(off, D);
    let ry = p.ry;
    if (picked && SC.flipA) ry += 180 * SC.flipA * Math.max(0, 1 - Math.abs(off) * 2);
    if (!picked && el.style.getPropertyValue("--tx")) { el.style.removeProperty("--tx"); el.style.removeProperty("--ty"); el.style.removeProperty("--gx"); }
    el.classList.toggle("on", picked);
    el.classList.toggle("open", picked && SC.open);
    el.classList.toggle("lft", i < SC.sel);
    el.style.setProperty("--lit", p.lit.toFixed(3));
    el.style.transform = `translate3d(${p.x.toFixed(1)}px,var(--hy),${p.z.toFixed(1)}px) rotateY(${ry.toFixed(2)}deg) rotateX(var(--tx)) rotateY(var(--ty))`;
  }
  for (const [id, el] of SC.els) if (!keep.has(id)) { el.remove(); SC.els.delete(id); }
}

// One animation loop drives the whole shelf: the position eases toward the picked case
// (or follows the pointer while you drag), and the flip eases the same way.
function frame(now) {
  SC.raf = 0;
  const dt = Math.min(0.1, Math.max(0, (now - SC.last) / 1000));
  SC.last = now;
  const dragging = SC.drag && SC.drag.moved;
  const tgt = dragging ? SC.drag.pos : SC.sel;
  SC.pos += (tgt - SC.pos) * (1 - Math.exp(-(dragging ? 28 : 9) * dt));
  if (Math.abs(tgt - SC.pos) < 0.002) SC.pos = tgt;
  const ft = SC.flipped ? 1 : 0;
  SC.flipA += (ft - SC.flipA) * (1 - Math.exp(-8 * dt));
  if (Math.abs(ft - SC.flipA) < 0.003) SC.flipA = ft;
  render();
  if (dragging || SC.pos !== tgt || SC.flipA !== ft) SC.raf = requestAnimationFrame(frame);
}
function kick() {
  if (SC.raf || !SC.root || !SC.root.isConnected) return;
  SC.last = performance.now();
  SC.raf = requestAnimationFrame(frame);
}
function stop() { if (SC.raf) cancelAnimationFrame(SC.raf); SC.raf = 0; }

function cur() { return SC.list[SC.sel]; }

const ICO = {
  details: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  flip: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>',
  open: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/></svg>',
  random: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" class="fill"/><circle cx="15" cy="15" r="1.2" class="fill"/><circle cx="15" cy="9" r="1.2" class="fill"/><circle cx="9" cy="15" r="1.2" class="fill"/></svg>',
  view3d: '<svg viewBox="0 0 24 24"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>',
};

// The title and buttons under the shelf. Built once and updated in place, so the buttons keep
// focus and the title only fades in when you stop on a game, not on every case you pass.
function paintInfo() {
  const g = cur();
  const info = $("#sc-info");
  if (!info) return;
  $("#sc-pos").textContent = SC.list.length ? `${SC.sel + 1} / ${SC.list.length}` : "";
  if (!g) { info.innerHTML = ""; delete info.dataset.appid; return; }
  if (!info.querySelector(".sc-acts")) {
    info.innerHTML = `<h2></h2><p></p><div class="sc-acts">
      <button class="sc-a pri" data-sca="play"></button>
      <button class="sc-a" data-sca="details">${ICO.details}Details</button>
      <button class="sc-a" data-sca="flip"></button>
      <button class="sc-a" data-sca="open"></button>
      <button class="sc-a" data-sca="random">${ICO.random}Random</button>
      <button class="sc-a" data-sca="view3d">${ICO.view3d}3D view</button></div>`;
  }
  const m = C.meta(g.appid);
  const bits = [g.shortcut ? "Non-Steam" : "Steam",
    g.lastplayed ? `played ${C.fmtAgo(g.lastplayed)}` : "never played",
    g.playtime ? C.fmtPlay(g.playtime) : "",
    !g.installed ? "not installed" : g.update_pending ? "update ready" : "",
    m.status ? C.statusLabel(m.status) : ""].filter(Boolean);
  const h2 = info.querySelector("h2");
  if (info.dataset.appid !== String(g.appid)) {
    info.dataset.appid = g.appid;
    h2.textContent = C.gname(g.name);
    // A single step fades the title in; while you run along the shelf it just swaps.
    const now = performance.now(), calm = now - SC.titleAt > 350;
    SC.titleAt = now;
    h2.classList.remove("fx");
    if (calm) { void h2.offsetWidth; h2.classList.add("fx"); }
  }
  info.querySelector("p").innerHTML = `${bits.map(esc).join(" · ")}${m.rating ? ` · ${C.stars(m.rating)}` : ""}`;
  const set = (k, html, on) => { const b = info.querySelector(`[data-sca="${k}"]`); if (b.innerHTML !== html) b.innerHTML = html; b.classList.toggle("on", !!on); };
  set("play", `${g.installed ? ICON.play : ICON.down}${g.installed ? "Play" : "Install"}`);
  set("flip", `${ICO.flip}${SC.flipped ? "Front" : "Back"}`, SC.flipped);
  set("open", `${ICO.open}${SC.open ? "Close case" : "Open case"}`, SC.open);
  clearTimeout(SC.bgFor);
  SC.bgFor = setTimeout(() => setBg(g.appid), 260);
}

function setBg(appid) {
  const ls = SC.root && SC.root.querySelectorAll(".sc-bg i");
  if (!ls || !ls.length) return;
  const img = new Image();
  img.onload = () => {
    if (!cur() || cur().appid !== appid) return;
    const [a, b] = ls[0].classList.contains("on") ? [ls[1], ls[0]] : [ls[0], ls[1]];
    a.style.backgroundImage = `url('/art/${appid}/hero')`;
    a.classList.add("on");
    b.classList.remove("on");
  };
  img.src = `/art/${appid}/hero`;
}

/** Pick case n. A long jump starts the glide a short way out, so it doesn't race past hundreds of cases. */
function go(n, instant, lead = 14) {
  const max = SC.list.length - 1;
  if (max < 0) return;
  n = Math.max(0, Math.min(max, n));
  if (n === SC.sel) { if (!instant) bump(); return; }
  SC.sel = n;
  SC.flipped = SC.open = false;
  if (instant) return layout(true);
  if (Math.abs(n - SC.pos) > lead + 6) SC.pos = n - Math.sign(n - SC.pos) * lead;
  paintInfo();
  kick();
}

function bump() {
  const el = SC.els.get(cur() && cur().appid);
  if (!el) return;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

// Random: one long glide along the shelf that slows down onto the game it lands on.
function randomSpin() {
  const all = SC.list.map((g, i) => [g, i]);
  const pool = all.filter(([g, i]) => g.installed && i !== SC.sel);
  const from = pool.length ? pool : all.filter(([, i]) => i !== SC.sel);
  const pick = from[Math.floor(Math.random() * from.length)];
  if (!pick) return;
  go(pick[1], false, 24);
}

function act(a) {
  const g = cur();
  if (!g) return;
  if (a === "play") return C.launch(g.appid);
  if (a === "details") return C.library.openDetail(g.appid);
  if (a === "flip" || a === "open") {
    if (a === "flip") { SC.flipped = !SC.flipped; if (SC.flipped) SC.open = false; }
    else { SC.open = !SC.open; if (SC.open) SC.flipped = false; }
    const el = SC.els.get(g.appid);
    if (el) fill(el, g);
    paintInfo();
    return kick() || render();
  }
  if (a === "random") return randomSpin();
  if (a === "view3d") return openViewer(g.appid);
}

// ---------- collections (bento) ----------
function bentoHTML() {
  const fav = new Set(S.config.favorites || []);
  const all = S.games.filter((g) => !(S.config.hidden || []).includes(g.appid));
  const tiles = [
    { id: "", name: "Whole collection", n: all.length, games: [...all].sort((a, b) => (b.lastplayed || 0) - (a.lastplayed || 0)) },
    { id: "@fav", name: "Favorites", n: fav.size, games: all.filter((g) => fav.has(g.appid)) },
    { id: "@inst", name: "Installed", n: all.filter((g) => g.installed).length, games: all.filter((g) => g.installed) },
    ...(C.lists ? C.lists.all() : []).map((l) => {
      const set = new Set(l.appids);
      const gs = all.filter((g) => set.has(g.appid)).sort((a, b) => (b.playtime || 0) - (a.playtime || 0));
      return { id: l.id, name: l.name, n: gs.length, games: gs };
    }),
  ].filter((t) => t.n || t.id === "");
  const active = C.lists && C.lists.active() ? C.lists.active().id : "";
  return `<div class="bento">${tiles.map((t, i) => {
    const big = i === 0 || t.n >= 12;
    const hero = t.games[0];
    const cov = t.games.slice(0, big ? 5 : 3);
    return `<button class="bt${big ? " big" : ""}${(t.id === active && !t.id.startsWith("@")) ? " on" : ""}" data-bento="${esc(t.id)}">
      ${hero ? `<span class="bt-bg" style="background-image:url('/art/${hero.appid}/hero')"></span>` : ""}
      <span class="bt-fan">${cov.map((g, k) => `<img alt="" loading="lazy" src="/art/${g.appid}/portrait" data-fail="hide" style="--k:${k};--n:${cov.length}">`).join("")}</span>
      <span class="bt-txt"><b>${esc(t.name)}</b><small>${t.n} game${t.n === 1 ? "" : "s"}</small></span>
    </button>`;
  }).join("")}</div>`;
}

function setView(v) {
  SC.view = v;
  if (!SC.root) return;
  SC.root.classList.toggle("bento-on", v === "bento");
  SC.root.querySelectorAll("[data-scv]").forEach((b) => b.classList.toggle("on", b.dataset.scv === v));
  $("#sc-bento").hidden = v !== "bento";
  if (v === "bento") { $("#sc-bento").innerHTML = bentoHTML(); C.markLoaded && C.markLoaded($("#sc-bento")); }
}

function pickBento(id) {
  if (id === "@fav") { document.querySelector('#filters [data-filter="favorites"]')?.click(); C.lists && C.lists.select(null); }
  else if (id === "@inst") { document.querySelector('#filters [data-filter="installed"]')?.click(); C.lists && C.lists.select(null); }
  else {
    document.querySelector('#filters [data-filter="all"]')?.click();
    C.lists && C.lists.select(id || null);
  }
  SC.sel = 0;
  setView("shelf");
  C.library.render();
}

// ---------- input ----------
function bind() {
  const root = SC.root;
  const stage = $("#sc-stage");
  root.addEventListener("click", (e) => {
    if (performance.now() - SC.dragEnd < 80) return;   // the end of a drag, not a click
    const v = e.target.closest("[data-scv]");
    if (v) return setView(v.dataset.scv), layout(true);
    const b = e.target.closest("[data-bento]");
    if (b) return pickBento(b.dataset.bento);
    const a = e.target.closest("[data-sca]");
    if (a) return act(a.dataset.sca);
    const t = e.target.closest("[data-sctab]");
    if (t) { SC.sel = 0; document.querySelector(`#filters [data-filter="${t.dataset.sctab}"]`)?.click(); return; }
    const box = e.target.closest(".b3");
    if (box) {
      const i = SC.list.findIndex((g) => g.appid === +box.dataset.appid);
      if (i === SC.sel) return act(SC.open ? "open" : "details");
      return go(i);
    }
  });
  stage.addEventListener("wheel", (e) => {
    if (SC.view !== "shelf") return;
    e.preventDefault();
    const dl = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const now = performance.now();
    // A mouse wheel notch is always exactly one case; a touchpad's small deltas add up.
    if (Math.abs(dl) >= 40) { SC.wheel = 0; SC.wheelAt = now; return go(SC.sel + Math.sign(dl)); }
    if (now - (SC.wheelAt || 0) > 250) SC.wheel = 0;
    SC.wheelAt = now;
    SC.wheel = (SC.wheel || 0) + dl;
    if (Math.abs(SC.wheel) >= 60) { const n = Math.sign(SC.wheel); SC.wheel -= n * 60; go(SC.sel + n); }
  }, { passive: false });
  // Click and drag: the shelf follows the pointer, and a flick keeps it gliding.
  const perCase = () => (SC.D ? SC.D.w : 240) * 0.45;
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || SC.view !== "shelf") return;
    SC.drag = { x: e.clientX, start: SC.pos, pos: SC.pos, moved: false, id: e.pointerId, pts: [[e.clientX, performance.now()]] };
  });
  stage.addEventListener("pointermove", (e) => {
    const d = SC.drag;
    if (!d || e.pointerId !== d.id) { tiltTo(e); return; }
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true;
      try { stage.setPointerCapture(d.id); } catch { /* fine */ }
      stage.classList.add("dragging");
      tiltTo(null);
    }
    if (!d.moved) return;
    d.pts.push([e.clientX, performance.now()]);
    if (d.pts.length > 6) d.pts.shift();
    const max = SC.list.length - 1;
    let pos = d.start - dx / perCase();
    if (pos < 0) pos = -0.4 * (1 - Math.exp(pos));                 // a little give past the ends
    else if (pos > max) pos = max + 0.4 * (1 - Math.exp(max - pos));
    d.pos = pos;
    const n = Math.max(0, Math.min(max, Math.round(pos)));
    if (n !== SC.sel) { SC.sel = n; SC.flipped = SC.open = false; paintInfo(); }
    kick();
  });
  const end = (e) => {
    const d = SC.drag;
    if (!d || e.pointerId !== d.id) return;
    SC.drag = null;
    stage.classList.remove("dragging");
    if (!d.moved) return;
    SC.dragEnd = performance.now();
    const [x0, t0] = d.pts[0], [x1, t1] = d.pts[d.pts.length - 1];
    const v = t1 > t0 && performance.now() - t1 < 90 ? (x1 - x0) / (t1 - t0) : 0;   // px per ms
    const n = Math.round(d.pos - (v * 260) / perCase());
    const max = SC.list.length - 1;
    SC.sel = Math.max(0, Math.min(max, n));
    SC.flipped = SC.open = false;
    paintInfo();
    kick();
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("pointerleave", () => tiltTo(null));
  window.addEventListener("resize", () => { if (SC.root && SC.root.isConnected) layout(true); });
}

// The picked case leans toward the mouse, and its plastic catches the light.
function tiltTo(e) {
  const el = cur() && SC.els.get(cur().appid);
  if (!el) return;
  if (!e || SC.drag) { el.style.removeProperty("--tx"); el.style.removeProperty("--ty"); el.style.removeProperty("--gx"); return; }
  const r = el.getBoundingClientRect();
  const px = (e.clientX - (r.left + r.width / 2)) / Math.max(200, r.width);
  const py = (e.clientY - (r.top + r.height / 2)) / Math.max(260, r.height);
  if (Math.abs(px) > 1.6 || Math.abs(py) > 1.4) return tiltTo(null);
  el.style.setProperty("--tx", `${(-py * 10).toFixed(2)}deg`);
  el.style.setProperty("--ty", `${(px * 14).toFixed(2)}deg`);
  el.style.setProperty("--gx", `${(50 + px * 60).toFixed(1)}%`);
}

function onKey(e) {
  if (C.route.tab !== "library" || !SC.root || !SC.root.isConnected || SC.view !== "shelf") return false;
  if (document.querySelector(".overlay:not([hidden])") || (e.target.matches && e.target.matches("input, textarea, select"))) return false;
  const k = e.key;
  if (k === "ArrowRight") go(SC.sel + 1);
  else if (k === "ArrowLeft") go(SC.sel - 1);
  else if (k === "Home") go(0);
  else if (k === "End") go(SC.list.length - 1);
  else if (k === "PageDown") go(SC.sel + 8);
  else if (k === "PageUp") go(SC.sel - 8);
  else if (k === "Enter") act("details");
  else if (k === " ") act("play");
  else if (k === "f" || k === "F") act("flip");
  else if (k === "o" || k === "O") act("open");
  else if (k === "r" || k === "R") act("random");
  else return false;
  e.preventDefault();
  return true;
}

// ---------- the big 3D viewer ----------
const VW = { rx: -8, ry: -24, vx: 0, vy: 0, auto: false, raf: 0, drag: null, appid: 0 };

function openViewer(appid) {
  const g = S.games.find((x) => x.appid === appid) || { appid, name: "", installed: false };
  const ov = $("#b3v");
  VW.appid = appid;
  ov.querySelector(".b3v-bg").style.backgroundImage = `url('/art/${appid}/hero')`;
  $("#b3v-stage").innerHTML = caseHTML(g, true);
  $("#b3v-name").textContent = C.gname(g.name || "");
  const el = $("#b3v-stage .b3");
  el.dataset.full = "1";
  el.classList.add("on", "big");
  C.markLoaded && C.markLoaded(el);
  const img = el.querySelector("[data-tintfor]");
  if (img) (img.complete ? measureTint(appid, img) : img.addEventListener("load", () => measureTint(appid, img), { once: true }));
  Object.assign(VW, { rx: -6, ry: -28, vx: 0, vy: 0, auto: false, open: false });
  paintBtns();
  ov.hidden = false;
  VW.ry = -120;
  spinTo(-6, -28);
  loop();
}

function closeViewer() {
  $("#b3v").hidden = true;
  cancelAnimationFrame(VW.raf);
  VW.raf = 0;
}

function apply() {
  const el = $("#b3v-stage .b3");
  if (el) el.style.transform = `rotateX(${VW.rx}deg) rotateY(${VW.ry}deg)`;
}

let spinTarget = null;
function spinTo(rx, ry) {
  // Take the short way round.
  const d = ((ry - VW.ry) % 360 + 540) % 360 - 180;
  spinTarget = { rx, ry: VW.ry + d };
  VW.vx = VW.vy = 0;
  VW.auto = false;
  paintBtns();
}

function loop() {
  if ($("#b3v").hidden) return;
  VW.raf = requestAnimationFrame(loop);
  if (VW.drag) return apply();
  if (spinTarget) {
    VW.rx += (spinTarget.rx - VW.rx) * 0.12;
    VW.ry += (spinTarget.ry - VW.ry) * 0.12;
    if (Math.abs(spinTarget.ry - VW.ry) < 0.1 && Math.abs(spinTarget.rx - VW.rx) < 0.1) spinTarget = null;
  } else if (VW.auto) {
    VW.ry += 0.45;
  } else if (Math.abs(VW.vx) > 0.01 || Math.abs(VW.vy) > 0.01) {
    VW.ry += VW.vy; VW.rx = Math.max(-70, Math.min(70, VW.rx + VW.vx));
    VW.vx *= 0.94; VW.vy *= 0.94;
  }
  apply();
}

function paintBtns() {
  document.querySelectorAll("#b3v [data-b3]").forEach((b) => {
    const k = b.dataset.b3;
    b.classList.toggle("on", (k === "spin" && VW.auto) || (k === "open" && VW.open));
  });
  const el = $("#b3v-stage .b3");
  if (el) el.classList.toggle("open", !!VW.open);
}

function viewerAct(k) {
  if (k === "front") { VW.open = false; spinTo(-4, 0); }
  else if (k === "back") { VW.open = false; spinTo(-4, 180); }
  else if (k === "spine") { VW.open = false; spinTo(-4, 90); }
  else if (k === "open") { VW.open = !VW.open; spinTo(-10, VW.open ? -18 : -28); }
  else if (k === "disc") { VW.open = true; spinTo(-58, -6); }
  else if (k === "spin") { VW.auto = !VW.auto; spinTarget = null; }
  else if (k === "details") { const id = VW.appid; closeViewer(); C.library.openDetail(id); return; }
  else if (k === "play") { C.launch(VW.appid); return; }
  paintBtns();
}

function bindViewer() {
  const ov = $("#b3v");
  const stage = $("#b3v-stage");
  ov.addEventListener("click", (e) => {
    const b = e.target.closest("[data-b3]");
    if (b) return viewerAct(b.dataset.b3);
    if (e.target.closest("[data-b3close]") || e.target === ov) closeViewer();
  });
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    VW.drag = { x: e.clientX, y: e.clientY, rx: VW.rx, ry: VW.ry, last: [e.clientX, e.clientY, performance.now()] };
    VW.auto = false; spinTarget = null; paintBtns();
    try { stage.setPointerCapture(e.pointerId); } catch { /* fine */ }
    stage.classList.add("grab");
  });
  stage.addEventListener("pointermove", (e) => {
    const d = VW.drag;
    if (!d) return;
    VW.ry = d.ry + (e.clientX - d.x) * 0.45;
    VW.rx = Math.max(-70, Math.min(70, d.rx - (e.clientY - d.y) * 0.35));
    const now = performance.now(), [lx, ly, lt] = d.last, dt = Math.max(8, now - lt);
    VW.vy = ((e.clientX - lx) * 0.45) / dt * 16;
    VW.vx = (-(e.clientY - ly) * 0.35) / dt * 16;
    d.last = [e.clientX, e.clientY, now];
  });
  const up = () => { VW.drag = null; stage.classList.remove("grab"); };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  stage.addEventListener("wheel", (e) => { e.preventDefault(); VW.ry += e.deltaY * 0.2; VW.auto = false; spinTarget = null; paintBtns(); }, { passive: false });
  document.addEventListener("keydown", (e) => {
    if (ov.hidden) return;
    const map = { ArrowLeft: () => { spinTarget = null; VW.vy = -4; }, ArrowRight: () => { spinTarget = null; VW.vy = 4; },
      ArrowUp: () => { spinTarget = null; VW.vx = 3; }, ArrowDown: () => { spinTarget = null; VW.vx = -3; },
      f: () => viewerAct("front"), b: () => viewerAct("back"), s: () => viewerAct("spine"), o: () => viewerAct("open"), d: () => viewerAct("disc"), " ": () => viewerAct("spin"),
      Escape: closeViewer };
    const fn = map[e.key];
    if (fn) { e.preventDefault(); e.stopImmediatePropagation(); fn(); }
  }, true);
}

function init() {
  bindViewer();
  document.addEventListener("keydown", (e) => { if (onKey(e)) e.stopImmediatePropagation(); }, true);
}

// For the controller: is the shelf what you're looking at?
function active() {
  return !!(SC.root && SC.root.isConnected && SC.view === "shelf" && C.route.tab === "library" && !document.querySelector(".overlay:not([hidden])"));
}

C.showcase = { mount, init, openViewer, caseHTML, active, step: (d) => go(SC.sel + d), act, go: (n) => go(n), state: SC };
})();
