/* Store tab: featured home, search, and app pages. Purchases open in the Steam client. */
(() => {
"use strict";
// Only plain https image addresses go into CSS (no quotes or parentheses that could break out).
const safeUrl = (u) => (/^https:\/\/[^\s'"()\\]+$/.test(u || "") ? u : "");
const WS_ICON = '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/></svg>';
const { $, esc, S, ICON } = C;
const el = () => $("#view-store");
const T = { home: null, shots: [], shotIndex: 0, searchTimer: null, lastQuery: "" };

function scard(it) {
  return `<button class="scard" data-app="${it.appid}" title="${esc(it.name)}">
    <div class="scard-art"><img loading="lazy" alt="" src="${esc(it.image || `/art/${it.appid}/header`)}" data-fallback="/art/${it.appid}/header" data-fail="hide"></div>
    <div class="scard-meta"><span class="name">${esc(it.name)}</span>${C.priceHTML(it.price, "sm")}</div>
  </button>`;
}

function rowHTML(sec) {
  return `<section class="srow">
    <div class="srow-head"><h2>${esc(sec.title)}</h2>
      <div class="btns"><button class="icon-btn" data-scroll="-1" title="Back">${ICON.left}</button>
      <button class="icon-btn" data-scroll="1" title="More">${ICON.right}</button></div></div>
    <div class="srow-items">${sec.items.map(scard).join("")}</div>
  </section>`;
}

function spotlightHTML(items) {
  const top = items.slice(0, 4);
  if (!top.length) return "";
  const [main, ...side] = top;
  return `<section class="spotlight">
    <button class="spot-main" data-app="${main.appid}">
      <img alt="" src="${esc(main.capsule || main.image)}" data-fallback="/art/${main.appid}/hero" data-fail="hide">
      <span class="shade"></span>
      <span class="spot-meta"><span class="spot-tag">Featured deal</span><span class="spot-name">${esc(main.name)}</span>${C.priceHTML(main.price)}</span>
    </button>
    <div class="spot-side">${side.map((it) => `
      <button class="spot-mini" data-app="${it.appid}">
        <img alt="" loading="lazy" src="${esc(it.image)}" data-fallback="/art/${it.appid}/header" data-fail="hide">
        <span class="spot-mini-meta"><span class="name">${esc(it.name)}</span>${C.priceHTML(it.price, "sm")}</span>
      </button>`).join("")}</div>
  </section>`;
}

async function showHome(force = false) {
  const v = el();
  if (T.home && !force) return renderHome();
  v.innerHTML = C.loading("Loading the store…");
  const onHome = () => C.route.tab === "store" && !C.route.params.length;
  try {
    T.home = await C.api("/api/store/home");
    if (onHome()) renderHome();
  } catch (e) {
    if (onHome()) v.innerHTML = C.failed(e.message);
  }
}

function renderHome() {
  const secs = T.home.sections;
  const specials = secs.find((s) => s.id === "specials") || secs[0];
  el().innerHTML = `
    <div class="page-head"><h1>Store</h1><div class="spacer"></div>
      <button class="btn sm" data-steam-store>${ICON.ext}Open store in Steam</button></div>
    ${spotlightHTML(specials.items)}
    ${secs.map(rowHTML).join("")}`;
}

async function showSearch(q) {
  T.lastQuery = q;
  const v = el();
  v.innerHTML = `<div class="page-head"><h1>Results for “${esc(q)}”</h1></div>${C.loading("Searching…")}`;
  try {
    const r = await C.api(`/api/store/search?q=${encodeURIComponent(q)}`);
    if (T.lastQuery !== q) return;
    v.innerHTML = `<div class="page-head"><h1>Results for “${esc(q)}”</h1><span class="count">${r.items.length}</span></div>
      ${r.items.length ? `<div class="sgrid">${r.items.map(scard).join("")}</div>`
        : '<div class="state"><strong>No games found</strong>Try another name.</div>'}`;
  } catch (e) {
    if (T.lastQuery === q && C.route.tab === "store") v.innerHTML = C.failed(e.message);
  }
}

// ---------- app page ----------
async function showApp(appid) {
  const v = el();
  v.innerHTML = C.loading("Loading game…");
  let a;
  try {
    a = (await C.api(`/api/store/app/${appid}`)).app;
  } catch (e) {
    if (C.route.tab === "store" && C.route.params[1] === String(appid)) v.innerHTML = C.failed(e.message);
    return;
  }
  if (C.route.tab !== "store" || C.route.params[1] !== String(appid)) return;
  T.shots = a.screenshots;
  const owned = S.games.find((g) => g.appid === a.appid);
  const buy = a.installed
    ? `<button class="btn primary lg" data-launch="${a.appid}">${ICON.play}Play</button>`
    : owned
      ? `<button class="btn primary lg" data-launch="${a.appid}">${ICON.down}Install</button>`
      : `<button class="btn primary lg" data-buy="${a.appid}">${ICON.cart}${a.price && a.price.free ? "Get it free" : a.coming_soon ? "View in Steam" : "Buy in Steam"}</button>`;
  const meta = [
    a.release && ["Release", esc(a.release)],
    a.developers.length && ["Developer", esc(a.developers.join(", "))],
    a.publishers.length && ["Publisher", esc(a.publishers.join(", "))],
    a.metacritic && ["Metacritic", `<span class="meta-score">${a.metacritic}</span>`],
    a.recommendations && ["Reviews", `${Number(a.recommendations).toLocaleString()} recommendations`],
  ].filter(Boolean);
  v.innerHTML = `
    <div class="sp-bg" style="--sp-bg:url('${esc(safeUrl(a.background || a.header))}')"></div>
    <div class="sp">
      <div class="sp-title">
        <img alt="" src="/art/${a.appid}/logo" data-fail="logo">
        <h1>${esc(a.name)}</h1>
      </div>
      <div class="sp-grid">
        <div class="sp-media">
          ${a.screenshots.length ? `
            <button class="sp-shot" data-shot="0"><img alt="" src="${esc(a.screenshots[0].full)}"></button>
            <div class="sp-thumbs">${a.screenshots.map((s, i) =>
              `<button data-shot="${i}"${i === 0 ? ' class="on"' : ""}><img loading="lazy" alt="" src="${esc(s.thumb)}"></button>`).join("")}</div>`
            : `<div class="sp-shot"><img alt="" src="${esc(a.header)}"></div>`}
        </div>
        <aside class="sp-info">
          <img class="sp-header" alt="" src="${esc(a.header)}" data-fail="hide">
          <p class="sp-short">${esc(a.short)}</p>
          <dl class="sp-meta">${meta.map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join("")}</dl>
          ${a.genres.length ? `<div class="tags">${a.genres.map((g) => `<span>${esc(g)}</span>`).join("")}</div>` : ""}
        </aside>
      </div>
      <div class="buybox">
        <div><strong>${a.installed ? "In your library" : owned ? "You own this" : a.coming_soon ? "Coming soon" : `Buy ${esc(a.name)}`}</strong>
          ${a.dlc_count ? `<small>${a.dlc_count} DLC available</small>` : ""}</div>
        <div class="spacer"></div>
        ${a.installed || owned ? "" : C.priceHTML(a.price, "lg")}
        ${buy}
        <button class="btn" data-buy="${a.appid}" title="Add to your wishlist in Steam">${ICON.heart}Wishlist</button>
        ${a.workshop ? `<button class="btn" data-ws-app="${a.appid}" title="Mods, maps and more for this game">${WS_ICON}Workshop</button>` : ""}
      </div>
      ${a.about ? `<section class="sp-about"><h2>About this game</h2><div class="prose">${esc(a.about).replace(/\n/g, "<br>")}</div></section>` : ""}
      ${a.categories.length ? `<section class="sp-about"><h2>Features</h2><div class="tags">${a.categories.map((c) => `<span>${esc(c)}</span>`).join("")}</div></section>` : ""}
    </div>`;
}

function setShot(i) {
  T.shotIndex = (i + T.shots.length) % T.shots.length;
  const s = T.shots[T.shotIndex];
  const main = $(".sp-shot img", el());
  if (main) main.src = s.full;
  const btn = $(".sp-shot", el());
  if (btn) btn.dataset.shot = T.shotIndex;
  C.$$(".sp-thumbs button", el()).forEach((b, j) => b.classList.toggle("on", j === T.shotIndex));
}

function openLightbox(i) {
  if (!T.shots.length) return;
  T.shotIndex = i;
  $("#lb-img").src = T.shots[i].full;
  $("#lightbox").hidden = false;
}

function bind() {
  el().addEventListener("click", (e) => {
    const t = e.target;
    const app = t.closest("[data-app]");
    if (app) return C.go(`store/app/${app.dataset.app}`);
    const scroll = t.closest("[data-scroll]");
    if (scroll) {
      const row = scroll.closest(".srow").querySelector(".srow-items");
      row.scrollBy({ left: +scroll.dataset.scroll * row.clientWidth * 0.9, behavior: "smooth" });
      return;
    }
    const thumb = t.closest(".sp-thumbs [data-shot]");
    if (thumb) return setShot(+thumb.dataset.shot);
    const shot = t.closest(".sp-shot[data-shot]");
    if (shot) return openLightbox(+shot.dataset.shot);
    const ws = t.closest("[data-ws-app]");
    if (ws) return C.go(`workshop/${ws.dataset.wsApp}/browse`);
    const buy = t.closest("[data-buy]");
    if (buy) { C.act("store", { appid: +buy.dataset.buy }).then((ok) => ok && C.toast("Opened in Steam")); return; }
    const launch = t.closest("[data-launch]");
    if (launch) return C.launch(+launch.dataset.launch);
    if (t.closest("[data-steam-store]")) return C.act("store_in_steam");
    if (t.closest("[data-retry]")) return C.onRoute();
  });
  const lb = $("#lightbox");
  $("#lb-prev").addEventListener("click", (e) => { e.stopPropagation(); T.shotIndex = (T.shotIndex - 1 + T.shots.length) % T.shots.length; $("#lb-img").src = T.shots[T.shotIndex].full; });
  $("#lb-next").addEventListener("click", (e) => { e.stopPropagation(); T.shotIndex = (T.shotIndex + 1) % T.shots.length; $("#lb-img").src = T.shots[T.shotIndex].full; });
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.id === "lb-img") lb.hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "ArrowLeft") $("#lb-prev").click();
    if (e.key === "ArrowRight") $("#lb-next").click();
  });
}

C.views.store = {
  placeholder: "Search the store",
  searchValue: (p) => (p[0] === "search" ? p[1] || "" : ""),
  show(p) {
    if (p[0] === "app" && p[1]) return showApp(+p[1]);
    if (p[0] === "search" && p[1]) return showSearch(p[1]);
    showHome();
  },
  search(q, enter) {
    clearTimeout(T.searchTimer);
    const term = q.trim();
    if (!term) { if (C.route.params.length) C.go("store"); return; }
    T.searchTimer = setTimeout(() => {
      const h = `#/store/search/${encodeURIComponent(term)}`;
      // Typing refines the same search: replace it in history so Back skips the partial queries.
      if (C.route.tab === "store" && C.route.params[0] === "search") { history.replaceState(null, "", h); C.onRoute(); }
      else C.go(`store/search/${encodeURIComponent(term)}`);
    }, enter ? 0 : 450);
  },
  refresh() {
    T.home = null;
    C.onRoute();
  },
  init: bind,
};
})();
