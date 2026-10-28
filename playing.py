"""Notices when a Steam game starts and stops, and tucks Cinder away while you play."""

from __future__ import annotations

import threading
import time

from cinderlog import log
from steamlib import running_appid


class GameWatcher:
    """Polls Steam's RunningAppID every couple of seconds (a cheap registry read)."""

    def __init__(self, on_start=None, on_stop=None, interval: float = 2.0):
        self.on_start = on_start
        self.on_stop = on_stop
        self.interval = interval
        self.appid = 0
        self.since = 0.0
        self._stop = threading.Event()

    def start(self) -> None:
        self.appid = running_appid()
        self.since = time.time() if self.appid else 0.0
        threading.Thread(target=self._run, name="game-watch", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self):
        while not self._stop.wait(self.interval):
            try:
                now = running_appid()
            except Exception:
                continue
            if now == self.appid:
                continue
            prev, started = self.appid, self.since
            self.appid, self.since = now, (time.time() if now else 0.0)
            if prev and self.on_stop:
                log.info("game %s stopped after %.0f min", prev, (time.time() - started) / 60)
                self._call(self.on_stop, prev, time.time() - started)
            if now and self.on_start:
                log.info("game %s started", now)
                self._call(self.on_start, now)

    @staticmethod
    def _call(fn, *a):
        try:
            fn(*a)
        except Exception:
            log.exception("game watcher callback failed")

    def snapshot(self) -> dict | None:
        return {"appid": self.appid, "since": self.since} if self.appid else None
