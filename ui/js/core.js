/* Cinder core: helpers, state, router, window controls. Everything hangs off window.C. */
(() => {
"use strict";
const C = (window.C = {});

C.$ = (s, el = document) => el.querySelector(s);
C.$$ = (s, el = document) => [...el.querySelectorAll(s)];
C.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
C.S = { games: [], config: {}, themes: [], user: null, steam: {}, platform: "", native: false };
const { $, $$ } = C;

C.api = async (path, body) => {
  const opts = { method: body === undefined ? "GET" : "POST", headers: { "X-Cinder-Token": window.CINDER_TOKEN } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || r.statusText);
  return data;
};

C.act = async (action, extra = {}) => {
  try {
    await C.api("/api/action", { action, ...extra });
    return true;
  } catch (e) { C.toast(e.message, true); return false; }
};

// ---------- formatting ----------
C.fmtPlay = (m) => !m ? "Never" : m < 60 ? `${m} min` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} hrs`;
C.fmtAgo = (ts) => {
  if (!ts) return "Never";
  const s = Date.now() / 1000 - ts;
  if (s < 90) return "Just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 86400 * 2) return "Yesterday";
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return C.fmtDate(ts);
};
C.fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
C.fmtSize = (b) => {
  if (!b) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < 4) { b /= 1024; i++; }
  return `${b.toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
};
C.money = (cents, currency) => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency || ""}`; }
};
/** Price block HTML from the backend's {free} / {currency, final, initial, discount}. */
C.priceHTML = (p, cls = "") => {
  if (!p) return `<span class="price ${cls} na">—</span>`;
  if (p.free) return `<span class="price ${cls}"><b>Free</b></span>`;
  if (p.discount > 0) {
    return `<span class="price ${cls} sale"><em>-${p.discount}%</em><s>${C.money(p.initial, p.currency)}</s><b>${C.money(p.final, p.currency)}</b></span>`;
  }
  return `<span class="price ${cls}"><b>${C.money(p.final, p.currency)}</b></span>`;
};
C.sortKey = (n) => n.toLowerCase().replace(/^(the|a|an)\s+/, "");
C.ICON = {
  play: '<svg viewBox="0 0 24 24" class="fill"><path d="M7 4.5v15l12-7.5z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>',
  cart: '<svg viewBox="0 0 24 24"><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6"/><circle cx="9" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
};

let toastTimer;
C.toast = (msg, err = false) => {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (err ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), Math.max(2800, Math.min(8000, msg.length * 70)));
};

C.loading = (text = "Loading…") => `<div class="state"><span class="spinner"></span>${C.esc(text)}</div>`;
C.failed = (msg, retry = true) => `<div class="state err"><strong>${C.esc(msg)}</strong>${retry ? '<button class="btn sm" data-retry>Try again</button>' : ""}</div>`;

// ---------- router ----------
// Routes look like #/store, #/store/app/570, #/store/search/elden%20ring, #/profile/7656...
C.TABS = [
  { id: "library", label: "Library", icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/></svg>' },
  { id: "store", label: "Store", icon: '<svg viewBox="0 0 24 24"><path d="M4 9h16l-1.2 10a1 1 0 0 1-1 .9H6.2a1 1 0 0 1-1-.9L4 9Z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/></svg>' },
  { id: "wishlist", label: "Wishlist", icon: C.ICON.heart },
  { id: "friends", label: "Friends", icon: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>' },
  { id: "profile", label: "Profile", icon: C.ICON.user },
];
C.views = {};  // id -> { show(params), search?(q, enter), refresh?(), placeholder }
C.route = { tab: "library", params: [] };

C.go = (path) => {
  const h = "#/" + path;
  if (location.hash === h) C.onRoute(); else location.hash = h;
};

C.onRoute = () => {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  let tab = parts[0];
  if (!C.views[tab]) tab = C.S.config.start_tab && C.views[C.S.config.start_tab] ? C.S.config.start_tab : "library";
  const params = parts.slice(1).filter(Boolean);
  const changedTab = tab !== C.route.tab;
  C.route = { tab, params };
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${tab}`));
  $$("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("#nav-back").hidden = params.length === 0;
  const view = C.views[tab];
  const search = $("#search");
  search.placeholder = view.placeholder || "Search";
  if (changedTab) search.value = view.searchValue ? view.searchValue(params) : "";
  if (changedTab || params.length === 0) $("#main").scrollTop = 0;
  view.show(params);
};

C.renderNav = () => {
  const html = C.TABS.map((t, i) =>
    `<button data-tab="${t.id}" title="${t.label} (Ctrl+${i + 1})">${t.icon}<span>${t.label}</span></button>`).join("");
  $("#nav-top").innerHTML = html;
  $("#nav-side").innerHTML = html;
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => C.go(b.dataset.tab)));
};

C.log = (msg) => { C.api("/api/log", { msg: String(msg) }).catch(() => {}); };

// ---------- window controls (borderless window on Windows) ----------
C.winState = (state) => {
  document.body.classList.toggle("win-max", state && state !== "normal");
  $("#win-max").title = state === "normal" ? "Maximize" : "Restore";
  $("#win-max").innerHTML = state === "normal"
    ? '<svg viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7"/></svg>'
    : '<svg viewBox="0 0 12 12"><path d="M4 4V2.5h5.5V8H8"/><rect x="2.5" y="4" width="5.5" height="5.5"/></svg>';
};
window.cinderWinState = C.winState;

C.bindWindow = () => {
  const w = window.pywebview.api;
  const frameless = C.S.platform === "win32" && C.S.config.frameless;
  document.body.classList.toggle("native", !!frameless);
  C.log(`window controls: platform=${C.S.platform} frameless=${C.S.config.frameless}`);
  if (!frameless || C.boundWindow) return;
  C.boundWindow = true;
  $("#win-min").onclick = () => w.minimize();
  $("#win-max").onclick = async () => C.winState(await w.toggle_maximize());
  $("#win-close").onclick = () => w.close();

  // Title bar. Pressing it hands the drag to Windows (like a normal title bar);
  // Cinder snaps the window when you let go. A maximized window only starts
  // moving once you actually drag, so double-click still works.
  const bar = $("#titlebar");
  const isControl = (t) => t.closest("button, input, select, a, label, .navtabs, kbd");
  let lastDown = 0, lastX = 0, lastY = 0, pending = null, busy = false;

  const startDrag = async () => {
    if (busy) return;
    busy = true;
    try { C.winState(await w.drag()); }
    catch (err) { C.log("drag error: " + err); }
    busy = false;
  };
  const cancelPending = () => {
    if (!pending) return;
    window.removeEventListener("mousemove", pending.move);
    window.removeEventListener("mouseup", cancelPending);
    pending = null;
  };

  bar.addEventListener("mousedown", async (e) => {
    if (e.button !== 0 || isControl(e.target)) return;
    e.preventDefault();
    const now = Date.now();
    const dbl = now - lastDown < 450 && Math.abs(e.screenX - lastX) < 6 && Math.abs(e.screenY - lastY) < 6;
    lastDown = dbl ? 0 : now; lastX = e.screenX; lastY = e.screenY;
    if (dbl) { cancelPending(); C.winState(await w.toggle_maximize()); return; }
    if (!document.body.classList.contains("win-max")) { startDrag(); return; }
    // Maximized/snapped: wait for a real drag before popping it out.
    cancelPending();
    const sx = e.screenX, sy = e.screenY;
    pending = {
      move: (m) => {
        if (!(m.buttons & 1)) return cancelPending();
        if (Math.abs(m.screenX - sx) > 5 || Math.abs(m.screenY - sy) > 5) { cancelPending(); startDrag(); }
      },
    };
    window.addEventListener("mousemove", pending.move);
    window.addEventListener("mouseup", cancelPending);
  });

  // Window edges and corners: Windows' own resize.
  $$(".rz").forEach((el) => el.addEventListener("mousedown", async (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { C.winState(await w.resize(el.dataset.edge)); } catch (err) { C.log("resize error: " + err); }
  }));
  w.state().then(C.winState).catch(() => {});
};

// ---------- images: fade-in + graceful fallbacks ----------
document.addEventListener("load", (e) => {
  if (e.target.tagName === "IMG") e.target.dataset.loaded = "1";
}, true);
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName !== "IMG") return;
  if (img.dataset.fallback) {
    const fb = img.dataset.fallback;
    delete img.dataset.fallback;
    // A tall cover falling back to wide header art: show it centered on a blurred copy.
    const art = img.parentElement;
    if (art && art.classList.contains("art") && !art.closest(".grid.wide")) {
      art.classList.add("from-header");
      art.style.setProperty("--fb", `url("${fb}")`);
    }
    img.src = fb;
    return;
  }
  const fail = img.dataset.fail;
  if (fail === "hide") img.style.visibility = "hidden";
  else if (fail === "logo") img.closest(".d-title, .sp-title")?.classList.add("no-logo");
  else if (img.parentElement?.classList.contains("art")) img.parentElement.classList.remove("from-header"), img.parentElement.classList.add("missing");
  else img.style.visibility = "hidden";
}, true);
})();

/* Click-and-drag scrolling for horizontal rows, with a little momentum on release.
   A press that doesn't move still counts as a normal click. */
(() => {
  const ROWS = ".srow-items, .recent-row, .sp-thumbs";
  const THRESHOLD = 6;
  let row = null, startX = 0, startLeft = 0, dragged = false, lastX = 0, lastT = 0, vel = 0, glide = 0;

  const stopGlide = () => { cancelAnimationFrame(glide); glide = 0; };
  const finish = () => { if (row) row.classList.remove("dragging"); row = null; };

  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const r = e.target.closest(ROWS);
    if (!r || r.scrollWidth <= r.clientWidth) return;
    stopGlide();
    row = r; startX = lastX = e.clientX; startLeft = r.scrollLeft; lastT = performance.now();
    dragged = false; vel = 0;
    e.preventDefault();  // no text selection / image ghost while dragging
  });

  window.addEventListener("mousemove", (e) => {
    if (!row) return;
    if (!(e.buttons & 1)) return finish();
    const dx = e.clientX - startX;
    if (!dragged && Math.abs(dx) < THRESHOLD) return;
    if (!dragged) { dragged = true; row.classList.add("dragging"); }
    row.scrollLeft = startLeft - dx;
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    vel = 0.8 * vel + 0.2 * ((lastX - e.clientX) / dt);  // px per ms, smoothed
    lastX = e.clientX; lastT = now;
  });

  window.addEventListener("mouseup", () => {
    if (!row) return;
    const r = row;
    finish();
    if (!dragged) return;
    // Swallow the click that follows a drag so it doesn't open a game.
    // (Only if it comes right away; a release outside the window sends no click.)
    const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => { window.removeEventListener("click", swallow, { capture: true }); dragged = false; }, 60);
    // Glide to a stop.
    let v = vel * 16;  // px per frame
    if (Math.abs(v) < 1) return;
    r.classList.add("gliding");
    const step = () => {
      r.scrollLeft += v;
      v *= 0.94;
      if (Math.abs(v) > 0.5) glide = requestAnimationFrame(step);
      else { glide = 0; r.classList.remove("gliding"); }
    };
    glide = requestAnimationFrame(step);
  });

  // Scrolling the wheel over a row while gliding stops the glide.
  document.addEventListener("wheel", (e) => { if (glide && e.target.closest(ROWS)) stopGlide(); }, { passive: true });
})();
