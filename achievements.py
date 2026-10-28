"""Your Steam achievements across every game, gathered in the background.

Results are cached in %APPDATA%/Cinder/achievements.json so the hub opens
instantly. Recently played games are re-checked every 12 hours, the rest
weekly. Only games you've played are checked (the rest have nothing unlocked).
"""

from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import storeapi
from cinderlog import log

RECENT_TTL = 12 * 3600
OLD_TTL = 7 * 86400
NONE_TTL = 14 * 86400  # games with no achievements (or hidden stats)


class AchievementIndex:
    def __init__(self, steam, config, data_dir: Path):
        self.steam, self.config = steam, config
        self.file = data_dir / "achievements.json"
        self._lock = threading.Lock()
        self.games: dict[str, dict] = {}
        try:
            self.games = json.loads(self.file.read_text(encoding="utf-8")).get("games", {})
        except (OSError, ValueError):
            pass
        self.scanning = False
        self.done = self.total = 0
        self.private_hits = 0
        self.last_error = None
        self._dirty = 0

    # -- storage ---------------------------------------------------------------
    def _save(self):
        try:
            with self._lock:
                data = json.dumps({"games": self.games})
            tmp = self.file.with_suffix(".tmp")
            tmp.write_text(data, encoding="utf-8")
            tmp.replace(self.file)
        except OSError:
            pass

    def record(self, appid: int, result: dict | None, none_reason: str | None = None) -> None:
        """Store one game's achievements (also used when you open a game's Achievements tab)."""
        entry = {"checked": time.time()}
        if result:
            entry.update(total=result["total"], unlocked=result["unlocked"], items=[
                {k: a.get(k) for k in ("id", "name", "icon", "unlocked", "time", "percent", "desc")}
                for a in result["items"]])
        else:
            entry.update(none=True, reason=none_reason or "")
        with self._lock:
            self.games[str(appid)] = entry
            self._dirty += 1
        if self._dirty >= 10:
            self._dirty = 0
            self._save()

    # -- scanning --------------------------------------------------------------
    def _stale(self, g: dict) -> bool:
        e = self.games.get(str(g["appid"]))
        if not e:
            return True
        age = time.time() - e.get("checked", 0)
        if e.get("none"):
            return age > NONE_TTL
        recent = g.get("lastplayed", 0) > time.time() - 14 * 86400
        return age > (RECENT_TTL if recent else OLD_TTL) or g.get("lastplayed", 0) > e.get("checked", 0)

    def scan(self, force: bool = False) -> bool:
        if self.scanning:
            return False
        u = self.steam.user()
        if not u:
            self.last_error = "Sign in to Steam once so Cinder knows your account"
            return False
        played = [g for g in self.steam.library()
                  if not g.get("shortcut") and (g.get("playtime") or g.get("lastplayed"))]
        todo = [g for g in played if force or self._stale(g)]
        if not todo:
            return False
        self.scanning, self.done, self.total = True, 0, len(todo)
        self.private_hits, self.last_error = 0, None
        threading.Thread(target=self._scan, args=(u["steamid"], todo), daemon=True).start()
        return True

    def _scan(self, steamid: str, todo: list[dict]):
        key = self.config["api_key"] or ""
        workers = 4 if key else 2  # be gentle with the public profile pages

        def one(g):
            try:
                res = storeapi.achievements(steamid, g["appid"], key)
                self.record(g["appid"], res)
            except storeapi.SteamDataError as e:
                msg = str(e)
                if "private" in msg.lower():
                    self.private_hits += 1
                if "Couldn't reach" in msg or "returned 429" in msg or "returned 5" in msg:
                    self.last_error = msg  # network trouble: try again next time
                else:
                    self.record(g["appid"], None, msg)
            except Exception:
                log.exception("achievement scan failed for %s", g["appid"])
            finally:
                self.done += 1
                if not key:
                    time.sleep(0.4)

        try:
            # Most recently played first, so the hub fills in with what you care about.
            todo.sort(key=lambda g: -g.get("lastplayed", 0))
            with ThreadPoolExecutor(workers) as ex:
                list(ex.map(one, todo))
        finally:
            self._save()
            self.scanning = False
            log.info("achievement scan: %d games checked", self.done)

    # -- hub -------------------------------------------------------------------
    def hub(self) -> dict:
        names = {g["appid"]: g for g in self.steam.library()}
        with self._lock:
            games = dict(self.games)
        rows, recent, rare = [], [], []
        unlocked_total = available = perfect = 0
        for sid, e in games.items():
            if e.get("none") or not e.get("total"):
                continue
            appid = int(sid)
            g = names.get(appid)
            if not g:
                continue
            u, t = e["unlocked"], e["total"]
            unlocked_total += u
            available += t
            perfect += u == t
            last = max((a.get("time") or 0 for a in e["items"] if a.get("unlocked")), default=0)
            rows.append({"appid": appid, "name": g["name"], "unlocked": u, "total": t,
                         "pct": round(100 * u / t, 1), "last": last, "playtime": g.get("playtime", 0)})
            for a in e["items"]:
                if a.get("unlocked"):
                    item = {"appid": appid, "game": g["name"], "name": a.get("name"), "icon": a.get("icon"),
                            "time": a.get("time") or 0, "percent": a.get("percent"), "desc": a.get("desc") or ""}
                    recent.append(item)
                    if a.get("percent") is not None:
                        rare.append(item)
        started = [r for r in rows if r["unlocked"]]
        recent.sort(key=lambda a: -a["time"])
        rare.sort(key=lambda a: a["percent"])
        almost = sorted([r for r in rows if 50 <= r["pct"] < 100], key=lambda r: -r["pct"])
        return {
            "scanning": self.scanning, "done": self.done, "total": self.total,
            "error": self.last_error,
            "private": self.private_hits > 0 and not rows,
            "stats": {
                "unlocked": unlocked_total,
                "available": available,
                "games": len(rows),
                "perfect": perfect,
                "avg": round(sum(r["pct"] for r in started) / len(started), 1) if started else 0,
            },
            "recent": [a for a in recent if a["time"]][:16],
            "rarest": rare[:12],
            "almost": almost[:12],
            "games": sorted(rows, key=lambda r: (-r["pct"], -r["last"])),
        }
