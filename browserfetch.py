"""Fetch a page through a hidden browser window (the same Chromium engine Cinder's window uses).

Some Steam endpoints (user reviews) reject plain programmatic requests and answer with the
Steam home page instead. A real browser request goes through. The helper window is invisible,
made on first use, reused, and closed after a minute of not being needed.
"""

from __future__ import annotations

import json
import threading
import time

from cinderlog import log


class BrowserFetch:
    IDLE_CLOSE = 60

    def __init__(self):
        self._win = None
        self._loaded = threading.Event()
        self._lock = threading.Lock()
        self._last = 0.0
        self._closer = None

    def get_json(self, url: str, timeout: float = 20) -> dict:
        text = self._load(url, "document.body ? document.body.innerText : ''", timeout)
        try:
            return json.loads(text, strict=False)
        except ValueError as e:
            log.info("browser fetch got a page, not data: %r", text[:120])
            raise ValueError("not JSON") from e

    def get_html(self, url: str, timeout: float = 20) -> str:
        return self._load(url, "document.documentElement ? document.documentElement.outerHTML : ''", timeout)

    def _load(self, url: str, script: str, timeout: float) -> str:
        import webview  # pywebview: only available when Cinder runs as its own window
        with self._lock:
            self._loaded.clear()
            if self._win is None:
                self._win = webview.create_window("Cinder helper", url, hidden=True, focus=False,
                                                  width=1280, height=900)  # desktop layout, not mobile
                self._win.events.loaded += self._on_loaded
            else:
                self._win.load_url(url)
            if not self._loaded.wait(timeout):
                raise TimeoutError("page didn't load")
            text = ""
            for _ in range(20):  # the body can lag the load event slightly
                text = self._win.evaluate_js(script) or ""
                if text.strip():
                    break
                time.sleep(0.15)
            self._last = time.monotonic()
            self._schedule_close()
        return text

    def _on_loaded(self):
        self._loaded.set()

    def _schedule_close(self):
        if self._closer and self._closer.is_alive():
            return

        def run():
            while True:
                time.sleep(15)
                with self._lock:
                    if time.monotonic() - self._last >= self.IDLE_CLOSE and self._win is not None:
                        try:
                            self._win.destroy()
                        except Exception:
                            pass
                        self._win = None
                        return
        self._closer = threading.Thread(target=run, daemon=True)
        self._closer.start()
