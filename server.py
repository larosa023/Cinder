"""Tiny local HTTP server that feeds the Cinder UI. Binds to 127.0.0.1 only."""

from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import threading

import install
import storeapi
from cinderlog import log
from steamlib import ART, IS_WIN
from version import VERSION
ALLOWED_WEB = {"https://steamcommunity.com/dev/apikey", "https://github.com/larosa023/Cinder"}
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
        self.ach = None  # achievements.AchievementIndex, set by main
        self.idle = None  # steamidle.SteamIdle, set by main
        import gamedata
        self.meta = gamedata.GameMeta(data_dir)
        self.sessions = gamedata.Sessions(data_dir)
        self.launchopts = gamedata.LaunchOptions(data_dir)
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
    protocol_version = "HTTP/1.1"  # keep-alive: images and API calls reuse connections
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
    def _host_ok(self) -> bool:
        """Only answer requests addressed to this PC (blocks DNS-rebinding pages from reading the token)."""
        host = (self.headers.get("Host") or "").lower()
        port = self.server.server_address[1]
        return host in (f"127.0.0.1:{port}", f"localhost:{port}")

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, b"forbidden", "text/plain")
        try:
            return self._get()
        except (ConnectionError, BrokenPipeError):
            pass
        except Exception as e:
            log.exception("GET %s failed", self.path)
            try:
                return self._json({"ok": False, "error": f"Something went wrong ({type(e).__name__})"}, 500)
            except OSError:
                pass

    def _get(self):
        parts = urlsplit(self.path)
        path = parts.path
        query = {k: v[0] for k, v in parse_qs(parts.query).items()}
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
            found = c.steam.art(int(m.group(1)), m.group(2))
            if not found:
                return self._send(404, b"", "text/plain", "max-age=3600")
            kind, val = found
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
        if path == "/api/collections":
            return self._json({"ok": True, "steam": c.steam.collections()})
        if path == "/api/achievements/summary":
            if not c.ach:
                return self._json({"ok": True, "games": {}, "scanning": False})
            c.ach.scan()
            return self._json({"ok": True, "games": c.ach.summary(), "scanning": c.ach.scanning})
        if path == "/api/achievements":
            if c.ach:
                c.ach.scan()  # refreshes anything stale, in the background
                return self._json({"ok": True, **c.ach.hub()})
            return self._json({"ok": False, "error": "Not available"})
        if path == "/api/meta":
            return self._json({"ok": True, "games": c.meta.all()})
        if path == "/api/stats":
            playing = getattr(c, "playing", lambda: None)()
            return self._json({"ok": True, **c.sessions.stats(c.steam.library(), playing)})
        if path == "/api/storage":
            return self._json({"ok": True, **self._storage()})
        m = re.fullmatch(r"/api/game/(\d+)/launch_options", path)
        if m:
            appid = int(m.group(1))
            pend = c.launchopts.pending().get(str(appid))
            cur = (c.steam._localconfig_apps().get(str(appid)) or {})
            cur = cur.get("launchoptions", "") if isinstance(cur, dict) else ""
            return self._json({"ok": True, "options": pend if pend is not None else cur, "pending": pend is not None,
                               "live": self._bridge_state() == "on"})
        if path == "/api/downloads":
            if query.get("first") and self.ctx.steam.bridge and self._bridge_state() == "on":
                try:  # what Steam's own download buttons called since last time (helps support new Steam builds)
                    for row in self.ctx.steam.bridge.record_steam_ui():
                        log.info("steam ui: %s", json.dumps(row)[:400])
                except Exception:
                    log.exception("recording Steam's download calls failed")
            return self._json(self._downloads())
        if path == "/api/library":
            if not query.get("soft"):
                c.steam.invalidate_library()  # an explicit reload always reads Steam's files fresh
            return self._json({"ok": True, "games": self._library()})
        try:
            return self._steam_data(path, query)
        except storeapi.SteamDataError as e:
            return self._json({"ok": False, "error": str(e)}, 502)
        return self._json({"ok": False, "error": "unknown endpoint"}, 404)

    do_HEAD = do_GET

    # -- Steam data tabs --------------------------------------------------------
    def _me(self) -> str:
        u = self.ctx.steam.user()
        return u["steamid"] if u else ""

    def _library(self) -> list[dict]:
        c = self.ctx
        games = c.steam.library()
        key, me = c.config["api_key"], self._me()
        if key and me:
            try:
                local = {g["appid"]: g for g in games}
                for o in storeapi.owned_games(key, me):
                    g = local.get(o["appid"])
                    if g:
                        g["owned"] = True
                        g["playtime"] = max(g["playtime"], o["playtime"])
                        g["lastplayed"] = max(g["lastplayed"], o["lastplayed"])
                    else:
                        games.append({**o, "installed": False, "owned": True, "update_pending": False,
                                      "size": 0, "lastupdated": 0, "installdir": "", "library": ""})
            except storeapi.SteamDataError:
                pass  # keep the local library
        c.steam.prefetch_art([g["appid"] for g in games])
        return games

    # -- launch options ----------------------------------------------------------
    def _launch_options(self, appid: int, options: str):
        """Live through Steam when connected; straight into Steam's file when it's closed; else on close."""
        import steambridge
        c, s = self.ctx, self.ctx.steam
        options = options.replace("\r", " ").replace("\n", " ").strip()
        if s.running() and self._bridge_state() == "on":
            try:
                r = s.bridge.run(f"""(async () => {{
  const A = SteamClient.Apps;
  if (typeof A.SetAppLaunchOptions !== "function") return {{ok: false}};
  const r = A.SetAppLaunchOptions({int(appid)}, {json.dumps(options)}); if (r && r.then) await r;
  return {{ok: true}};
}})()""")
                if isinstance(r, dict) and r.get("ok"):
                    log.info("launch options for %s set through Steam", appid)
                    return self._json({"ok": True, "state": "live"})
            except steambridge.BridgeError as e:
                log.info("launch options via Steam failed: %s", e)
        c.launchopts.queue(appid, options)
        if not s.running():
            p = s._localconfig_path() if hasattr(s, "_localconfig_path") else None
            if p and c.launchopts.apply_to_file(p):
                s.invalidate_library()
                return self._json({"ok": True, "state": "saved"})
        return self._json({"ok": True, "state": "pending"})

    # -- storage -----------------------------------------------------------------
    def _storage(self) -> dict:
        import shutil
        from steamlib import read_vdf
        s = self.ctx.steam
        keys = {}
        data = read_vdf(s.path / "steamapps" / "libraryfolders.vdf") if s.path else {}
        for k, v in (data.get("libraryfolders") or {}).items():
            p = v.get("path") if isinstance(v, dict) else v
            if k.isdigit() and p:
                keys[os.path.normcase(os.path.abspath(p))] = int(k)
        games = [g for g in s.library() if g.get("installed") and not g.get("shortcut")]
        drives = []
        for lib in s.library_dirs():
            norm = os.path.normcase(os.path.abspath(str(lib)))
            try:
                du = shutil.disk_usage(str(lib))
                total, free = du.total, du.free
            except OSError:
                total = free = 0
            mine = [g for g in games if os.path.normcase(os.path.abspath(g["library"])) == norm]
            drives.append({"path": str(lib), "index": keys.get(norm, 0 if lib == s.path else -1),
                           "label": (str(lib)[:2].upper() if len(str(lib)) > 1 and str(lib)[1] == ":" else (Path(lib).name or str(lib))),
                           "total": total, "free": free, "games_size": sum(g["size"] for g in mine),
                           "count": len(mine)})
        return {"drives": drives, "bridge": self._bridge_state(),
                "games": [{"appid": g["appid"], "name": g["name"], "size": g["size"], "lastplayed": g["lastplayed"],
                           "playtime": g["playtime"], "library": g["library"], "update_pending": g["update_pending"]}
                          for g in games]}

    def _move_game(self, appid: int, folder: str):
        import steambridge
        s = self.ctx.steam
        if not folder.lstrip("-").isdigit() or int(folder) < 0:
            return self._json({"ok": False, "error": "Pick a drive"}, 400)
        if self._bridge_state() != "on":
            s.steam_url(f"steam://gameproperties/{appid}")
            return self._json({"ok": True, "state": "steam"})
        try:
            r = s.bridge.run(f"""(async () => {{
  const F = SteamClient.InstallFolder;
  if (!F || typeof F.MoveInstallFolderForApp !== "function") return {{ok: false}};
  const r = F.MoveInstallFolderForApp({int(appid)}, {int(folder)}); if (r && r.then) await r;
  return {{ok: true}};
}})()""")
        except steambridge.BridgeError as e:
            return self._json({"ok": False, "error": f"Steam didn't take the request ({e})"})
        log.info("move %s to folder %s: %s", appid, folder, r)
        if not (isinstance(r, dict) and r.get("ok")):
            s.steam_url(f"steam://gameproperties/{appid}")
            return self._json({"ok": True, "state": "steam"})
        s.invalidate_library()
        return self._json({"ok": True, "state": "moving"})

    # -- workshop ----------------------------------------------------------------
    _ws_support: dict | None = None
    _ws_lock = threading.Lock()

    def _workshop_support(self, appid: int, cc: str) -> dict:
        """Does this game have a Steam Workshop? Your files first, then its store page (remembered)."""
        import workshop
        cls = type(self)
        path = self.ctx.data_dir / "workshop_support.json"
        if cls._ws_support is None:
            try:
                cls._ws_support = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                cls._ws_support = {}
        local = workshop.installed(self.ctx.steam).get(appid)
        count = len(local["items"]) if local else 0
        key = str(appid)
        if local:
            supported = True
        elif key in cls._ws_support:
            supported = bool(cls._ws_support[key])
        elif appid >= 0x80000000:
            supported = False
        else:
            try:
                supported = bool(storeapi.app_details(appid, cc).get("workshop"))
            except storeapi.SteamDataError:
                return {"supported": False, "count": 0, "unknown": True}  # try again next time
        with cls._ws_lock:
            if cls._ws_support.get(key) != supported:
                cls._ws_support[key] = supported
                try:
                    path.write_text(json.dumps(cls._ws_support), encoding="utf-8")
                except OSError:
                    pass
        updates = sum(i["needs_update"] for i in local["items"]) if local else 0
        return {"supported": supported, "count": count, "updates": updates}

    def _workshop(self, path: str, q: dict, key: str):
        import workshop
        c = self.ctx
        names = {g["appid"]: g["name"] for g in c.steam.library()}
        if path == "/api/workshop":
            games = []
            for appid, e in workshop.installed(c.steam).items():
                games.append({"appid": appid, "name": names.get(appid) or f"App {appid}", "size": e["size"],
                              "count": len(e["items"]), "subscribed": sum(i["subscribed"] for i in e["items"]),
                              "needs_update": e["needs_update"],
                              "updates": sum(i["needs_update"] for i in e["items"])})
            games.sort(key=lambda g: g["name"].lower())
            return self._json({"ok": True, "games": games})
        m = re.fullmatch(r"/api/workshop/(\d+)", path)
        if m:
            appid = int(m.group(1))
            e = workshop.installed(c.steam).get(appid) or {"items": [], "size": 0, "needs_update": False}
            info, err = {}, None
            try:
                info = workshop.details([i["id"] for i in e["items"]])
            except storeapi.SteamDataError as ex:
                err = str(ex)
            items = [{**(info.get(i["id"]) or {"id": i["id"], "title": f"Item {i['id']}", "preview": ""}), **{
                "size": i["size"] or (info.get(i["id"]) or {}).get("size", 0), "installed_updated": i["updated"],
                "needs_update": i["needs_update"], "subscribed": i["subscribed"], "has_folder": bool(i["folder"])}}
                for i in e["items"]]
            items.sort(key=lambda x: (not x.get("needs_update"), not x.get("subscribed"), -(x.get("installed_updated") or 0)))
            return self._json({"ok": True, "appid": appid, "name": names.get(appid) or f"App {appid}",
                               "size": e["size"], "items": items, "error": err, "has_key": bool(key)})
        m = re.fullmatch(r"/api/workshop/(\d+)/browse", path)
        if m:
            page = max(1, min(50, int(q.get("page", "1")) if str(q.get("page", "1")).isdigit() else 1))
            res = workshop.browse(int(m.group(1)), q.get("sort", "trend"), q.get("q", ""), page, key)
            mine = {i["id"]: i for i in (workshop.installed(c.steam).get(int(m.group(1))) or {"items": []})["items"]}
            for it in res["items"]:
                it["have"] = it["id"] in mine
                it["subscribed"] = bool(mine.get(it["id"], {}).get("subscribed"))
            return self._json({"ok": True, **res})
        m = re.fullmatch(r"/api/workshop/item/(\d+)", path)
        if m:
            fid = m.group(1)
            it = workshop.details([fid]).get(fid)
            if not it or not it["ok"]:
                raise storeapi.SteamDataError("This workshop item is private or was removed")
            local = (workshop.installed(c.steam).get(it["appid"]) or {"items": []})["items"]
            mine = next((i for i in local if i["id"] == fid), None)
            it.update(have=bool(mine), subscribed=bool(mine and mine["subscribed"]),
                      needs_update=bool(mine and mine["needs_update"]), has_folder=bool(mine and mine["folder"]),
                      game=names.get(it["appid"]) or "")
            return self._json({"ok": True, "item": it})
        return self._json({"ok": False, "error": "unknown endpoint"}, 404)

    def _steam_data(self, path: str, q: dict):
        c = self.ctx
        cc = (c.config["store_region"] or "US").upper()[:2]
        key = c.config["api_key"] or ""
        if path.startswith("/api/workshop"):
            return self._workshop(path, q, key)
        if path == "/api/store/home":
            return self._json({"ok": True, **storeapi.store_home(cc)})
        if path == "/api/store/search":
            return self._json({"ok": True, **storeapi.store_search(q.get("q", ""), cc)})
        m = re.fullmatch(r"/api/store/app/(\d+)", path)
        if m:
            app = storeapi.app_details(int(m.group(1)), cc)
            local = next((g for g in c.steam.library() if g["appid"] == app["appid"]), None)
            app["installed"] = bool(local and local["installed"])
            return self._json({"ok": True, "app": app})
        m = re.fullmatch(r"/api/game/(\d+)/workshop_support", path)
        if m:
            return self._json({"ok": True, **self._workshop_support(int(m.group(1)), cc)})
        m = re.fullmatch(r"/api/game/(\d+)/(news|achievements|dlc)", path)
        if m:
            appid, what = int(m.group(1)), m.group(2)
            if appid >= 0x80000000:
                raise storeapi.SteamDataError("Not available for non-Steam games")
            if what == "news":
                return self._json({"ok": True, "items": storeapi.news(appid)})
            if what == "dlc":
                return self._json({"ok": True, "items": storeapi.dlc(appid, cc, c.steam.installed_dlc(appid))})
            me = self._me()
            if not me:
                raise storeapi.SteamDataError("Sign in to Steam once so Cinder knows your account")
            res = storeapi.achievements(me, appid, key)
            if c.ach:
                c.ach.record(appid, res)
            return self._json({"ok": True, **res})
        me = self._me()
        if path == "/api/wishlist":
            if not me:
                raise storeapi.SteamDataError("Sign in to Steam once so Cinder knows your account")
            return self._json({"ok": True, **storeapi.wishlist(me, cc, key)})
        if path == "/api/presence":
            if not me:
                raise storeapi.SteamDataError("No Steam account found")
            return self._json({"ok": True, **storeapi.visible_status(me, key)})
        if path == "/api/friends":
            return self._json({"ok": True, **storeapi.friends(c.steam.local_friends(), me, key)})
        if path == "/api/profile":
            sid = q.get("id") or me
            if not sid or not sid.isdigit():
                raise storeapi.SteamDataError("No Steam account found")
            p = storeapi.profile(sid, key)
            p["is_me"] = sid == me
            if p["is_me"]:
                lib = c.steam.library()
                p["local"] = {
                    "installed": sum(1 for g in lib if g["installed"]),
                    "minutes": sum(g["playtime"] for g in lib),
                    "disk": sum(g["size"] for g in lib),
                    "recent": [g for g in sorted(lib, key=lambda g: -g["lastplayed"]) if g["lastplayed"]][:6],
                }
            return self._json({"ok": True, "profile": p})
        return self._json({"ok": False, "error": "unknown endpoint"}, 404)

    def _steam_status(self) -> dict:
        s = self.ctx.steam
        playing = getattr(self.ctx, "playing", lambda: None)()
        if playing:
            g = next((x for x in s.library() if x["appid"] == playing["appid"]), None)
            playing["name"] = g["name"] if g else f"App {playing['appid']}"
        downloads = [g for g in s.library() if g.get("download")]
        return {
            "found": s.found,
            "path": str(s.path) if s.path else "",
            "running": s.running(),
            "frozen": s.freeze_enabled(),
            "playing": playing,
            "downloads": sum(1 for g in downloads if g["download"]["state"] != "paused"),
            "on_demand": self.ctx.idle.status() if self.ctx.idle else None,
        }

    def _state(self) -> dict:
        c = self.ctx
        return {
            "ok": True,
            "version": VERSION,
            "config": c.config.public(),
            "platform": sys.platform,
            "themes": list_themes(c.theme_dirs),
            "user": c.steam.user(),
            "steam": self._steam_status(),
            "native": c.window_api is not None,
            "install": {
                "folder_build": install.is_folder_build(),
                "frozen": install.is_frozen(),
                "startup": install.startup_enabled(),
                "migrated_from": getattr(c, "migrated_from", "") or "",
                "path": str(install.install_dir()),
            },
        }

    # -- POST -----------------------------------------------------------------
    def do_POST(self):
        if not self._host_ok():
            return self._send(403, b"forbidden", "text/plain")
        path = urlsplit(self.path).path
        if not self._authed():
            return self._json({"ok": False, "error": "forbidden"}, 403)
        body = self._body()
        try:
            if path == "/api/config":
                return self._config(body)
            if path == "/api/meta":
                if not str(body.get("appid", "")).isdigit():
                    return self._json({"ok": False, "error": "bad appid"}, 400)
                return self._json({"ok": True, "meta": self.ctx.meta.update(int(body["appid"]), body)})
            if path == "/api/action":
                return self._action(body)
            if path == "/api/theme":
                return self._save_theme(body)
            if path == "/api/activate":
                if body.get("show", True):
                    threading.Thread(target=self.ctx.activate, daemon=True).start()
                return self._json({"ok": True})
            if path == "/api/achievements/scan":
                started = self.ctx.ach.scan(force=True) if self.ctx.ach else False
                return self._json({"ok": True, "started": started})
            if path == "/api/log":
                from cinderlog import log
                log.info("page: %s", str(body.get("msg", ""))[:500])
                return self._json({"ok": True})
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
        if "start_with_windows" in body:
            if not install.is_frozen():
                return self._json({"ok": False, "error": "Only available in the installed Cinder"})
            if not install.set_startup(bool(body.pop("start_with_windows"))):
                return self._json({"ok": False, "error": "Windows didn't allow changing the startup setting"})
            msg = "Cinder will start with Windows" if install.startup_enabled() else "Cinder won't start with Windows"
        if "steam_idle_minutes" in body:
            try:
                body["steam_idle_minutes"] = max(1, min(240, int(body["steam_idle_minutes"])))
            except (TypeError, ValueError):
                body.pop("steam_idle_minutes")
        if body.get("steam_on_demand") and c.idle:
            c.idle.touch()  # start the countdown from now, not from whenever Steam was last used
        if "steam_bridge" in body:
            on = bool(body["steam_bridge"])
            if c.steam.bridge:
                c.steam.bridge.set_enabled(on)
            from steambridge import LAUNCH_FLAG
            c.steam.extra_flags = [LAUNCH_FLAG] if on else []
        if "style" in body and not isinstance(body["style"], dict):
            return self._json({"ok": False, "error": "bad style"}, 400)
        if "api_key" in body:
            body["api_key"] = re.sub(r"[^0-9A-Fa-f]", "", str(body["api_key"]))[:64]
        if "lists" in body:
            lists = []
            for l in body["lists"] if isinstance(body["lists"], list) else []:
                if not isinstance(l, dict) or not str(l.get("name", "")).strip():
                    continue
                lists.append({"id": re.sub(r"[^\w-]", "", str(l.get("id") or ""))[:40] or secrets_id(),
                              "name": str(l["name"]).strip()[:60],
                              "appids": [int(x) for x in l.get("appids") or [] if str(x).isdigit()][:5000]})
            body["lists"] = lists[:100]
        if "profile_style" in body:
            ps = body["profile_style"] if isinstance(body["profile_style"], dict) else {}
            bg = ps.get("background")
            body["profile_style"] = {
                "background": int(bg) if str(bg).isdigit() else None,
                "showcase": [int(x) for x in ps.get("showcase") or [] if str(x).isdigit()][:4],
                "sections": {k: bool(v) for k, v in (ps.get("sections") or {}).items()
                             if k in ("showcase", "achievements", "stats", "about", "recent", "most")},
                "banner": "compact" if ps.get("banner") == "compact" else "large",
            }
        for k in ("favorites", "hidden"):
            if k in body:
                if not isinstance(body[k], list):
                    return self._json({"ok": False, "error": f"bad {k}"}, 400)
                body[k] = sorted({int(x) for x in body[k] if str(x).isdigit()})[:5000]
        if "when_playing" in body and body["when_playing"] not in ("minimize", "tray", "nothing"):
            return self._json({"ok": False, "error": "bad when_playing"}, 400)
        if "store_region" in body:
            body["store_region"] = re.sub(r"[^A-Za-z]", "", str(body["store_region"]))[:2].upper() or "US"
        c.config.update(body)
        return self._json({"ok": True, "config": c.config.public(), "message": msg, "steam": self._steam_status()})

    def _delete_old_exe(self):
        """After switching to the installed version, remove the old single-file Cinder.exe."""
        import time
        old = Path(getattr(self.ctx, "migrated_from", "") or "")
        if not old.name.lower() == "cinder.exe" or not old.is_file():
            return self._json({"ok": False, "error": "Old copy not found"})
        if old.resolve() == Path(sys.executable).resolve():
            return self._json({"ok": False, "error": "That's the copy that's running"})
        for _ in range(10):  # it may still be closing
            try:
                old.unlink()
                break
            except OSError:
                time.sleep(0.5)
        else:
            return self._json({"ok": False, "error": "Couldn't delete it yet; try again in a moment"})
        try:
            old.with_name("Cinder.exe.old").unlink(missing_ok=True)
        except OSError:
            pass
        self.ctx.migrated_from = ""
        return self._json({"ok": True})

    def _save_theme(self, body: dict):
        name = str(body.get("name", "")).strip()[:40]
        css = str(body.get("css", ""))
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        if not slug or not css or len(css) > 100_000:
            return self._json({"ok": False, "error": "Give your theme a name"}, 400)
        if "</" in css or "@import" in css.lower():
            return self._json({"ok": False, "error": "Theme contains unsupported content"}, 400)
        path = self.ctx.data_dir / "themes" / f"{slug}.css"
        path.write_text(css, encoding="utf-8")
        return self._json({"ok": True, "id": slug, "themes": list_themes(self.ctx.theme_dirs)})

    # -- downloads -------------------------------------------------------------
    def _bridge_state(self) -> str:
        c, s = self.ctx, self.ctx.steam
        if not s.found or not s.bridge:
            return "unavailable"
        if not c.config["steam_bridge"]:
            return "off"
        if not s.running():
            return "steam_off"
        return "on" if s.bridge.available() else "needs_restart"

    def _downloads(self) -> dict:
        """Downloads from Steam's files, upgraded with Steam's live queue when connected."""
        import steambridge
        s = self.ctx.steam
        games = {g["appid"]: g for g in s.library()}
        items = {a: {"appid": a, "name": g["name"], **g["download"]} for a, g in games.items() if g.get("download")}
        bridge = self._bridge_state()
        out = {"ok": True, "bridge": bridge, "live": False, "current": 0, "speed": 0, "peak": 0, "eta": 0}
        snap = None
        if bridge == "on":
            try:
                snap = s.bridge.snapshot()
            except steambridge.BridgeError as e:
                log.info("downloads: live queue unavailable (%s)", e)
        if snap and snap.get("items") is not None:
            out["live"] = True
            ov = snap.get("overview") or {}
            cur = int(ov.get("update_appid") or 0)
            running = str(ov.get("update_state") or "").lower() not in ("", "none", "stopping") and not ov.get("paused")
            out.update(current=cur if running else 0,
                       speed=int(ov.get("update_network_bytes_per_second") or 0) if running else 0,
                       peak=int(ov.get("update_peak_network_bytes_per_second") or 0),
                       eta=int(ov.get("update_seconds_remaining") or 0) if running else 0)
            for it in snap["items"] or []:
                a = int(it.get("appid") or 0)
                if not a:
                    continue
                d = items.get(a) or {"appid": a, "name": (games.get(a) or {}).get("name") or f"App {a}",
                                     "state": "queued", "total": 0, "done": 0, "stage_total": 0, "stage_done": 0}
                total, done = int(it.get("total_bytes") or 0), int(it.get("downloaded_bytes") or 0)
                if total:
                    d["total"], d["done"] = total, min(done, total)
                d["queue"] = int(it.get("queue_index") if it.get("queue_index") is not None else 999)
                if it.get("completed"):
                    d["state"], d["completed_time"] = "done", int(it.get("completed_time") or 0)
                elif it.get("paused"):
                    d["state"] = "paused"
                elif a == out["current"]:
                    if d["state"] not in ("installing", "verifying"):
                        d["state"] = "downloading"
                elif d["state"] == "downloading":
                    d["state"] = "queued"
                if it.get("update_error"):
                    d["error"] = str(it["update_error"])
                items[a] = d
        order = {"downloading": 0, "installing": 1, "verifying": 2, "queued": 3, "paused": 4, "done": 9}
        lst = sorted(items.values(), key=lambda d: (order.get(d["state"], 5), d.get("queue", 999),
                                                    -d.get("completed_time", 0)))
        busy = {d["appid"] for d in lst if d["state"] != "done"}
        out["items"] = lst
        out["updates"] = [{"appid": a, "name": g["name"], "size": g.get("size", 0)} for a, g in games.items()
                          if g.get("installed") and g.get("update_pending") and not g.get("shortcut") and a not in busy]
        return out

    # Steam writes every update it starts to logs/content_log.txt, so that's how Cinder
    # checks a request really worked (Steam's API calls return nothing either way).
    def _content_log(self):
        p = self.ctx.steam.path / "logs" / "content_log.txt" if self.ctx.steam.path else None
        return p if p and p.exists() else None

    def _log_pos(self) -> int:
        p = self._content_log()
        try:
            return p.stat().st_size if p else 0
        except OSError:
            return 0

    def _started(self, ids: list[int], pos: int, wait: float) -> list[int]:
        import time
        p = self._content_log()
        b = self.ctx.steam.bridge
        end = time.time() + wait
        while True:
            hit = set()
            if p:
                try:
                    with open(p, "rb") as f:
                        f.seek(pos)
                        text = f.read().decode("utf-8", "replace")
                    for a in ids:
                        if re.search(rf"AppID {a} (scheduler update|update started|state changed : [^\n]*Update (Running|Started))", text):
                            hit.add(a)
                except OSError:
                    pass
            try:
                ov = (b.item(ids[0]).get("overview") or {}) if b else {}
                if int(ov.get("update_appid") or 0) in ids:
                    hit.add(int(ov["update_appid"]))
            except Exception:
                pass
            if hit or time.time() >= end:
                return sorted(hit)
            time.sleep(0.7)

    def _start_updates(self, ids: list[int]) -> dict:
        """Try each way of starting an update, checking Steam's own log after each one."""
        import steambridge
        b = self.ctx.steam.bridge
        pos = self._log_pos()
        try:
            r = b.update(ids)
            log.info("bridge update %s steps: %s", ids, "; ".join((r or {}).get("log") or []) if isinstance(r, dict) else r)
        except steambridge.BridgeError as e:
            log.warning("bridge update %s failed: %s", ids, e)
        ok = self._started(ids, pos, 5)
        if len(ok) < len(ids):
            # Not on Steam's list yet: queue it, then start it.
            rest = [x for x in ids if x not in ok]
            try:
                r = b.update(rest, queue=True)
                log.info("bridge update %s (queue) steps: %s", rest, "; ".join((r or {}).get("log") or []) if isinstance(r, dict) else r)
            except steambridge.BridgeError as e:
                log.warning("bridge update %s (queue) failed: %s", rest, e)
            ok = sorted(set(ok) | set(self._started(ids, pos, 6)))
        if len(ok) == len(ids):
            log.info("bridge update %s: Steam started it", ids)
            return {"ok": True, "state": "queued"}
        try:
            log.info("bridge diagnose: %s", json.dumps(b.diagnose())[:6000])
        except Exception as e:
            log.info("bridge diagnose failed: %s", e)
        missing = [a for a in ids if a not in ok]
        log.warning("bridge update %s: Steam didn't start %s", ids, missing)
        # Last resort: Steam's own page for it, which has a working Update button.
        self.ctx.steam.steam_url(f"steam://nav/games/details/{missing[0]}")
        return {"ok": True, "state": "steam_fallback", "started": ok}

    def _check_started(self, ids: list[int]) -> None:
        """A few seconds after an update request, note in the log whether Steam actually started it."""
        import time
        import steambridge
        time.sleep(8)
        try:
            for a in ids[:3]:
                d = self.ctx.steam.bridge.item(a)
                it, ov = d.get("item") or {}, d.get("overview") or {}
                started = it.get("active") or int(ov.get("update_appid") or 0) == a
                log.info("bridge check %s: %s | item: %s | overview: %s", a, "downloading" if started else "NOT STARTED",
                         json.dumps(it)[:1200], json.dumps(ov)[:800])
        except steambridge.BridgeError as e:
            log.info("bridge check failed: %s", e)

    def _workshop_action(self, action: str, body: dict, appid):
        import workshop
        import steambridge
        s = self.ctx.steam
        fid = str(body.get("id", ""))
        if action == "workshop_browse_steam" and appid:
            s.steam_url(f"steam://openurl/https://steamcommunity.com/app/{appid}/workshop/")
            return self._json({"ok": True})
        if not fid.isdigit():
            return self._json({"ok": False, "error": "bad item"}, 400)
        if action == "workshop_open":
            s.steam_url("steam://openurl/" + workshop.item_url(fid))  # subscribe / unsubscribe there
            return self._json({"ok": True})
        mine = next((i for e in workshop.installed(s).values() for i in e["items"] if i["id"] == fid), None)
        app = next((a for a, e in workshop.installed(s).items() if any(i["id"] == fid for i in e["items"])), appid)
        if action == "workshop_folder":
            if not mine or not mine["folder"]:
                return self._json({"ok": False, "error": "This item isn't downloaded yet"})
            _open_path(mine["folder"])
            return self._json({"ok": True})
        # workshop_update: ask Steam to fetch the newest version now
        if not app or not s.bridge or self._bridge_state() != "on":
            return self._json({"ok": False, "error": "Connect Cinder to Steam first (Downloads tab), or update it by launching the game"})
        try:
            r = s.bridge.run(f"""(async () => {{
  const A = SteamClient.Apps;
  if (typeof A.DownloadWorkshopItem !== "function") return {{ok: false}};
  const r = A.DownloadWorkshopItem({int(app)}, "{fid}", true); if (r && r.then) await r;
  return {{ok: true}};
}})()""")
        except steambridge.BridgeError as e:
            return self._json({"ok": False, "error": f"Steam didn't take the request ({e})"})
        log.info("workshop update %s/%s: %s", app, fid, r)
        if not (isinstance(r, dict) and r.get("ok")):
            return self._json({"ok": False, "error": "This Steam build can't update workshop items from Cinder"})
        return self._json({"ok": True})

    def _bridge_action(self, action: str, body: dict):
        """Update games and control the download queue without opening a Steam window."""
        import threading
        import steambridge
        from steamlib import running_appid
        c, s = self.ctx, self.ctx.steam
        b = s.bridge
        if not s.found or not b:
            return self._json({"ok": False, "error": "Steam wasn't found"})
        cmd = "update" if action == "game_update" else str(body.get("cmd", ""))
        if action == "download_pause":  # older UI
            cmd = "pause" if body.get("pause") else "resume"
        if cmd not in ("update", "pause", "resume", "top", "remove", "pause_all", "resume_all", "connect"):
            return self._json({"ok": False, "error": "unknown command"}, 400)
        raw = body.get("appids") or ([body["appid"]] if body.get("appid") is not None else [])
        ids = [int(x) for x in raw if str(x).isdigit()][:200]
        if cmd == "update":
            games = {g["appid"]: g for g in s.library()}
            ids = [a for a in ids if a in games and games[a].get("installed") and not games[a].get("shortcut")]
        if not ids and cmd not in ("pause_all", "resume_all", "connect"):
            return self._json({"ok": False, "error": "Nothing to update"})

        def do():
            if cmd == "update":
                return self._start_updates(ids)
            try:
                r = b.command(cmd, ids) if cmd != "connect" else {"ok": True}
            except steambridge.BridgeError as e:
                log.warning("bridge %s %s failed: %s", cmd, ids, e)
                return {"ok": False, "error": f"Steam didn't take the request ({e})"}
            if isinstance(r, dict) and r.get("ok"):
                log.info("bridge %s %s", cmd, ids)
                if cmd == "update":
                    log.info("bridge update steps: %s", "; ".join(r.get("log") or []))
                    log.info("bridge update before: %s | overview: %s", json.dumps(r.get("before"))[:1500],
                             json.dumps(r.get("overview"))[:800])
                    threading.Thread(target=self._check_started, args=(ids,), daemon=True).start()
                return {"ok": True, "state": "queued" if cmd == "update" else "done"}
            log.warning("bridge %s: unexpected reply %r", cmd, r)
            return {"ok": False, "error": "This Steam build doesn't support that from Cinder. Use Manage in Steam."}

        if not c.config["steam_bridge"]:
            # Fallback: Steam's own pages, which have the buttons.
            s.steam_url(f"steam://nav/games/details/{ids[0]}" if cmd == "update" and ids else "steam://open/downloads")
            return self._json({"ok": True, "state": "steam"})
        if not s.running():
            def start_then():
                s.start(silent=True)
                if b.wait_ready(120):
                    do()
            threading.Thread(target=start_then, daemon=True).start()
            return self._json({"ok": True, "state": "starting"})
        if b.available():
            return self._json(do())
        if not body.get("restart"):
            return self._json({"ok": True, "state": "need_restart"})
        if running_appid():
            return self._json({"ok": False, "error": "Close your game first; Steam has to restart once"})
        threading.Thread(target=steambridge.restart_with_bridge, args=(s, b, do), daemon=True).start()
        return self._json({"ok": True, "state": "restarting"})

    def _action(self, body: dict):
        c, s = self.ctx, self.ctx.steam
        action = body.get("action")
        appid = body.get("appid")
        if appid is not None:
            if not str(appid).isdigit():
                return self._json({"ok": False, "error": "bad appid"}, 400)
            appid = int(appid)

        if c.idle and action not in ("cinder_check", "cinder_update", "cinder_restart", "steam_check", "open_web",
                                     "folder", "themes_folder", "delete_old_exe", "workshop_folder", "steam_exit"):
            # Anything else that talks to Steam keeps it around a while (a launch long enough to start the game).
            c.idle.touch(hold=600 if action == "launch" else 180 if action == "steam_open" else 60)
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
            if s.quiet:
                s.quiet.cancel()
            if s.running():
                s.open_url("steam://open/main")
            else:
                s.start(silent=False)
        elif action == "status":
            status = str(body.get("status", ""))
            if status not in ("online", "away", "invisible", "offline"):
                return self._json({"ok": False, "error": "unknown status"}, 400)
            s.set_status(status)
            c.config.update({"persona": status})
            return self._json({"ok": True, "persona": status})
        elif action == "steam_friends":
            if s.quiet:
                s.quiet.cancel()
            s.steam_url("steam://open/friends")
        elif action == "steam_downloads":
            s.steam_url("steam://open/downloads")
        elif action == "message" and str(body.get("steamid", "")).isdigit():
            s.steam_url(f"steam://friends/message/{body['steamid']}")
        elif action == "profile_in_steam" and str(body.get("steamid", "")).isdigit():
            s.steam_url(f"steam://url/SteamIDPage/{body['steamid']}")
        elif action == "wishlist_in_steam":
            s.steam_url("steam://openurl/https://store.steampowered.com/wishlist/")
        elif action == "open_web":
            url = str(body.get("url", ""))
            if url not in ALLOWED_WEB:
                return self._json({"ok": False, "error": "link not allowed"}, 400)
            import webbrowser
            webbrowser.open(url)
        elif action == "steam_url_open":
            url = str(body.get("url", ""))
            if re.match(r"^https://(store\.steampowered\.com|steamcommunity\.com)/", url):
                s.steam_url("steam://openurl/" + url)  # Steam pages open in Steam
            elif re.match(r"^https?://[^\s]+$", url):
                import webbrowser
                webbrowser.open(url)  # other news sites open in your browser
            else:
                return self._json({"ok": False, "error": "link not allowed"}, 400)
        elif action == "steam_profile_edit":
            sec = str(body.get("section", ""))
            me = self._me()
            if sec not in ("info", "avatar", "background", "miniprofile", "theme", "showcases", "settings") or not me:
                return self._json({"ok": False, "error": "unknown section"}, 400)
            s.steam_url(f"steam://openurl/https://steamcommunity.com/profiles/{me}/edit/{sec}")
        elif action == "store_in_steam":
            s.steam_url("steam://store")
        elif action == "steam_exit":
            s.shutdown()
        elif action == "launch_options" and appid:
            return self._launch_options(appid, str(body.get("options") or "")[:1000])
        elif action == "move_game" and appid:
            return self._move_game(appid, str(body.get("folder", "")))
        elif action in ("workshop_open", "workshop_folder", "workshop_update", "workshop_browse_steam"):
            return self._workshop_action(action, body, appid)
        elif action in ("game_update", "download_pause", "download_cmd"):
            return self._bridge_action(action, body)
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
        elif action == "delete_old_exe":
            return self._delete_old_exe()
        elif action == "themes_folder":
            _open_path(str(c.data_dir / "themes"))
        else:
            return self._json({"ok": False, "error": "unknown action"}, 400)
        return self._json({"ok": True})


def secrets_id() -> str:
    import secrets
    return "l-" + secrets.token_hex(4)


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
