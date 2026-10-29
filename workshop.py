"""Steam Workshop: the mods and items you have, plus browsing a game's workshop.

What's installed comes from Steam's own files (steamapps/workshop/appworkshop_<appid>.acf
in every library folder). Titles, pictures and stats come from Steam's public
GetPublishedFileDetails endpoint (no key needed). Browsing uses the Web API with a key
(IPublishedFileService/QueryFiles), or the public workshop pages without one.

Subscribing and unsubscribing happen on the item's page in Steam (Cinder never handles
your login); updating an item you already have goes through Steam's own interface.
"""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

import storeapi
from steamlib import read_vdf

API = "https://api.steampowered.com"
COMMUNITY = "https://steamcommunity.com"

_details_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()
DETAILS_TTL = 6 * 3600


def _get(d: dict, key: str, default=None):
    """Case-insensitive dict lookup (Steam isn't consistent about key case)."""
    if key in d:
        return d[key]
    low = key.lower()
    for k, v in d.items():
        if k.lower() == low:
            return v
    return default


def _i(v, d=0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return d


# ------------------------------------------------------------------ installed

def installed(steam) -> dict[int, dict]:
    """{appid: {"size", "needs_update", "items": [...]}} for every game with workshop content."""
    me = str((steam.user() or {}).get("accountid") or "")
    out: dict[int, dict] = {}
    for lib in steam.library_dirs():
        wdir = lib / "steamapps" / "workshop"
        if not wdir.is_dir():
            continue
        for acf in wdir.glob("appworkshop_*.acf"):
            data = _get(read_vdf(acf), "AppWorkshop", {}) or {}
            appid = _i(_get(data, "appid")) or _i(acf.stem.split("_")[-1])
            if not appid:
                continue
            inst = _get(data, "WorkshopItemsInstalled", {}) or {}
            det = _get(data, "WorkshopItemDetails", {}) or {}
            items = []
            for fid, it in inst.items():
                if not fid.isdigit() or not isinstance(it, dict):
                    continue
                d = det.get(fid) if isinstance(det.get(fid), dict) else {}
                upd, latest = _i(_get(it, "timeupdated")), _i(_get(d, "latest_timeupdated"))
                sub = str(_get(d, "subscribedby", "") or "")
                folder = wdir / "content" / str(appid) / fid
                items.append({
                    "id": fid,
                    "size": _i(_get(it, "size")),
                    "updated": upd,
                    "needs_update": bool(latest and latest > upd),
                    "subscribed": bool(sub and sub != "0" and (not me or sub == me)),
                    "touched": _i(_get(d, "timetouched")),
                    "folder": str(folder) if folder.is_dir() else "",
                })
            if not items:
                continue
            entry = out.setdefault(appid, {"appid": appid, "size": 0, "needs_update": False, "items": [],
                                           "checked": 0})
            entry["items"] += items
            entry["size"] += _i(_get(data, "SizeOnDisk")) or sum(x["size"] for x in items)
            entry["needs_update"] |= _i(_get(data, "NeedsUpdate")) > 0 or any(x["needs_update"] for x in items)
            entry["checked"] = max(entry["checked"], _i(_get(data, "TimeLastFullCheck")))
    return out


# ------------------------------------------------------------------ details

def _post(url: str, form: dict, timeout: float = 15) -> dict:
    body = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(url, data=body, headers={**storeapi.HEADERS,
                                                         "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise storeapi.SteamDataError(f"Steam returned {e.code}") from e
    except Exception as e:
        raise storeapi.SteamDataError("Couldn't reach Steam") from e


def _text(raw: str) -> str:
    """Workshop descriptions are BBCode; keep the paragraphs, drop the markup."""
    raw = re.sub(r"\[\*\]", "\n• ", raw or "")
    lines = [storeapi._bbcode(l) for l in raw.replace("\r", "").split("\n")]
    out, blank = [], False
    for l in lines:
        if l:
            out.append(l)
            blank = False
        elif not blank and out:
            out.append("")
            blank = True
    return "\n".join(out).strip()


def _clean(d: dict) -> dict:
    tags = [t.get("tag") for t in d.get("tags") or [] if isinstance(t, dict) and t.get("tag")]
    return {
        "id": str(d.get("publishedfileid")),
        "title": d.get("title") or "Untitled item",
        "preview": d.get("preview_url") or "",
        "desc": _text(d.get("description") or d.get("file_description") or "")[:6000],
        "size": _i(d.get("file_size")),
        "created": _i(d.get("time_created")),
        "updated": _i(d.get("time_updated")),
        "subs": _i(d.get("lifetime_subscriptions") or d.get("subscriptions")),
        "current_subs": _i(d.get("subscriptions")),
        "favs": _i(d.get("lifetime_favorited") or d.get("favorited")),
        "views": _i(d.get("views")),
        "creator": str(d.get("creator") or ""),
        "appid": _i(d.get("consumer_app_id") or d.get("creator_app_id")),
        "tags": tags[:12],
        "score": (d.get("vote_data") or {}).get("score"),
        "ok": _i(d.get("result"), 1) == 1,
    }


def details(ids: list[str]) -> dict[str, dict]:
    """Titles, previews and stats for workshop items (cached for a few hours)."""
    ids = [str(i) for i in ids if str(i).isdigit()]
    now = time.time()
    out, todo = {}, []
    with _lock:
        for i in ids:
            hit = _details_cache.get(i)
            if hit and now - hit[0] < DETAILS_TTL:
                out[i] = hit[1]
            else:
                todo.append(i)
    for n in range(0, len(todo), 100):
        chunk = todo[n:n + 100]
        form = {"itemcount": len(chunk)}
        form.update({f"publishedfileids[{k}]": v for k, v in enumerate(chunk)})
        data = _post(f"{API}/ISteamRemoteStorage/GetPublishedFileDetails/v1/", form)
        for d in (data.get("response") or {}).get("publishedfiledetails") or []:
            c = _clean(d)
            with _lock:
                _details_cache[c["id"]] = (now, c)
            out[c["id"]] = c
    return out


# ------------------------------------------------------------------ browsing

SORTS = {  # our name: (QueryFiles query_type, community browsesort)
    "trend": (3, "trend"),
    "popular": (9, "totaluniquesubscribers"),
    "top": (0, "toprated"),
    "recent": (1, "mostrecent"),
    "updated": (21, "lastupdated"),
}


def _browse_api(appid: int, sort: str, q: str, page: int, key: str) -> list[str]:
    qt = 12 if q else SORTS.get(sort, SORTS["trend"])[0]
    params = {"key": key, "appid": appid, "query_type": qt, "page": page, "numperpage": 30,
              "return_metadata": 1, "return_previews": 1, "return_tags": 1, "filetype": 0}
    if q:
        params["search_text"] = q
    if sort == "trend" and not q:
        params["days"] = 7
    data = storeapi._fetch(f"{API}/IPublishedFileService/QueryFiles/v1/?" + urllib.parse.urlencode(params), ttl=900)
    files = (data.get("response") or {}).get("publishedfiledetails") or []
    with _lock:
        for d in files:
            c = _clean(d)
            _details_cache[c["id"]] = (time.time(), c)
    return [str(d.get("publishedfileid")) for d in files if d.get("publishedfileid")]


_ITEM_RE = re.compile(r'sharedfiles/filedetails/\?id=(\d+)')


def _browse_page(appid: int, sort: str, q: str, page: int) -> list[str]:
    params = {"appid": appid, "browsesort": "textsearch" if q else SORTS.get(sort, SORTS["trend"])[1],
              "section": "readytouseitems", "p": page, "numperpage": 30}
    if q:
        params["searchtext"] = q
    if sort == "trend" and not q:
        params["days"] = 7
    text = storeapi._fetch(f"{COMMUNITY}/workshop/browse/?" + urllib.parse.urlencode(params), ttl=900, as_json=False)
    seen, ids = set(), []
    # Only the item grid: start at the first workshopItem block.
    start = text.find('class="workshopItem')
    for m in _ITEM_RE.finditer(text, start if start > 0 else 0):
        i = m.group(1)
        if i not in seen:
            seen.add(i)
            ids.append(i)
    return ids[:30]


def browse(appid: int, sort: str = "trend", q: str = "", page: int = 1, key: str = "") -> dict:
    q = q.strip()[:100]
    ids: list[str] = []
    if key:
        try:
            ids = _browse_api(appid, sort, q, page, key)
        except storeapi.SteamDataError:
            ids = []
    if not ids:
        ids = _browse_page(appid, sort, q, page)
    info = details(ids) if ids else {}
    items = [info[i] for i in ids if i in info and info[i]["ok"]]
    return {"items": items, "page": page, "more": len(ids) >= 20}


def item_url(fid: str) -> str:
    return f"{COMMUNITY}/sharedfiles/filedetails/?id={int(fid)}"

