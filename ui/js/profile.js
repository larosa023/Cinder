/* Profile tab: yours, or a friend's (#/profile/<steamid>). */
(() => {
"use strict";
const { $, esc, S, ICON } = C;
const el = () => $("#view-profile");
const P = { cache: {} };

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

function render(p) {
  const onlineClass = p.online === "in-game" ? "ingame" : p.online === "online" ? "online" : "offline";
  const recent = (p.local && p.local.recent) || [];
  const heroApp = (recent[0] && recent[0].appid) || (p.most_played[0] && p.most_played[0].appid);
  const stats = [];
  if (p.level != null) stats.push(stat("Steam level", `<span class="lvl">${p.level}</span>`));
  if (p.game_count != null) stats.push(stat("Games owned", p.game_count.toLocaleString()));
  if (p.local) {
    stats.push(stat("Installed", p.local.installed));
    stats.push(stat("Hours played", Math.round(p.local.minutes / 60).toLocaleString()));
    stats.push(stat("On disk", C.fmtSize(p.local.disk)));
  }

  el().innerHTML = `
    <div class="phero"${heroApp ? ` style="--phero:url('/art/${heroApp}/hero')"` : ""}>
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
          ${p.is_me ? "" : `<button class="btn" data-p-msg="${p.steamid}">${ICON.chat}Message</button>`}
          <button class="btn" data-p-steam="${p.steamid}">${ICON.ext}${p.is_me ? "Edit in Steam" : "View in Steam"}</button>
        </div>
      </div>
    </div>
    ${!p.public ? '<p class="note">This profile is private, so only basic details are visible.</p>' : ""}
    ${stats.length ? `<div class="pstats">${stats.join("")}</div>` : ""}
    ${p.summary ? `<section class="psection"><h2>About</h2><div class="prose">${esc(p.summary).replace(/\n/g, "<br>")}</div></section>` : ""}
    ${recent.length ? `<section class="psection"><h2>Recently played</h2><div class="recent-row">${recent.map((g) => `
      <button class="tile" data-lib="${g.appid}" title="${esc(g.name)}">
        <img loading="lazy" alt="" src="/art/${g.appid}/header" data-fail="hide"><span class="shade"></span>
        <span class="t-meta"><span class="t-name">${esc(g.name)}</span>
        <span class="t-sub">${C.fmtAgo(g.lastplayed)} · ${C.fmtPlay(g.playtime)}</span></span>
      </button>`).join("")}</div></section>` : ""}
    ${p.most_played.length ? `<section class="psection"><h2>Most played recently</h2><div class="plist">${p.most_played.map((g) => `
      <button class="prow" data-app="${g.appid}">
        <img loading="lazy" alt="" src="/art/${g.appid}/header" data-fail="hide">
        <span class="name">${esc(g.name)}</span>
        <span class="sub">${g.hours_recent ? `${esc(g.hours_recent)} hrs last 2 weeks` : ""}${g.hours_total ? ` · ${esc(g.hours_total)} hrs total` : ""}</span>
      </button>`).join("")}</div></section>` : ""}`;
}

function bind() {
  el().addEventListener("click", (e) => {
    const t = e.target;
    const msg = t.closest("[data-p-msg]");
    if (msg) return C.act("message", { steamid: msg.dataset.pMsg });
    const st = t.closest("[data-p-steam]");
    if (st) return C.act("profile_in_steam", { steamid: st.dataset.pSteam });
    const lib = t.closest("[data-lib]");
    if (lib) { C.go("library"); setTimeout(() => C.library.openDetail(+lib.dataset.lib), 50); return; }
    const app = t.closest("[data-app]");
    if (app && +app.dataset.app) return C.go(`store/app/${app.dataset.app}`);
    if (t.closest("[data-retry]")) return load(C.route.params[0], true);
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
  refresh() { return load(C.route.params[0], true); },
  init: bind,
};
})();
