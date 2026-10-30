/* Wishlist tab. Reads your public wishlist; edits happen in Steam. */
(() => {
"use strict";
const { $, esc, ICON, S } = C;
const el = () => $("#view-wishlist");
const W = { data: null, q: "", sort: "priority", saleOnly: false, lowOnly: false };
const BELL = '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
const steamLow = (i) => i.lows && i.lows.steam_low && i.lows.steam_low.cents;
const atLow = (i) => i.price && !i.price.free && steamLow(i) != null && i.price.final <= steamLow(i);
const atTarget = (i) => i.target && i.price && !i.price.free && i.price.final <= i.target;

const SORTS = {
  priority: (a, b) => (a.priority || 1e9) - (b.priority || 1e9),
  discount: (a, b) => ((b.price && b.price.discount) || 0) - ((a.price && a.price.discount) || 0),
  price: (a, b) => ((a.price && a.price.final) ?? 1e12) - ((b.price && b.price.final) ?? 1e12),
  added: (a, b) => b.added - a.added,
  low: (a, b) => gap(a) - gap(b),
  name: (a, b) => C.sortKey(a.name).localeCompare(C.sortKey(b.name)),
};

// How far above its lowest-ever Steam price a game is now (0 = at its lowest).
function gap(i) {
  const lo = steamLow(i);
  if (!i.price || i.price.free || i.price.final == null || !lo) return 1e9;
  return (i.price.final - lo) / Math.max(lo, 1);
}

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
  if (W.lowOnly) items = items.filter((i) => atLow(i) || atTarget(i));
  if (W.q) {
    const q = W.q.toLowerCase();
    items = items.filter((i) => i.name.toLowerCase().includes(q));
  }
  items = [...items].sort(SORTS[W.sort]);
  const priced = d.items.filter((i) => i.price && !i.price.free && i.price.final != null);
  const total = priced.reduce((s, i) => s + i.price.final, 0);
  const onSale = d.items.filter((i) => i.price && i.price.discount > 0).length;
  const cur = priced[0] && priced[0].price.currency;
  S.wlCurrency = cur;
  const lowN = d.items.filter((i) => atLow(i) || atTarget(i)).length;
  el().innerHTML = `
    <div class="page-head"><h1>Wishlist</h1>
      <span class="count">${d.items.length} games${priced.length ? ` · ${C.money(total, cur)} total` : ""}${onSale ? ` · ${onSale} on sale` : ""}</span>
      <div class="spacer"></div>
      <div class="chips"><button data-wl-sale class="${W.saleOnly ? "on" : ""}">On sale</button>
        <button data-wl-low class="${W.lowOnly ? "on" : ""}" title="At their lowest Steam price ever, or at your target">Great deals${lowN ? ` · ${lowN}` : ""}</button></div>
      <select data-wl-sort>
        ${[["priority", "Your rank"], ["discount", "Biggest discount"], ["low", "Closest to lowest ever"], ["price", "Lowest price"], ["added", "Date added"], ["name", "Name"]]
          .map(([v, l]) => `<option value="${v}"${v === W.sort ? " selected" : ""}>${l}</option>`).join("")}
      </select>
      <button class="btn sm" data-wl-steam>${ICON.ext}Edit in Steam</button>
    </div>
    <div class="wlist">${items.map((i) => `
      <div class="wrow" data-app="${i.appid}" role="button" tabindex="0">
        <img loading="lazy" alt="" src="${esc(i.image)}" data-fallback="/art/${i.appid}/header" data-fail="hide">
        <div class="w-main"><span class="name">${esc(i.name)}</span>
          <small>${i.added ? `Added ${C.fmtDate(i.added)}` : ""}${i.priority ? ` · #${i.priority}` : ""}</small></div>
        <div class="w-price">${C.priceHTML(i.price)}${lowLine(i)}</div>
        <button class="icon-btn w-bell${i.target ? " on" : ""}" data-wl-target="${i.appid}" title="${i.target ? `Alert at ${C.money(i.target, cur)}` : "Alert me when the price drops"}">${BELL}</button>
        <button class="btn sm primary" data-wl-buy="${i.appid}">${ICON.cart}Buy in Steam</button>
      </div>`).join("") || '<div class="state">No matches.</div>'}</div>`;
}

function lowLine(i) {
  const lo = i.lows && i.lows.steam_low;
  const bits = [];
  if (atTarget(i)) bits.push('<span class="pill ok">At your target</span>');
  else if (atLow(i)) bits.push('<span class="pill ok">Lowest price ever</span>');
  else if (lo) bits.push(`<small>Lowest ${C.money(lo.cents, lo.currency)}${lo.cut ? ` (-${lo.cut}%)` : ""}</small>`);
  if (i.target && !atTarget(i)) bits.push(`<small>Alert at ${C.money(i.target, i.price && i.price.currency)}</small>`);
  return bits.length ? `<div class="w-low">${bits.join("")}</div>` : "";
}

function targetPop(btn, appid) {
  const it = W.data.items.find((x) => x.appid === appid);
  const pop = $("#wl-pop") || Object.assign(document.createElement("div"), { id: "wl-pop", className: "wl-pop" });
  document.body.appendChild(pop);
  const cur = (it.price && it.price.currency) || "";
  const lo = it.lows && it.lows.steam_low;
  pop.innerHTML = `<b>Price alert</b><small>Get a notification when ${esc(it.name)} is at or under:</small>
    <div class="wl-pop-row"><span class="money-in"><input type="number" min="0" step="0.01" value="${it.target ? (it.target / 100).toFixed(2) : lo ? (lo.cents / 100).toFixed(2) : ""}"></span><small>${esc(cur)}</small></div>
    ${lo ? `<small>Lowest ever on Steam: ${C.money(lo.cents, lo.currency)}</small>` : ""}
    <div class="btns"><button class="btn sm primary" data-pop-set>Set</button>${it.target ? '<button class="btn sm" data-pop-clear>Remove</button>' : ""}</div>`;
  const r = btn.getBoundingClientRect();
  pop.style.top = `${Math.min(r.bottom + 6, innerHeight - 200)}px`;
  pop.style.left = `${Math.max(8, r.right - 260)}px`;
  pop.hidden = false;
  const input = pop.querySelector("input");
  input.focus(); input.select();
  const done = async (cents) => {
    pop.hidden = true;
    await C.extras.setTarget(appid, cents);
    it.target = cents;
    render();
  };
  pop.onclick = (e) => {
    if (e.target.closest("[data-pop-set]")) { const v = parseFloat(input.value); if (v > 0) done(Math.round(v * 100)); }
    if (e.target.closest("[data-pop-clear]")) done(null);
  };
  input.onkeydown = (e) => { if (e.key === "Enter") pop.querySelector("[data-pop-set]").click(); if (e.key === "Escape") pop.hidden = true; };
  setTimeout(() => document.addEventListener("mousedown", function off(e) {
    if (!pop.contains(e.target)) { pop.hidden = true; document.removeEventListener("mousedown", off); }
  }), 0);
}

function bind() {
  document.addEventListener("cinder-target", (e) => {
    const it = W.data && W.data.items.find((x) => x.appid === e.detail.appid);
    if (it) it.target = e.detail.cents;
  });
  const v = el();
  v.addEventListener("click", (e) => {
    const t = e.target;
    const buy = t.closest("[data-wl-buy]");
    if (buy) { e.stopPropagation(); C.act("store", { appid: +buy.dataset.wlBuy }); return; }
    if (t.closest("[data-wl-steam]")) return C.act("wishlist_in_steam");
    if (t.closest("[data-wl-sale]")) { W.saleOnly = !W.saleOnly; return render(); }
    if (t.closest("[data-wl-low]")) { W.lowOnly = !W.lowOnly; return render(); }
    const bell = t.closest("[data-wl-target]");
    if (bell) { e.stopPropagation(); return targetPop(bell, +bell.dataset.wlTarget); }
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
