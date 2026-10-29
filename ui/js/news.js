/* What's new: every Cinder update, from ui/changelog.json (ships with the app, works offline). */
(() => {
"use strict";
const { $, esc, S } = C;
let notes = null;

const vnum = (v) => String(v || "0").split(".").map((x) => parseInt(x, 10) || 0);
const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

async function load() {
  if (notes) return notes;
  const r = await fetch("/ui/changelog.json", { cache: "no-cache" });
  notes = await r.json();
  return notes;
}

function current() { return ($("#version").textContent || "").replace(/^v/, ""); }

async function refreshDot() {
  try {
    const n = await load();
    const latest = n[0] && n[0].version;
    $("#news-dot").hidden = !latest || !newer(latest, S.config.seen_version || "0");
  } catch { /* no changelog: no dot */ }
}

async function open() {
  const box = $("#news-body");
  $("#news").hidden = false;
  box.innerHTML = C.loading("Loading…");
  let n;
  try { n = await load(); } catch (e) { box.innerHTML = C.failed("Couldn't load the update notes", false); return; }
  // First time: only the newest entry counts as new.
  const seen = S.config.seen_version || (n[1] && n[1].version) || "0";
  const cur = current();
  $("#news-sub").textContent = `You're on Cinder ${cur ? "v" + cur : ""} · ${n.length} updates`;
  box.innerHTML = n.map((e, i) => `
    <article class="cl-note${newer(e.version, seen) ? " unseen" : ""}${e.version === cur ? " current" : ""}">
      <div class="cl-rail"><i></i></div>
      <div class="cl-main">
        <div class="cl-top"><b class="cl-ver">v${esc(e.version)}</b>
          ${e.version === cur ? '<span class="cl-tag cur">Installed</span>' : newer(e.version, cur) ? '<span class="cl-tag">Available</span>' : ""}
          ${newer(e.version, seen) && i < 30 ? '<span class="cl-tag new">New</span>' : ""}
          <small>${esc(e.date ? C.fmtDate(Date.parse(e.date + "T12:00:00") / 1000) : "")}</small></div>
        <h3>${esc(e.title)}</h3>
        <ul>${(e.items || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>
    </article>`).join("");
  const latest = n[0] && n[0].version;
  if (latest && newer(latest, seen)) {
    S.config.seen_version = latest;
    C.saveConfig({ seen_version: latest });
  }
  $("#news-dot").hidden = true;
}

function bind() {
  $("#btn-news").addEventListener("click", open);
  setTimeout(refreshDot, 1500);  // after settings have loaded
}

C.news = { open, refreshDot };
bind();
})();
