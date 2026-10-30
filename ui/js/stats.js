/* Stats tab: how much you play. Sessions are recorded by Cinder; totals come from Steam. */
(() => {
"use strict";
const { $, esc, S } = C;
const el = () => $("#view-stats");
const T = { data: null };

const hm = (m) => {
  m = Math.round(m || 0);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h >= 100 ? `${h.toLocaleString()}h` : `${h}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
};
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function load() {
  if (!T.data) el().innerHTML = C.loading("Adding up your play time…");
  try {
    T.data = await C.api("/api/stats");
    if (C.route.tab === "stats") render();
  } catch (e) { if (!T.data) el().innerHTML = C.failed(e.message); }
}

// One series, one hue (the theme accent): thin bars, rounded tops on the baseline, hover tips.
function bars(values, labels, tips, opts = {}) {
  const w = 1000, h = opts.h || 160, n = values.length, gap = opts.gap ?? 4;
  const max = Math.max(...values, 1);
  const bw = (w - gap * (n - 1)) / n;
  const rects = values.map((v, i) => {
    const bh = v ? Math.max(4, (v / max) * (h - 8)) : 0;
    const x = i * (bw + gap), y = h - bh;
    return `<g class="bar-hit" data-tip="${esc(tips[i])}"><rect class="hit" x="${x}" y="0" width="${bw + gap}" height="${h}"/>
      ${bh ? `<path class="b${opts.hot && opts.hot(i) ? " hot" : ""}" d="M${x},${h} V${y + 4} q0,-4 4,-4 h${Math.max(0, bw - 8)} q4,0 4,4 V${h} Z"/>` : ""}</g>`;
  }).join("");
  const lab = labels.map((l, i) => (l ? `<span style="left:${((i + 0.5) / n) * 100}%">${esc(l)}</span>` : "")).join("");
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(opts.label || "")}">
      <line class="base" x1="0" y1="${h - 0.5}" x2="${w}" y2="${h - 0.5}"/>${rects}</svg>
    <div class="chart-x">${lab}</div><div class="chart-tip" hidden></div></div>`;
}

function topList(rows, max) {
  if (!rows.length) return '<div class="st-empty">Nothing yet.</div>';
  return `<div class="st-top">${rows.map((r) => `
    <button class="st-row" data-app="${r.appid}">
      <img alt="" loading="lazy" src="/art/${r.appid}/header" data-fail="hide">
      <span class="st-name">${esc(C.gname(r.name))}</span>
      <span class="st-bar"><i style="width:${Math.max(2, (100 * r.minutes) / max)}%"></i></span>
      <b>${hm(r.minutes)}</b>
    </button>`).join("")}</div>`;
}

function render() {
  const d = T.data;
  const n = new Date();
  const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  const metaCounts = {};
  for (const m of Object.values(S.meta || {})) if (m.status) metaCounts[m.status] = (metaCounts[m.status] || 0) + 1;
  const pct = d.library_count ? Math.round((100 * d.played_count) / d.library_count) : 0;
  const dayLabels = d.days.map((x, i) => (i % 5 === 4 || i === 29 ? new Date(x.date + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" }) : ""));
  const dayTips = d.days.map((x) => `${new Date(x.date + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}: ${x.minutes ? hm(x.minutes) : "no play"}`);
  const fresh = !d.sessions;
  el().innerHTML = `
    <div class="page-head"><h1>Stats</h1>
      <span class="scan">${d.tracking_since ? `Cinder has tracked your sessions since ${C.fmtDate(d.tracking_since)}` : "Cinder starts tracking from your next game"}</span></div>
    <div class="pstats st-kpis">
      <div class="pstat"><span>This week</span><b>${hm(d.week)}</b><small>last 7 days</small></div>
      <div class="pstat"><span>Last 30 days</span><b>${hm(d.month)}</b><small>${d.days.filter((x) => x.minutes).length} days played</small></div>
      <div class="pstat"><span>Last 2 weeks</span><b>${hm(d.two_weeks_steam)}</b><small>according to Steam</small></div>
      <div class="pstat"><span>All time</span><b>${hm(d.total)}</b><small>across ${d.played_count} games</small></div>
      <div class="pstat"><span>Streak</span><b>${d.streak} day${d.streak === 1 ? "" : "s"}</b><small>best ${d.best_streak}</small></div>
    </div>
    <section class="psection"><h2>Last 30 days</h2>
      ${fresh ? '<div class="st-empty">Play something and your days fill in here.</div>'
        : bars(d.days.map((x) => x.minutes), dayLabels, dayTips, { label: "Minutes played per day, last 30 days", hot: (i) => d.days[i].date === today })}
    </section>
    <div class="st-cols">
      <section class="psection"><h2>Most played lately</h2>${topList(d.recent_top, Math.max(1, ...d.recent_top.map((r) => r.minutes)))}</section>
      <section class="psection"><h2>Most played ever</h2>${topList(d.all_top, Math.max(1, ...d.all_top.map((r) => r.minutes)))}</section>
    </div>
    ${fresh ? "" : `<div class="st-cols">
      <section class="psection"><h2>By day of the week</h2>
        ${bars(d.weekday, DOW, d.weekday.map((m, i) => `${DOW[i]}: ${hm(m)}`), { h: 120, gap: 14, label: "Minutes by weekday" })}</section>
      <section class="psection"><h2>By time of day</h2>
        ${bars(d.hours, d.hours.map((_, i) => (i % 6 === 0 ? (i === 0 ? "12am" : i === 12 ? "12pm" : i < 12 ? `${i}am` : `${i - 12}pm`) : "")),
          d.hours.map((m, i) => `${i === 0 ? 12 : i > 12 ? i - 12 : i}${i < 12 ? "am" : "pm"}: ${hm(m)}`), { h: 120, gap: 3, label: "Minutes by hour" })}</section>
    </div>`}
    <div class="st-cols">
      <section class="psection"><h2>Your library</h2>
        <div class="st-lib"><div class="st-ring" style="--p:${pct}"><b>${pct}%</b><small>played</small></div>
          <div><p><b>${d.played_count}</b> of ${d.library_count} games played</p>
            ${C.STATUSES.map(([k, l]) => `<p class="st-st"><span>${l}</span><b>${metaCounts[k] || 0}</b></p>`).join("")}
            ${d.longest ? `<p class="st-long">Longest session: <b>${hm(d.longest.minutes)}</b> of ${esc(C.gname(d.longest.name))} on ${C.fmtDate(d.longest.date)}</p>` : ""}
          </div></div></section>
      <section class="psection"><h2>Recent sessions</h2>
        ${d.recent.length ? `<div class="st-sess">${d.recent.map((r) => `
          <button class="st-srow" data-app="${r.appid}"><span>${esc(C.gname(r.name))}</span><small>${C.fmtAgo(r.start)}</small><b>${hm(r.minutes)}</b></button>`).join("")}</div>`
          : '<div class="st-empty">Your sessions show up here.</div>'}</section>
    </div>`;
}

function bind() {
  el().addEventListener("click", (e) => {
    const a = e.target.closest("[data-app]");
    if (a) { const id = +a.dataset.app; C.go("library"); setTimeout(() => C.library.openDetail(id), 50); }
    if (e.target.closest("[data-retry]")) load();
  });
  // Hover tips for the bars (bigger hit area than the bar itself).
  el().addEventListener("mousemove", (e) => {
    const g = e.target.closest(".bar-hit");
    const chart = e.target.closest(".chart");
    el().querySelectorAll(".chart-tip").forEach((t) => { if (!chart || t.parentNode !== chart) t.hidden = true; });
    if (!g || !chart) return;
    const tip = chart.querySelector(".chart-tip");
    const r = chart.getBoundingClientRect();
    tip.textContent = g.dataset.tip;
    tip.hidden = false;
    tip.style.left = `${Math.min(r.width - 10, Math.max(10, e.clientX - r.left))}px`;
  });
  el().addEventListener("mouseleave", () => el().querySelectorAll(".chart-tip").forEach((t) => (t.hidden = true)));
}

C.views.stats = {
  placeholder: "Search your library",
  show() { if (T.data) render(); load(); },
  search(q, enter) { if (!q.trim()) return; C.views.library.search(q, enter); C.go("library"); },
  refresh() { return load(); },
  init: bind,
};
})();
