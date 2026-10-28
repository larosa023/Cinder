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


# ----------------------------------------------------------------- websocket

def _recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise BridgeError("Steam closed the connection")
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
            raise BridgeError("Steam closed the connection")
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
                raise BridgeError("Steam refused the connection")
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
        raise BridgeError("Steam didn't answer")
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
        if not self.steam.running():
            return False
        if self._target:
            try:
                if _evaluate(self._target, "typeof SteamClient", 3) == "object":
                    return True
            except (OSError, BridgeError):
                pass
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

    def run(self, js: str) -> object:
        if not self.available():
            raise BridgeError("not connected")
        try:
            return _evaluate(self._target, js)  # type: ignore[arg-type]
        except OSError as e:
            self._target = None
            raise BridgeError(f"Couldn't reach Steam ({e})") from e

    # -- actions -----------------------------------------------------------------
    def update(self, appids: list[int]) -> object:
        """Queue updates and move them to the front, like Steam's Update button."""
        ids = json.dumps([int(a) for a in appids])
        return self.run(f"""(async () => {{
  const D = SteamClient.Downloads, ids = {ids}, done = [];
  if (!D || !D.QueueAppUpdate) return {{ok: false, missing: Object.keys(D || {{}})}};
  try {{ D.EnableAllDownloads && await D.EnableAllDownloads(true); }} catch (e) {{}}
  for (const id of ids.slice().reverse()) {{
    await D.QueueAppUpdate(id);
    try {{ D.SetQueueIndex && await D.SetQueueIndex(id, 0); }} catch (e) {{}}
    try {{ D.ResumeAppUpdate && await D.ResumeAppUpdate(id); }} catch (e) {{}}
    done.push(id);
  }}
  return {{ok: true, done}};
}})()""")

    def pause(self, appid: int, pause: bool) -> object:
        fn = "PauseAppUpdate" if pause else "ResumeAppUpdate"
        return self.run(f"""(async () => {{
  const D = SteamClient.Downloads;
  if (!D || !D.{fn}) return {{ok: false, missing: Object.keys(D || {{}})}};
  if (!{str(pause).lower()}) {{ try {{ D.EnableAllDownloads && await D.EnableAllDownloads(true); }} catch (e) {{}} }}
  await D.{fn}({int(appid)});
  return {{ok: true}};
}})()""")


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
