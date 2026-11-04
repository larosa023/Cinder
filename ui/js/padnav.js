/* Controller everywhere: drive the whole app (not just couch mode) with a gamepad.

   D-pad / left stick: move between buttons, cards and fields (nearest one in that direction)
   A: select · B: back (closes menus and windows first) · Y: search · LB/RB: previous/next tab
   Right stick: scroll · Start: couch mode (handled by couch.js)
   Only runs while a controller is connected and Cinder is the window in front. */
(() => {
"use strict";
const { $ } = C;
const P = { cur: null, timer: 0, idle: 0, prev: new Set(), hold: { dir: "", next: 0, n: 0 }, fg: true, fgAt: 0 };
const SEL = 'button:not([disabled]), a[href], input:not([type="hidden"]):not([type="file"]), select, textarea, [tabindex]:not([tabindex="-1"]), [data-app], [role="button"]';
const BTN = { 0: "a", 1: "b", 3: "y", 4: "lb", 5: "rb", 12: "up", 13: "down", 14: "left", 15: "right" };

const enabled = () => C.S.config.controller_nav !== false;
function pads() {
  const all = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected !== false) : [];
  const std = all.filter((p) => p.mapping === "standard");
  return std.length ? std : all;
}

// Where focus can go: the top open window if there is one, else the page.
function scope() {
  const menus = ["#card-menu", "#list-picker", "#lists-menu", "#status-menu", ".wl-pop"].map((s) => document.querySelector(s)).filter((m) => m && !m.hidden && m.offsetParent);
  if (menus.length) return menus[menus.length - 1];
  const ovs = [...document.querySelectorAll(".overlay:not([hidden])")];
  return ovs.length ? ovs[ovs.length - 1] : document.body;
}
function candidates() {
  const root = scope();
  const out = [];
  for (const el of root.querySelectorAll(SEL)) {
    if (el.closest("[hidden], #couch")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (el.matches("[data-app]") && el.parentElement && el.parentElement.closest("[data-app]")) continue;  // the card, not its insides
    out.push(el);
  }
  return out;
}

function center(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; }

function pickStart(list) {
  const visible = list.filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 60 && r.top < innerHeight; });
  const main = visible.filter((el) => el.closest("#main, .overlay"));
  return (main[0] || visible[0] || list[0]) || null;
}

function moveFocus(dir) {
  const list = candidates();
  if (!list.length) return;
  if (!P.cur || !P.cur.isConnected || !list.includes(P.cur)) return setCur(pickStart(list));
  const a = center(P.cur);
  let best = null, bestScore = Infinity;
  for (const el of list) {
    if (el === P.cur) continue;
    const b = center(el);
    const dx = b.x - a.x, dy = b.y - a.y;
    let main, side;
    if (dir === "right") { main = b.r.left - a.r.right + a.r.width / 2; side = Math.abs(dy); if (dx <= 4) continue; }
    else if (dir === "left") { main = a.r.left - b.r.right + a.r.width / 2; side = Math.abs(dy); if (dx >= -4) continue; }
    else if (dir === "down") { main = b.r.top - a.r.bottom + a.r.height / 2; side = Math.abs(dx); if (dy <= 4) continue; }
    else { main = a.r.top - b.r.bottom + a.r.height / 2; side = Math.abs(dx); if (dy >= -4) continue; }
    const score = Math.max(0, main) + side * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) setCur(best);
}

function setCur(el) {
  if (!el) return;
  if (P.cur) P.cur.classList.remove("pad-focus");
  P.cur = el;
  el.classList.add("pad-focus");
  if (el.matches("input, select, textarea, button, a, [tabindex]")) el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function back() {
  const ae = document.activeElement;
  if (ae && ae.matches("input, textarea") && ae.value === "" && ae !== document.body) { ae.blur(); }
  const open = document.querySelector(".overlay:not([hidden])") || [...document.querySelectorAll("#card-menu, #list-picker, #lists-menu, .wl-pop")].some((m) => !m.hidden);
  if (open) { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); P.cur = null; return; }
  history.back();
}

function press(b) {
  document.body.classList.add("pad-nav");
  if (b === "up" || b === "down" || b === "left" || b === "right") {
    const el = P.cur;
    // A focused dropdown: left/right picks the option.
    if (el && el.matches("select") && (b === "left" || b === "right") && document.activeElement === el) {
      el.selectedIndex = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + (b === "right" ? 1 : -1)));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    return moveFocus(b);
  }
  if (b === "a") {
    if (!P.cur || !P.cur.isConnected) return moveFocus("down");
    if (P.cur.matches("input[type=checkbox], input[type=radio]")) { P.cur.click(); return; }
    if (P.cur.matches("input, textarea")) { P.cur.focus(); return; }
    P.cur.click();
    setTimeout(() => { if (P.cur && !P.cur.isConnected) P.cur = null; }, 300);
    return;
  }
  if (b === "b") return back();
  if (b === "y") { const s = $("#search"); s.focus(); s.select(); setCur(s); return; }
  if (b === "lb" || b === "rb") {
    const i = C.TABS.findIndex((t) => t.id === C.route.tab);
    const n = C.TABS[(i + (b === "rb" ? 1 : -1) + C.TABS.length) % C.TABS.length];
    C.closeOverlays();
    P.cur = null;
    C.go(n.id);
  }
}

function frontmost() {
  if (document.hidden) return false;
  if (document.hasFocus()) return true;
  const api = window.pywebview && window.pywebview.api;
  if (api && typeof api.foreground === "function" && performance.now() - P.fgAt > 500) {
    P.fgAt = performance.now();
    api.foreground().then((v) => { P.fg = !!v; }).catch(() => {});
  }
  return P.fg;
}

function poll(t) {
  P.timer = requestAnimationFrame(poll);
  if (!enabled() || (C.couch && C.couch.isOpen())) { P.prev = new Set(["a", "b"]); return; }
  const ps = pads();
  if (!ps.length) { cancelAnimationFrame(P.timer); P.timer = 0; return; }
  if (!frontmost()) { P.prev = new Set(["a", "b", "y"]); return; }
  const down = new Set();
  let scroll = 0;
  for (const p of ps) {
    p.buttons.forEach((x, i) => { if (x.pressed && BTN[i]) down.add(BTN[i]); });
    const [ax = 0, ay = 0, , ry = 0] = p.axes;
    if (ax < -0.6) down.add("left"); else if (ax > 0.6) down.add("right");
    if (ay < -0.6) down.add("up"); else if (ay > 0.6) down.add("down");
    if (Math.abs(ry) > 0.2) scroll = ry;
  }
  if (scroll) {
    const ov = document.querySelector(".overlay:not([hidden]) .d-body, .overlay:not([hidden]) .news-body, .overlay:not([hidden]) .review-body, .overlay:not([hidden]) .guide-body, .overlay:not([hidden]) .panel");
    (ov || $("#main")).scrollBy(0, scroll * 22);
    document.body.classList.add("pad-nav");
  }
  for (const b of down) if (!["up", "down", "left", "right"].includes(b) && !P.prev.has(b)) press(b);
  const dir = ["up", "down", "left", "right"].find((d) => down.has(d)) || "";
  const h = P.hold;
  if (dir !== h.dir) { h.dir = dir; h.n = 0; if (dir) { press(dir); h.next = t + 360; } }
  else if (dir && t >= h.next) { press(dir); h.n++; h.next = t + Math.max(70, 160 - h.n * 12); }
  P.prev = down;
}

function start() { if (!P.timer && enabled()) P.timer = requestAnimationFrame(poll); }

function init() {
  window.addEventListener("gamepadconnected", start);
  window.addEventListener("focus", () => { if (pads().length) start(); });
  setInterval(() => { if (!P.timer && pads().length) start(); }, 2000);
  // The mouse takes over again as soon as you move it.
  window.addEventListener("mousemove", () => {
    if (!document.body.classList.contains("pad-nav")) return;
    document.body.classList.remove("pad-nav");
    if (P.cur) P.cur.classList.remove("pad-focus");
  }, { passive: true });
  window.addEventListener("hashchange", () => { P.cur = null; });
}

C.padnav = { init, press };
})();
