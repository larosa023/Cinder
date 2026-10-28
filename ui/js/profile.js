/* Profile tab: yours (customizable) or a friend's (#/profile/<steamid>). */
(() => {
"use strict";
const { $, $$, esc, S, ICON } = C;
const el = () => $("#view-profile");
const P = { cache: {}, ach: null, editing: null };

const SECTIONS = [
  ["showcase", "Showcase"], ["achievements", "Achievements"], ["stats", "Stats"],
  ["about", "About"], ["recent", "Recently played"], ["most", "Most played recently"],
];
const STEAM_EDIT = [
  ["info", "Name, summary and location"], ["avatar", "Avatar and frame"], ["background", "Profile background"],
  ["miniprofile", "Mini profile"], ["theme", "Theme"], ["showcases", "Showcases"], ["settings", "Privacy settings"],
];

const style = () => {
  const ps = S.config.profile_style || {};
  return {
    background: ps.background || null,
    showcase: ps.showcase || [],
    sections: Object.fromEntries(SECTIONS.map(([k]) => [k, (ps.sections || {})[k] !== false])),
    banner: ps.banner || "large",
  };
};
const gameName = (appid) => (S.games.find((g) => g.appid === appid) || {}).name || `App ${appid}`;

async function load(id, force = false) {
  const key = id || "me";
  if (P.cache[key] && !force) return render(P.cache[key]);
  el().innerHTML = C.loading("Loading profile…");
  try {
    const { profile } = await C.api(`/api/profile${id ? `?id=${encodeURIComponent(id)}` : ""}`);
    P.cache[key] = profile;
    if ((C.route.params[0] || "me") === key || (!id && !C.route.params[0])) render(profile);
  } catch (e) {
    el().innerHTML = C.failed(e.message);
  }
}

function stat(label, value) {
  return `<div class="pstat"><span>${label}</span><b>${value}</b></div>`;
}

function achSection() {
  const a = P.ach;
  if (!a) return `<section class="psection" id="p-ach"><h2>Achievements</h2>${C.loading("Loading…")}</section>`;
  if (!a.games || !a.games.length) return "";
  const st = a.stats;
  return `<section class="psection" id="p-ach"><div class="lib-head"><h2>Achievements</h2><div class="spacer"></div>
      <button class="link" data-goto="achievements">See all</button></div>
    <div class="ach-summary">
      <div class="pstat"><span>Unlocked</span><b>${st.unlocked.toLocaleString()}</b></div>
      <div class="pstat"><span>Perfect games</span><b>${st.perfect}</b></div>
      <div class="pstat"><span>Average completion</span><b>${st.avg}%</b></div>
      <div class="ach-icons">${(a.rarest.length ? a.rarest : a.recent).slice(0, 8).map((x) =>
        `<img alt="" title="${esc(x.name)} · ${esc(x.game)}${x.percent != null ? ` · ${x.percent}%` : ""}" src="${esc(x.icon)}" data-fail="hide">`).join("")}</div>
    </div></section>`;
}

function showcaseSection(ids) {
  if (!ids.length) return "";
  return `<section class="psection"><h2>Showcase</h2><div class="showcase">${ids.map((id) => {
    const g = S.games.find((x) => x.appid === id) || { appid: id, name: gameName(id), playtime: 0 };
    return `<button class="sc-card" data-lib="${id}" title="${esc(g.name)}">
      <div class="art"><img alt="" src="/art/${id}/portrait" data-fallback="/art/${id}/header"></div>
      <span class="name">${esc(g.name)}</span><span class="sub">${g.playtime ? C.fmtPlay(g.playtime) + " played" : ""}</span></button>`;
  }).join("")}</div></section>`;
}

function render(p) {
  const mine = !!p.is_me;
  const ps = mine ? style() : { background: null, showcase: [], sections: Object.fromEntries(SECTIONS.map(([k]) => [k, true])), banner: "large" };
  const show = ps.sections;
  const onlineClass = p.online === "in-game" ? "ingame" : p.online === "online" ? "online" : "offline";
  const recent = (p.local && p.local.recent) || [];
  const heroApp = ps.background || (recent[0] && recent[0].appid) || (p.most_played[0] && p.most_played[0].appid);
  const stats = [];
  if (p.level != null) stats.push(stat("Steam level", `<span class="lvl">${p.level}</span>`));
  if (p.game_count != null) stats.push(stat("Games owned", p.game_count.toLocaleString()));
  if (p.local) {
    stats.push(stat("Installed", p.local.installed));
    stats.push(stat("Hours played", Math.round(p.local.minutes / 60).toLocaleString()));
    stats.push(stat("On disk", C.fmtSize(p.local.disk)));
  }

  el().innerHTML = `
    <div class="phero${ps.banner === "compact" ? " compact" : ""}"${heroApp ? ` style="--phero:url('/art/${heroApp}/hero')"` : ""}>
      <div class="phero-inner">
        <span class="p-av ${onlineClass}"><b>${esc((p.name || "?")[0].toUpperCase())}</b><img alt="" src="${esc(p.avatar)}" data-fail="hide"></span>
        <div class="p-id">
          <h1>${esc(p.name)}</h1>
          <div class="p-sub">
            <span class="pill ${onlineClass}">${esc(p.status || p.online || "Offline")}</span>
            ${p.realname ? `<span>${esc(p.realname)}</span>` : ""}
            ${p.location ? `<span>${esc(p.location)}</span>` : ""}
            ${p.member_since ? `<span>Member since ${esc(p.member_since)}</span>` : ""}
            ${p.vac_banned ? '<span class="pill danger">VAC ban on record</span>' : ""}
          </div>
        </div>
        <div class="spacer"></div>
        <div class="btns">
          ${mine ? `<button class="btn" data-customize><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/></svg>Customize</button>
            <button class="btn" data-steam-edit>${ICON.ext}Edit on Steam</button>`
            : `<button class="btn" data-p-msg="${p.steamid}">${ICON.chat}Message</button>
            <button class="btn" data-p-steam="${p.steamid}">${ICON.ext}View in Steam</button>`}
        </div>
      </div>
    </div>
    ${!p.public ? '<p class="note">This profile is private, so only basic details are visible.</p>' : ""}
    ${mine && show.showcase ? showcaseSection(ps.showcase) : ""}
    ${show.stats && stats.length ? `<div class="pstats">${stats.join("")}</div>` : ""}
    ${mine && show.achievements ? achSection() : ""}
    ${show.about && p.summary ? `<section class="psection"><h2>About</h2><div class="prose">${esc(p.summary).replace(/\n/g, "<br>")}</div></section>` : ""}
    ${show.recent && recent.length ? `<section class="psection"><h2>Recently played</h2><div class="recent-row">${recent.map((g) => `
      <button class="tile" data-lib="${g.appid}" title="${esc(g.name)}">
        <img loading="lazy" alt="" src="/art/${g.appid}/header" data-fail="hide"><span class="shade"></span>
        <span class="t-meta"><span class="t-name">${esc(g.name)}</span>
        <span class="t-sub">${C.fmtAgo(g.lastplayed)} · ${C.fmtPlay(g.playtime)}</span></span>
      </button>`).join("")}</div></section>` : ""}
    ${show.most && p.most_played.length ? `<section class="psection"><h2>Most played recently</h2><div class="plist">${p.most_played.map((g) => `
      <button class="prow" data-app="${g.appid}">
        <img loading="lazy" alt="" src="/art/${g.appid}/header" data-fail="hide">
        <span class="name">${esc(g.name)}</span>
        <span class="sub">${g.hours_recent ? `${esc(g.hours_recent)} hrs last 2 weeks` : ""}${g.hours_total ? ` · ${esc(g.hours_total)} hrs total` : ""}</span>
      </button>`).join("")}</div></section>` : ""}`;

  if (mine && show.achievements && !P.ach) {
    C.achievements.summary().then((a) => {
      P.ach = a;
      const sec = $("#p-ach");
      if (sec && C.route.tab === "profile") sec.outerHTML = achSection() || "";
    }).catch(() => { const sec = $("#p-ach"); if (sec) sec.remove(); });
  }
}

// ---------- Edit on Steam menu ----------
function steamEditMenu(btn) {
  const m = $("#steam-edit-menu");
  m.innerHTML = `<h4>Edit on Steam</h4>${STEAM_EDIT.map(([k, l]) => `<button data-edit-sec="${k}">${l}</button>`).join("")}
    <p class="hint">Opens Steam's own editor. Changes there show here after a refresh.</p>`;
  const r = btn.getBoundingClientRect();
  m.hidden = false;
  m.style.left = `${Math.min(r.left, innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = `${r.bottom + 6}px`;
}

// ---------- Customize panel ----------
function openEditor() {
  P.editing = JSON.parse(JSON.stringify(style()));
  $("#profile-edit").hidden = false;
  renderEditor();
}

function pickGrid(kind) {
  const e = P.editing;
  const q = ($("#pe-q") && $("#pe-q").value || "").toLowerCase();
  const games = S.games.filter((g) => !q || g.name.toLowerCase().includes(q)).slice(0, 60);
  return games.map((g) => {
    const on = kind === "background" ? e.background === g.appid : e.showcase.includes(g.appid);
    return `<button class="pe-game${on ? " on" : ""}" data-pick-${kind}="${g.appid}" title="${esc(g.name)}">
      <img alt="" loading="lazy" src="/art/${g.appid}/${kind === "background" ? "hero" : "header"}" data-fallback="/art/${g.appid}/header" data-fail="hide">
      <span>${esc(g.name)}</span></button>`;
  }).join("");
}

function renderEditor() {
  const e = P.editing;
  const tab = P.editTab || "background";
  $("#pe-body").innerHTML = `
    <nav class="d-tabs">
      ${[["background", "Background"], ["showcase", `Showcase (${e.showcase.length}/4)`], ["layout", "Layout"]]
        .map(([k, l]) => `<button data-pe-tab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}
    </nav>
    ${tab === "layout" ? `
      <div class="row"><div><strong>Banner</strong></div>
        <div class="seg"><button data-pe-banner="large" class="${e.banner === "large" ? "on" : ""}">Large</button>
        <button data-pe-banner="compact" class="${e.banner === "compact" ? "on" : ""}">Compact</button></div></div>
      <div class="row col"><div><strong>Sections</strong><small>Choose what your Cinder profile shows.</small></div>
        <div class="checks left">${SECTIONS.map(([k, l]) => `<label><input type="checkbox" data-pe-sec="${k}" ${e.sections[k] ? "checked" : ""}> ${l}</label>`).join("")}</div></div>`
    : `
      <div class="pe-tools"><input class="text" id="pe-q" placeholder="Search your games" autocomplete="off">
        ${tab === "background" ? `<button class="btn sm${e.background ? "" : " on"}" data-pe-auto>Automatic (last played)</button>`
          : `<span class="hint">Pick up to 4 games to feature at the top of your profile.</span>`}</div>
      <div class="pe-grid ${tab}" id="pe-grid">${pickGrid(tab)}</div>`}`;
}

function saveEditor() {
  S.config.profile_style = P.editing;
  C.saveConfig({ profile_style: P.editing });
  $("#profile-edit").hidden = true;
  const me = P.cache.me;
  if (me && C.route.tab === "profile" && !C.route.params[0]) render(me);
  C.toast("Profile updated");
}

function bind() {
  el().addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-customize]")) return openEditor();
    const se = t.closest("[data-steam-edit]");
    if (se) return steamEditMenu(se);
    const msg = t.closest("[data-p-msg]");
    if (msg) return C.act("message", { steamid: msg.dataset.pMsg });
    const st = t.closest("[data-p-steam]");
    if (st) return C.act("profile_in_steam", { steamid: st.dataset.pSteam });
    const go = t.closest("[data-goto]");
    if (go) return C.go(go.dataset.goto);
    const lib = t.closest("[data-lib]");
    if (lib) { C.go("library"); setTimeout(() => C.library.openDetail(+lib.dataset.lib), 50); return; }
    const app = t.closest("[data-app]");
    if (app && +app.dataset.app) return C.go(`store/app/${app.dataset.app}`);
    if (t.closest("[data-retry]")) return load(C.route.params[0], true);
  });

  const m = $("#steam-edit-menu");
  m.addEventListener("click", (e) => {
    const b = e.target.closest("[data-edit-sec]");
    if (!b) return;
    m.hidden = true;
    C.act("steam_profile_edit", { section: b.dataset.editSec }).then((ok) => ok && C.toast("Opened in Steam"));
  });
  document.addEventListener("mousedown", (e) => {
    if (!m.hidden && !e.target.closest("#steam-edit-menu, [data-steam-edit]")) m.hidden = true;
  });

  const ed = $("#profile-edit");
  ed.addEventListener("click", (e) => {
    const t = e.target, pe = P.editing;
    if (!pe) return;
    const tab = t.closest("[data-pe-tab]");
    if (tab) { P.editTab = tab.dataset.peTab; return renderEditor(); }
    const bg = t.closest("[data-pick-background]");
    if (bg) { pe.background = +bg.dataset.pickBackground; return renderEditor(); }
    if (t.closest("[data-pe-auto]")) { pe.background = null; return renderEditor(); }
    const sc = t.closest("[data-pick-showcase]");
    if (sc) {
      const id = +sc.dataset.pickShowcase;
      if (pe.showcase.includes(id)) pe.showcase = pe.showcase.filter((x) => x !== id);
      else if (pe.showcase.length < 4) pe.showcase.push(id);
      else C.toast("Showcase holds up to 4 games", true);
      const q = $("#pe-q").value;
      renderEditor();
      $("#pe-q").value = q;
      $("#pe-grid").innerHTML = pickGrid("showcase");
      return;
    }
    const bn = t.closest("[data-pe-banner]");
    if (bn) { pe.banner = bn.dataset.peBanner; return renderEditor(); }
    if (t.closest("#pe-save")) return saveEditor();
    if (t === ed || t.closest("[data-pe-cancel]")) { ed.hidden = true; P.editing = null; }
  });
  ed.addEventListener("change", (e) => {
    const sec = e.target.closest("[data-pe-sec]");
    if (sec && P.editing) P.editing.sections[sec.dataset.peSec] = sec.checked;
  });
  ed.addEventListener("input", (e) => {
    if (e.target.id === "pe-q") {
      const kind = (P.editTab || "background");
      $("#pe-grid").innerHTML = pickGrid(kind);
    }
  });
}

C.views.profile = {
  placeholder: "Search your library",
  show(p) { load(p[0]); },
  search(q, enter) {
    // Searching from the profile jumps to the library.
    if (!q.trim()) return;
    C.go("library");
    setTimeout(() => { $("#search").value = q; C.views.library.search(q, enter); }, 30);
  },
  refresh() { P.ach = null; return load(C.route.params[0], true); },
  init: bind,
};
})();
