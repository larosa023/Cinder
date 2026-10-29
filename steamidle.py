"""'Only run Steam when needed': closes Steam once nothing needs it.

Steam is needed while a game runs, while something downloads, while Steam is updating
itself, and while one of Steam's own windows is open. When none of that has been true
for a few minutes, Cinder closes Steam the normal way (steam.exe -shutdown, which also
finishes any cloud save sync). Anything that needs Steam starts it again in the
background: Play, Update, status changes and so on.
"""

from __future__ import annotations

import threading
import time

from cinderlog import log
from steamlib import running_appid

BUSY_DOWNLOADS = {"downloading", "installing", "verifying"}  # not "queued": Steam schedules updates hours ahead


class SteamIdle:
    CHECK = 20  # seconds between checks

    def __init__(self, steam, config, steam_updater=None):
        self.steam, self.config, self.steam_updater = steam, config, steam_updater
        self.last_active = time.time()
        self.hold_until = 0.0
        self.reason = ""
        self._stop = threading.Event()

    @property
    def enabled(self) -> bool:
        return bool(self.config["steam_on_demand"])

    @property
    def minutes(self) -> float:
        try:
            return max(1.0, float(self.config["steam_idle_minutes"]))
        except (TypeError, ValueError):
            return 5.0

    def touch(self, hold: float = 0) -> None:
        """Something just used Steam; `hold` keeps it open at least that many seconds."""
        now = time.time()
        self.last_active = now
        if hold:
            self.hold_until = max(self.hold_until, now + hold)

    def start(self) -> None:
        threading.Thread(target=self._run, name="steam-idle", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()

    def busy(self) -> str:
        """Why Steam is still needed right now ('' if it isn't)."""
        if time.time() < self.hold_until:
            return "just used"
        if running_appid():
            return "game running"
        try:
            if any((g.get("download") or {}).get("state") in BUSY_DOWNLOADS for g in self.steam.library()):
                return "downloading"
        except Exception:
            return "unknown"
        if self.steam_updater and self.steam_updater.snapshot().get("busy"):
            return "updating Steam"
        try:
            from steamquiet import steam_pids, steam_windows, _is_big, SteamQuiet
            wins = steam_windows(steam_pids())
            if any(_is_big(w, SteamQuiet.MAIN + SteamQuiet.FRIENDS) for w in wins.values()):
                return "Steam window open"
        except Exception:
            pass
        return ""

    def status(self) -> dict:
        running = self.steam.running()
        left = 0
        if self.enabled and running and not self.reason:
            left = max(0, int(self.minutes * 60 - (time.time() - self.last_active)))
        return {"enabled": self.enabled, "running": running, "busy": self.reason, "closes_in": left}

    def _run(self):
        while not self._stop.wait(self.CHECK):
            try:
                if not self.enabled or not self.steam.running():
                    self.last_active = time.time()
                    self.reason = ""
                    continue
                self.reason = self.busy()
                if self.reason:
                    self.last_active = time.time()
                    continue
                if time.time() - self.last_active >= self.minutes * 60:
                    log.info("steam idle for %.0f min: closing Steam", self.minutes)
                    self.steam.shutdown()
                    self.last_active = time.time()
            except Exception:
                log.exception("steam idle check failed")
