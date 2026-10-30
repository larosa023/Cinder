"""Extra game data from the Augmented Steam service (the browser extension's public API).

- How long to beat: HowLongToBeat's main story / main + extras / completionist times.
- Price lows: the lowest price a game has ever had (on Steam, and at any store), from IsThereAnyDeal.
- Similar games: SteamPeek's "more like this", used for recommendations.

Everything is cached, and any failure just means the extra isn't shown.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request

from cinderlog import log
from version import VERSION

BASE = "https://api.augmentedsteam.com"
STEAM_SHOP = 61  # IsThereAnyDeal's id for the Steam store
HEADERS = {"User-Agent": f"Cinder/{VERSION} (+https://github.com/larosa023/Cinder)", "Accept": "application/json"}

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()
_down_until = 0.0  # after the service fails, leave it alone for a bit


class Unavailable(Exception):
    pass


def _call(path: str, ttl: float, body: dict | None = None):
    global _down_until
    key = path + (json.dumps(body, sort_keys=True) if body else "")
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    if now < _down_until:
        raise Unavailable("service resting")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers={**HEADERS, **({"Content-Type": "application/json"} if data else {})},
                                 method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            out = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        if e.code == 404:  # nothing known about this game
            out = None
        else:
            _down_until = now + 120
            log.info("augmented steam %s: HTTP %s", path.split("?")[0], e.code)
            raise Unavailable(str(e.code)) from e
    except Exception as e:
        _down_until = now + 120
        log.info("augmented steam %s: %r", path.split("?")[0], e)
        raise Unavailable("unreachable") from e
    with _lock:
        _cache[key] = (now, out)
        if len(_cache) > 600:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:150]:
                _cache.pop(k, None)
    return out


def _num(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------ how long to beat

def hltb(appid: int) -> dict | None:
    """{"main": minutes, "extras": minutes, "complete": minutes, "url": ...} or None."""
    try:
        d = _call(f"/app/{int(appid)}/v2", ttl=12 * 3600)
    except Unavailable:
        return None
    h = (d or {}).get("hltb") if isinstance(d, dict) else None
    if not isinstance(h, dict):
        return None
    out = {"main": _num(h.get("story")), "extras": _num(h.get("extras")), "complete": _num(h.get("complete")),
           "url": h.get("url") if str(h.get("url", "")).startswith("https://howlongtobeat.com/") else ""}
    if not (out["main"] or out["extras"] or out["complete"]):
        return None
    return out


# ----------------------------------------------------------------- price lows

def _price(p):
    if not isinstance(p, dict):
        return None
    amt = p.get("amountInt")
    if amt is None and p.get("amount") is not None:
        amt = round(float(p["amount"]) * 100)
    return {"cents": int(amt), "currency": p.get("currency") or ""} if amt is not None else None


def _deal(x):
    if not isinstance(x, dict):
        return None
    price = _price(x.get("price"))
    if not price:
        return None
    return {
        **price,
        "regular": (_price(x.get("regular")) or {}).get("cents"),
        "cut": int(x.get("cut") or 0),
        "shop": ((x.get("shop") or {}).get("name") or ""),
        "when": x.get("timestamp") or "",
        "url": x.get("url") if str(x.get("url", "")).startswith("https://") else "",
    }


def price_lows(appids: list[int], cc: str) -> dict[int, dict]:
    """appid -> {"steam_low": deal, "any_low": deal, "best_now": deal, "history_url": str}."""
    appids = [int(a) for a in appids if a][:200]
    if not appids:
        return {}
    out: dict[int, dict] = {}
    cc = (cc or "US").upper()[:2]
    for shops, low_key, now_key in (([STEAM_SHOP], "steam_low", None), ([], "any_low", "best_now")):
        for i in range(0, len(appids), 50):
            chunk = appids[i:i + 50]
            try:
                d = _call("/prices/v2", ttl=6 * 3600, body={"country": cc, "apps": chunk, "subs": [], "bundles": [],
                                                            "voucher": False, "shops": shops})
            except Unavailable:
                return out
            for k, v in ((d or {}).get("prices") or {}).items():
                if not k.startswith("app/") or not isinstance(v, dict):
                    continue
                a = int(k[4:]) if k[4:].isdigit() else 0
                e = out.setdefault(a, {})
                e[low_key] = _deal(v.get("lowest"))
                if now_key:
                    e[now_key] = _deal(v.get("current"))
                    e["history_url"] = ((v.get("urls") or {}).get("history") or "")
    return out


# ---------------------------------------------------------------- similar games

def similar(appid: int, count: int = 15) -> list[dict]:
    """[{"appid", "name", "score"}] games like this one (SteamPeek)."""
    try:
        d = _call(f"/similar/{int(appid)}/v2?count={int(count)}", ttl=24 * 3600)
    except Unavailable:
        return []
    out = []
    for x in d if isinstance(d, list) else []:
        try:
            out.append({"appid": int(x.get("appid")), "name": str(x.get("title") or ""), "score": _num(x.get("score")) or 0})
        except (TypeError, ValueError, AttributeError):
            continue
    return out
