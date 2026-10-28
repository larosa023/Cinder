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

function renderSteam() {
  const s = S.steam;
  const dot = $("#steam-dot");
  dot.classList.toggle("on", !!s.running);
  dot.title = s.running ? "Steam is running" : "Steam is not running";
  $("#steam-info").textContent = !s.found ? "Steam folder not found"
    : `${s.running ? "Running" : "Not running"} · ${s.frozen ? "updates blocked" : "updates allowed"} · ${s.path}`;
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
    go.textContent = c.ready ? "Restart" : `Update to ${c.latest}`;
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
    if (busy || !$("#settings").hidden) U.timer = setTimeout(poll, busy ? 1200 : 4000);
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
  $("#set-freeze").addEventListener("change", (e) => C.saveConfig({ freeze_updates: e.target.checked }));
  $("#set-autostart").addEventListener("change", (e) => C.saveConfig({ autostart_steam: e.target.checked }));
  $("#set-frameless").addEventListener("change", (e) => C.saveConfig({ frameless: e.target.checked }));
  $("#set-start").addEventListener("change", (e) => C.saveConfig({ start_tab: e.target.value }));
  $("#set-region").addEventListener("change", (e) => C.saveConfig({ store_region: e.target.value }).then(() => {
    C.views.store.refresh && (C.route.tab === "store") && C.views.store.refresh();
  }));
  const size = $("#set-size");
  size.addEventListener("input", () => document.documentElement.style.setProperty("--card-w", `${size.value}px`));
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
  $("#banner-x").addEventListener("click", () => dismiss($("#banner").dataset.key));
  $("#banner-go").addEventListener("click", () => {
    if ($("#banner").dataset.kind === "cinder") cinderUpdate();
    else C.openSettings("updates");
  });
}

function renderSteamUpdToggle() {
  const on = !!S.config.show_steam_updates || (U.steam && U.steam.busy);
  $("#steam-upd-row").hidden = !on;
  $("#steam-upd-toggle").textContent = on ? "Hide Steam client update controls" : "Show Steam client update controls";
}

function fill() {
  const c = S.config;
  $("#set-size").value = c.card_size;
  document.documentElement.style.setProperty("--card-w", `${c.card_size}px`);
  $("#set-autostart").checked = !!c.autostart_steam;
  $("#set-frameless").checked = !!c.frameless;
  $("#set-checkupd").checked = !!c.check_updates;
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
