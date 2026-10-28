/* Now playing pill and the downloads badge. */
(() => {
"use strict";
const { $, S } = C;
let tick = null;

// ---------- now playing ----------
function renderPlaying() {
  const p = S.steam && S.steam.playing;
  const pill = $("#now-playing");
  clearInterval(tick);
  if (!p) { pill.hidden = true; return; }
  pill.hidden = false;
  pill.dataset.appid = p.appid;
  $("#np-name").textContent = p.name;
  const upd = () => {
    const s = Math.max(0, Math.floor(Date.now() / 1000 - p.since));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    $("#np-time").textContent = h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  };
  upd();
  tick = setInterval(upd, 1000);
}

// ---------- downloads badge (the Downloads tab is downloads.js) ----------
function renderBadge() {
  const upd = S.games.filter((g) => g.installed && g.update_pending && !g.shortcut && !g.download).length;
  const n = ((S.steam && S.steam.downloads) || 0) + upd;
  $("#btn-downloads").title = upd ? `Downloads · ${upd} update${upd > 1 ? "s" : ""} available` : "Downloads";
  $("#dl-badge").hidden = !n;
  $("#dl-badge").textContent = n;
}

function bind() {
  $("#btn-downloads").addEventListener("click", () => C.go("downloads"));
  $("#now-playing").addEventListener("click", () => {
    C.go("library");
    setTimeout(() => C.library.openDetail(+$("#now-playing").dataset.appid), 50);
  });
}

C.activity = { renderPlaying, renderBadge, init: bind };
})();
