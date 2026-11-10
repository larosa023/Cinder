/* Game page "Setup" tab: custom art, before & after playing, save backups. Plus Year in review. */
(() => {
"use strict";
const { $, esc, S } = C;
const ART_KINDS = [["portrait", "Cover", "Tall cover in the library and couch mode"], ["header", "Banner", "Wide banner in lists and the store"],
  ["hero", "Background", "Big picture behind the game page"], ["logo", "Logo", "Transparent title logo"]];
const api = () => window.pywebview && window.pywebview.api;
const ago = (t) => C.fmtAgo ? C.fmtAgo(t) : C.fmtDate(t);

// Point every picture of this game at the new art (and refresh the browser's copy).
function bustArt(appid, kind) {
  const base = `/art/${appid}/${kind}`;
  fetch(base, { cache: "reload" }).catch(() => {});
  const t = Date.now();
  document.querySelectorAll(`img[src^="${base}"]`).forEach((img) => { img.src = `${base}?r=${t}`; });
  document.querySelectorAll(`[style*="${base}"]`).forEach((el) => { el.style.cssText = el.style.cssText.split(base).join(`${base}?r=${t}`); });
}

const POWER = [["high", "High performance"], ["ultimate", "Ultimate performance"], ["balanced", "Balanced"]];
function hookLine(h) {
  if (h.kind === "power") return `Switch the power plan to <b>${esc((POWER.find((p) => p[0] === h.value) || [0, h.value])[1])}</b>, then back`;
  if (h.kind === "close") return `Close <b>${esc(h.value)}</b>${h.reopen ? ", and open it again after" : ""}`;
  if (h.kind === "run") return `Open <b>${esc(h.value.split(/[\\/]/).pop())}</b>${h.args ? ` <small>${esc(h.args)}</small>` : ""}${h.close_after ? ", and close it after" : ""}`;
  return "";
}

async function mount(pane, g) {
  const appid = g.appid;
  pane.innerHTML = C.loading("Loading…");
  let custom = [], hooks = { hooks: [], global: [] }, bk = null;
  try {
    [custom, hooks, bk] = await Promise.all([
      C.api(`/api/customart/${appid}`).then((r) => r.custom),
      C.api(`/api/hooks/${appid}`),
      g.shortcut ? Promise.resolve(null) : C.api(`/api/backups/${appid}`),
    ]);
  } catch (e) { pane.innerHTML = C.failed(e.message, false); return; }
  if (!pane.isConnected) return;
  const st = { custom: new Set(custom), hooks: hooks.hooks, global: hooks.global, bk, scope: String(appid) };

  const paint = () => {
    const list = st.scope === "*" ? st.global : st.hooks;
    pane.innerHTML = `
      <section class="su-sec"><h3>Custom art</h3><p class="su-note">Use any picture for this game. It shows everywhere in Cinder, including every couch mode theme.</p>
        <div class="su-art">${ART_KINDS.map(([k, label, tip]) => `
          <div class="su-tile su-${k}" title="${esc(tip)}">
            <div class="su-img"><img alt="" src="/art/${appid}/${k}" data-fail="hide"></div>
            <div class="su-meta"><b>${label}</b>${st.custom.has(k) ? '<span class="pill ok">Yours</span>' : "<small>From Steam</small>"}</div>
            <div class="btns"><button class="btn sm" data-art-pick="${k}">Change</button>${st.custom.has(k) ? `<button class="btn sm" data-art-reset="${k}">Reset</button>` : ""}</div>
          </div>`).join("")}</div>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="su-file" hidden>
      </section>

      <section class="su-sec"><h3>Before &amp; after playing</h3>
        <div class="seg su-scope"><button data-scope="${appid}" class="${st.scope !== "*" ? "on" : ""}">This game</button><button data-scope="*" class="${st.scope === "*" ? "on" : ""}">Every game${st.global.length ? ` · ${st.global.length}` : ""}</button></div>
        <p class="su-note">${st.scope === "*" ? "These run for every game you play." : "When the game starts Cinder does these, and when it closes it puts things back."}${st.scope !== "*" && st.global.length ? ` Plus ${st.global.length} thing${st.global.length > 1 ? "s" : ""} set for every game.` : ""}</p>
        <div class="su-hooks">${list.map((h, i) => `<div class="su-hook"><span>${hookLine(h)}</span><button class="icon-btn" data-hook-del="${i}" title="Remove">✕</button></div>`).join("") || '<div class="su-empty">Nothing yet.</div>'}</div>
        <div class="su-add">
          <select data-hook-power><option value="">Power plan…</option>${POWER.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
          <span class="su-inline"><input class="text" data-hook-close placeholder="Close an app, e.g. Discord.exe" spellcheck="false"><label><input type="checkbox" data-hook-reopen checked> reopen after</label><button class="btn sm" data-hook-close-add>Add</button></span>
          <span class="su-inline"><input class="text" data-hook-run placeholder="Open a program (path to .exe)" spellcheck="false">${api() && api().pick_file ? '<button class="btn sm" data-hook-browse>Browse…</button>' : ""}<label><input type="checkbox" data-hook-closeafter> close it after</label><button class="btn sm" data-hook-run-add>Add</button></span>
        </div>
      </section>

      ${st.bk ? `<section class="su-sec"><h3>Save backups</h3>
        <p class="su-note">${S.config.backup_before_updates !== false ? "Cinder backs up this game's saves" + (S.config.backup_workshop !== false ? " and Workshop mods" : "") + " before it updates, keeping the last three." : "Backups before updates are off in Settings → Steam."}
          ${st.bk.sources.length ? `Backing up: ${st.bk.sources.map((s) => esc(s.label === "saves" ? "Steam Cloud saves" : s.label === "workshop" ? "Workshop mods" : s.path)).join(", ")}.` : "No save folder found yet: add where this game keeps its saves."}</p>
        <div class="su-folders">${st.bk.folders.map((f, i) => `<div class="su-hook"><span>📁 ${esc(f)}</span><button class="icon-btn" data-folder-del="${i}" title="Remove">✕</button></div>`).join("")}
          <span class="su-inline"><input class="text" data-folder-in placeholder="Add a save folder, e.g. C:\\Users\\you\\Documents\\My Games\\…" spellcheck="false">${api() && api().pick_folder ? '<button class="btn sm" data-folder-browse>Browse…</button>' : ""}<button class="btn sm" data-folder-add>Add</button></span></div>
        <div class="su-bk">${st.bk.backups.map((b) => `<div class="su-bkrow">
            <div><b>${C.fmtDate(b.time)}</b> <small>${new Date(b.time * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>
              <small>${{ update: "before an update", manual: "made by you", "before-restore": "before a restore" }[b.reason] || esc(b.reason)} · ${C.fmtSize(b.size)} · ${b.parts.map((p) => p === "saves" ? "saves" : p === "workshop" ? "mods" : "folder").join(", ")}${b.skipped.length ? ` · skipped ${esc(b.skipped.join(", "))}` : ""}</small></div>
            <div class="btns"><button class="btn sm" data-bk-restore="${esc(b.id)}">Restore</button><button class="icon-btn" data-bk-del="${esc(b.id)}" title="Delete">✕</button></div>
          </div>`).join("") || '<div class="su-empty">No backups yet.</div>'}</div>
        <button class="btn sm primary" data-bk-make ${st.bk.busy ? "disabled" : ""}>${st.bk.busy ? "Backing up…" : "Back up now"}</button>
      </section>` : ""}`;
  };

  const saveHooks = async (list) => {
    try {
      const r = await C.api("/api/hooks", { scope: st.scope, hooks: list });
      if (st.scope === "*") st.global = r.hooks; else st.hooks = r.hooks;
    } catch (e) { C.toast(e.message, true); }
    paint();
  };
  const bkOp = async (body, busyMsg) => {
    try {
      if (busyMsg) C.toast(busyMsg);
      const r = await C.api("/api/backups", { appid, ...body });
      if (!r.ok) { C.toast(r.error, true); return false; }
      st.bk = r;
      paint();
      return true;
    } catch (e) { C.toast(e.message, true); return false; }
  };

  pane.onclick = async (e) => {
    const t = e.target;
    const pick = t.closest("[data-art-pick]");
    if (pick) { const f = $("#su-file"); f.dataset.kind = pick.dataset.artPick; f.value = ""; f.click(); return; }
    const rs = t.closest("[data-art-reset]");
    if (rs) { await C.api("/api/customart", { appid, kind: rs.dataset.artReset, reset: true }); st.custom.delete(rs.dataset.artReset); bustArt(appid, rs.dataset.artReset); paint(); return; }
    const sc = t.closest("[data-scope]");
    if (sc) { st.scope = sc.dataset.scope; paint(); return; }
    const list = st.scope === "*" ? st.global : st.hooks;
    const del = t.closest("[data-hook-del]");
    if (del) return saveHooks(list.filter((_, i) => i !== +del.dataset.hookDel));
    if (t.closest("[data-hook-close-add]")) {
      let v = pane.querySelector("[data-hook-close]").value.trim();
      if (!v) return;
      if (!/\.exe$/i.test(v)) v += ".exe";
      return saveHooks([...list, { kind: "close", value: v, reopen: pane.querySelector("[data-hook-reopen]").checked }]);
    }
    if (t.closest("[data-hook-browse]")) { const p = await api().pick_file("exe"); if (p) pane.querySelector("[data-hook-run]").value = p; return; }
    if (t.closest("[data-hook-run-add]")) {
      const v = pane.querySelector("[data-hook-run]").value.trim().replace(/^"|"$/g, "");
      if (!v) return;
      return saveHooks([...list, { kind: "run", value: v, close_after: pane.querySelector("[data-hook-closeafter]").checked }]);
    }
    if (t.closest("[data-folder-browse]")) { const p = await api().pick_folder(); if (p) pane.querySelector("[data-folder-in]").value = p; return; }
    if (t.closest("[data-folder-add]")) {
      const v = pane.querySelector("[data-folder-in]").value.trim().replace(/^"|"$/g, "");
      if (v) bkOp({ op: "folders", folders: [...st.bk.folders, v] });
      return;
    }
    const fd = t.closest("[data-folder-del]");
    if (fd) return bkOp({ op: "folders", folders: st.bk.folders.filter((_, i) => i !== +fd.dataset.folderDel) });
    if (t.closest("[data-bk-make]")) { if (await bkOp({ op: "make" }, "Backing up…")) C.toast("Backed up"); return; }
    const rr = t.closest("[data-bk-restore]");
    if (rr) {
      if (rr.dataset.armed !== "1") { rr.dataset.armed = "1"; rr.textContent = "Click again to restore"; rr.classList.add("danger"); return; }
      if (await bkOp({ op: "restore", id: rr.dataset.bkRestore }, "Restoring…")) C.toast("Restored. Your saves from before are in a new backup too.");
      return;
    }
    const bd = t.closest("[data-bk-del]");
    if (bd) return bkOp({ op: "delete", id: bd.dataset.bkDel });
  };
  pane.onchange = async (e) => {
    if (e.target.matches("[data-hook-power]") && e.target.value) {
      const list = (st.scope === "*" ? st.global : st.hooks).filter((h) => h.kind !== "power");
      return saveHooks([...list, { kind: "power", value: e.target.value }]);
    }
    if (e.target.id === "su-file") {
      const f = e.target.files[0], kind = e.target.dataset.kind;
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { C.toast("That image is over 20 MB", true); return; }
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      try {
        const r = await C.api("/api/customart", { appid, kind, data });
        if (!r.ok) { C.toast(r.error, true); return; }
        st.custom.add(kind);
        bustArt(appid, kind);
        paint();
        C.toast("Saved. It shows everywhere in Cinder now.");
      } catch (err) { C.toast(err.message, true); }
    }
  };
  pane.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    if (e.target.matches("[data-hook-close]")) pane.querySelector("[data-hook-close-add]").click();
    if (e.target.matches("[data-hook-run]")) pane.querySelector("[data-hook-run-add]").click();
    if (e.target.matches("[data-folder-in]")) pane.querySelector("[data-folder-add]").click();
  };
  paint();
}

// ---------------------------------------------------------------- Year in review
const RV = { period: "" };
const hrs = (h) => (h >= 10 ? Math.round(h) : h).toLocaleString();
const hour12 = (h) => `${(h % 12) || 12} ${h < 12 ? "AM" : "PM"}`;

async function openReview(period) {
  const ov = $("#review"), body = $("#review-body");
  ov.hidden = false;
  body.innerHTML = C.loading("Adding it all up…");
  let r;
  try { r = await C.api(`/api/review${period ? `?period=${encodeURIComponent(period)}` : ""}`); }
  catch (e) { body.innerHTML = C.failed(e.message, false); return; }
  const v = r.review;
  RV.period = v.period;
  RV.data = v;
  $("#review-period").innerHTML = (r.periods.length ? r.periods : [{ id: v.period, label: v.label }])
    .map((p) => `<option value="${p.id}"${p.id === v.period ? " selected" : ""}>${p.id.length === 4 ? `${esc(p.label)} — whole year` : `&nbsp;&nbsp;${esc(p.label)}`}</option>`).join("");
  const top = v.top[0];
  const max = Math.max(...v.by_hour, 0.01);
  body.innerHTML = `
    <div class="yr-hero"${top ? ` style="--yr:url('/art/${top.appid}/hero')"` : ""}>
      <small>Your ${esc(v.label)} in games</small>
      <h2>${hrs(v.hours)} hours</h2>
      <p>${v.sessions.toLocaleString()} sessions · ${v.games} game${v.games === 1 ? "" : "s"} · ${v.days} day${v.days === 1 ? "" : "s"} with play</p>
    </div>
    ${!v.sessions && !v.achievements ? `<p class="note">Nothing recorded for ${esc(v.label)} yet. Cinder counts the sessions it sees, so this fills in as you play.</p>` : ""}
    <div class="yr-grid">
      ${top ? `<div class="yr-card yr-top" data-app="${top.appid}"><img alt="" src="/art/${top.appid}/portrait" data-fail="hide"><div><small>Most played</small><b>${esc(top.name)}</b><span>${hrs(top.hours)} h · ${top.share}% of your time</span></div></div>` : ""}
      ${v.longest ? `<div class="yr-card"><small>Longest session</small><b>${hrs(v.longest.hours)} h</b><span>${esc(v.longest.name)} · ${C.fmtDate(v.longest.start)}</span></div>` : ""}
      ${v.busiest ? `<div class="yr-card"><small>Busiest day</small><b>${hrs(v.busiest.hours)} h</b><span>${new Date(v.busiest.day + "T12:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span></div>` : ""}
      ${v.streak ? `<div class="yr-card"><small>Longest streak</small><b>${v.streak} day${v.streak === 1 ? "" : "s"}</b><span>in a row with some play</span></div>` : ""}
      ${v.weekday_name ? `<div class="yr-card"><small>You play most on</small><b>${esc(v.weekday_name)}</b><span>around ${hour12(v.hour)}</span></div>` : ""}
      <div class="yr-card"><small>Achievements</small><b>${v.achievements.toLocaleString()}</b><span>${v.perfect.length ? `${v.perfect.length} game${v.perfect.length > 1 ? "s" : ""} completed 100%` : "unlocked"}</span></div>
      ${v.rarest ? `<div class="yr-card yr-rare"><img alt="" src="${esc(v.rarest.icon || "")}" data-fail="hide"><div><small>Rarest unlock</small><b>${esc(v.rarest.name)}</b><span>${esc(v.rarest.game)} · ${v.rarest.percent}% of players</span></div></div>` : ""}
      ${v.new_games.length ? `<div class="yr-card"><small>New to you</small><b>${v.new_games.length} game${v.new_games.length > 1 ? "s" : ""}</b><span>${v.new_games.slice(0, 3).map((g) => esc(g.name)).join(", ")}${v.new_games.length > 3 ? "…" : ""}</span></div>` : ""}
    </div>
    ${v.top.length > 1 ? `<h3 class="yr-h">Top games</h3><div class="yr-list">${v.top.map((g, i) => `
      <div class="yr-row" data-app="${g.appid}"><span class="yr-n">${i + 1}</span><img alt="" src="/art/${g.appid}/header" data-fail="hide"><b>${esc(g.name)}</b>
        <div class="yr-bar"><i style="width:${(100 * g.hours) / v.top[0].hours}%"></i></div><span>${hrs(g.hours)} h${g.achievements ? ` · 🏆 ${g.achievements}` : ""}</span></div>`).join("")}</div>` : ""}
    ${v.sessions ? `<h3 class="yr-h">When you play</h3><div class="yr-hours">${v.by_hour.map((h, i) => `<i style="height:${Math.max(2, (100 * h) / max)}%" title="${hour12(i)}: ${h.toFixed(1)} h"></i>`).join("")}</div>
      <div class="yr-hx"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div>` : ""}
    <p class="yr-foot">Hours come from the sessions Cinder has seen${v.since ? ` (since ${C.fmtDate(v.since)})` : ""}; achievements come from Steam.</p>`;
}

// ---- The shareable card: a 1080×1350 picture of the review, drawn on a canvas ----
const loadImg = (src) => new Promise((res) => {
  if (!src) return res(null);
  const i = new Image();
  i.onload = () => res(i); i.onerror = () => res(null);
  i.src = src;
});
function cover(ctx, img, x, y, w, h) {  // draw like object-fit: cover
  const r = Math.max(w / img.width, h / img.height);
  const sw = w / r, sh = h / r;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > max) text = text.slice(0, -1);
  return text + "…";
}

async function drawCard(v) {
  const W = 1080, H = 1350, pad = 72;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const accent = (css.getPropertyValue("--accent") || "#ff6a3d").trim() || "#ff6a3d";
  const font = (w, px) => `${w} ${px}px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
  const top = v.top[0];
  const [hero, port, rare, ...heads] = await Promise.all([
    top ? loadImg(`/art/${top.appid}/hero`) : null, top ? loadImg(`/art/${top.appid}/portrait`) : null,
    v.rarest ? loadImg(v.rarest.icon) : null, ...v.top.slice(0, 5).map((g) => loadImg(`/art/${g.appid}/header`)),
  ]);

  // Background: the top game's art, darkened, fading into the page colour.
  ctx.fillStyle = "#0b0d12"; ctx.fillRect(0, 0, W, H);
  if (hero) { ctx.save(); ctx.filter = "blur(18px) saturate(1.2) brightness(.55)"; cover(ctx, hero, -40, -40, W + 80, 760); ctx.restore(); }
  let g = ctx.createLinearGradient(0, 0, 0, 780);
  g.addColorStop(0, "rgba(11,13,18,.15)"); g.addColorStop(.7, "rgba(11,13,18,.75)"); g.addColorStop(1, "#0b0d12");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 780);
  g = ctx.createRadialGradient(W * .85, 120, 0, W * .85, 120, 520);
  g.addColorStop(0, accent + "55"); g.addColorStop(1, "transparent");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 700);

  // Heading
  ctx.fillStyle = accent; ctx.font = font(800, 30);
  ctx.fillText(`MY ${v.label.toUpperCase()} IN GAMES`, pad, 120);
  ctx.fillStyle = "#fff"; ctx.font = font(800, 150);
  const hoursTxt = (v.hours >= 10 ? Math.round(v.hours) : v.hours).toLocaleString();
  ctx.fillText(hoursTxt, pad - 6, 270);
  const hw = ctx.measureText(hoursTxt).width;
  ctx.font = font(700, 56); ctx.fillText(v.hours === 1 ? "hour" : "hours", pad + hw + 18, 270);
  ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.font = font(500, 32);
  ctx.fillText(`${v.sessions.toLocaleString()} sessions · ${v.games} game${v.games === 1 ? "" : "s"} · ${v.days} day${v.days === 1 ? "" : "s"} of play`, pad, 330);

  // Most played
  let y = 390;
  if (top) {
    rrect(ctx, pad, y, W - pad * 2, 260, 28); ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fill();
    if (port) { ctx.save(); rrect(ctx, pad + 22, y + 22, 144, 216, 14); ctx.clip(); cover(ctx, port, pad + 22, y + 22, 144, 216); ctx.restore(); }
    const tx = pad + (port ? 196 : 32);
    ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = font(700, 24); ctx.fillText("MOST PLAYED", tx, y + 66);
    ctx.fillStyle = "#fff"; ctx.font = font(800, 50); ctx.fillText(fit(ctx, top.name, W - pad - tx - 32), tx, y + 128);
    ctx.fillStyle = accent; ctx.font = font(800, 38); ctx.fillText(`${(top.hours >= 10 ? Math.round(top.hours) : top.hours).toLocaleString()} h`, tx, y + 184);
    ctx.fillStyle = "rgba(255,255,255,.65)"; ctx.font = font(500, 26); ctx.fillText(`${top.share}% of your time`, tx, y + 224);
    y += 284;
  }

  // Stat tiles
  const tiles = [
    v.longest && ["Longest", `${v.longest.hours} h`, v.longest.name],
    v.busiest && ["Busiest day", `${v.busiest.hours} h`, new Date(v.busiest.day + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" })],
    v.streak && ["Streak", `${v.streak} day${v.streak === 1 ? "" : "s"}`, "in a row"],
    ["Trophies", v.achievements.toLocaleString(), v.perfect.length ? `${v.perfect.length} game${v.perfect.length > 1 ? "s" : ""} at 100%` : "achievements"],
  ].filter(Boolean).slice(0, 4);
  const tw = (W - pad * 2 - 24 * (tiles.length - 1)) / tiles.length;
  tiles.forEach(([l, big, small], i) => {
    const x = pad + i * (tw + 24);
    rrect(ctx, x, y, tw, 156, 22); ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = font(700, 22); ctx.fillText(fit(ctx, l.toUpperCase(), tw - 40), x + 22, y + 46);
    ctx.fillStyle = "#fff"; ctx.font = font(800, 44); ctx.fillText(fit(ctx, big, tw - 40), x + 22, y + 100);
    ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = font(500, 22); ctx.fillText(fit(ctx, small || "", tw - 40), x + 22, y + 134);
  });
  y += 190;

  // Top games
  const room = Math.floor((H - 130 - (y + 34)) / 62);  // rows that fit above the footer
  const rest = v.top.slice(0, Math.max(0, Math.min(5, room - (v.rarest && room >= 5 ? 2 : 0))));
  if (rest.length > 1) {
    ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = font(700, 24); ctx.fillText("TOP GAMES", pad, y + 10);
    y += 34;
    const max = rest[0].hours || 1;
    rest.forEach((gm, i) => {
      const ry = y + i * 62;
      ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.font = font(800, 26); ctx.fillText(String(i + 1), pad, ry + 36);
      if (heads[i]) { ctx.save(); rrect(ctx, pad + 40, ry + 6, 96, 45, 8); ctx.clip(); cover(ctx, heads[i], pad + 40, ry + 6, 96, 45); ctx.restore(); }
      ctx.fillStyle = "#fff"; ctx.font = font(600, 28); ctx.fillText(fit(ctx, gm.name, 380), pad + 156, ry + 38);
      const bx = pad + 560, bw = W - pad - bx - 110;
      rrect(ctx, bx, ry + 22, bw, 12, 6); ctx.fillStyle = "rgba(255,255,255,.1)"; ctx.fill();
      rrect(ctx, bx, ry + 22, Math.max(12, (bw * gm.hours) / max), 12, 6); ctx.fillStyle = accent; ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.font = font(700, 26); ctx.textAlign = "right";
      ctx.fillText(`${(gm.hours >= 10 ? Math.round(gm.hours) : gm.hours).toLocaleString()} h`, W - pad, ry + 38); ctx.textAlign = "left";
    });
    y += rest.length * 62 + 20;
  }

  // Rarest unlock
  if (v.rarest && y + 104 < H - 110) {
    rrect(ctx, pad, y, W - pad * 2, 104, 22); ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fill();
    if (rare) { ctx.save(); rrect(ctx, pad + 20, y + 16, 72, 72, 12); ctx.clip(); ctx.drawImage(rare, pad + 20, y + 16, 72, 72); ctx.restore(); }
    const tx = pad + (rare ? 112 : 24);
    ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = font(700, 22); ctx.fillText(`RAREST UNLOCK · ${v.rarest.percent}% OF PLAYERS`, tx, y + 42);
    ctx.fillStyle = "#fff"; ctx.font = font(700, 32); ctx.fillText(fit(ctx, `${v.rarest.name} — ${v.rarest.game}`, W - pad - tx - 24), tx, y + 82);
  }

  // Footer
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(pad + 9, H - 62, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = font(700, 26); ctx.fillText("Cinder", pad + 30, H - 52);
  ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.font = font(500, 22);
  ctx.fillText(S.user ? S.user.name || "" : "", W - pad, H - 54); ctx.textAlign = "left";
  return cv;
}

async function saveCard() {
  if (!RV.data) return;
  const btn = $("#review-save");
  btn.disabled = true;
  try {
    const cv = await drawCard(RV.data);
    const data = cv.toDataURL("image/png");
    const name = `Cinder ${RV.data.label} in review.png`;
    const a = api();
    if (a && a.save_file) {
      const path = await a.save_file(name, "png");
      if (!path) return;
      const r = await C.api("/api/save_image", { path, data });
      if (!r.ok) return C.toast(r.error, true);
      C.toast("Saved");
    } else {
      Object.assign(document.createElement("a"), { href: data, download: name }).click();
    }
  } catch (e) { C.toast(e.message, true); }
  finally { btn.disabled = false; }
}

async function copyCard() {
  if (!RV.data) return;
  try {
    const cv = await drawCard(RV.data);
    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    C.toast("Copied. Paste it anywhere");
  } catch { C.toast("Couldn't copy here: use Save image instead", true); }
}

function bindReview() {
  const ov = $("#review");
  $("#review-save").addEventListener("click", saveCard);
  $("#review-copy").addEventListener("click", copyCard);
  ov.addEventListener("change", (e) => { if (e.target.id === "review-period") openReview(e.target.value); });
  ov.addEventListener("click", (e) => {
    const a = e.target.closest("[data-app]");
    if (a) { const id = +a.dataset.app; C.closeOverlays(); C.go("library"); setTimeout(() => C.library.openDetail(id), 60); }
  });
}

C.gameSetup = { mount, bustArt };
C.review = { open: openReview, init: bindReview, drawCard };
})();
