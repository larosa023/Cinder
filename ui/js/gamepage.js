/* Game page tabs: achievements, news, DLC. */
(() => {
"use strict";
const { $, $$, esc } = C;
const G = { appid: 0, tab: "overview", cache: {} };

function setTab(tab) {
  G.tab = tab;
  $$("#d-tabs [data-dtab]").forEach((b) => b.classList.toggle("on", b.dataset.dtab === tab));
  $("#d-overview").hidden = tab !== "overview";
  $("#d-pane").hidden = tab === "overview";
  if (tab !== "overview") load(tab);
}

async function load(tab) {
  const pane = $("#d-pane");
  const key = `${G.appid}:${tab}`;
  const appid = G.appid;
  if (!G.cache[key]) {
    pane.innerHTML = C.loading("Loading…");
    try {
      G.cache[key] = await C.api(`/api/game/${appid}/${tab}`);
    } catch (e) {
      if (G.appid === appid && G.tab === tab) pane.innerHTML = C.failed(e.message, false);
      return;
    }
  }
  if (G.appid !== appid || G.tab !== tab) return;
  pane.innerHTML = ({ achievements: renderAch, news: renderNews, dlc: renderDlc })[tab](G.cache[key]);
}

function renderAch(d) {
  const pct = d.total ? Math.round((100 * d.unlocked) / d.total) : 0;
  return `<div class="ach-head"><strong>${d.unlocked} of ${d.total} unlocked</strong><span>${pct}%</span></div>
    <div class="bar wide"><i style="width:${pct}%"></i></div>
    <div class="ach-list">${d.items.map((a) => `
      <div class="ach ${a.unlocked ? "got" : ""}">
        <img alt="" loading="lazy" src="${esc(a.icon)}" data-fail="hide">
        <div><strong>${esc(a.name)}</strong><small>${esc(a.desc)}</small></div>
        <span class="ach-meta">${a.unlocked && a.time ? C.fmtDate(a.time) : ""}${a.percent != null ? `<em>${a.percent}% of players</em>` : ""}</span>
      </div>`).join("")}</div>`;
}

function renderNews(d) {
  if (!d.items.length) return '<div class="state">No news for this game.</div>';
  return `<div class="news-list">${d.items.map((n) => `
    <a class="news" href="${esc(n.url)}" data-url="${esc(n.url)}">
      <div class="news-top">${n.patch ? '<span class="pill ingame">Patch notes</span>' : n.official ? '<span class="pill">Announcement</span>' : `<span class="pill">${esc(n.source)}</span>`}
        <small>${C.fmtDate(n.date)}</small></div>
      <strong>${esc(n.title)}</strong>
      <p>${esc(n.text)}</p>
    </a>`).join("")}</div>`;
}

function renderDlc(d) {
  if (!d.items.length) return '<div class="state">This game has no DLC.</div>';
  const inst = d.items.filter((x) => x.installed).length;
  return `<div class="ach-head"><strong>${d.items.length} DLC</strong><span>${inst ? `${inst} installed` : ""}</span></div>
    <div class="dlc-list">${d.items.map((x) => `
      <button class="dlc" data-store="${x.appid}">
        <img alt="" loading="lazy" src="${esc(x.image)}" data-fail="hide">
        <span class="name">${esc(x.name)}</span>
        ${x.installed ? '<span class="pill online">Installed</span>' : C.priceHTML(x.price, "sm")}
      </button>`).join("")}</div>`;
}

function open(g) {
  G.appid = g.appid;
  const nonSteam = !!g.shortcut;
  $("#d-tabs").hidden = nonSteam;
  $("#d-store").hidden = nonSteam;
  if (nonSteam) { $("#d-props").hidden = true; $("#d-uninstall").hidden = true; }
  setTab("overview");
}

function bind() {
  $("#d-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-dtab]");
    if (b) setTab(b.dataset.dtab);
  });
  $("#d-pane").addEventListener("click", (e) => {
    const n = e.target.closest("[data-url]");
    if (n) { e.preventDefault(); C.act("steam_url_open", { url: n.dataset.url }); return; }
    const d = e.target.closest("[data-store]");
    if (d) { C.closeOverlays(); C.go(`store/app/${d.dataset.store}`); }
  });
}

C.gamepage = { open, init: bind, show: (tab) => { if (!$("#d-tabs").hidden) setTab(tab); } };
})();
