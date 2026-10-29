/* Settings panel: themes, Steam, account, updates. */
(() => {
"use strict";
const { $, $$, esc, S } = C;

const REGIONS = [["US", "United States"], ["CA", "Canada"], ["GB", "United Kingdom"], ["DE", "Europe (Germany)"],
  ["FR", "France"], ["PL", "Poland"], ["AU", "Australia"], ["NZ", "New Zealand"], ["JP", "Japan"], ["KR", "South Korea"],
  ["BR", "Brazil"], ["MX", "Mexico"], ["IN", "India"], ["TR", "Turkey"], ["ZA", "South Africa"]];

C.saveConfig = async (changes) => {
  try {
    const r = await C.api("/api/config", changes);
    S.config = r.config;
    if (r.steam) { S.steam = r.steam; renderSteam(); }
    if (r.message) C.toast(r.message);
    renderAccount();
    return true;
  } catch (e) {
    C.toast(e.message, true);
    renderSteam();
    return false;
  }
};

C.refreshStatus = async () => {
  try {
    const { steam } = await C.api("/api/status");
    S.steam = steam;
    renderSteam();
  } catch { /* server gone */ }
};

function setTheme(id) {
  S.config.theme = id;
  $("#theme-css").href = `/themes/${encodeURIComponent(id)}.css?v=${Date.now()}`;
  $$(".theme").forEach((b) => b.classList.toggle("on", b.dataset.theme === id));
  C.saveConfig({ theme: id });
}

function renderThemes() {
  $("#themes").innerHTML = S.themes.map((t) => `
    <button class="theme" data-theme="${esc(t.id)}" title="${esc(t.author ? "by " + t.author : t.name)}">
      <div class="swatch">${(t.swatch.length ? t.swatch : ["#333", "#666"]).map((c) =>
        `<i style="background:${esc(c)}"></i>`).join("")}</div>
      <span>${esc(t.name)}</span>
    </button>`).join("");
  $$(".theme").forEach((b) => b.classList.toggle("on", b.dataset.theme === S.config.theme));
}

const STATUSES = [
  ["online", "Online"], ["away", "Away"],
  ["invisible", "Invisible", "Friends see you as offline"], ["offline", "Offline", "Signed out of friends and chat"],
];
const SEEN = { online: "online", away: "away", ingame: "in game", offline: "offline" };
// What friends should see for each status. The public profile can't always tell Away from Online.
const EXPECT = { online: ["online", "ingame"], away: ["away"], invisible: ["offline"], offline: ["offline"] };
const P = { seen: null, checkedAt: 0, verifying: null };
const statusLabel = (p) => (STATUSES.find((x) => x[0] === p) || STATUSES[0])[1];

function syncOnDemand() {
  const on = !!S.config.steam_on_demand;
  $("#row-idle").hidden = !on;
  $("#row-autostart").classList.toggle("disabled", on);
  $("#set-autostart").disabled = on;
}

function renderSteam() {
  const s = S.steam;
  if (C.activity) { C.activity.renderPlaying(); C.activity.renderBadge(); }
  const dot = $("#steam-dot");
  const persona = S.config.persona || "online";
  dot.dataset.p = s.running ? persona : "closed";
  dot.title = s.running ? `Steam: ${statusLabel(persona)}` : "Steam is not running";
  const od = s.on_demand;
  let run = s.running ? "Running" : "Not running";
  if (od && od.enabled) {
    run = !s.running ? "Closed, starts when needed"
      : od.busy ? `Running (${od.busy})`
      : od.closes_in ? `Running, closes in ${Math.max(1, Math.round(od.closes_in / 60))} min` : "Running";
  }
  $("#steam-info").textContent = !s.found ? "Steam folder not found"
    : `${run} · ${s.frozen ? "updates blocked" : "updates allowed"} · ${s.path}`;
  dot.title = s.running ? `Steam: ${statusLabel(persona)}` : od && od.enabled ? "Steam is closed until something needs it" : "Steam is not running";
  $("#set-freeze").checked = !!s.frozen;
}

function renderUser() {
  const u = S.user;
  $("#user-name").textContent = u ? u.name : "Not signed in";
  const av = $("#avatar");
  if (u && u.has_avatar) { av.style.backgroundImage = "url(/avatar)"; av.textContent = ""; }
  else { av.style.backgroundImage = ""; av.textContent = u ? u.name[0].toUpperCase() : "?"; }
}

function renderAccount() {
  const set = !!S.config.api_key_set;
  $("#key-state").textContent = set ? "Connected" : "Not set";
  $("#key-state").className = "pill " + (set ? "online" : "");
  $("#key-clear").hidden = !set;
  $("#set-region").value = S.config.store_region || "US";
}

function renderStatusMenu() {
  const persona = S.config.persona || "online";
  const u = S.user;
  $("#sm-name").textContent = u ? u.name : "Not signed in";
  let line = S.steam.running ? statusLabel(persona) : "Steam isn't running (choosing a status starts it)";
  if (P.verifying) line = `Setting ${statusLabel(P.verifying).toLowerCase()}… checking what friends see`;
  else if (P.seen) line += ` · friends see you as ${SEEN[P.seen.state] || P.seen.state}`;
  $("#sm-state").textContent = line;
  const av = $("#sm-avatar");
  if (u && u.has_avatar) { av.style.backgroundImage = "url(/avatar)"; av.textContent = ""; }
  else { av.style.backgroundImage = ""; av.textContent = u ? u.name[0].toUpperCase() : "?"; }
  $("#sm-list").innerHTML = STATUSES.map(([v, label, hint]) => `
    <button data-status="${v}" class="${v === persona ? "on" : ""}">
      <span class="dot" data-p="${v}"></span><span>${label}${hint ? `<br><small>${hint}</small>` : ""}</span>
      <svg class="check" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></button>`).join("");
}

C.toggleStatusMenu = (force) => {
  const m = $("#status-menu");
  const open = force ?? m.hidden;
  if (open) {
    renderStatusMenu();
    if (!P.verifying && Date.now() - P.checkedAt > 20000) checkPresence().then(renderStatusMenu).catch(() => {});
  }
  m.hidden = !open;
};

async function checkPresence() {
  const r = await C.api("/api/presence");
  P.seen = r; P.checkedAt = Date.now();
  return r;
}

const okFor = (status, seen) =>
  EXPECT[status].includes(seen.state) || (status === "away" && seen.source === "profile" && seen.state === "online");

/** Set a status, then confirm from Steam's side what other people actually see. */
async function setStatus(status) {
  await C.api("/api/action", { action: "status", status });
  S.config.persona = status;
  P.verifying = status;
  renderSteam();
  C.toast(`Setting status to ${statusLabel(status)}…`);
  let seen = null;
  for (const wait of [4, 8, 12, 20, 30]) {  // Steam can take up to a minute to update
    await new Promise((r) => setTimeout(r, wait * 1000));
    if (P.verifying !== status) return;  // another status was picked meanwhile
    try { seen = await checkPresence(); } catch (e) { seen = { error: e.message }; break; }
    if (okFor(status, seen)) break;
  }
  P.verifying = null;
  renderStatusMenu();
  if (seen && seen.error) {
    C.toast(`${statusLabel(status)} set, but Cinder couldn't confirm it: ${seen.error}. Adding an API key in Settings → Account fixes this.`, true);
  } else if (seen && okFor(status, seen)) {
    const note = status === "away" && seen.source === "profile" ? " (your public profile shows Away as Online)" : "";
    C.toast(`${statusLabel(status)} ✓ friends see you as ${SEEN[seen.state] || seen.state}${note}`);
  } else {
    C.toast(`Steam still shows you as ${SEEN[seen?.state] || "online"} to friends. Try again, or set it in Steam's friends list.`, true);
  }
}

function showPane(name) {
  $$("#set-nav [data-pane]").forEach((b) => b.classList.toggle("on", b.dataset.pane === name));
  $$(".pane").forEach((p) => (p.hidden = p.dataset.pane !== name));
}

C.openSettings = (pane) => {
  $("#settings").hidden = false;
  if (pane) showPane(pane);
  C.refreshStatus();
  C.updates.poll();
};

// ---------- updates ----------
const U = { cinder: null, steam: null, timer: null };
const dismissed = (k) => { try { return localStorage.getItem("cinder.dismiss") === k; } catch { return false; } };
const dismiss = (k) => { try { localStorage.setItem("cinder.dismiss", k); } catch {} $("#banner").hidden = true; };

function renderUpdates() {
  const c = U.cinder, st = U.steam;
  if (c) {
    $("#u-cur").textContent = `v${c.current}`;
    let txt;
    if (c.busy) txt = c.phase + (c.progress != null ? ` · ${Math.round(c.progress * 100)}%` : "…");
    else if (c.ready) txt = "Update installed. Restart to finish.";
    else if (c.error) txt = c.error;
    else if (c.migrate && c.available) txt = "A faster installed version is available (starts instantly)";
    else if (c.available) txt = `Version ${c.latest} is available`;
    else if (c.checked_at) txt = `You're up to date${c.latest ? ` (latest is ${c.latest})` : ""}`;
    else txt = "Not checked yet";
    $("#u-cinder").textContent = txt;
    const bar = $("#u-bar");
    bar.hidden = !c.busy;
    bar.classList.toggle("indeterminate", c.busy && c.progress == null);
    $("#u-bar i").style.width = c.progress != null ? `${c.progress * 100}%` : "";
    const go = $("#u-go");
    go.hidden = !(c.available || c.ready);
    go.disabled = c.busy;
    go.textContent = c.ready ? "Restart" : c.migrate ? "Install" : `Update to ${c.latest}`;
    $("#u-check").disabled = c.busy;
  }
  if (st) {
    let txt;
    if (st.busy) txt = st.phase || "Working…";
    else {
      const parts = [`Installed build ${st.installed || "unknown"}`];
      if (st.latest) parts.push(st.available ? `newer build ${st.latest} available` : "this is the latest build");
      if (st.error) parts.push(st.error);
      else if (st.phase) parts.push(st.phase);
      txt = parts.join(" · ");
    }
    $("#u-steam").textContent = txt;
    $("#s-go").disabled = st.busy || !S.steam.found;
    $("#s-check").disabled = st.busy;
  }
  const banner = $("#banner");
  const inst = S.install || {};
  if (inst.migrated_from) {
    Object.assign(banner.dataset, { key: "migrated", kind: "migrated" });
    banner.hidden = false;
    $("#banner-text").textContent = "Cinder is now installed and starts instantly. Use the new Cinder shortcut on your Desktop or Start menu. Delete the old Cinder.exe?";
    $("#banner-go").textContent = "Delete old copy";
    $("#banner-go").hidden = false;
    return;
  }
  if (c && c.migrate && (c.available || c.busy || c.ready)) {
    Object.assign(banner.dataset, { key: "migrate", kind: "cinder" });
    banner.hidden = !c.busy && !c.ready && dismissed("migrate");
    $("#banner-text").textContent = c.busy ? `Installing faster Cinder: ${c.phase.toLowerCase()}…`
      : c.ready ? "Faster Cinder is installed. Restart to switch over."
      : "Cinder can now start instantly. Install it properly (adds Start menu and Desktop shortcuts)?";
    $("#banner-go").textContent = c.ready ? "Restart" : "Install";
    $("#banner-go").hidden = c.busy;
    return;
  }
  if (c && (c.ready || c.available || c.busy)) {
    const key = `cinder:${c.latest}`;
    banner.hidden = !c.busy && !c.ready && dismissed(key);
    Object.assign(banner.dataset, { key, kind: "cinder" });
    $("#banner-text").textContent = c.busy ? `Updating Cinder: ${c.phase.toLowerCase()}…`
      : c.ready ? `Cinder ${c.latest} is installed. Restart to start using it.`
      : `Cinder ${c.latest} is available (you have ${c.current}).`;
    $("#banner-go").textContent = c.ready ? "Restart" : "Update";
    $("#banner-go").hidden = c.busy;
  } else if (st && S.config.show_steam_updates && (st.busy || st.available)) {
    const key = `steam:${st.latest}`;
    banner.hidden = !st.busy && dismissed(key);
    Object.assign(banner.dataset, { key, kind: "steam" });
    $("#banner-text").textContent = st.busy ? `Steam update: ${st.phase}`
      : `A newer Steam build (${st.latest}) is out. Yours is locked at ${st.installed}.`;
    $("#banner-go").textContent = "Details";
    $("#banner-go").hidden = st.busy;
  } else {
    banner.hidden = true;
  }
}

async function poll() {
  try {
    const r = await C.api("/api/updates");
    const steamWasBusy = U.steam && U.steam.busy;
    U.cinder = r.cinder; U.steam = r.steam;
    renderUpdates();
    if (steamWasBusy && !r.steam.busy) {
      C.toast(r.steam.error ? r.steam.error : "Steam update finished - updates are blocked again", !!r.steam.error);
      C.refreshStatus();
    }
    const busy = r.cinder.busy || r.steam.busy;
    clearTimeout(U.timer);
    if (busy || (!$("#settings").hidden && !document.hidden)) U.timer = setTimeout(poll, busy ? 1200 : 4000);
  } catch { /* offline */ }
}

async function cinderUpdate() {
  if (U.cinder && U.cinder.ready) {
    C.toast("Restarting Cinder…");
    await C.act("cinder_restart");
    return;
  }
  if (await C.act("cinder_update")) poll();
}

async function steamUpdate() {
  const ok = window.confirm(
    "Update Steam now?\n\nCinder will close Steam, let it download its update, then block updates again.\n\n" +
    "Heads up: a new Steam build can break Steamidra until you re-apply it or Steamidra releases a fix.");
  if (ok && (await C.act("steam_update"))) { C.toast("Updating Steam…"); poll(); }
}

function bind() {
  $("#set-region").innerHTML = REGIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  $("#set-nav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pane]");
    if (b) showPane(b.dataset.pane);
  });
  $("#themes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme]");
    if (b) setTheme(b.dataset.theme);
  });
  $("#open-themes").addEventListener("click", () => C.act("themes_folder"));
  $("#set-bridge").addEventListener("change", (e) => C.saveConfig({ steam_bridge: e.target.checked }));
  $("#set-quiet").addEventListener("change", (e) => C.saveConfig({ hide_steam_on_launch: e.target.checked }));
  $("#status-menu").addEventListener("click", async (e) => {
    const st = e.target.closest("[data-status]");
    if (st) {
      C.toggleStatusMenu(false);
      try { await setStatus(st.dataset.status); } catch (err) { P.verifying = null; C.toast(err.message, true); }
      return;
    }
    const a = e.target.closest("[data-sm]");
    if (!a) return;
    C.toggleStatusMenu(false);
    if (a.dataset.sm === "profile") C.go("profile");
    else C.act("steam_friends");
  });
  document.addEventListener("mousedown", (e) => {
    if (!$("#status-menu").hidden && !e.target.closest("#status-menu, #btn-user")) C.toggleStatusMenu(false);
  });
  $("#set-freeze").addEventListener("change", (e) => C.saveConfig({ freeze_updates: e.target.checked }));
  $("#set-autostart").addEventListener("change", (e) => C.saveConfig({ autostart_steam: e.target.checked }));
  $("#set-ondemand").addEventListener("change", (e) => {
    S.config.steam_on_demand = e.target.checked;
    syncOnDemand();
    C.saveConfig({ steam_on_demand: e.target.checked });
    if (e.target.checked) C.toast(`Steam will close after ${S.config.steam_idle_minutes || 5} min with nothing to do`);
  });
  $("#set-idle").addEventListener("change", (e) => { S.config.steam_idle_minutes = +e.target.value; C.saveConfig({ steam_idle_minutes: +e.target.value }); });
  $("#set-frameless").addEventListener("change", (e) => C.saveConfig({ frameless: e.target.checked }));
  $("#set-start").addEventListener("change", (e) => C.saveConfig({ start_tab: e.target.value }));
  $("#set-region").addEventListener("change", (e) => C.saveConfig({ store_region: e.target.value }).then(() => {
    C.views.store.refresh && (C.route.tab === "store") && C.views.store.refresh();
  }));
  const size = $("#set-size");
  size.addEventListener("input", () => {
    document.documentElement.style.setProperty("--card-w", `${size.value}px`);
    if ($("#lib-zoom")) $("#lib-zoom").value = size.value;
  });
  size.addEventListener("change", () => C.saveConfig({ card_size: +size.value }));
  $$("[data-act]").forEach((b) => b.addEventListener("click", async () => {
    if (await C.act(b.dataset.act)) { C.toast("Done"); setTimeout(C.refreshStatus, 2500); }
  }));

  $("#key-save").addEventListener("click", async () => {
    const key = $("#set-key").value.trim();
    if (!/^[0-9A-Fa-f]{32}$/.test(key)) return C.toast("That doesn't look like a Steam Web API key (32 letters and numbers)", true);
    if (await C.saveConfig({ api_key: key })) {
      $("#set-key").value = "";
      C.toast("API key saved");
      C.library.load(true);
    }
  });
  $("#key-clear").addEventListener("click", async () => {
    if (await C.saveConfig({ api_key: "" })) { C.toast("API key removed"); C.library.load(true); }
  });
  $("#key-get").addEventListener("click", () => C.act("open_web", { url: "https://steamcommunity.com/dev/apikey" }));

  $("#u-check").addEventListener("click", async () => {
    $("#u-cinder").textContent = "Checking…";
    try { U.cinder = (await C.api("/api/action", { action: "cinder_check" })).cinder; } catch (e) { C.toast(e.message, true); }
    renderUpdates();
  });
  $("#u-go").addEventListener("click", cinderUpdate);
  $("#s-check").addEventListener("click", async () => {
    $("#u-steam").textContent = "Checking…";
    try { U.steam = (await C.api("/api/action", { action: "steam_check" })).steam; } catch (e) { C.toast(e.message, true); }
    renderUpdates();
  });
  $("#s-go").addEventListener("click", steamUpdate);
  $("#steam-upd-toggle").addEventListener("click", async () => {
    await C.saveConfig({ show_steam_updates: !S.config.show_steam_updates });
    renderSteamUpdToggle();
    renderUpdates();
  });
  $("#set-checkupd").addEventListener("change", (e) => C.saveConfig({ check_updates: e.target.checked }));
  $("#banner-x").addEventListener("click", () => {
    if ($("#banner").dataset.kind === "migrated") { S.install.migrated_from = ""; $("#banner").hidden = true; return; }
    dismiss($("#banner").dataset.key);
  });
  $("#banner-go").addEventListener("click", async () => {
    const kind = $("#banner").dataset.kind;
    if (kind === "migrated") {
      if (await C.act("delete_old_exe")) { C.toast("Old Cinder.exe deleted"); S.install.migrated_from = ""; $("#banner").hidden = true; }
      return;
    }
    if (kind === "cinder") cinderUpdate();
    else C.openSettings("updates");
  });
  $("#set-startup").addEventListener("change", async (e) => {
    if (!(await C.saveConfig({ start_with_windows: e.target.checked }))) e.target.checked = !e.target.checked;
  });
  $("#set-tray").addEventListener("change", (e) => C.saveConfig({ close_to_tray: e.target.checked }));
  $("#set-playing").addEventListener("change", (e) => C.saveConfig({ when_playing: e.target.value }));
  $("#set-restore").addEventListener("change", (e) => C.saveConfig({ restore_after_play: e.target.checked }));
  $("#set-sales").addEventListener("change", (e) => C.saveConfig({ sale_alerts: e.target.checked }));
}

function renderSteamUpdToggle() {
  const on = !!S.config.show_steam_updates || (U.steam && U.steam.busy);
  $("#steam-upd-row").hidden = !on;
  $("#steam-upd-toggle").textContent = on ? "Hide Steam client update controls" : "Show Steam client update controls";
}

function fill() {
  const c = S.config;
  $("#set-size").value = c.card_size;
  if ($("#lib-zoom")) $("#lib-zoom").value = c.card_size;
  document.documentElement.style.setProperty("--card-w", `${c.card_size}px`);
  $("#set-autostart").checked = !!c.autostart_steam;
  $("#set-ondemand").checked = !!c.steam_on_demand;
  $("#set-idle").value = String(c.steam_idle_minutes || 5);
  syncOnDemand();
  $("#set-frameless").checked = !!c.frameless;
  $("#set-checkupd").checked = !!c.check_updates;
  $("#set-quiet").checked = c.hide_steam_on_launch !== false;
  $("#set-bridge").checked = c.steam_bridge !== false;
  $("#set-tray").checked = c.close_to_tray !== false;
  $("#set-playing").value = c.when_playing || "minimize";
  $("#set-restore").checked = c.restore_after_play !== false;
  $("#set-sales").checked = c.sale_alerts !== false;
  const inst = S.install || {};
  $("#set-startup").checked = !!inst.startup;
  $("#set-startup").disabled = !inst.frozen;
  if (!inst.frozen) $("#startup-note").textContent = "Available in the installed Cinder.";
  $("#set-start").value = c.start_tab || "library";
  $("#sort").value = c.sort;
  $("#theme-css").href = `/themes/${encodeURIComponent(c.theme)}.css`;
  renderThemes();
  renderUser();
  renderSteam();
  renderAccount();
  renderSteamUpdToggle();
}

C.updates = { poll };
C.settings = { init: bind, fill, renderThemes, setTheme, renderSteam, renderUser };
})();
