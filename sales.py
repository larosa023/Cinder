"""Checks your wishlist every few hours and notifies you about new sales."""

from __future__ import annotations

import json
import threading
from pathlib import Path

import storeapi
from cinderlog import log


class SaleWatcher:
    FIRST_CHECK = 120        # seconds after Cinder starts
    INTERVAL = 6 * 3600      # then every 6 hours

    def __init__(self, steam, config, data_dir: Path, notify):
        self.steam, self.config, self.notify = steam, config, notify
        self.file = data_dir / "sales.json"
        self._stop = threading.Event()

    def start(self) -> None:
        threading.Thread(target=self._run, name="sales", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self):
        wait = self.FIRST_CHECK
        while not self._stop.wait(wait):
            wait = self.INTERVAL
            if self.config["sale_alerts"]:
                try:
                    self.check()
                except Exception as e:
                    log.info("sale check skipped: %r", e)

    def check(self) -> list[dict]:
        u = self.steam.user()
        if not u:
            return []
        cc = (self.config["store_region"] or "US").upper()[:2]
        data = storeapi.wishlist(u["steamid"], cc, self.config["api_key"] or "")
        try:
            seen = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            seen = None
        fresh, now_seen = storeapi.new_sales(data.get("items") or [], seen or {})
        self.file.write_text(json.dumps(now_seen), encoding="utf-8")
        if seen is None:
            return []  # first run: just remember what's on sale now, don't flood you
        if fresh:
            fresh.sort(key=lambda x: -(x["price"] or {}).get("discount", 0))
            def line(it):
                p = it["price"]
                return f"{it['name']} -{p['discount']}% ({p['final'] / 100:.2f} {p.get('currency', '')})".strip()
            if len(fresh) == 1:
                self.notify("Wishlist sale", line(fresh[0]))
            else:
                self.notify(f"{len(fresh)} wishlist games on sale", "; ".join(line(x) for x in fresh[:3])
                            + (f" and {len(fresh) - 3} more" if len(fresh) > 3 else ""))
            log.info("sale alert: %s", ", ".join(x["name"] for x in fresh))
        return fresh
