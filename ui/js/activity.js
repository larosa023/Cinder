/* Now playing pill and the downloads panel. */
(() => {
"use strict";
const { $, $$, esc, S } = C;
const D = { timer: null, prev: {}, speed: {} };
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

// ---------- downloads ----------
function renderBadge() {
  const upd = S.games.filter((g) => g.installed && g.update_pending && !g.shortcut && !g.download).length;
  const n = ((S.steam && S.steam.downloads) || 0) + upd;
  $("#btn-downloads").title = upd ? `Downloads · ${upd} update${upd > 1 ? "s" : ""} available` : "Downloads";
  $("#dl-badge").hidden = !n;
  $("#dl-badge").textContent = n;
}

const PAUSE = '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';

async function pauseDl(appid, pause) {
  try {
    let r = await C.api("/api/action", { action: "download_pause", appid, pause });
    if (r.state === "need_restart") {
      if (!window.confirm("To pause and resume downloads from Cinder, Steam needs to restart once in the background.\n\nRestart Steam now?")) return;
      r = await C.api("/api/action", { action: "download_pause", appid, pause, restart: true });
      return C.toast("Restarting Steam in the background…");
    }
    if (r.state === "steam") C.toast("Opened the game in Steam");
    setTimeout(loadDownloads, 800);
  } catch (e) { C.toast(e.message, true); }
}

const STATE = { downloading: "Downloading", installing: "Installing", verifying: "Verifying", queued: "Queued", paused: "Paused" };

function rate(appid, done) {
  const now = Date.now();
  const prev = D.prev[appid];
  D.prev[appid] = { done, at: now };
  if (prev && now > prev.at && done >= prev.done) {
    const r = (done - prev.done) / ((now - prev.at) / 1000);
    D.speed[appid] = D.speed[appid] == null ? r : 0.6 * D.speed[appid] + 0.4 * r;
  }
  return D.speed[appid] || 0;
}

async function loadDownloads() {
  try {
    const { items } = await C.api("/api/downloads");
    const list = $("#dl-list");
    const busy = new Set(items.map((d) => d.appid));
    const pending = S.games.filter((g) => g.installed && g.update_pending && !g.shortcut && !busy.has(g.appid));
    const updHTML = pending.length ? `<div class="dl-section"><span>Updates available · ${pending.length}</span>
      ${pending.length > 1 ? '<button class="btn sm primary" data-upd-all>Update all</button>' : ""}</div>`
      + pending.map((g) => `<div class="dl-item pending" data-appid="${g.appid}">
        <img alt="" src="/art/${g.appid}/header" data-fail="hide">
        <div class="dl-main"><div class="dl-top"><span class="name">${esc(C.gname(g.name))}</span></div>
          <div class="dl-sub"><span>Update ready to download</span></div></div>
        <button class="btn sm dl-act" data-upd="${g.appid}">${C.ICON.down}Update</button></div>`).join("") : "";
    if (!items.length) {
      list.innerHTML = updHTML || '<div class="dl-empty">No downloads or updates right now.</div>';
      return;
    }
    list.innerHTML = (pending.length ? '<div class="dl-section"><span>Downloading</span></div>' : "") + items.map((d) => {
      const installing = d.state === "installing" && d.stage_total;
      const total = installing ? d.stage_total : d.total, done = installing ? d.stage_done : d.done;
      const pct = total ? Math.min(100, (100 * done) / total) : 0;
      const spd = d.state === "downloading" ? rate(d.appid, d.done) : 0;
      const left = spd > 1024 && total ? Math.round((total - done) / spd) : 0;
      const eta = left ? (left > 3600 ? `${Math.floor(left / 3600)}h ${Math.round((left % 3600) / 60)}m left`
        : left > 60 ? `${Math.round(left / 60)} min left` : `${left}s left`) : "";
      return `<div class="dl-item ${d.state}" data-appid="${d.appid}">
        <img alt="" src="/art/${d.appid}/header" data-fail="hide">
        <div class="dl-main">
          <div class="dl-top"><span class="name">${esc(d.name)}</span><span class="dl-state">${STATE[d.state] || d.state}</span></div>
          <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
          <div class="dl-sub"><span>${total ? `${C.fmtSize(done)} of ${C.fmtSize(total)}` : ""}</span>
            <span>${spd > 1024 ? `${C.fmtSize(spd)}/s` : ""}${eta ? ` · ${eta}` : ""}</span></div>
        </div>
        ${d.state === "paused" ? `<button class="btn sm dl-act" data-resume="${d.appid}" title="Resume">${C.ICON.play}</button>`
          : d.state === "downloading" || d.state === "queued" ? `<button class="btn sm dl-act" data-pause="${d.appid}" title="Pause">${PAUSE}</button>` : ""}
        </div>`;
    }).join("") + updHTML;
  } catch (e) {
    $("#dl-list").innerHTML = `<div class="dl-empty">${esc(e.message)}</div>`;
  }
}

function toggleDownloads(force) {
  const m = $("#dl-menu");
  const open = force ?? m.hidden;
  m.hidden = !open;
  clearInterval(D.timer);
  if (open) {
    loadDownloads();
    D.timer = setInterval(() => { if (!document.hidden) loadDownloads(); }, 2000);
  }
}

function bind() {
  $("#btn-downloads").addEventListener("click", () => toggleDownloads());
  $("#dl-steam").addEventListener("click", () => { toggleDownloads(false); C.act("steam_downloads"); });
  $("#dl-list").addEventListener("click", (e) => {
    const t = e.target;
    const one = t.closest("[data-upd]"), all = t.closest("[data-upd-all]");
    const pz = t.closest("[data-pause]"), rs = t.closest("[data-resume]");
    if (one || all) {
      e.stopPropagation();
      const ids = one ? [+one.dataset.upd] : [...$$("#dl-list [data-upd]")].map((b) => +b.dataset.upd);
      const g = one && S.games.find((x) => x.appid === ids[0]);
      (one || all).disabled = true;
      C.updateGames(ids, g ? C.gname(g.name) : undefined).then(() => setTimeout(loadDownloads, 2500));
      return;
    }
    if (pz || rs) { e.stopPropagation(); return pauseDl(+(pz || rs).dataset[pz ? "pause" : "resume"], !!pz); }
    const it = e.target.closest("[data-appid]");
    if (it) { toggleDownloads(false); C.go("library"); setTimeout(() => C.library.openDetail(+it.dataset.appid), 50); }
  });
  $("#now-playing").addEventListener("click", () => {
    C.go("library");
    setTimeout(() => C.library.openDetail(+$("#now-playing").dataset.appid), 50);
  });
  document.addEventListener("mousedown", (e) => {
    if (!$("#dl-menu").hidden && !e.target.closest("#dl-menu, #btn-downloads")) toggleDownloads(false);
  });
}

C.activity = { renderPlaying, renderBadge, toggleDownloads, init: bind };
})();
