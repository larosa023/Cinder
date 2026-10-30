/* Steam user reviews: the score badge, and a browsable list (game page tab and store pages). */
(() => {
"use strict";
const { esc } = C;
const SORTS = [["helpful", "Most helpful"], ["recent", "Recent"], ["positive", "Positive"], ["negative", "Negative"]];
const summaries = {};  // appid -> summary (or null), shared by every view
const THUMB = '<svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2.6 2.3L12.8 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7"/></svg>';

const tone = (s) => !s ? "" : s.pct >= 70 ? "pos" : s.pct >= 40 ? "mixed" : "neg";
const n = (x) => (x || 0).toLocaleString();

/** Small score badge: "Very Positive · 92%" (colored like Steam's). */
function badge(s, big = false) {
  if (!s) return "";
  return `<span class="rv-badge ${tone(s)}${big ? " big" : ""}" title="${n(s.positive)} positive · ${n(s.negative)} negative">
    <b>${esc(s.desc || "No score yet")}</b>${s.pct != null ? `<span>${s.pct}% of ${n(s.total)}</span>` : ""}</span>`;
}

async function summary(appid) {
  if (appid in summaries) return summaries[appid];
  try { summaries[appid] = (await C.api(`/api/reviews/${appid}?summary=1`)).summary || null; }
  catch { return null; }  // offline: try again next time
  return summaries[appid];
}

function card(r) {
  const long = r.text.length > 700;
  return `<article class="rv${r.up ? " up" : " down"}">
    <header>
      <span class="rv-thumb">${THUMB}</span>
      <div><b>${r.up ? "Recommended" : "Not recommended"}</b>
        <small>${r.hours ? `${n(r.hours)} hrs on record` : "Under an hour"}${r.hours_at && r.hours_at !== r.hours ? ` (${n(r.hours_at)} at review)` : ""}</small></div>
      <small class="rv-date">${C.fmtDate(r.date)}${r.updated > r.date + 86400 ? " · edited" : ""}</small>
    </header>
    ${r.early || r.free ? `<div class="rv-tags">${r.early ? "<span>Early Access review</span>" : ""}${r.free ? "<span>Got it for free</span>" : ""}</div>` : ""}
    <div class="rv-text${long ? " clamp" : ""}">${esc(r.text) || "<i>No text</i>"}</div>
    ${long ? '<button class="link rv-more" data-rv-more>Read more</button>' : ""}
    <footer>${r.helpful ? `${n(r.helpful)} found this helpful` : ""}${r.funny ? `${r.helpful ? " · " : ""}${n(r.funny)} found it funny` : ""}</footer>
  </article>`;
}

/** A reviews panel inside `el` for `appid`; keeps its own sort and paging. */
function mount(el, appid) {
  const st = { sort: "helpful", cursor: "*", items: [], busy: false, done: false, seq: 0 };

  async function load(more = false) {
    if (more && (st.busy || st.done)) return;
    const tok = ++st.seq;
    st.busy = true;
    if (!more) { st.cursor = "*"; st.items = []; st.done = false; paint(true); }
    try {
      const r = await C.api(`/api/reviews/${appid}?sort=${st.sort}&cursor=${encodeURIComponent(st.cursor)}`);
      if (tok !== st.seq || !el.isConnected) return;
      if (r.summary) summaries[appid] = r.summary;
      const seen = new Set(st.items.map((x) => x.id));
      const fresh = r.reviews.filter((x) => !seen.has(x.id));
      st.items.push(...fresh);
      st.done = !fresh.length || !r.cursor || r.cursor === st.cursor;
      st.cursor = r.cursor;
    } catch (e) {
      if (tok !== st.seq) return;
      st.error = e.message;
    } finally { if (tok === st.seq) st.busy = false; }
    paint();
  }

  function paint(loading) {
    const s = summaries[appid];
    const total = s ? s.positive + s.negative : 0;
    el.innerHTML = `
      <div class="rv-head">
        ${s ? `${badge(s, true)}<div class="rv-split" title="${n(s.positive)} positive · ${n(s.negative)} negative"><i style="width:${total ? (100 * s.positive) / total : 0}%"></i></div>` : ""}
        <div class="chips rv-sorts">${SORTS.map(([k, l]) => `<button data-rv-sort="${k}" class="${st.sort === k ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
      ${loading ? C.loading("Loading reviews…")
        : st.error && !st.items.length ? `<div class="state err"><strong>${esc(st.error)}</strong>
            <div class="btns"><button class="btn sm" data-retry>Try again</button>
            <button class="btn sm" data-rv-steam>Read them in Steam</button></div></div>`
        : !st.items.length ? '<div class="state">No reviews here yet.</div>'
        : `<div class="rv-list">${st.items.map(card).join("")}</div>
           ${st.done ? "" : `<div class="ws-more"><button class="btn" data-rv-load ${st.busy ? "disabled" : ""}>${st.busy ? "Loading…" : "More reviews"}</button></div>`}`}`;
  }

  if (!(appid in summaries)) summary(appid).then(() => { if (el.isConnected && !st.busy) paint(); });
  el.onclick = (e) => {
    const s = e.target.closest("[data-rv-sort]");
    if (s && s.dataset.rvSort !== st.sort) { st.sort = s.dataset.rvSort; st.error = null; return load(); }
    if (e.target.closest("[data-rv-load]")) return load(true);
    const m = e.target.closest("[data-rv-more]");
    if (m) { m.previousElementSibling.classList.remove("clamp"); m.remove(); }
    if (e.target.closest("[data-retry]")) { st.error = null; load(); }
    if (e.target.closest("[data-rv-steam]")) C.act("steam_url_open", { url: `https://store.steampowered.com/app/${appid}/#app_reviews_hash` });
  };
  load();
}

C.reviews = { badge, summary, mount };

/** System requirements, Minimum and Recommended side by side. */
C.specsHTML = (req) => {
  const col = (title, rows) => `<div class="specs-col"><h3>${title}</h3>${rows.length
    ? `<dl>${rows.map(([k, v]) => `<div${k ? "" : ' class="note-row"'}>${k ? `<dt>${esc(k)}</dt>` : ""}<dd>${esc(v)}</dd></div>`).join("")}</dl>`
    : '<p class="specs-none">Not listed</p>'}</div>`;
  if (!req || (!req.minimum.length && !req.recommended.length)) return '<div class="state">This game doesn\'t list system requirements.</div>';
  return `<div class="specs">${col("Minimum", req.minimum)}${col("Recommended", req.recommended)}</div>`;
};
})();
