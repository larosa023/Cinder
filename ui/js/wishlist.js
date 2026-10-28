/* Wishlist tab. Reads your public wishlist; edits happen in Steam. */
(() => {
"use strict";
const { $, esc, ICON } = C;
const el = () => $("#view-wishlist");
const W = { data: null, q: "", sort: "priority", saleOnly: false };

const SORTS = {
  priority: (a, b) => (a.priority || 1e9) - (b.priority || 1e9),
  discount: (a, b) => ((b.price && b.price.discount) || 0) - ((a.price && a.price.discount) || 0),
  price: (a, b) => ((a.price && a.price.final) ?? 1e12) - ((b.price && b.price.final) ?? 1e12),
  added: (a, b) => b.added - a.added,
  name: (a, b) => C.sortKey(a.name).localeCompare(C.sortKey(b.name)),
};

async function load(force = false) {
  if (W.data && !force) return render();
  el().innerHTML = C.loading("Loading your wishlist…");
  try {
    W.data = await C.api("/api/wishlist");
    render();
  } catch (e) {
    el().innerHTML = C.failed(e.message);
  }
}

function render() {
  const d = W.data;
  if (d.private || !d.items.length) {
    el().innerHTML = `<div class="page-head"><h1>Wishlist</h1></div>
      <div class="state"><strong>${d.private ? "Your wishlist is empty or private" : "Nothing here yet"}</strong>
      Add games from the Store tab. If you have wishlisted games, set your profile's game details to Public in Steam's privacy settings.
      <button class="btn sm" data-wl-steam>${ICON.ext}Open wishlist in Steam</button></div>`;
    return;
  }
  let items = d.items;
  if (W.saleOnly) items = items.filter((i) => i.price && i.price.discount > 0);
  if (W.q) {
    const q = W.q.toLowerCase();
    items = items.filter((i) => i.name.toLowerCase().includes(q));
  }
  items = [...items].sort(SORTS[W.sort]);
  const priced = d.items.filter((i) => i.price && !i.price.free && i.price.final != null);
  const total = priced.reduce((s, i) => s + i.price.final, 0);
  const onSale = d.items.filter((i) => i.price && i.price.discount > 0).length;
  const cur = priced[0] && priced[0].price.currency;
  el().innerHTML = `
    <div class="page-head"><h1>Wishlist</h1>
      <span class="count">${d.items.length} games${priced.length ? ` · ${C.money(total, cur)} total` : ""}${onSale ? ` · ${onSale} on sale` : ""}</span>
      <div class="spacer"></div>
      <div class="chips"><button data-wl-sale class="${W.saleOnly ? "on" : ""}">On sale</button></div>
      <select data-wl-sort>
        ${[["priority", "Your rank"], ["discount", "Biggest discount"], ["price", "Lowest price"], ["added", "Date added"], ["name", "Name"]]
          .map(([v, l]) => `<option value="${v}"${v === W.sort ? " selected" : ""}>${l}</option>`).join("")}
      </select>
      <button class="btn sm" data-wl-steam>${ICON.ext}Edit in Steam</button>
    </div>
    <div class="wlist">${items.map((i) => `
      <div class="wrow" data-app="${i.appid}" role="button" tabindex="0">
        <img loading="lazy" alt="" src="${esc(i.image)}" data-fallback="/art/${i.appid}/header" data-fail="hide">
        <div class="w-main"><span class="name">${esc(i.name)}</span>
          <small>${i.added ? `Added ${C.fmtDate(i.added)}` : ""}${i.priority ? ` · #${i.priority}` : ""}</small></div>
        ${C.priceHTML(i.price)}
        <button class="btn sm primary" data-wl-buy="${i.appid}">${ICON.cart}Buy in Steam</button>
      </div>`).join("") || '<div class="state">No matches.</div>'}</div>`;
}

function bind() {
  const v = el();
  v.addEventListener("click", (e) => {
    const t = e.target;
    const buy = t.closest("[data-wl-buy]");
    if (buy) { e.stopPropagation(); C.act("store", { appid: +buy.dataset.wlBuy }); return; }
    if (t.closest("[data-wl-steam]")) return C.act("wishlist_in_steam");
    if (t.closest("[data-wl-sale]")) { W.saleOnly = !W.saleOnly; return render(); }
    if (t.closest("[data-retry]")) return load(true);
    const row = t.closest("[data-app]");
    if (row) C.go(`store/app/${row.dataset.app}`);
  });
  v.addEventListener("change", (e) => {
    if (e.target.matches("[data-wl-sort]")) { W.sort = e.target.value; render(); }
  });
  v.addEventListener("keydown", (e) => {
    const row = e.target.closest(".wrow");
    if (row && e.key === "Enter") C.go(`store/app/${row.dataset.app}`);
  });
}

C.views.wishlist = {
  placeholder: "Search your wishlist",
  show() { load(); },
  search(q) { W.q = q.trim(); if (W.data) render(); },
  refresh() { return load(true); },
  init: bind,
};
})();
