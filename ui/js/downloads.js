/* Downloads tab: what Steam is downloading, the queue, updates waiting, and what finished. */
(() => {
"use strict";
const { $, $$, esc, S, ICON } = C;
const el = () => $("#view-downloads");
const DL = { q: "", now: { speed: 0, eta: 0 }, data: null, timer: 0, hist: [], prev: {}, rate: {}, seen: {}, finished: [], busy: false };

const PAUSE = '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';
const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const UP = '<svg viewBox="0 0 24 24"><path d="M12 19V6m0 0-5 5m5-5 5 5M5 4h14"/></svg>';
const STATE = { downloading: "Downloading", installing: "Installing", verifying: "Verifying", queued: "Queued", paused: "Paused", done: "Done" };
const ACTIVE = new Set(["downloading", "installing", "verifying"]);

const name = (d) => C.gname(d.name || `App ${d.appid}`);
const fmtLeft = (s) => (!s ? "" : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.round(s / 60)} min` : `${s}s`);

// Without Steam's live numbers, work out speed from how fast the files grow.
function rate(appid, done) {
  const now = Date.now(), prev = DL.prev[appid];
  DL.prev[appid] = { done, at: now };
  if (prev && now > prev.at && done >= prev.done) {
    const r = (done - prev.done) / ((now - prev.at) / 1000);
    DL.rate[appid] = DL.rate[appid] == null ? r : 0.6 * DL.rate[appid] + 0.4 * r;
  }
  return DL.rate[appid] || 0;
}

function progress(d) {
  const inst = d.state === "installing" && d.stage_total;
  const total = inst ? d.stage_total : d.total, done = inst ? d.stage_done : d.done;
  return { total, done, pct: total ? Math.min(100, (100 * done) / total) : 0 };
}

async function load(first = false) {
  clearTimeout(DL.timer);
  try {
    const d = await C.api("/api/downloads" + (first ? "?first=1" : ""));
    // Remember games that finish while you watch (Steam's live queue lists them itself).
    const now = new Set(d.items.filter((x) => x.state !== "done").map((x) => x.appid));
    for (const [id, it] of Object.entries(DL.seen)) {
      if (!now.has(+id) && !d.items.some((x) => x.appid === +id) && !DL.finished.some((f) => f.appid === +id))
        DL.finished.unshift({ ...it, state: "done", completed_time: Date.now() / 1000 });
    }
    DL.seen = Object.fromEntries(d.items.filter((x) => x.state !== "done").map((x) => [x.appid, x]));
    DL.data = d;
    sample(d);
    if (C.route.tab === "downloads") render();
  } catch (e) {
    if (!DL.data) el().innerHTML = C.failed(e.message);
  }
  // Only polls while you're looking at it; coming back to the window picks it up again.
  if (C.route.tab === "downloads" && !document.hidden) DL.timer = setTimeout(load, 2000);
}

function spark() {
  const h = DL.hist, max = Math.max(...h, 1), w = 300, ht = 54;
  if (h.length < 2) return "";
  const pts = h.map((v, i) => `${((i / (h.length - 1)) * w).toFixed(1)},${(ht - (v / max) * (ht - 4)).toFixed(1)}`).join(" ");
  return `<svg class="dlp-spark" viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none">
    <polygon points="0,${ht} ${pts} ${w},${ht}"/><polyline points="${pts}"/></svg>`;
}

function heroShell(d) {
  return `<div class="dlp-hero" data-game="${d.appid}" data-key="${d.appid}:${d.state}">
    <img class="dlp-bg" alt="" src="/art/${d.appid}/hero" data-fail="hide">
    <div class="dlp-shade"></div>
    <div class="dlp-body">
      <div class="dlp-title"><img class="dlp-cap" alt="" src="/art/${d.appid}/header" data-fail="hide">
        <div><small>${ACTIVE.has(d.state) ? "Now downloading" : d.state === "paused" ? "Paused" : "Next up"}</small><h2>${esc(name(d))}</h2></div></div>
      <div class="dlp-dyn"></div>
    </div></div>`;
}

function heroLive(d, speed, eta) {
  const p = progress(d);
  const paused = d.state === "paused";
  return `<div class="dlp-bar ${d.state}"><i style="width:${p.pct.toFixed(1)}%"></i></div>
      <div class="dlp-stats">
        <div><span>${STATE[d.state] || d.state}${d.error ? ` · ${esc(d.error)}` : ""}</span><b>${p.total ? `${Math.floor(p.pct)}%` : "—"}</b><small>${p.total ? `${C.fmtSize(p.done)} of ${C.fmtSize(p.total)}` : "Waiting for Steam"}</small></div>
        <div class="dlp-speed" data-speedfmt title="Click to switch between MB/s, Mbps and both"><span>Speed <em>${{ MB: "MB/s", Mbps: "Mbps", both: "MB/s + Mbps" }[(C.style && C.style.get().speedFmt) || "MB"]}</em></span><b>${speed > 1024 ? C.fmtSpeed(speed) : "—"}</b><small>${DL.data.peak > 1024 ? `Peak ${C.fmtSpeed(DL.data.peak)}` : ""}</small></div>
        <div><span>Time left</span><b>${eta ? fmtLeft(eta) : "—"}</b><small>${eta ? `Done around ${new Date(Date.now() + eta * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</small></div>
        <div class="dlp-graph">${spark()}</div>
      </div>
      <div class="dlp-actions">
        ${paused ? `<button class="btn primary" data-cmd="resume" data-id="${d.appid}">${ICON.play}Resume</button>`
          : d.state === "queued" ? `<button class="btn primary" data-start="${d.appid}">${ICON.down}Start now</button>`
          : `<button class="btn" data-cmd="pause" data-id="${d.appid}">${PAUSE}Pause</button>`}
        <button class="btn" data-open="${d.appid}">Game page</button>
      </div>`;
}

function row(d) {
  const p = progress(d);
  const sub = d.state === "done"
    ? `${d.total ? C.fmtSize(d.total) + " · " : ""}finished ${d.completed_time ? C.fmtAgo(d.completed_time) : "just now"}`
    : p.total ? `${C.fmtSize(p.done)} of ${C.fmtSize(p.total)}` : "Waiting for Steam";
  const acts = d.state === "done" ? `<button class="icon-btn" data-cmd="remove" data-id="${d.appid}" title="Clear">${X}</button>`
    : `${d.state === "queued" || d.state === "paused" ? `<button class="btn sm" data-start="${d.appid}" title="Move to the front and download now">${UP}Start now</button>` : ""}
       ${d.state === "paused" ? `<button class="icon-btn" data-cmd="resume" data-id="${d.appid}" title="Resume">${ICON.play}</button>`
         : `<button class="icon-btn" data-cmd="pause" data-id="${d.appid}" title="Pause">${PAUSE}</button>`}
       <button class="icon-btn" data-cmd="remove" data-id="${d.appid}" title="Remove from the queue">${X}</button>`;
  return `<div class="dlp-row ${d.state}" data-game="${d.appid}">
    <img alt="" loading="lazy" src="/art/${d.appid}/header" data-fail="hide">
    <div class="dlp-main"><div class="dlp-top"><span class="name">${esc(name(d))}</span><span class="dlp-state ${d.state}">${STATE[d.state] || d.state}</span></div>
      ${d.state === "done" ? "" : `<div class="bar"><i style="width:${p.pct.toFixed(1)}%"></i></div>`}
      <div class="sub">${sub}${d.error ? ` · <span class="err">${esc(d.error)}</span>` : ""}</div></div>
    <div class="dlp-acts">${acts}</div></div>`;
}

function updRow(u) {
  return `<div class="dlp-row pending" data-game="${u.appid}">
    <img alt="" loading="lazy" src="/art/${u.appid}/header" data-fail="hide">
    <div class="dlp-main"><div class="dlp-top"><span class="name">${esc(name(u))}</span></div>
      <div class="sub">Update ready to download${u.size ? ` · game is ${C.fmtSize(u.size)}` : ""}</div></div>
    <div class="dlp-acts"><button class="btn sm primary" data-upd="${u.appid}">${ICON.down}Update</button></div></div>`;
}

function banner(state) {
  if (state === "needs_restart") return `<div class="dlp-banner"><div><strong>Connect Cinder to Steam</strong>
      <small>Lets Cinder start, pause, reorder and update downloads without opening Steam. Steam restarts once in the background.</small></div>
      <button class="btn sm primary" data-connect>Connect</button></div>`;
  if (state === "steam_off") return `<div class="dlp-banner"><div><strong>Steam isn't running</strong>
      <small>Nothing downloads until Steam is running. It starts in the background, with updates to Steam itself still blocked.</small></div>
      <button class="btn sm primary" data-steam-start>Start Steam</button></div>`;
  if (state === "off") return `<div class="dlp-banner muted"><div><strong>Download controls are off</strong>
      <small>Buttons here open Steam instead. Turn on “Update games from Cinder” in Settings → Steam.</small></div></div>`;
  return "";
}

const put = (node, html) => { if (node && node._html !== html) { node.innerHTML = html; node._html = html; } };
const match = (x) => !DL.q || name(x).toLowerCase().includes(DL.q);

const current = (d) => d.items.find((x) => x.appid === d.current) || d.items.find((x) => ACTIVE.has(x.state))
  || d.items.find((x) => x.state !== "done");

// Speed is sampled once per poll (not on every redraw, e.g. while typing in search).
function sample(d) {
  const cur = current(d);
  let speed = 0, eta = 0;
  if (cur) {
    speed = d.live ? d.speed : cur.state === "downloading" ? rate(cur.appid, cur.done) : 0;
    const p = progress(cur);
    eta = d.live && d.eta ? d.eta : speed > 1024 && p.total ? Math.round((p.total - p.done) / speed) : 0;
  }
  DL.now = { speed, eta };
  DL.hist.push(speed);
  if (DL.hist.length > 90) DL.hist.shift();
}

function render() {
  const d = DL.data;
  const all = d.items;
  const cur = current(d);
  const { speed, eta } = DL.now;
  const queue = all.filter((x) => x !== cur && x.state !== "done").filter(match);
  const updates = d.updates.filter(match);
  const done = [...all.filter((x) => x.state === "done"), ...DL.finished.filter((f) => !all.some((x) => x.appid === f.appid))].filter(match);
  const anyRunning = all.some((x) => ACTIVE.has(x.state) || x.state === "queued");
  const anyPaused = all.some((x) => x.state === "paused");
  const canCtl = d.bridge === "on";
  const nothing = !all.length && !d.updates.length && !done.length;

  if (!el().querySelector(".dlp-page")) {
    el().innerHTML = `<div class="dlp-page"><div class="page-head" data-s="head"></div><div data-s="banner"></div>
      <div data-s="empty"></div><div data-s="hero"></div><div data-s="queue"></div><div data-s="updates"></div><div data-s="done"></div></div>`;
  }
  const sec = (k) => el().querySelector(`[data-s="${k}"]`);
  put(sec("head"), `<h1>Downloads</h1>
      ${d.live ? '<span class="dlp-live" title="Live from Steam">Live</span>' : ""}
      <div class="spacer"></div>
      ${canCtl && anyRunning ? `<button class="btn sm" data-cmd="pause_all">${PAUSE}Pause all</button>` : ""}
      ${canCtl && anyPaused ? `<button class="btn sm" data-cmd="resume_all">${ICON.play}Resume all</button>` : ""}
      <button class="btn sm" data-steam>Manage in Steam</button>`);
  put(sec("banner"), banner(d.bridge));
  put(sec("empty"), nothing ? `<div class="state dlp-empty">${ICON.down}<strong>Nothing downloading</strong>Your games are up to date. Updates show up here when they're ready.</div>` : "");
  const hs = sec("hero");
  if (!cur) put(hs, "");
  else {
    const h = hs.querySelector(".dlp-hero");
    if (!h || h.dataset.key !== `${cur.appid}:${cur.state}`) { put(hs, heroShell(cur)); }
    put(hs.querySelector(".dlp-dyn"), heroLive(cur, speed, eta));
  }
  put(sec("queue"), queue.length ? `<section class="psection"><h2>Up next <span class="count">${queue.length}</span></h2><div class="dlp-list">${queue.map(row).join("")}</div></section>` : "");
  put(sec("updates"), updates.length ? `<section class="psection"><div class="lib-head"><h2>Updates available <span class="count">${updates.length}</span></h2><div class="spacer"></div>
      ${updates.length > 1 ? `<button class="btn sm primary" data-upd-all>${ICON.down}Update all</button>` : ""}</div>
      <div class="dlp-list">${updates.map(updRow).join("")}</div></section>` : "");
  put(sec("done"), done.length ? `<section class="psection"><h2>Finished</h2><div class="dlp-list">${done.slice(0, 20).map(row).join("")}</div></section>` : "");
}

async function cmd(c, appid, extra = {}) {
  if (DL.busy) return;
  DL.busy = true;
  try {
    if (c === "remove" && appid && DL.finished.some((f) => f.appid === appid) && !DL.data.items.some((x) => x.appid === appid)) {
      DL.finished = DL.finished.filter((f) => f.appid !== appid);
      return render();
    }
    const body = { action: "download_cmd", cmd: c, ...(appid ? { appid } : {}), ...extra };
    let r = await C.api("/api/action", body);
    if (r.state === "need_restart") {
      if (!window.confirm("Cinder needs to restart Steam once in the background to control downloads (this turns on Cinder's connection to Steam).\n\nRestart Steam now?")) return;
      r = await C.api("/api/action", { ...body, restart: true });
    }
    const msg = { starting: "Starting Steam in the background…", restarting: "Restarting Steam in the background. This takes about a minute", steam: "Opened Steam's downloads" }[r.state];
    if (msg) C.toast(msg);
    else if (c === "connect") C.toast("Connected to Steam");
  } catch (e) { C.toast(e.message, true); } finally {
    DL.busy = false;
    setTimeout(load, 700);
  }
}

function bind() {
  el().addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-speedfmt]")) {
      const order = ["MB", "Mbps", "both"];
      const cur = (C.style.get().speedFmt) || "MB";
      C.style.set("speedFmt", order[(order.indexOf(cur) + 1) % order.length]);
      return render();
    }
    const b = t.closest("[data-cmd]");
    if (b) { e.stopPropagation(); return cmd(b.dataset.cmd, b.dataset.id ? +b.dataset.id : 0); }
    const st = t.closest("[data-start]");
    if (st) { e.stopPropagation(); st.disabled = true; await C.updateGames([+st.dataset.start], name(DL.data.items.find((x) => x.appid === +st.dataset.start) || {})); return setTimeout(load, 1200); }
    const u = t.closest("[data-upd]"), all = t.closest("[data-upd-all]");
    if (u || all) {
      e.stopPropagation();
      (u || all).disabled = true;
      const ids = u ? [+u.dataset.upd] : DL.data.updates.map((x) => x.appid);
      const g = u && DL.data.updates.find((x) => x.appid === ids[0]);
      await C.updateGames(ids, g ? name(g) : undefined);
      return setTimeout(load, 1500);
    }
    if (t.closest("[data-connect]")) return cmd("connect", 0, { restart: true });
    if (t.closest("[data-steam-start]")) { await C.act("steam_start"); C.toast("Starting Steam in the background…"); return setTimeout(load, 4000); }
    if (t.closest("[data-steam]")) return C.act("steam_downloads");
    if (t.closest("[data-retry]")) return load();
    const open = t.closest("[data-open]") || t.closest("[data-game]");
    if (open && !t.closest("button:not([data-open])")) {
      const id = +(open.dataset.open || open.dataset.game);
      if (S.games.some((g) => g.appid === id)) { C.go("library"); setTimeout(() => C.library.openDetail(id), 50); }
    }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && C.route.tab === "downloads") load(); });
}

C.downloads = { load };
C.views.downloads = {
  placeholder: "Search",
  show() {
    if (DL.data) render(); else if (!el().querySelector(".dlp-page")) el().innerHTML = C.loading("Checking downloads…");
    load(true);
  },
  search(q) { DL.q = q.trim().toLowerCase(); if (DL.data) render(); },
  refresh() { return load(); },
  init: bind,
};
})();
