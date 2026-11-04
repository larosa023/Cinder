"""Phone remote: a small web page your phone opens over your home Wi-Fi.

Off until you turn it on in Settings. It listens on your local network only (Windows asks
once whether to allow that), and a phone has to enter the 6-digit pairing code shown in
Cinder before it can do anything. Paired phones are remembered until you forget them.

What a phone can do: see your library and what's downloading, start/install/update games,
pause or resume downloads. Nothing else is reachable through it.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import socket
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from cinderlog import log

DEFAULT_PORT = 47630
ACTIONS = {"launch", "install"}
DL_CMDS = {"pause_all", "resume_all", "pause", "resume"}


def lan_ip() -> str:
    """This PC's address on your home network."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.168.0.1", 9))  # no packet is sent; this just picks the right network card
            return s.getsockname()[0]
    except OSError:
        return socket.gethostbyname(socket.gethostname())


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


class Remote:
    def __init__(self, ctx, local_port: int):
        self.ctx, self.local_port = ctx, local_port
        self.srv = None
        self.pin = ""
        self.port = 0
        self.error = ""
        self._tries: dict[str, list[float]] = {}
        self._lock = threading.Lock()
        self._opener = urllib.request.build_opener(_NoRedirect)

    # -- on / off ---------------------------------------------------------------
    def apply(self) -> None:
        """Start or stop to match the setting."""
        want = bool(self.ctx.config["remote_enabled"])
        if want and not self.srv:
            self.start()
        elif not want and self.srv:
            self.stop()

    def start(self) -> None:
        port = int(self.ctx.config["remote_port"] or DEFAULT_PORT)
        handler = type("RemoteHandler", (_Handler,), {"remote": self})
        try:
            self.srv = ThreadingHTTPServer(("0.0.0.0", port), handler)
        except OSError as e:
            self.error = f"Port {port} is busy ({e.strerror or e})"
            log.info("phone remote couldn't start: %s", e)
            return
        self.srv.daemon_threads = True
        self.port = port
        self.error = ""
        self.new_pin()
        threading.Thread(target=self.srv.serve_forever, name="remote", daemon=True).start()
        log.info("phone remote on at http://%s:%s", lan_ip(), port)

    def stop(self) -> None:
        srv, self.srv = self.srv, None
        if srv:
            threading.Thread(target=srv.shutdown, daemon=True).start()
        self.pin = ""

    def new_pin(self) -> str:
        self.pin = f"{secrets.randbelow(1_000_000):06d}"
        return self.pin

    def status(self) -> dict:
        return {"on": bool(self.srv), "url": f"http://{lan_ip()}:{self.port}" if self.srv else "", "pin": self.pin if self.srv else "",
                "error": self.error, "devices": [{"name": d.get("name", "Phone"), "added": d.get("added", 0)} for d in self.ctx.config["remote_devices"] or []]}

    # -- pairing ------------------------------------------------------------------
    def pair(self, ip: str, pin: str, name: str) -> str | None:
        now = time.time()
        with self._lock:
            tries = [t for t in self._tries.get(ip, []) if now - t < 300]
            if len(tries) >= 5:
                return None  # five wrong codes in five minutes: wait
            if not self.pin or not secrets.compare_digest(str(pin).strip(), self.pin):
                tries.append(now)
                self._tries[ip] = tries
                return None
            self._tries.pop(ip, None)
        token = secrets.token_urlsafe(32)
        devs = list(self.ctx.config["remote_devices"] or [])
        devs.append({"hash": _hash(token), "name": (name or "Phone")[:40], "added": int(now)})
        self.ctx.config.update({"remote_devices": devs[-10:]})
        self.new_pin()  # each code works once
        log.info("phone remote: paired %s", name or "a phone")
        return token

    def authed(self, token: str) -> bool:
        if not token:
            return False
        h = _hash(token)
        return any(secrets.compare_digest(d.get("hash", ""), h) for d in self.ctx.config["remote_devices"] or [])

    def forget_all(self) -> None:
        self.ctx.config.update({"remote_devices": []})

    # -- talking to Cinder itself -----------------------------------------------------
    def local(self, path: str, body: dict | None = None, timeout: float = 20):
        req = urllib.request.Request(f"http://127.0.0.1:{self.local_port}{path}",
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"X-Cinder-Token": self.ctx.token, "Content-Type": "application/json"},
                                     method="POST" if body is not None else "GET")
        try:
            with self._opener.open(req, timeout=timeout) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()


class _Handler(BaseHTTPRequestHandler):
    server_version = "CinderRemote"
    protocol_version = "HTTP/1.1"
    remote: Remote

    def log_message(self, *a):
        pass

    def _send(self, code, body: bytes, ctype="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if ctype.startswith(("application/json", "text/html")) else "max-age=600")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200, extra=None):
        self._send(code, json.dumps(obj).encode(), "application/json", extra)

    def _token(self) -> str:
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "cinder_remote":
                return v
        return ""

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if not n or n > 4096:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except ValueError:
            return {}

    def do_GET(self):
        try:
            self._get()
        except (ConnectionError, BrokenPipeError):
            pass
        except Exception:
            log.exception("remote GET %s", self.path)
            self._json({"ok": False, "error": "Something went wrong"}, 500)

    def do_POST(self):
        try:
            self._post()
        except (ConnectionError, BrokenPipeError):
            pass
        except Exception:
            log.exception("remote POST %s", self.path)
            self._json({"ok": False, "error": "Something went wrong"}, 500)

    def _get(self):
        r = self.remote
        path = urlsplit(self.path).path
        if path in ("/", "/index.html"):
            html = (r.ctx.ui_dir / "remote.html").read_bytes()
            return self._send(200, html, "text/html; charset=utf-8")
        if path == "/icon.png":
            p = r.ctx.ui_dir.parent / "assets" / "cinder.png"
            return self._send(200, p.read_bytes(), "image/png") if p.is_file() else self._send(404, b"", "text/plain")
        if not r.authed(self._token()):
            return self._json({"ok": False, "error": "pair", "paired": False}, 401)
        if path.startswith("/art/"):
            code, headers, data = r.local(path, timeout=10)
            if code in (301, 302, 303, 307, 308):
                loc = headers.get("Location", "")
                if loc.startswith("/art/"):
                    code, headers, data = r.local(loc, timeout=10)
                else:
                    return self._send(302, b"", "text/plain", {"Location": loc})
            return self._send(code, data, headers.get("Content-Type", "application/octet-stream"))
        routes = {"/r/library": "/api/library?soft=1", "/r/status": "/api/status", "/r/downloads": "/api/downloads"}
        if path in routes:
            code, _, data = r.local(routes[path])
            if path == "/r/library" and code == 200:
                games = json.loads(data).get("games", [])
                keep = ("appid", "name", "installed", "playtime", "lastplayed", "update_pending", "download", "shortcut", "size")
                data = json.dumps({"ok": True, "games": [{k: g.get(k) for k in keep} for g in games]}).encode()
            return self._send(code, data, "application/json")
        return self._json({"ok": False, "error": "not found"}, 404)

    def _post(self):
        r = self.remote
        path = urlsplit(self.path).path
        # A custom header can't be sent cross-site without permission, so other web pages can't drive this.
        if self.headers.get("X-Remote") != "1":
            return self._json({"ok": False, "error": "forbidden"}, 403)
        body = self._body()
        if path == "/pair":
            token = r.pair(self.client_address[0], str(body.get("pin", "")), str(body.get("name", ""))[:40])
            if not token:
                return self._json({"ok": False, "error": "That code didn't work. Check Cinder's Settings → Phone remote for the current one"}, 403)
            return self._json({"ok": True}, extra={"Set-Cookie": f"cinder_remote={token}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Strict"})
        if not r.authed(self._token()):
            return self._json({"ok": False, "error": "pair"}, 401)
        if path == "/r/action":
            a = body.get("action")
            appid = body.get("appid")
            if a in ACTIONS and str(appid).isdigit():
                code, _, data = r.local("/api/action", {"action": a, "appid": int(appid)})
            elif a == "update" and str(appid).isdigit():
                code, _, data = r.local("/api/action", {"action": "game_update", "appids": [int(appid)], "restart": True}, timeout=30)
            elif a == "download" and body.get("cmd") in DL_CMDS:
                req = {"action": "download_cmd", "cmd": body["cmd"], "restart": True}
                if str(appid).isdigit():
                    req["appid"] = int(appid)
                code, _, data = r.local("/api/action", req, timeout=30)
            else:
                return self._json({"ok": False, "error": "Not allowed from the remote"}, 400)
            return self._send(code, data, "application/json")
        return self._json({"ok": False, "error": "not found"}, 404)
