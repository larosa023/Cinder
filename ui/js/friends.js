/* Friends tab. Chat opens in Steam's own chat window. */
(() => {
"use strict";
const { $, esc, ICON } = C;
const el = () => $("#view-friends");
const F = { data: null, q: "", filter: "all", timer: null };

const ORDER = { ingame: 0, online: 1, offline: 2 };

async function load(force = false) {
  if (F.data && !force) return render();
  el().innerHTML = C.loading("Loading friends…");
  try {
    F.data = await C.api("/api/friends");
    render();
  } catch (e) {
    el().innerHTML = C.failed(e.message);
  }
}

function friendHTML(f) {
  const state = f.state || "unknown";
  const line = f.game ? `Playing ${esc(f.game)}` : f.status ? esc(f.status) : "";
  return `<div class="friend ${state}" data-sid="${f.steamid}">
    <span class="f-av"><b>${esc((f.name || "?")[0].toUpperCase())}</b><img loading="lazy" alt="" src="${esc(f.avatar)}" data-fail="hide"><i></i></span>
    <span class="f-main"><span class="name">${esc(f.name)}</span>${line ? `<small>${line}</small>` : ""}</span>
    <span class="f-actions">
      <button class="icon-btn" data-msg="${f.steamid}" title="Message in Steam">${ICON.chat}</button>
      <button class="icon-btn" data-prof="${f.steamid}" title="View profile">${ICON.user}</button>
    </span>
  </div>`;
}

function render() {
  const d = F.data;
  let list = d.friends;
  if (F.filter !== "all") list = list.filter((f) => (F.filter === "online" ? f.state === "online" || f.state === "ingame" : f.state === F.filter));
  if (F.q) {
    const q = F.q.toLowerCase();
    list = list.filter((f) => f.name.toLowerCase().includes(q));
  }
  if (d.live) list = [...list].sort((a, b) => (ORDER[a.state] - ORDER[b.state]) || a.name.localeCompare(b.name));
  const online = d.friends.filter((f) => f.state === "online" || f.state === "ingame").length;
  const groups = d.live
    ? [["ingame", "In game"], ["online", "Online"], ["offline", "Offline"]]
        .map(([k, label]) => [label, list.filter((f) => f.state === k)]).filter(([, l]) => l.length)
    : [["All friends", list]];
  el().innerHTML = `
    <div class="page-head"><h1>Friends</h1>
      <span class="count">${d.friends.length}${d.live ? ` · ${online} online` : ""}</span>
      <div class="spacer"></div>
      ${d.live ? `<div class="chips">${[["all", "All"], ["online", "Online"], ["ingame", "In game"]]
        .map(([v, l]) => `<button data-ff="${v}" class="${F.filter === v ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
      <button class="btn sm" data-open-chat>${ICON.chat}Open Steam chat</button>
    </div>
    ${d.error ? `<p class="note warn">${esc(d.error)}</p>` : ""}
    ${!d.live && !d.error ? `<p class="note">Showing Steam's saved friends list. Add a Steam Web API key in Settings → Account to see who's online and what they're playing.</p>` : ""}
    ${list.length ? groups.map(([label, l]) => `
      <section class="fgroup"><h2>${label} <span class="count">${l.length}</span></h2>
      <div class="flist">${l.map(friendHTML).join("")}</div></section>`).join("")
      : `<div class="state"><strong>${d.friends.length ? "No matches" : "No friends found"}</strong>${d.friends.length ? "" : "Open Steam's friends list once so it saves your friends to this PC."}</div>`}`;
}

function bind() {
  const v = el();
  v.addEventListener("click", (e) => {
    const t = e.target;
    const msg = t.closest("[data-msg]");
    if (msg) return C.act("message", { steamid: msg.dataset.msg });
    const prof = t.closest("[data-prof]");
    if (prof) return C.go(`profile/${prof.dataset.prof}`);
    const ff = t.closest("[data-ff]");
    if (ff) { F.filter = ff.dataset.ff; return render(); }
    if (t.closest("[data-open-chat]")) return C.act("steam_friends");
    if (t.closest("[data-retry]")) return load(true);
    const row = t.closest("[data-sid]");
    if (row) C.go(`profile/${row.dataset.sid}`);
  });
}

C.views.friends = {
  placeholder: "Search friends",
  show() {
    load();
    clearInterval(F.timer);
    F.timer = setInterval(() => { if (!document.hidden && C.route.tab === "friends" && F.data && F.data.live) load(true); }, 60000);
  },
  search(q) { F.q = q.trim(); if (F.data) render(); },
  refresh() { return load(true); },
  init: bind,
};
})();
