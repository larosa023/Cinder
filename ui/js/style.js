/* Quick style: layered on top of the active theme. Saved in config.style. */
(() => {
"use strict";
const { $, $$ } = C;

const DEFAULTS = {
  accent: "", nav: "top", covers: "portrait", radius: "soft", density: "cozy",
  font: "segoe", bg: "solid", sideCollapsed: false, glow: true, blur: true, motion: true, recent: true, labels: true,
};
const ACCENTS = ["", "#5b8cff", "#3ea6ff", "#66c0f4", "#2dd4bf", "#3ddc97", "#a3e635",
  "#facc15", "#ff7a3d", "#ff5d6c", "#f472b6", "#a78bfa"];
const RADIUS = { sharp: [4, 3, 6], soft: [12, 10, 16], round: [18, 16, 24] };  // radius, card, panel
const DENSITY = { compact: [0.75, 16], cozy: [1, 28], roomy: [1.3, 40] };      // gap scale, page pad
const FONTS = {
  segoe: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  bahnschrift: 'Bahnschrift, "Segoe UI", system-ui, sans-serif',
  cascadia: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};
// Theme variables a saved theme carries.
const THEME_VARS = ["--bg", "--bg-elev", "--surface", "--surface-hover", "--border", "--text",
  "--text-dim", "--accent", "--accent-text", "--danger", "--ok", "--shadow"];

let style = { ...DEFAULTS };
let saveTimer;

function contrastText(hex) {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return "#fff";
  const [r, g, b] = m.map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#0b0d12" : "#ffffff";
}

function apply() {
  const s = style;
  const b = document.body;
  b.classList.toggle("nav-side", s.nav === "side");
  b.classList.toggle("side-collapsed", !!s.sideCollapsed);
  const tg = $("#side-toggle");
  if (tg) {
    tg.title = s.sideCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)";
    tg.querySelector("span").textContent = s.sideCollapsed ? "Expand" : "Collapse";
  }
  b.classList.toggle("covers-wide", s.covers === "wide");
  b.classList.toggle("no-glow", !s.glow);
  b.classList.toggle("no-blur", !s.blur);
  b.classList.toggle("no-motion", !s.motion);
  b.classList.toggle("hide-recent", !s.recent);
  b.classList.toggle("hide-labels", !s.labels);
  ["solid", "glow", "art"].forEach((k) => b.classList.toggle(`bg-${k}`, s.bg === k));
  const [r, cr, pr] = RADIUS[s.radius] || RADIUS.soft;
  const [gap, pad] = DENSITY[s.density] || DENSITY.cozy;
  // Only override what the user changed, so a theme's own corners and font still show by default.
  let css = `:root{--gap:${gap};--pad:${pad}px;`;
  if (s.radius !== DEFAULTS.radius) css += `--radius:${r}px;--card-radius:${cr}px;--panel-radius:${pr}px;`;
  if (s.font !== DEFAULTS.font) css += `--font:${FONTS[s.font] || FONTS.segoe};`;
  css += "}";
  if (s.accent) css += `:root{--accent:${s.accent};--accent-text:${contrastText(s.accent)};}`;
  $("#style-vars").textContent = css;
  refreshArt();
  syncControls();
}

function refreshArt() {
  const recent = C.S.games.filter((g) => g.lastplayed && g.installed).sort((a, b) => b.lastplayed - a.lastplayed)[0];
  document.documentElement.style.setProperty("--bg-art", recent ? `url("/art/${recent.appid}/hero")` : "none");
}

function syncControls() {
  $$("[data-style]").forEach((seg) => {
    $$("button", seg).forEach((btn) => btn.classList.toggle("on", btn.dataset.v === style[seg.dataset.style]));
  });
  $$("[data-style-bool]").forEach((cb) => (cb.checked = !!style[cb.dataset.styleBool]));
  $$("#st-accent [data-accent]").forEach((btn) => btn.classList.toggle("on", btn.dataset.accent === (style.accent || "")));
  const custom = $("#st-accent-custom");
  if (custom && style.accent && !ACCENTS.includes(style.accent)) custom.value = style.accent;
}

function set(key, value) {
  style[key] = value;
  apply();
  if (key === "covers") C.library.render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => C.saveConfig({ style }), 400);
}

function themeCSS(name) {
  const cs = getComputedStyle(document.documentElement);
  const vals = THEME_VARS.map((v) => [v, cs.getPropertyValue(v).trim()]).filter(([, x]) => x);
  const get = (v) => (vals.find(([k]) => k === v) || [])[1] || "";
  const sw = [get("--bg"), get("--surface"), get("--accent")].filter(Boolean).join(" ");
  const [r, cr, pr] = RADIUS[style.radius] || RADIUS.soft;
  return `/*
  @name   ${name.replace(/\*\//g, "")}
  @author ${(C.S.user && C.S.user.name || "me").replace(/\*\//g, "")}
  @swatch ${sw}
*/
:root {
${vals.map(([k, v]) => `  ${k}: ${v};`).join("\n")}
  --radius: ${r}px;
  --card-radius: ${cr}px;
  --panel-radius: ${pr}px;
  --font: ${FONTS[style.font] || FONTS.segoe};
}
`;
}

function toggleSidebar() {
  if (style.nav !== "side") return;
  set("sideCollapsed", !style.sideCollapsed);
}

function bind() {
  $("#side-toggle").addEventListener("click", toggleSidebar);
  $("#st-accent").innerHTML = ACCENTS.map((c) =>
    `<button data-accent="${c}" title="${c || "Theme default"}" style="${c ? `background:${c}` : ""}" class="${c ? "" : "auto"}"></button>`).join("")
    + '<label class="custom" title="Custom color"><input type="color" id="st-accent-custom" value="#5b8cff"></label>';
  $("#st-accent").addEventListener("click", (e) => {
    const b = e.target.closest("[data-accent]");
    if (b) set("accent", b.dataset.accent);
  });
  $("#st-accent-custom").addEventListener("input", (e) => set("accent", e.target.value));
  $$("[data-style]").forEach((seg) => seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (b) set(seg.dataset.style, b.dataset.v);
  }));
  $$("[data-style-bool]").forEach((cb) => cb.addEventListener("change", () => set(cb.dataset.styleBool, cb.checked)));
  $("#style-reset").addEventListener("click", () => {
    style = { ...DEFAULTS };
    apply();
    C.library.render();
    C.saveConfig({ style });
    C.toast("Style reset to the theme's defaults");
  });
  $("#theme-save").addEventListener("click", async () => {
    const name = $("#theme-name").value.trim();
    if (!name) { $("#theme-name").focus(); return C.toast("Give your theme a name first", true); }
    try {
      const r = await C.api("/api/theme", { name, css: themeCSS(name) });
      C.S.themes = r.themes;
      style.accent = "";  // the accent now lives in the theme itself
      C.settings.renderThemes();
      C.settings.setTheme(r.id);
      apply();
      C.saveConfig({ style });
      $("#theme-name").value = "";
      C.toast(`Saved “${name}” to your themes`);
    } catch (e) { C.toast(e.message, true); }
  });
}

C.style = {
  get: () => style,
  load(saved) { style = { ...DEFAULTS, ...(saved || {}) }; apply(); },
  apply, refreshArt, toggleSidebar, init: bind,
};
})();
