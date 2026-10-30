"""Session recap: what happened in the game you just closed.

When a game starts, Cinder notes your achievements and play time for it. When it closes,
it waits a moment for Steam to sync, checks again, and keeps a small recap that the
window shows as a card: time played, achievements you unlocked, and your new total.
"""

from __future__ import annotations

import threading
import time

import storeapi
from cinderlog import log

SYNC_WAIT = 25  # seconds for Steam to upload what you unlocked


class Recaps:
    def __init__(self, steam, config, sessions, ach=None):
        self.steam, self.config, self.sessions, self.ach = steam, config, sessions, ach
        self._lock = threading.Lock()
        self._before: dict[int, dict] = {}
        self.latest: dict | None = None

    # -- helpers ---------------------------------------------------------------
    def _me(self) -> str:
        u = self.steam.user()
        return u["steamid"] if u else ""

    def _achievements(self, appid: int, fresh: bool) -> dict | None:
        me = self._me()
        if not me or appid >= 0x80000000:
            return None
        if fresh:
            storeapi.forget(f"/{appid}/achievements/", f"appid={appid}&")
        try:
            return storeapi.achievements(me, appid, self.config["api_key"] or "")
        except storeapi.SteamDataError:
            return None

    def _game(self, appid: int) -> dict:
        return next((g for g in self.steam.library() if g["appid"] == appid), {}) or {}

    # -- events from the game watcher -------------------------------------------
    def started(self, appid: int) -> None:
        g = self._game(appid)
        snap = {"minutes": int(g.get("playtime") or 0), "unlocked": None}
        with self._lock:
            self._before[appid] = snap

        def look():
            a = self._achievements(appid, fresh=False)
            if a:
                snap["unlocked"] = {x["id"] for x in a["items"] if x["unlocked"]}
        threading.Thread(target=look, name="recap-start", daemon=True).start()

    def stopped(self, appid: int, seconds: float) -> None:
        if seconds < 60:
            return  # a crash at launch isn't worth a recap
        with self._lock:
            before = self._before.pop(appid, None) or {"minutes": int(self._game(appid).get("playtime") or 0), "unlocked": None}
        g = self._game(appid)
        end = time.time()
        rec = {
            "id": f"{appid}-{int(end)}", "appid": appid, "name": g.get("name") or f"App {appid}",
            "start": int(end - seconds), "end": int(end), "seconds": int(seconds),
            "total_minutes": before["minutes"] + int(seconds // 60),
            "new": [], "ach_total": 0, "ach_unlocked": 0, "pending": True,
        }
        rec.update(self._place(appid, seconds))
        with self._lock:
            self.latest = rec
        threading.Thread(target=self._finish, args=(rec, before), name="recap", daemon=True).start()

    def _place(self, appid: int, seconds: float) -> dict:
        """How this session compares with your others for the game."""
        with self.sessions.lock:
            mine = [e - s for a, s, e in self.sessions.data if a == appid]
        longer = sum(1 for x in mine if x > seconds + 1)
        return {"sessions": len(mine), "longest": bool(mine) and len(mine) > 2 and longer == 0}

    def _finish(self, rec: dict, before: dict) -> None:
        time.sleep(SYNC_WAIT)
        try:
            a = self._achievements(rec["appid"], fresh=True)
            if a:
                rec["ach_total"], rec["ach_unlocked"] = a["total"], a["unlocked"]
                had = before.get("unlocked")
                if had is None:  # couldn't check at the start: count what unlocked during the session
                    new = [x for x in a["items"] if x["unlocked"] and rec["start"] - 60 <= (x.get("time") or 0) <= rec["end"] + 60]
                else:
                    new = [x for x in a["items"] if x["unlocked"] and x["id"] not in had]
                rec["new"] = [{k: x.get(k) for k in ("id", "name", "desc", "icon", "percent")} for x in new][:30]
                if self.ach:
                    self.ach.record(rec["appid"], a)
            g = self._game(rec["appid"])
            if g.get("playtime"):  # Steam's own total, once it has written it
                rec["total_minutes"] = max(rec["total_minutes"], int(g["playtime"]))
        except Exception:
            log.exception("session recap")
        rec["pending"] = False
        log.info("recap: %s, %d min, %d new achievements", rec["name"], rec["seconds"] // 60, len(rec["new"]))

    def snapshot(self) -> dict | None:
        with self._lock:
            return dict(self.latest) if self.latest else None
