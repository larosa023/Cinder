"""Talks to the Steam client's own interface so Cinder can update games and
pause or resume downloads without opening a Steam window.

Steam's interface is a web page running inside the client. When Steam starts
with remote debugging enabled (a `.cef-enable-remote-debugging` file in the
Steam folder, or the `-cef-enable-debugging` flag) that page can be reached on
127.0.0.1:8080, and Cinder asks it to do what its own Update / Pause buttons do
(SteamClient.Downloads.*). Nothing here touches your account or game files.
"""

from __future__ import annotations

import base64
import json
import os
import socket
import struct
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from cinderlog import log

PORT = 8080
FLAG_FILE = ".cef-enable-remote-debugging"
LAUNCH_FLAG = "-cef-enable-debugging"

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # always local


class BridgeError(Exception):
    pass


class ConnError(BridgeError):
    """Couldn't talk to Steam at all (as opposed to Steam reporting an error)."""


# ----------------------------------------------------------------- websocket

def _recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnError("Steam closed the connection")
        buf += chunk
    return buf


def _send_frame(sock: socket.socket, data: bytes, opcode: int = 1) -> None:
    head = bytes([0x80 | opcode])
    n = len(data)
    if n < 126:
        head += bytes([0x80 | n])
    elif n < 65536:
        head += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        head += bytes([0x80 | 127]) + struct.pack(">Q", n)
    mask = os.urandom(4)
    sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def _recv_message(sock: socket.socket) -> str:
    parts = []
    while True:
        b1, b2 = _recv_exact(sock, 2)
        fin, op = b1 & 0x80, b1 & 0x0F
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack(">H", _recv_exact(sock, 2))[0]
        elif n == 127:
            n = struct.unpack(">Q", _recv_exact(sock, 8))[0]
        mask = _recv_exact(sock, 4) if b2 & 0x80 else b""
        payload = _recv_exact(sock, n) if n else b""
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        if op == 8:
            raise ConnError("Steam closed the connection")
        if op == 9:
            _send_frame(sock, payload, 10)
            continue
        if op in (0, 1, 2):
            parts.append(payload)
            if fin:
                return b"".join(parts).decode("utf-8", "replace")


def _evaluate(ws_url: str, expression: str, timeout: float = 15) -> object:
    u = urlparse(ws_url)
    sock = socket.create_connection((u.hostname or "127.0.0.1", u.port or PORT), timeout=timeout)
    try:
        key = base64.b64encode(os.urandom(16)).decode()
        sock.sendall((f"GET {u.path} HTTP/1.1\r\nHost: 127.0.0.1:{u.port or PORT}\r\n"
                      "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = sock.recv(1024)
            if not chunk:
                raise ConnError("Steam refused the connection")
            head += chunk
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise BridgeError("Steam refused the connection")
        _send_frame(sock, json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": expression, "awaitPromise": True, "returnByValue": True}}).encode())
        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(_recv_message(sock))
            if msg.get("id") != 1:
                continue
            res = msg.get("result", {})
            if "exceptionDetails" in res:
                d = res["exceptionDetails"]
                raise BridgeError((d.get("exception") or {}).get("description") or d.get("text") or "Steam error")
            return (res.get("result") or {}).get("value")
        raise ConnError("Steam didn't answer")
    finally:
        sock.close()


# ------------------------------------------------------------------- bridge

class SteamBridge:
    def __init__(self, steam):
        self.steam = steam
        self._target: str | None = None

    # -- enabling ---------------------------------------------------------------
    @property
    def flag_path(self) -> Path | None:
        return self.steam.path / FLAG_FILE if self.steam.path else None

    def set_enabled(self, on: bool) -> tuple[bool, str]:
        p = self.flag_path
        if not p:
            return False, "Steam folder not found"
        try:
            if on:
                p.touch(exist_ok=True)
            elif p.exists():
                p.unlink()
            return True, ""
        except OSError as e:
            return False, f"Couldn't write to the Steam folder ({e.strerror or e})"

    # -- connection --------------------------------------------------------------
    def _targets(self) -> list[dict]:
        try:
            with _opener.open(f"http://127.0.0.1:{PORT}/json", timeout=2) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except (OSError, ValueError):
            return []

    def _find_target(self) -> str | None:
        targets = [t for t in self._targets() if t.get("webSocketDebuggerUrl")]
        if not targets:
            return None
        # SharedJSContext is Steam's always-loaded background page.
        targets.sort(key=lambda t: (t.get("title") != "SharedJSContext",
                                    "steamloopback.host" not in t.get("url", "")))
        for t in targets[:6]:
            try:
                if _evaluate(t["webSocketDebuggerUrl"], "typeof SteamClient", 4) == "object":
                    return t["webSocketDebuggerUrl"]
            except (OSError, BridgeError):
                continue
        return None

    def available(self) -> bool:
        """True when Steam is running and its interface answers."""
        if not self.steam.running():
            self._target = None
            return False
        if self._target:
            return True
        self._target = self._find_target()
        return bool(self._target)

    def wait_ready(self, timeout: float = 90) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            if self.available():
                time.sleep(3)  # let Steam finish loading the library
                return True
            time.sleep(2)
        return False

    def run(self, js: str, timeout: float = 15) -> object:
        for attempt in range(2):
            if not self.available():
                raise ConnError("not connected")
            try:
                return _evaluate(self._target, js, timeout)  # type: ignore[arg-type]
            except (OSError, ConnError) as e:
                self._target = None  # Steam reloaded its interface: find it again
                if attempt:
                    raise ConnError(f"Couldn't reach Steam ({e})") from e
        raise ConnError("not connected")

    # -- actions -----------------------------------------------------------------
    _INIT = """const D = SteamClient.Downloads;
  let st = window.__cinderDl;
  if (!st) {
    st = window.__cinderDl = {};
    try { D.RegisterForDownloadOverview((o) => { st.overview = o; st.at = Date.now(); }); } catch (e) { st.err = String(e); }
    try { D.RegisterForDownloadItems((active, items) => { st.active = active; st.items = items; st.at = Date.now(); }); } catch (e) { st.err = String(e); }
  }"""

    def update(self, appids: list[int]) -> object:
        """Start updates now, like Steam's own Update button.

        A scheduled ("update delayed") update ignores a plain re-queue, so an update that
        isn't running is taken off the list and queued again as one you asked for.
        Every step is reported back so problems show up in cinder.log.
        """
        ids = json.dumps([int(a) for a in appids])
        return self.run(f"""(async () => {{
  {self._INIT}
  const ids = {ids}, log = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const find = (id) => (st.items || []).find((i) => i.appid === id);
  const step = async (name, ...args) => {{
    if (typeof D[name] !== "function") {{ log.push(name + ": missing"); return false; }}
    try {{ const r = D[name](...args); if (r && r.then) await r; log.push(name + "(" + args.join(",") + ")"); return true; }}
    catch (e) {{ log.push(name + ": " + e); return false; }}
  }};
  if (typeof D.QueueAppUpdate !== "function") return {{ok: false, missing: Object.keys(D || {{}})}};
  const before = ids.map((id) => find(id) || {{appid: id, missing: true}});
  await step("EnableAllDownloads", true);
  for (const id of ids.slice().reverse()) {{
    const it = find(id);
    if (it && !it.active && !it.completed) {{ await step("RemoveFromDownloadList", id); await sleep(500); }}
    await step("QueueAppUpdate", id);
    await sleep(400);
    await step("SetQueueIndex", id, 0);
    await step("ResumeAppUpdate", id);
  }}
  return {{ok: true, log, before, overview: st.overview || null}};
}})()""", 30)

    def item(self, appid: int) -> dict:
        """Steam's live queue entry for one app plus the overview, for diagnostics."""
        r = self.run(f"""(() => {{
  {self._INIT}
  return {{item: (st.items || []).find((i) => i.appid === {int(appid)}) || null, overview: st.overview || null,
          keys: Object.keys(D)}};
}})()""", 5)
        return r if isinstance(r, dict) else {}

    def console(self, command: str) -> dict:
        """Run a Steam console command (what you'd type in steam://open/console) and return its output."""
        r = self.run(f"""(async () => {{
  const C = SteamClient.Console;
  if (!C || typeof C.ExecCommand !== "function") return {{ok: false, missing: Object.keys(SteamClient)}};
  const out = [];
  let h = null;
  try {{ if (typeof C.RegisterForSpewOutput === "function") h = C.RegisterForSpewOutput((...a) => out.push(JSON.stringify(a).slice(0, 300))); }} catch (e) {{ out.push("spew: " + e); }}
  try {{ const r = C.ExecCommand({json.dumps(command)}); if (r && r.then) await r; }} catch (e) {{ out.push("exec: " + e); }}
  await new Promise((r) => setTimeout(r, 1500));
  try {{ h && h.unregister && h.unregister(); }} catch (e) {{}}
  return {{ok: true, out: out.slice(-30)}};
}})()""", 20)
        return r if isinstance(r, dict) else {"ok": False}

    def diagnose(self) -> dict:
        """What this Steam build offers for updates, and how its own UI calls it (for the log)."""
        r = self.run(r"""(async () => {
  const fns = {};
  for (const k of Object.keys(SteamClient)) {
    const o = SteamClient[k];
    if (o && typeof o === "object") {
      const f = Object.keys(o).filter((n) => /updat|queue|download|schedul|install/i.test(n));
      if (f.length) fns[k] = f;
    }
  }
  const urls = [...new Set([...performance.getEntriesByType("resource").map((e) => e.name), ...[...document.scripts].map((s) => s.src)]
    .filter((u) => u && /\.js(\?|$)/.test(u)))].slice(0, 60);
  const snippets = [];
  for (const u of urls) {
    try {
      const t = await (await fetch(u)).text();
      const re = /.{0,140}(Downloads\.QueueAppUpdate|AppUpdate\(|ScheduleAppUpdate|UpdateApp\w*\().{0,140}/g;
      let m;
      while ((m = re.exec(t)) && snippets.length < 30) snippets.push(u.split("/").pop().slice(0, 40) + ": " + m[0]);
    } catch (e) {}
  }
  return {fns, snippets, scripts: urls.length};
})()""", 40)
        return r if isinstance(r, dict) else {}

    # -- learning what Steam's own buttons do -------------------------------------
    _REC = """(() => {
  if (typeof SteamClient !== "object" || !SteamClient.Downloads) return "no";
  if (window.__cinderRec) return "already";
  window.__cinderRec = [];
  const D = SteamClient.Downloads;
  for (const k of Object.keys(D)) {
    if (typeof D[k] !== "function" || k.startsWith("Register")) continue;
    const f = D[k];
    try { D[k] = function (...a) { try { window.__cinderRec.push([Date.now(), k, JSON.stringify(a).slice(0, 200)]); if (window.__cinderRec.length > 60) window.__cinderRec.shift(); } catch (e) {} return f.apply(this, a); }; } catch (e) {}
  }
  return "on";
})()"""

    def record_steam_ui(self) -> list:
        """Note what Steam's own windows call when you press their download buttons."""
        seen = []
        for t in self._targets():
            url = t.get("webSocketDebuggerUrl")
            if not url:
                continue
            try:
                _evaluate(url, self._REC, 3)
                rec = _evaluate(url, "(() => { const r = window.__cinderRec || []; window.__cinderRec = window.__cinderRec ? [] : undefined; return r; })()", 3)
                for row in rec or []:
                    seen.append([t.get("title", "")] + list(row))
            except (OSError, BridgeError):
                continue
        return seen

    def command(self, cmd: str, appids: list[int]) -> object:
        """pause / resume / top / remove for given apps; pause_all / resume_all for the queue."""
        ids = json.dumps([int(a) for a in appids])
        return self.run(f"""(async () => {{
  const D = SteamClient.Downloads, cmd = {json.dumps(cmd)};
  let ids = {ids};
  const need = {{pause: "PauseAppUpdate", resume: "ResumeAppUpdate", top: "SetQueueIndex",
    remove: "RemoveFromDownloadList", pause_all: "PauseAppUpdate", resume_all: "ResumeAppUpdate"}}[cmd];
  if (!D || !D[need]) return {{ok: false, missing: Object.keys(D || {{}})}};
  const st = window.__cinderDl || {{}};
  if (cmd === "pause_all" || cmd === "resume_all")
    ids = (st.items || []).filter((i) => !i.completed).map((i) => i.appid);
  if (cmd.startsWith("resume") || cmd === "top") {{ try {{ D.EnableAllDownloads && await D.EnableAllDownloads(true); }} catch (e) {{}} }}
  for (const id of ids) {{
    if (cmd === "top") {{ await D.SetQueueIndex(id, 0); try {{ await D.ResumeAppUpdate(id); }} catch (e) {{}} }}
    else await D[need](id);
  }}
  return {{ok: true}};
}})()""")

    def snapshot(self) -> dict | None:
        """Steam's live download queue: {overview, items}. Listens once, then reads what Steam pushed."""
        r = self.run(f"""(() => {{
  {self._INIT}
  return {{overview: st.overview || null, items: st.items || null, active: !!st.active, err: st.err || null}};
}})()""", 5)
        return r if isinstance(r, dict) else None


def restart_with_bridge(steam, bridge: SteamBridge, then=None) -> None:
    """Restart Steam in the background with the bridge on, then run `then()`."""
    try:
        bridge.set_enabled(True)
        if steam.running():
            steam.shutdown()
            if not steam.wait_stopped(60):
                log.warning("bridge: Steam didn't close in time")
                return
            time.sleep(2)
        steam.start(silent=True, extra=[LAUNCH_FLAG])
        if bridge.wait_ready(120):
            log.info("bridge: connected to Steam")
            if then:
                then()
        else:
            log.warning("bridge: Steam started but its interface never became reachable")
    except Exception:
        log.exception("bridge restart failed")
