"""Wishlist prices: a local price history, price-drop targets, and sale alerts every few hours."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

import storeapi
from cinderlog import log


class PriceBook:
    """What each wishlisted game cost over time (recorded whenever Cinder checks), and your price targets."""
    MAX_POINTS = 500

    def __init__(self, data_dir: Path):
        self.file = data_dir / "prices.json"
        self._lock = threading.Lock()
        try:
            d = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            d = {}
        self.history: dict[str, list] = d.get("history") or {}   # appid -> [[time, final cents, discount %], ...]
        self.targets: dict[str, int] = d.get("targets") or {}    # appid -> cents
        self.alerted: dict[str, int] = d.get("alerted") or {}    # appid -> price we last alerted at
        self.currency: str = d.get("currency") or ""

    def _save(self):
        tmp = self.file.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps({"history": self.history, "targets": self.targets, "alerted": self.alerted,
                                       "currency": self.currency}), encoding="utf-8")
            tmp.replace(self.file)
        except OSError:
            pass

    def record(self, items: list[dict]) -> None:
        """Note today's prices; a point is added only when a price changes (or once a day to show it held)."""
        now = int(time.time())
        changed = False
        with self._lock:
            for it in items:
                p = it.get("price") or {}
                if p.get("free") or p.get("final") is None:
                    continue
                if p.get("currency") and p["currency"] != self.currency:
                    if self.currency:  # store region changed: old prices aren't comparable
                        self.history.clear()
                    self.currency = p["currency"]
                key = str(it["appid"])
                h = self.history.setdefault(key, [])
                pt = [now, int(p["final"]), int(p.get("discount") or 0)]
                if h and h[-1][1] == pt[1] and now - h[-1][0] < 86400:
                    continue
                if len(h) >= 2 and h[-1][1] == pt[1] == h[-2][1]:
                    h[-1] = pt  # same price as before: just move the latest point forward
                else:
                    h.append(pt)
                del h[:-self.MAX_POINTS]
                changed = True
            if changed:
                self._save()

    def set_target(self, appid: int, cents: int | None) -> None:
        with self._lock:
            key = str(appid)
            if cents and cents > 0:
                self.targets[key] = int(cents)
            else:
                self.targets.pop(key, None)
            self.alerted.pop(key, None)
            self._save()

    def view(self, appid: int) -> dict:
        key = str(appid)
        with self._lock:
            h = list(self.history.get(key) or [])
            return {"history": h, "target": self.targets.get(key), "currency": self.currency,
                    "low_seen": min((x[1] for x in h), default=None)}

    def due_targets(self, items: list[dict]) -> list[dict]:
        """Wishlist items at or under your target price that you haven't been told about at this price."""
        out = []
        with self._lock:
            for it in items:
                key = str(it["appid"])
                t, p = self.targets.get(key), it.get("price") or {}
                if t and p.get("final") is not None and not p.get("free") and p["final"] <= t:
                    if self.alerted.get(key) != p["final"]:
                        self.alerted[key] = p["final"]
                        out.append(it)
                elif key in self.alerted and (p.get("final") or 0) > (t or 0):
                    self.alerted.pop(key, None)  # it went back up: tell you again next time it drops
            if out:
                self._save()
        return out


class SaleWatcher:
    FIRST_CHECK = 120        # seconds after Cinder starts
    INTERVAL = 3 * 3600      # then every 3 hours

    def __init__(self, steam, config, data_dir: Path, notify, book: PriceBook | None = None):
        self.steam, self.config, self.notify = steam, config, notify
        self.book = book
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
            if self.config["sale_alerts"] or (self.book and self.book.targets):
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
        items = data.get("items") or []
        money = lambda p: f"{p['final'] / 100:.2f} {p.get('currency', '')}".strip()
        if self.book:
            self.book.record(items)
            for it in self.book.due_targets(items):
                self.notify("Price alert", f"{it['name']} is {money(it['price'])}, at or under your "
                            f"{self.book.targets.get(str(it['appid']), 0) / 100:.2f} target")
                log.info("price target hit: %s", it["name"])
        if not self.config["sale_alerts"]:
            return []
        lows = {}
        try:
            import augmented
            lows = augmented.price_lows([x["appid"] for x in items if (x.get("price") or {}).get("discount")], cc)
        except Exception as e:
            log.info("price lows skipped: %r", e)
        try:
            seen = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            seen = None
        fresh, now_seen = storeapi.new_sales(items, seen or {})
        self.file.write_text(json.dumps(now_seen), encoding="utf-8")
        if seen is None:
            return []  # first run: just remember what's on sale now, don't flood you
        if fresh:
            fresh.sort(key=lambda x: -(x["price"] or {}).get("discount", 0))
            def line(it):
                p = it["price"]
                low = (lows.get(it["appid"]) or {}).get("steam_low") or {}
                best = " · lowest ever" if low.get("cents") is not None and p["final"] <= low["cents"] else ""
                return f"{it['name']} -{p['discount']}% ({money(p)}){best}"
            if len(fresh) == 1:
                self.notify("Wishlist sale", line(fresh[0]))
            else:
                self.notify(f"{len(fresh)} wishlist games on sale", "; ".join(line(x) for x in fresh[:3])
                            + (f" and {len(fresh) - 3} more" if len(fresh) > 3 else ""))
            log.info("sale alert: %s", ", ".join(x["name"] for x in fresh))
        return fresh
