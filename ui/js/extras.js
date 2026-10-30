/* How long to beat, price history and targets, session recaps, and Steam guides. */
(() => {
"use strict";
const { $, esc, S } = C;
const once = {};  // url -> promise, so several views share one request
const get = (url, ttl = 600000) => {
  const hit = once[url];
  if (hit && Date.now() - hit.at < ttl) return hit.p;
  const p = C.api(url).catch((e) => { delete once[url]; throw e; });
  once[url] = { p, at: Date.now() };
  return p;
};
const hrs = (min) => (min >= 600 ? Math.round(min / 60) : Math.round(min / 6) / 10).toLocaleString();
const dur = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m} min`;
};
const when = (iso) => { const t = Date.parse(iso); return t ? C.fmtDate(t / 1000) : ""; };

// ---------------------------------------------------------------- how long to beat
async function hltbInto(el, appid, playedMin = 0) {
  if (!el) return;
  el.hidden = true;
  let h;
  try { h = (await get(`/api/hltb/${appid}`, 3600000)).hltb; } catch { return; }
  if (!h || !el.isConnected) return;
  const rows = [["Main story", h.main], ["Main + extras", h.extras], ["Completionist", h.complete]].filter((r) => r[1]);
  const max = Math.max(...rows.map((r) => r[1]), playedMin || 0);
  const youPct = playedMin && max ? Math.min(100, (100 * playedMin) / max) : 0;
  const main = h.main || h.extras || h.complete;
  el.innerHTML = `
    <div class="hltb-head"><b>How long to beat</b>${h.url ? `<a href="#" data-url="${esc(h.url)}">HowLongToBeat</a>` : ""}</div>
    <div class="hltb-rows">${rows.map(([l, m]) => `
      <div class="hltb-row"><span>${l}</span><div class="hltb-bar"><i style="width:${(100 * m) / max}%"></i>${youPct ? `<em style="left:${youPct}%"></em>` : ""}</div><b>${hrs(m)} h</b></div>`).join("")}</div>
    ${playedMin ? `<small class="hltb-you"><em></em>You've played ${hrs(playedMin)} h${main ? ` · ${playedMin >= main ? "past the main story's length" : `about ${Math.round((100 * playedMin) / main)}% of the main story`}` : ""}</small>` : ""}`;
  el.hidden = false;
}

// ---------------------------------------------------------------- prices
function chartSVG(hist, target, cur) {
  if (!hist || hist.length < 2) return "";
  const now = Date.now() / 1000;
  const pts = [...hist, [now, hist[hist.length - 1][1], hist[hist.length - 1][2]]];
  const t0 = pts[0][0], t1 = Math.max(now, t0 + 86400);
  const vals = pts.map((p) => p[1]).concat(target ? [target] : []);
  const lo = Math.min(...vals) * 0.9, hi = Math.max(...vals) * 1.05 || 1;
  const W = 600, H = 120;
  const x = (t) => ((t - t0) / (t1 - t0)) * W, y = (v) => H - ((v - lo) / (hi - lo)) * H;
  let d = `M${x(pts[0][0]).toFixed(1)},${y(pts[0][1]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i][0]).toFixed(1)} V${y(pts[i][1]).toFixed(1)}`;
  return `<div class="pchart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path class="pc-area" d="${d} V${H} H0 Z"/><path class="pc-line" d="${d}"/>
      ${target ? `<path class="pc-target" d="M0,${y(target).toFixed(1)} H${W}"/>` : ""}</svg>
    <div class="pc-axis"><span>${C.fmtDate(t0)}</span><span>Now</span></div>
    <small>Prices Cinder has seen since it started watching${target ? ` · dashed line: your target ${C.money(target, cur)}` : ""}</small></div>`;
}

function dealLine(label, d, nowCents, cls = "") {
  if (!d) return "";
  const now = nowCents != null && d.cents >= nowCents;
  return `<div class="pdeal ${cls}"><span>${label}</span>
    <b>${C.money(d.cents, d.currency)}</b>${d.cut ? `<em>-${d.cut}%</em>` : ""}
    <small>${esc(d.shop && cls !== "steam" ? d.shop : "")}${d.shop && cls !== "steam" && d.when ? " · " : ""}${when(d.when)}</small>
    ${now ? '<span class="pill ok">That\'s now</span>' : ""}</div>`;
}

async function pricePanel(el, appid, price) {
  if (!el) return;
  el.innerHTML = C.loading("Checking price history…");
  let d;
  try { d = await C.api(`/api/prices/${appid}`); } catch (e) { el.innerHTML = C.failed(e.message, false); return; }
  if (!el.isConnected) return;
  const cur = (price && price.currency) || d.currency || (d.steam_low && d.steam_low.currency) || "USD";
  const nowC = price && !price.free ? price.final : null;
  const elsewhere = d.best_now && d.best_now.shop && !/^steam$/i.test(d.best_now.shop) && nowC != null && d.best_now.cents < nowC ? d.best_now : null;
  el.innerHTML = `
    <div class="pdeals">
      ${dealLine("Lowest ever on Steam", d.steam_low, nowC, "steam")}
      ${d.any_low && (!d.steam_low || d.any_low.cents < d.steam_low.cents) ? dealLine("Lowest ever anywhere", d.any_low, null) : ""}
      ${elsewhere ? `<div class="pdeal"><span>Cheaper right now</span><b>${C.money(elsewhere.cents, elsewhere.currency)}</b>${elsewhere.cut ? `<em>-${elsewhere.cut}%</em>` : ""}
        <small>at ${esc(elsewhere.shop)}</small>${elsewhere.url ? `<a href="#" data-url="${esc(elsewhere.url)}">View</a>` : ""}</div>` : ""}
      ${!d.steam_low && !d.any_low ? '<p class="note">No price history found for this game.</p>' : ""}
    </div>
    ${chartSVG(d.history, d.target, cur)}
    <div class="ptarget">
      <label>Tell me when it's at or under
        <span class="money-in"><input type="number" min="0" step="0.01" inputmode="decimal" data-target-in value="${d.target ? (d.target / 100).toFixed(2) : ""}" placeholder="${nowC ? (Math.floor(nowC * 0.6) / 100).toFixed(2) : "0.00"}"></span>
        <small>${esc(cur)}</small></label>
      <button class="btn sm primary" data-target-set="${appid}">${d.target ? "Update alert" : "Set alert"}</button>
      ${d.target ? `<button class="btn sm" data-target-clear="${appid}">Remove</button>` : ""}
      ${d.history_url ? `<a href="#" class="ptarget-more" data-url="${esc(d.history_url)}">Full price history</a>` : ""}
    </div>`;
  el.onclick = async (e) => {
    const set = e.target.closest("[data-target-set]"), clr = e.target.closest("[data-target-clear]");
    if (!set && !clr) return;
    const v = parseFloat(el.querySelector("[data-target-in]").value);
    if (set && !(v > 0)) { C.toast("Enter a price first"); return; }
    await setTarget(appid, set ? Math.round(v * 100) : null);
    pricePanel(el, appid, price);
  };
}

async function setTarget(appid, cents) {
  try {
    await C.api("/api/price_target", { appid, cents });
    C.toast(cents ? `Price alert set at ${C.money(cents, (S.wlCurrency || undefined))}` : "Price alert removed");
    document.dispatchEvent(new CustomEvent("cinder-target", { detail: { appid, cents } }));
  } catch (e) { C.toast(e.message, true); }
}

// ---------------------------------------------------------------- session recap
const R = { shown: "", timer: null };
const seenRecap = () => { try { return localStorage.getItem("cinder.recap") || ""; } catch { return R.shown; } };
const markRecap = (id) => { R.shown = id; try { localStorage.setItem("cinder.recap", id); } catch { /* fine */ } };

async function checkRecap() {
  const r = S.steam && S.steam.recap;
  if (!r || r.id === seenRecap() || r.id === R.shown || Date.now() / 1000 - r.end > 12 * 3600 || S.config.session_recap === false) return;
  if (r.pending) { clearTimeout(R.timer); R.timer = setTimeout(async () => { await C.refreshStatus(); }, 8000); return; }
  let rec;
  try { rec = (await C.api("/api/recap")).recap; } catch { return; }
  if (!rec || rec.pending || rec.id !== r.id) return;
  R.shown = rec.id;
  showRecap(rec);
}

function showRecap(rec) {
  const box = $("#recap");
  const pct = rec.ach_total ? Math.round((100 * rec.ach_unlocked) / rec.ach_total) : 0;
  box.innerHTML = `
    <div class="rc-art" style="--rc:url('/art/${rec.appid}/hero')"></div>
    <button class="icon-btn rc-x" data-rc-close title="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="rc-body">
      <small class="rc-kicker">Session recap</small>
      <h3>${esc(rec.name)}</h3>
      <div class="rc-stats">
        <div><b>${dur(rec.seconds)}</b><span>this session</span></div>
        <div><b>${hrs(rec.total_minutes)} h</b><span>total</span></div>
        ${rec.ach_total ? `<div><b>${rec.ach_unlocked}/${rec.ach_total}</b><span>achievements</span></div>` : ""}
      </div>
      ${rec.longest ? '<span class="pill ok rc-badge">Your longest session in this game</span>' : ""}
      ${rec.new.length ? `<div class="rc-ach"><small>${rec.new.length} new achievement${rec.new.length > 1 ? "s" : ""}</small>
        <div class="rc-icons">${rec.new.slice(0, 8).map((a) => `<span title="${esc(a.name)}${a.desc ? ": " + esc(a.desc) : ""}${a.percent != null ? ` (${a.percent}% of players)` : ""}">
          <img alt="" src="${esc(a.icon || "")}" data-fail="hide"></span>`).join("")}${rec.new.length > 8 ? `<i>+${rec.new.length - 8}</i>` : ""}</div>
        <p>${rec.new.slice(0, 3).map((a) => esc(a.name)).join(" · ")}</p></div>` : ""}
      ${rec.ach_total ? `<div class="bar wide"><i style="width:${pct}%"></i></div>` : ""}
      <div class="btns"><button class="btn sm primary" data-rc-open="${rec.appid}">Open game page</button>
        <button class="btn sm" data-rc-close>Done</button></div>
    </div>`;
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add("in"));
  box.onclick = (e) => {
    const o = e.target.closest("[data-rc-open]");
    if (o) { closeRecap(rec.id); C.go("library"); setTimeout(() => C.library.openDetail(+o.dataset.rcOpen), 50); return; }
    if (e.target.closest("[data-rc-close]")) closeRecap(rec.id);
  };
}

function closeRecap(id) {
  markRecap(id);
  const box = $("#recap");
  box.classList.remove("in");
  setTimeout(() => { box.hidden = true; }, 250);
}

// ---------------------------------------------------------------- guides
const GD = { appid: 0 };

function guideCard(g) {
  return `<button class="guide" data-guide="${esc(g.id)}">
    ${g.image ? `<img alt="" loading="lazy" src="${esc(g.image)}" data-fail="hide">` : '<span class="guide-ph"></span>'}
    <span><b>${esc(g.title)}</b><small>${esc(g.desc)}</small>${g.stars ? `<em>${"★".repeat(g.stars)}${"☆".repeat(5 - g.stars)}</em>` : ""}</span>
  </button>`;
}

async function guidesInto(el, appid) {
  el.innerHTML = C.loading("Finding guides…");
  try {
    const { items } = await get(`/api/guides/${appid}`, 1800000);
    if (!el.isConnected) return;
    el.innerHTML = items.length
      ? `<div class="guide-head"><b>${items[0].achievements ? "Achievement guides" : "Top guides"}</b><small>from the Steam Community</small></div>
         <div class="guide-list">${items.slice(0, 8).map(guideCard).join("")}</div>`
      : '<p class="note">No Steam Community guides for this game yet.</p>';
  } catch (e) { el.innerHTML = C.failed(e.message, false); }
}

async function tipsInto(el, appid, name) {
  el.hidden = false;
  el.innerHTML = C.loading("Looking through guides…");
  try {
    const { tips, guides } = await get(`/api/tips/${appid}?name=${encodeURIComponent(name)}`, 1800000);
    if (!el.isConnected) return;
    el.innerHTML = tips.length
      ? tips.map((t) => `<div class="tip"><div class="tip-src">From <button class="link" data-guide="${esc(t.guide)}">${esc(t.guide_title)}</button>${t.section ? ` · ${esc(t.section)}` : ""}</div>
          <div class="tip-text prose">${t.html}</div></div>`).join("")
      : `<p class="note">No tips mention this one by name${guides.length ? ". Try a full guide:" : "."}</p>
         ${guides.length ? `<div class="guide-list">${guides.slice(0, 3).map(guideCard).join("")}</div>` : ""}`;
  } catch (e) { el.innerHTML = C.failed(e.message, false); }
}

async function openGuide(id) {
  const ov = $("#guide"), body = $("#guide-body");
  ov.hidden = false;
  body.innerHTML = C.loading("Loading guide…");
  body.scrollTop = 0;
  try {
    const { guide: g } = await get(`/api/guide/${id}`, 3600000);
    body.innerHTML = `
      <h2>${esc(g.title)}</h2>
      <div class="guide-by">${g.author ? `by ${esc(g.author)}` : ""}${g.stars ? ` · ${"★".repeat(g.stars)}` : ""}</div>
      ${g.sections.length > 3 ? `<nav class="guide-toc">${g.sections.map((s, i) => s.title ? `<button class="link" data-gsec="${i}">${esc(s.title)}</button>` : "").join("")}</nav>` : ""}
      ${g.intro ? `<div class="prose guide-intro">${g.intro}</div>` : ""}
      ${g.sections.map((s, i) => `<section class="guide-sec" id="gsec-${i}">${s.title ? `<h3>${esc(s.title)}</h3>` : ""}<div class="prose">${s.html}</div></section>`).join("")}`;
  } catch (e) { body.innerHTML = C.failed(e.message, false); }
}

function bindGuide() {
  const ov = $("#guide");
  const close = () => { ov.hidden = true; };
  // This sits on top of the game page, so closing it shouldn't close that too.
  ov.addEventListener("click", (e) => {
    if (e.target === ov || e.target.closest("[data-gclose]")) { e.stopImmediatePropagation(); close(); return; }
    const sec = e.target.closest("[data-gsec]");
    if (sec) { document.getElementById(`gsec-${sec.dataset.gsec}`)?.scrollIntoView({ behavior: "smooth" }); return; }
    const sp = e.target.closest(".spoiler");
    if (sp) { sp.classList.add("open"); return; }
    const u = e.target.closest("[data-url]");
    if (u) { e.preventDefault(); C.act("steam_url_open", { url: u.dataset.url }); }
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !ov.hidden) { e.stopImmediatePropagation(); close(); }
  }, true);
}

function init() {
  bindGuide();
}

C.extras = { hltbInto, pricePanel, setTarget, checkRecap, showRecap, guidesInto, tipsInto, openGuide, init, hrs };
})();
