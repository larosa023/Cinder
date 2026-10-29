/* Achievements tab: your progress across every game. */
(() => {
"use strict";
const { $, esc } = C;
const el = () => $("#view-achievements");
const A = { data: null, timer: null, q: "", sort: "progress" };

const SORTS = {
  progress: (a, b) => (b.pct - a.pct) || (b.last - a.last),
  recent: (a, b) => b.last - a.last,
  name: (a, b) => C.sortKey(a.name).localeCompare(C.sortKey(b.name)),
  remaining: (a, b) => (a.total - a.unlocked) - (b.total - b.unlocked) || (b.pct - a.pct),
};

async function load(quiet = false) {
  if (!A.data && !quiet) el().innerHTML = C.loading("Gathering your achievements…");
  try {
    const prev = A.shown;
    A.data = await C.api("/api/achievements");
    if (C.route.tab === "achievements") {
      // While scanning, only redraw when there's something new to show; otherwise just tick the counter.
      const scan = el().querySelector(".scan");
      if (quiet && A.data.scanning && scan && prev === A.data.games.length + ":" + A.data.stats.unlocked) {
        scan.lastChild.textContent = `Checking ${A.data.done} of ${A.data.total} games…`;
      } else render();
    }
  } catch (e) {
    if (!A.data) el().innerHTML = C.failed(e.message);
    return;
  }
  clearTimeout(A.timer);
  if (A.data.scanning && C.route.tab === "achievements") A.timer = setTimeout(() => load(true), 2500);
}

const rarity = (p) => p == null ? "" : p < 5 ? "ultra" : p < 15 ? "rare" : p < 40 ? "uncommon" : "";

function achTile(a) {
  return `<button class="ach-tile ${rarity(a.percent)}" data-game="${a.appid}" title="${esc(a.desc)}">
    <img alt="" loading="lazy" src="${esc(a.icon)}" data-fail="hide">
    <span class="at-name">${esc(a.name)}</span>
    <span class="at-game">${esc(a.game)}</span>
    <span class="at-meta">${a.percent != null ? `${a.percent}% of players` : ""}${a.time ? `${a.percent != null ? " · " : ""}${C.fmtAgo(a.time)}` : ""}</span>
  </button>`;
}

function gameRow(g) {
  const done = g.unlocked === g.total;
  return `<button class="ach-game${done ? " perfect" : ""}" data-game="${g.appid}">
    <img alt="" loading="lazy" src="/art/${g.appid}/header" data-fail="hide">
    <span class="ag-main"><span class="name">${esc(g.name)}</span>
      <span class="bar"><i style="width:${g.pct}%"></i></span>
      <span class="sub">${g.unlocked} of ${g.total}${done ? " · Perfect" : ` · ${g.total - g.unlocked} to go`}${g.last ? ` · last ${C.fmtAgo(g.last)}` : ""}</span></span>
    <b class="ag-pct">${Math.round(g.pct)}%</b>
  </button>`;
}

function render() {
  const d = A.data;
  A.shown = d.games.length + ":" + d.stats.unlocked;
  const st = d.stats;
  let games = d.games;
  if (A.q) { const q = A.q.toLowerCase(); games = games.filter((g) => g.name.toLowerCase().includes(q)); }
  games = [...games].sort(SORTS[A.sort]);
  const scanning = d.scanning ? `<span class="scan"><span class="spinner sm"></span>Checking ${d.done} of ${d.total} games…</span>` : "";
  if (!d.games.length) {
    el().innerHTML = `<div class="page-head"><h1>Achievements</h1>${scanning}</div>
      ${d.scanning ? C.loading("Looking through your games… this first pass can take a minute.")
        : `<div class="state"><strong>${d.private ? "Steam isn't sharing your achievements" : "No achievements yet"}</strong>
          ${d.private ? "Set your profile's Game details to Public in Steam (Profile → Edit Profile → Privacy Settings), or add a Steam Web API key in Settings → Account."
            : d.error ? esc(d.error) : "Play a game with achievements and they'll show up here."}
          <button class="btn sm" data-rescan>Check again</button></div>`}`;
    return;
  }
  el().innerHTML = `
    <div class="page-head"><h1>Achievements</h1>${scanning}<div class="spacer"></div>
      <button class="btn sm" data-rescan ${d.scanning ? "disabled" : ""}>Refresh</button></div>
    <div class="pstats">
      <div class="pstat"><span>Unlocked</span><b>${st.unlocked.toLocaleString()}</b><small>of ${st.available.toLocaleString()}</small></div>
      <div class="pstat"><span>Perfect games</span><b>${st.perfect}</b><small>of ${st.games}</small></div>
      <div class="pstat"><span>Average completion</span><b>${st.avg}%</b><small>in games you've started</small></div>
    </div>
    ${d.recent.length ? `<section class="psection"><h2>Recently unlocked</h2><div class="ach-row recent-row">${d.recent.map(achTile).join("")}</div></section>` : ""}
    ${d.rarest.length ? `<section class="psection"><h2>Your rarest</h2><div class="ach-row recent-row">${d.rarest.map(achTile).join("")}</div></section>` : ""}
    ${d.almost.length ? `<section class="psection"><h2>Almost there</h2><div class="ach-games">${d.almost.map(gameRow).join("")}</div></section>` : ""}
    <section class="psection"><div class="lib-head"><h2>All games <span class="count">${games.length}</span></h2><div class="spacer"></div>
      <select data-ach-sort>${[["progress", "Most complete"], ["remaining", "Fewest left"], ["recent", "Recently unlocked"], ["name", "Name"]]
        .map(([v, l]) => `<option value="${v}"${v === A.sort ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="ach-games">${games.map(gameRow).join("")}</div></section>`;
}

function openGame(appid) {
  C.go("library");
  setTimeout(() => { C.library.openDetail(appid); C.gamepage.show("achievements"); }, 60);
}

function bind() {
  el().addEventListener("click", async (e) => {
    const g = e.target.closest("[data-game]");
    if (g) return openGame(+g.dataset.game);
    if (e.target.closest("[data-rescan]")) {
      try { await C.api("/api/achievements/scan", {}); } catch { /* ignore */ }
      load(true);
    }
    if (e.target.closest("[data-retry]")) load();
  });
  el().addEventListener("change", (e) => {
    if (e.target.matches("[data-ach-sort]")) { A.sort = e.target.value; render(); }
  });
}

C.achievements = { summary: async () => (A.data || (await C.api("/api/achievements"))) };
C.views.achievements = {
  placeholder: "Search games",
  show() { load(); },
  search(q) { A.q = q.trim(); if (A.data) render(); },
  refresh() { return load(); },
  init: bind,
};
})();
