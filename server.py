"""Tiny local HTTP server that feeds the Cinder UI. Binds to 127.0.0.1 only."""

from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from steamlib import ART, IS_WIN
from version import VERSION
THEME_META = re.compile(r"@(\w+)\s+([^\n*]+)")


def list_themes(dirs: list[Path]) -> list[dict]:
    themes: dict[str, dict] = {}
    for d in dirs:
        for f in sorted(d.glob("*.css")):
            head = f.read_text(encoding="utf-8", errors="replace")[:600]
            meta = {k: v.strip() for k, v in THEME_META.findall(head)}
            themes[f.stem] = {
                "id": f.stem,
                "name": meta.get("name", f.stem.title()),
                "author": meta.get("author", ""),
                "swatch": meta.get("swatch", "").split(),
            }
    return list(themes.values())


class Context:
    def __init__(self, *, token, steam, config, ui_dir, theme_dirs, data_dir,
                 updater, steam_updater, restart, window_api=None):
        self.token = token
        self.updater = updater
        self.steam_updater = steam_updater
        self.restart = restart
        self.steam = steam
        self.config = config
        self.ui_dir = ui_dir
        self.theme_dirs = theme_dirs  # later dirs override earlier
        self.data_dir = data_dir
        self.window_api = window_api


class Handler(BaseHTTPRequestHandler):
    server_version = "Cinder"
    ctx: Context  # set by make_server

    def log_message(self, *args):
        pass

    # -- helpers --------------------------------------------------------------
    def _send(self, code: int, body: bytes, ctype: str, cache: str = "no-store", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode(), "application/json")

    def _file(self, path: Path, cache="max-age=86400"):
        try:
            data = path.read_bytes()
        except OSError:
            return self._send(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self._send(200, data, ctype, cache)

    def _safe(self, root: Path, rel: str) -> Path | None:
        p = (root / rel).resolve()
        return p if p.is_file() and root.resolve() in p.parents else None

    def _authed(self) -> bool:
        return self.headers.get("X-Cinder-Token") == self.ctx.token

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if not n or n > 1 << 20:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except ValueError:
            return {}

    # -- GET ------------------------------------------------------------------
    def do_GET(self):
        path = urlsplit(self.path).path
        c = self.ctx
        if path in ("/", "/index.html"):
            html = (c.ui_dir / "index.html").read_text(encoding="utf-8")
            html = html.replace("{{TOKEN}}", c.token).replace("{{VERSION}}", VERSION)
            return self._send(200, html.encode(), "text/html; charset=utf-8")
        if path.startswith("/ui/"):
            p = self._safe(c.ui_dir, path[4:])
            return self._file(p, "no-cache") if p else self._send(404, b"", "text/plain")
        if path.startswith("/themes/") and path.endswith(".css"):
            name = path[8:]
            for d in reversed(c.theme_dirs):
                p = self._safe(d, name)
                if p:
                    return self._file(p, "no-cache")
            return self._send(404, b"", "text/css")
        m = re.fullmatch(r"/art/(\d+)/(\w+)", path)
        if m and m.group(2) in ART:
            kind, val = c.steam.art(int(m.group(1)), m.group(2))
            if kind == "file":
                return self._file(Path(val))
            return self._send(302, b"", "text/plain", "max-age=3600", {"Location": val})
        if path == "/avatar":
            p = c.steam.avatar_path()
            return self._file(p) if p else self._send(404, b"", "text/plain")

        if not path.startswith("/api/"):
            return self._send(404, b"not found", "text/plain")
        if not self._authed():
            return self._json({"ok": False, "error": "forbidden"}, 403)
        if path == "/api/state":
            return self._json(self._state())
        if path == "/api/status":
            return self._json({"ok": True, "steam": self._steam_status()})
        if path == "/api/updates":
            return self._json({"ok": True, "cinder": c.updater.snapshot(), "steam": c.steam_updater.snapshot()})
        if path == "/api/library":
            return self._json({"ok": True, "games": c.steam.library()})
        return self._json({"ok": False, "error": "unknown endpoint"}, 404)

    do_HEAD = do_GET

    def _steam_status(self) -> dict:
        s = self.ctx.steam
        return {
            "found": s.found,
            "path": str(s.path) if s.path else "",
            "running": s.running(),
            "frozen": s.freeze_enabled(),
        }

    def _state(self) -> dict:
        c = self.ctx
        return {
            "ok": True,
            "version": VERSION,
            "config": c.config.data,
            "themes": list_themes(c.theme_dirs),
            "user": c.steam.user(),
            "steam": self._steam_status(),
            "native": c.window_api is not None,
        }

    # -- POST -----------------------------------------------------------------
    def do_POST(self):
        path = urlsplit(self.path).path
        if not self._authed():
            return self._json({"ok": False, "error": "forbidden"}, 403)
        body = self._body()
        try:
            if path == "/api/config":
                return self._config(body)
            if path == "/api/action":
                return self._action(body)
        except Exception as e:  # keep the UI alive on unexpected errors
            return self._json({"ok": False, "error": str(e)}, 500)
        return self._json({"ok": False, "error": "unknown endpoint"}, 404)

    def _config(self, body: dict):
        c = self.ctx
        msg = None
        if "freeze_updates" in body:
            ok, msg = c.steam.set_freeze(bool(body["freeze_updates"]))
            if not ok:
                return self._json({"ok": False, "error": msg})
        data = c.config.update(body)
        return self._json({"ok": True, "config": data, "message": msg, "steam": self._steam_status()})

    def _action(self, body: dict):
        c, s = self.ctx, self.ctx.steam
        action = body.get("action")
        appid = body.get("appid")
        if appid is not None:
            if not str(appid).isdigit():
                return self._json({"ok": False, "error": "bad appid"}, 400)
            appid = int(appid)

        if action == "launch" and appid:
            s.launch(appid)
        elif action == "install" and appid:
            s.steam_url(f"steam://install/{appid}")
        elif action == "uninstall" and appid:
            s.steam_url(f"steam://uninstall/{appid}")
        elif action == "store" and appid:
            s.steam_url(f"steam://store/{appid}")
        elif action == "properties" and appid:
            s.steam_url(f"steam://gameproperties/{appid}")
        elif action == "folder" and appid:
            game = next((g for g in s.library() if g["appid"] == appid), None)
            if not game or not Path(game["installdir"]).is_dir():
                return self._json({"ok": False, "error": "Install folder not found"})
            _open_path(game["installdir"])
        elif action == "steam_start":
            if not s.start(silent=bool(body.get("silent", True))):
                return self._json({"ok": False, "error": "steam.exe not found"})
        elif action == "steam_open":
            if s.running():
                s.open_url("steam://open/main")
            else:
                s.start(silent=False)
        elif action == "steam_friends":
            s.steam_url("steam://open/friends")
        elif action == "steam_exit":
            s.shutdown()
        elif action == "cinder_check":
            return self._json({"ok": True, "cinder": c.updater.check()})
        elif action == "cinder_update":
            if not c.updater.apply_async():
                return self._json({"ok": False, "error": "No update to install"})
        elif action == "cinder_restart":
            c.restart()
        elif action == "steam_check":
            return self._json({"ok": True, "steam": c.steam_updater.check()})
        elif action == "steam_update":
            if not c.steam_updater.update_async():
                return self._json({"ok": False, "error": "A Steam update is already running"})
        elif action == "themes_folder":
            _open_path(str(c.data_dir / "themes"))
        else:
            return self._json({"ok": False, "error": "unknown action"}, 400)
        return self._json({"ok": True})


def _open_path(p: str):
    if IS_WIN:
        os.startfile(p)  # type: ignore[attr-defined]
    else:
        import subprocess
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", p])


def make_server(ctx: Context, port: int = 0) -> ThreadingHTTPServer:
    handler = type("CinderHandler", (Handler,), {"ctx": ctx})
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    srv.daemon_threads = True
    return srv
