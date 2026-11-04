/* Settings → Remote & backup: the phone remote (with a QR code) and Cinder's own backup. */
(() => {
"use strict";
const { $, esc } = C;
const api = () => window.pywebview && window.pywebview.api;
let qrLoaded = null;

function loadQR() {
  if (window.qrcode) return Promise.resolve();
  if (!qrLoaded) qrLoaded = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "/ui/vendor/qrcode.js"; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return qrLoaded;
}

async function paintRemote(r) {
  $("#rm-on").checked = !!r.on;
  $("#rm-box").hidden = !r.on;
  $("#rm-err").hidden = !r.error;
  $("#rm-err").textContent = r.error || "";
  if (!r.on) return;
  $("#rm-url").textContent = r.url;
  $("#rm-pin").textContent = r.pin.replace(/(\d{3})(\d{3})/, "$1 $2");
  $("#rm-devs").textContent = r.devices.length ? `Paired: ${r.devices.map((d) => d.name).join(", ")}` : "No phones paired yet.";
  try {
    await loadQR();
    const q = window.qrcode(0, "M");
    q.addData(r.url);
    q.make();
    $("#rm-qr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch { $("#rm-qr").innerHTML = ""; }
}

async function remote(op) {
  try {
    const r = op ? await C.api("/api/remote", { op }) : await C.api("/api/remote");
    paintRemote(r);
  } catch (e) { C.toast(e.message, true); }
}

function paintSync(d) {
  const has = !!d.folder;
  $("#cb-sync").hidden = $("#cb-unsync").hidden = !has;
  $("#cb-folder").textContent = has ? "Change folder…" : "Choose folder…";
  $("#cb-sync-state").textContent = has
    ? `Copies go to ${d.folder}${d.latest ? ` · last one ${C.fmtDate(d.latest.time)} (${C.fmtSize(d.latest.size)})` : ""}. Keeps the last four.`
    : "Pick a folder in OneDrive, Dropbox or Google Drive and your Cinder setup follows you to other PCs. Keeps the last four.";
}

async function show() {
  remote();
  try { paintSync(await C.api("/api/cinder_backup")); } catch { /* fine */ }
}

async function pickPath(kind) {
  const a = api();
  if (kind === "save") return a && a.save_file ? a.save_file(`Cinder ${new Date().toISOString().slice(0, 10)}.cinderbackup`) : window.prompt("Save the backup to (full path, e.g. C:\\Users\\you\\Documents\\Cinder.cinderbackup):") || "";
  if (kind === "folder") return a && a.pick_folder ? a.pick_folder() : window.prompt("Folder for weekly copies (full path):") || "";
  return a && a.pick_file ? a.pick_file("backup") : window.prompt("Backup file to restore (full path):") || "";
}

function bind() {
  $("#rm-on").addEventListener("change", (e) => remote(e.target.checked ? "on" : "off"));
  $("#rm-newpin").addEventListener("click", () => remote("new_pin"));
  $("#rm-forget").addEventListener("click", async () => { await remote("forget"); C.toast("Paired phones forgotten. They'll need a new code"); });
  $("#cb-export").addEventListener("click", async () => {
    const path = await pickPath("save");
    if (!path) return;
    const r = await C.api("/api/cinder_backup", { op: "export", path });
    if (!r.ok) return C.toast(r.error, true);
    C.toast(`Saved ${C.fmtSize(r.size)} backup`);
  });
  $("#cb-restore").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    const path = await pickPath("open");
    if (!path) return;
    const info = await C.api("/api/cinder_backup", { op: "inspect", path });
    if (!info.ok) return C.toast(info.error, true);
    if (!window.confirm(`Restore the Cinder backup from ${new Date(info.time * 1000).toLocaleString()} (Cinder ${esc(info.version)})?\n\nYour current setup is saved first, then Cinder restarts.`)) return;
    b.disabled = true;
    const r = await C.api("/api/cinder_backup", { op: "restore", path });
    if (!r.ok) { b.disabled = false; return C.toast(r.error, true); }
    C.toast("Restored. Cinder is restarting…");
  });
  $("#cb-folder").addEventListener("click", async () => {
    const folder = await pickPath("folder");
    if (!folder) return;
    const r = await C.api("/api/cinder_backup", { op: "folder", folder });
    if (!r.ok) return C.toast(r.error, true);
    paintSync(r);
    C.toast("Weekly copies on. Made the first one now");
  });
  $("#cb-sync").addEventListener("click", async () => {
    const r = await C.api("/api/cinder_backup", { op: "sync_now" });
    if (!r.ok) return C.toast(r.error, true);
    paintSync(await C.api("/api/cinder_backup"));
    C.toast("Copied");
  });
  $("#cb-unsync").addEventListener("click", async () => { paintSync(await C.api("/api/cinder_backup", { op: "folder", folder: "" })); });
}

C.remoteCfg = { show, init: bind };
})();
