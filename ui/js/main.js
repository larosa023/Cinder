/* Boot: load state, wire global events, start the router. */
(() => {
"use strict";
const { $, $$, S } = C;

C.closeOverlays = () => $$(".overlay").forEach((o) => (o.hidden = true));

function bindGlobal() {
  const search = $("#search");
  search.addEventListener("input", () => C.views[C.route.tab].search?.(search.value, false));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") C.views[C.route.tab].search?.(search.value, true);
    if (e.key === "Escape") { search.value = ""; C.views[C.route.tab].search?.("", false); search.blur(); }
  });

  $("#nav-back").addEventListener("click", () => history.back());
  $("#btn-refresh").addEventListener("click", () => C.views[C.route.tab].refresh?.());
  $("#btn-settings").addEventListener("click", () => C.openSettings());
  $("#btn-user").addEventListener("click", () => C.go("profile"));
  $("#btn-downloads").addEventListener("click", () => C.act("steam_downloads"));

  $$(".overlay").forEach((o) => o.addEventListener("click", (e) => {
    if (e.target === o || e.target.closest("[data-close]")) C.closeOverlays();
  }));

  document.addEventListener("keydown", (e) => {
    const typing = e.target.matches("input, select, textarea");
    if (e.key === "Escape") C.closeOverlays();
    else if (e.key === "F5") { e.preventDefault(); C.views[C.route.tab].refresh?.(); }
    else if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "f" && e.ctrlKey)) {
      e.preventDefault(); search.focus(); search.select();
    } else if (e.key === "," && e.ctrlKey) { e.preventDefault(); C.openSettings(); }
    else if (e.ctrlKey && e.key.toLowerCase() === "b") { e.preventDefault(); C.style.toggleSidebar(); }
    else if (e.ctrlKey && /^[1-5]$/.test(e.key)) { e.preventDefault(); C.go(C.TABS[+e.key - 1].id); }
    else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); history.back(); }
    else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); history.forward(); }
  });
  // Mouse back/forward buttons.
  window.addEventListener("mouseup", (e) => {
    if (e.button === 3) history.back();
    if (e.button === 4) history.forward();
  });

  window.addEventListener("hashchange", C.onRoute);
  window.addEventListener("focus", () => { C.library.load(true); C.refreshStatus(); });
  setInterval(C.refreshStatus, 15000);
}

async function init() {
  C.renderNav();
  bindGlobal();
  Object.values(C.views).forEach((v) => v.init && v.init());
  C.settings.init();
  C.style.init();
  const libraryLoad = C.library.load(true);  // start reading the library right away
  try {
    const st = await C.api("/api/state");
    Object.assign(S, { config: st.config, themes: st.themes, user: st.user, steam: st.steam, platform: st.platform });
    $("#version").textContent = `v${st.version}`;
    C.settings.fill();
    C.style.load(st.config.style);
  } catch (e) { C.toast(e.message, true); }

  // Bind the window controls once pywebview's bridge has its methods (it can be ready
  // before or after this point, so check both ways).
  const ready = () => window.pywebview && window.pywebview.api && typeof window.pywebview.api.drag === "function";
  const tryBind = () => { if (ready()) { C.bindWindow(); return true; } return false; };
  if (!tryBind()) {
    window.addEventListener("pywebviewready", tryBind);
    let tries = 0;
    const t = setInterval(() => {
      if (tryBind()) clearInterval(t);
      else if (++tries > 100) { clearInterval(t); C.log("pywebview bridge never became ready: " + JSON.stringify(Object.keys((window.pywebview || {}).api || {}))); }
    }, 100);
  }

  C.library.paintCached();
  C.onRoute();
  await libraryLoad;
  C.updates.poll();
  setTimeout(C.updates.poll, 5000);  // startup update checks finish in the background
}

init();
})();
