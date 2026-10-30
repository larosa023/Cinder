"""Steam store / community data for the Store, Wishlist, Friends and Profile tabs.

Everything here uses Steam's public endpoints (no login). Anything that needs
your account (buying, chat, wishlist edits) is handed to the real Steam client
through steam:// links instead.

An optional Steam Web API key (https://steamcommunity.com/dev/apikey) unlocks
live friend status, Steam level and your full owned-games list.
"""

from __future__ import annotations

import html
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

from version import VERSION

STEAMID64_BASE = 76561197960265728
STORE = "https://store.steampowered.com"
API = "https://api.steampowered.com"
COMMUNITY = "https://steamcommunity.com"
AVATAR = "https://avatars.steamstatic.com/{hash}_full.jpg"
DEFAULT_AVATAR_HASH = "0" * 40
HEADERS = {
    "User-Agent": f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cinder/{VERSION}",
    "Accept-Language": "en-US,en;q=0.8",
    # Skip the age gate on mature store pages.
    "Cookie": "birthtime=0; lastagecheckage=1-0-1990; mature_content=1; wants_mature_content=1",
}


class SteamDataError(Exception):
    pass


# --------------------------------------------------------------------- fetching

_cache: dict[str, tuple[float, object]] = {}
_cache_lock = threading.Lock()


def _fetch(url: str, ttl: float = 600, as_json: bool = True, timeout: float = 12):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(url)
        if hit and now - hit[0] < ttl:
            return hit[1]
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        raise SteamDataError(f"Steam returned {e.code}") from e
    except Exception as e:
        raise SteamDataError("Couldn't reach Steam") from e
    try:
        data = json.loads(raw) if as_json else raw.decode("utf-8", "replace")
    except ValueError as e:
        raise SteamDataError("Steam sent something unexpected. Try again in a minute") from e
    if as_json and not isinstance(data, (dict, list)):
        raise SteamDataError("Steam sent something unexpected. Try again in a minute")
    with _cache_lock:
        _cache[url] = (now, data)
        if len(_cache) > 800:  # keep memory small
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:200]:
                _cache.pop(k, None)
    return data


def _q(**params) -> str:
    return urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})


def strip_html(s: str | None) -> str:
    if not s:
        return ""
    s = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</h\d>", "\n", s)
    s = re.sub(r"(?i)<li[^>]*>", "• ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
    return s.strip()


def _int(v, d=0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return d


def _price(currency, final, initial=None, discount=0, free=False) -> dict | None:
    if free:
        return {"free": True}
    if final is None:
        return None
    return {
        "currency": currency or "USD",
        "final": _int(final),
        "initial": _int(initial if initial is not None else final),
        "discount": _int(discount),
    }


# ------------------------------------------------------------------------ store

SECTIONS = [
    ("specials", "Special offers"),
    ("top_sellers", "Top sellers"),
    ("new_releases", "New releases"),
    ("coming_soon", "Coming soon"),
]


def _store_item(it: dict) -> dict:
    appid = _int(it.get("id") or it.get("appid"))
    return {
        "appid": appid,
        "name": it.get("name") or f"App {appid}",
        "image": it.get("header_image") or it.get("large_capsule_image") or "",
        "capsule": it.get("large_capsule_image") or it.get("header_image") or "",
        "price": _price(
            it.get("currency"), it.get("final_price"), it.get("original_price"),
            it.get("discount_percent"),
            free=it.get("final_price") == 0 and not it.get("discounted"),
        ),
    }


def store_home(cc: str) -> dict:
    data = _fetch(f"{STORE}/api/featuredcategories?{_q(cc=cc, l='english')}", ttl=900)
    sections = []
    for key, title in SECTIONS:
        node = data.get(key) if isinstance(data, dict) else None
        items = (node or {}).get("items") or []
        seen, out = set(), []
        for it in items:
            if it.get("type", 0) not in (0, "0", None):
                continue  # skip bundles/packages
            item = _store_item(it)
            if item["appid"] and item["appid"] not in seen:
                seen.add(item["appid"])
                out.append(item)
        if out:
            sections.append({"id": key, "title": title, "items": out})
    if not sections:
        raise SteamDataError("The store didn't return anything")
    return {"sections": sections}


def store_search(term: str, cc: str) -> dict:
    term = term.strip()[:100]
    if not term:
        return {"items": []}
    data = _fetch(f"{STORE}/api/storesearch/?{_q(term=term, l='english', cc=cc)}", ttl=300)
    out = []
    for it in data.get("items") or []:
        if it.get("type") not in (None, "app"):
            continue
        p = it.get("price")
        appid = _int(it.get("id"))
        out.append({
            "appid": appid,
            "name": it.get("name") or f"App {appid}",
            "image": f"https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/{appid}/header.jpg",
            "price": _price(p.get("currency"), p.get("final"), p.get("initial"),
                            round(100 - 100 * p["final"] / p["initial"]) if p.get("initial") else 0)
            if isinstance(p, dict) else None,
            "metascore": _int(it.get("metascore")) or None,
        })
    return {"items": out, "total": _int(data.get("total"), len(out))}


def app_details(appid: int, cc: str) -> dict:
    data = _fetch(f"{STORE}/api/appdetails?{_q(appids=appid, cc=cc, l='english')}", ttl=3600)
    node = (data or {}).get(str(appid)) or {}
    if not node.get("success") or not isinstance(node.get("data"), dict):
        raise SteamDataError("This game has no store page in your region")
    d = node["data"]
    po = d.get("price_overview") or {}
    return {
        "appid": appid,
        "name": d.get("name", ""),
        "type": d.get("type", "game"),
        "short": strip_html(d.get("short_description")),
        "about": strip_html(d.get("about_the_game") or d.get("detailed_description"))[:6000],
        "header": d.get("header_image", ""),
        "background": d.get("background_raw") or d.get("background") or "",
        "developers": d.get("developers") or [],
        "publishers": d.get("publishers") or [],
        "release": (d.get("release_date") or {}).get("date", ""),
        "coming_soon": bool((d.get("release_date") or {}).get("coming_soon")),
        "genres": [g.get("description") for g in d.get("genres") or [] if g.get("description")],
        "categories": [c.get("description") for c in d.get("categories") or [] if c.get("description")][:8],
        "metacritic": (d.get("metacritic") or {}).get("score"),
        "recommendations": (d.get("recommendations") or {}).get("total"),
        "platforms": [k for k, v in (d.get("platforms") or {}).items() if v],
        "price": _price(po.get("currency"), po.get("final"), po.get("initial"),
                        po.get("discount_percent"), free=bool(d.get("is_free"))) if (po or d.get("is_free")) else None,
        "screenshots": [{"thumb": s.get("path_thumbnail"), "full": s.get("path_full")}
                        for s in (d.get("screenshots") or [])[:16]],
        "dlc_count": len(d.get("dlc") or []),
        "dlc": [int(x) for x in (d.get("dlc") or [])][:120],
        "website": d.get("website") or "",
        "workshop": any(_int(c.get("id")) == 30 for c in d.get("categories") or []),  # Steam Workshop
    }


def prices(appids: list[int], cc: str) -> dict[int, dict | None]:
    out: dict[int, dict | None] = {}
    for i in range(0, len(appids), 50):
        chunk = appids[i:i + 50]
        try:
            data = _fetch(f"{STORE}/api/appdetails?{_q(appids=','.join(map(str, chunk)), cc=cc, filters='price_overview')}", ttl=1800)
        except SteamDataError:
            continue
        for aid in chunk:
            node = (data or {}).get(str(aid)) or {}
            po = node.get("data") if isinstance(node.get("data"), dict) else {}
            po = po.get("price_overview") if po else None
            out[aid] = _price(po.get("currency"), po.get("final"), po.get("initial"), po.get("discount_percent")) if po else None
    return out


def _names(appids: list[int], cc: str) -> dict[int, str]:
    """App names via IStoreBrowseService, falling back to per-app appdetails."""
    names: dict[int, str] = {}
    for i in range(0, len(appids), 100):
        chunk = appids[i:i + 100]
        req = {
            "ids": [{"appid": a} for a in chunk],
            "context": {"language": "english", "country_code": cc},
            "data_request": {"include_basic_info": True},
        }
        try:
            data = _fetch(f"{API}/IStoreBrowseService/GetItems/v1/?{_q(input_json=json.dumps(req))}", ttl=86400)
            for it in (data.get("response") or {}).get("store_items") or []:
                if it.get("name"):
                    names[_int(it.get("appid"))] = it["name"]
        except SteamDataError:
            pass
    now = time.time()
    missing = [a for a in appids if a not in names and _no_name.get(a, 0) < now][:20]
    if missing:
        def one(a):
            try:
                return a, app_details(a, cc)["name"]
            except Exception:
                return a, None
        with ThreadPoolExecutor(4) as ex:
            for a, n in ex.map(one, missing):
                if n:
                    names[a] = n
                else:
                    _no_name[a] = now + 86400  # delisted or hidden: don't ask again today
    return names


_no_name: dict[int, float] = {}


# --------------------------------------------------------------------- wishlist

def wishlist(steamid: str, cc: str, api_key: str = "") -> dict:
    data = _fetch(f"{API}/IWishlistService/GetWishlist/v1/?{_q(steamid=steamid, key=api_key or None)}", ttl=300)
    items = (data.get("response") or {}).get("items") or []
    if not items:
        return {"items": [], "private": True}
    ids = [_int(i.get("appid")) for i in items if i.get("appid")]
    names = _names(ids, cc)
    price = prices(ids, cc)
    out = []
    for i in items:
        a = _int(i.get("appid"))
        out.append({
            "appid": a,
            "name": names.get(a) or f"App {a}",
            "priority": _int(i.get("priority")),
            "added": _int(i.get("date_added")),
            "price": price.get(a),
            "image": f"https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/{a}/header.jpg",
        })
    return {"items": out, "private": False}


# ---------------------------------------------------------------------- profile

PERSONA = {0: "Offline", 1: "Online", 2: "Busy", 3: "Away", 4: "Snooze", 5: "Looking to trade", 6: "Looking to play"}


def _xml_text(root, tag):
    el = root.find(tag)
    return (el.text or "").strip() if el is not None and el.text else ""


def profile(steamid: str, api_key: str = "") -> dict:
    raw = _fetch(f"{COMMUNITY}/profiles/{steamid}/?xml=1", ttl=300, as_json=False)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        raise SteamDataError("Couldn't read this profile") from e
    if root.tag == "response":
        raise SteamDataError(_xml_text(root, "error") or "Profile not found")
    state = strip_html(_xml_text(root, "stateMessage"))
    p = {
        "steamid": steamid,
        "name": _xml_text(root, "steamID"),
        "avatar": _xml_text(root, "avatarFull"),
        "online": _xml_text(root, "onlineState"),  # online / in-game / offline
        "status": state.replace("\n", " · "),
        "member_since": _xml_text(root, "memberSince"),
        "location": _xml_text(root, "location"),
        "realname": _xml_text(root, "realname"),
        "summary": strip_html(_xml_text(root, "summary"))[:3000],
        "headline": _xml_text(root, "headline"),
        "public": _xml_text(root, "privacyState") == "public",
        "vac_banned": _xml_text(root, "vacBanned") == "1",
        "most_played": [],
        "level": None,
        "game_count": None,
    }
    mp = root.find("mostPlayedGames")
    if mp is not None:
        for g in mp.findall("mostPlayedGame")[:6]:
            link = _xml_text(g, "gameLink")
            m = re.search(r"/app/(\d+)", link)
            p["most_played"].append({
                "appid": _int(m.group(1)) if m else 0,
                "name": _xml_text(g, "gameName"),
                "hours_recent": _xml_text(g, "hoursPlayed"),
                "hours_total": _xml_text(g, "hoursOnRecord"),
            })
    if api_key:
        try:
            lvl = _fetch(f"{API}/IPlayerService/GetSteamLevel/v1/?{_q(key=api_key, steamid=steamid)}", ttl=600)
            p["level"] = (lvl.get("response") or {}).get("player_level")
        except SteamDataError:
            pass
        try:
            owned = _fetch(f"{API}/IPlayerService/GetOwnedGames/v1/?{_q(key=api_key, steamid=steamid)}", ttl=600)
            p["game_count"] = (owned.get("response") or {}).get("game_count")
        except SteamDataError:
            pass
    return p


# ---------------------------------------------------------------------- friends

def summaries(api_key: str, steamids: list[str]) -> dict[str, dict]:
    out = {}
    for i in range(0, len(steamids), 100):
        chunk = steamids[i:i + 100]
        data = _fetch(f"{API}/ISteamUser/GetPlayerSummaries/v2/?{_q(key=api_key, steamids=','.join(chunk))}", ttl=45)
        for pl in (data.get("response") or {}).get("players") or []:
            out[pl.get("steamid")] = pl
    return out


def friends(local_friends: dict, my_steamid: str, api_key: str = "") -> dict:
    """local_friends: the 'friends' node from localconfig.vdf (Steam's own cache)."""
    people: dict[str, dict] = {}
    for k, v in (local_friends or {}).items():
        if not k.isdigit() or not isinstance(v, dict) or not v.get("name"):
            continue
        sid = str(int(k) + STEAMID64_BASE)
        if sid == my_steamid:
            continue
        h = (v.get("avatar") or "").strip()
        people[sid] = {
            "steamid": sid,
            "name": v.get("name"),
            "avatar": AVATAR.format(hash=h if re.fullmatch(r"[0-9a-f]{40}", h or "") else DEFAULT_AVATAR_HASH),
            "state": None, "status": "", "game": "", "game_appid": 0, "last_online": 0,
        }
    live = False
    error = None
    if api_key and my_steamid:
        try:
            fl = _fetch(f"{API}/ISteamUser/GetFriendList/v1/?{_q(key=api_key, steamid=my_steamid, relationship='friend')}", ttl=60)
            ids = [f["steamid"] for f in (fl.get("friendslist") or {}).get("friends") or []]
            info = summaries(api_key, ids)
            people = {}
            for sid in ids:
                pl = info.get(sid, {})
                st = _int(pl.get("personastate"))
                people[sid] = {
                    "steamid": sid,
                    "name": pl.get("personaname") or sid,
                    "avatar": pl.get("avatarfull") or pl.get("avatarmedium") or AVATAR.format(hash=DEFAULT_AVATAR_HASH),
                    "state": "ingame" if pl.get("gameextrainfo") else ("online" if st else "offline"),
                    "status": "In game" if pl.get("gameextrainfo") else PERSONA.get(st, "Online"),
                    "game": pl.get("gameextrainfo") or "",
                    "game_appid": _int(pl.get("gameid")),
                    "last_online": _int(pl.get("lastlogoff")),
                }
            live = True
        except SteamDataError as e:
            error = f"Live status unavailable ({e}). Showing Steam's local friend cache."
    return {"friends": sorted(people.values(), key=lambda p: p["name"].lower()), "live": live, "error": error}


def owned_games(api_key: str, steamid: str) -> list[dict]:
    data = _fetch(f"{API}/IPlayerService/GetOwnedGames/v1/?{_q(key=api_key, steamid=steamid, include_appinfo=1, include_played_free_games=1)}", ttl=600)
    out = []
    for g in (data.get("response") or {}).get("games") or []:
        out.append({
            "appid": _int(g.get("appid")),
            "name": g.get("name") or f"App {g.get('appid')}",
            "playtime": _int(g.get("playtime_forever")),
            "lastplayed": _int(g.get("rtime_last_played")),
        })
    return out


# --------------------------------------------------------------------- presence

def visible_status(steamid: str, api_key: str = "") -> dict:
    """What other people currently see for this account: online / away / ingame / offline.

    Uses the Web API when a key is set (it distinguishes Away), otherwise the public
    profile. Invisible shows as offline to everyone else, which is the point.
    Always fetched fresh (Steam's own servers can still lag by up to a minute).
    """
    bust = int(time.time())
    if api_key:
        try:
            data = _fetch(f"{API}/ISteamUser/GetPlayerSummaries/v2/?{_q(key=api_key, steamids=steamid)}&_={bust}", ttl=0)
            players = (data.get("response") or {}).get("players") or []
            if players:
                pl = players[0]
                st = _int(pl.get("personastate"))
                state = ("ingame" if pl.get("gameextrainfo") else
                         "offline" if st == 0 else "away" if st in (3, 4) else "online")
                return {"state": state, "source": "api"}
        except SteamDataError:
            pass  # fall back to the profile
    raw = _fetch(f"{COMMUNITY}/profiles/{steamid}/?xml=1&_={bust}", ttl=0, as_json=False)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        raise SteamDataError("Couldn't read your profile") from e
    online = _xml_text(root, "onlineState")
    if not online:
        raise SteamDataError("Your profile doesn't show online status publicly")
    msg = strip_html(_xml_text(root, "stateMessage")).lower()
    state = ("ingame" if online == "in-game" else "offline" if online == "offline" else
             "away" if "away" in msg or "snooze" in msg else "online")
    return {"state": state, "source": "profile"}


# ---------------------------------------------------------------- game pages

def _bbcode(text: str) -> str:
    """Steam news uses BBCode and HTML; reduce it to plain text."""
    text = re.sub(r"\[/?(?:b|i|u|h\d|list|olist|\*|quote|code|strike|spoiler|table|tr|td|th|hr|noparse)[^\]]*\]", " ", text or "")
    text = re.sub(r"\[url=[^\]]*\](.*?)\[/url\]", r"\1", text)
    text = re.sub(r"\[(?:img|previewyoutube|video)[^\]]*\].*?\[/(?:img|previewyoutube|video)\]", " ", text, flags=re.S)
    text = re.sub(r"\[/?[a-z]+[^\]]*\]", " ", text)
    text = re.sub(r"\{STEAM_CLAN_IMAGE\}\S*", " ", text)
    return re.sub(r"\s+", " ", strip_html(text)).strip()


def _review_text(raw: str) -> str:
    """Reviews are BBCode; keep the paragraphs, drop the markup."""
    raw = re.sub(r"\[\*\]", "\n• ", raw or "")
    out, blank = [], False
    for line in raw.replace("\r", "").split("\n"):
        t = _bbcode(line)
        if t:
            out.append(t)
            blank = False
        elif out and not blank:
            out.append("")
            blank = True
    return "\n".join(out).strip()


REVIEW_FILTERS = {  # ours: (filter, review_type)
    "helpful": ("all", "all"), "recent": ("recent", "all"),
    "positive": ("all", "positive"), "negative": ("all", "negative"),
}


def reviews(appid: int, sort: str = "helpful", cursor: str = "*", lang: str = "english") -> dict:
    """Steam user reviews: the score summary plus a page of reviews (20 at a time)."""
    f, rtype = REVIEW_FILTERS.get(sort, REVIEW_FILTERS["helpful"])
    q = {"json": 1, "filter": f, "review_type": rtype, "language": lang, "purchase_type": "all",
         "num_per_page": 20, "cursor": cursor or "*"}
    if f == "all":
        q["day_range"] = 365  # "most helpful" over the last year, like the store page
    data = _fetch(f"{STORE}/appreviews/{int(appid)}?{urllib.parse.urlencode(q)}", ttl=900)
    if not isinstance(data, dict) or data.get("success") != 1:
        raise SteamDataError("Steam didn't return reviews for this game")
    out = {"cursor": data.get("cursor") or "", "reviews": []}
    qs = data.get("query_summary") or {}
    if "total_reviews" in qs:
        pos, neg = _int(qs.get("total_positive")), _int(qs.get("total_negative"))
        out["summary"] = {"desc": qs.get("review_score_desc") or "", "score": _int(qs.get("review_score")),
                          "positive": pos, "negative": neg, "total": _int(qs.get("total_reviews")),
                          "pct": round(100 * pos / (pos + neg)) if pos + neg else None}
    for r in data.get("reviews") or []:
        a = r.get("author") or {}
        out["reviews"].append({
            "id": str(r.get("recommendationid") or ""),
            "up": bool(r.get("voted_up")),
            "text": _review_text(r.get("review") or "")[:5000],
            "helpful": _int(r.get("votes_up")), "funny": _int(r.get("votes_funny")),
            "hours": round(_int(a.get("playtime_forever")) / 60, 1),
            "hours_at": round(_int(a.get("playtime_at_review")) / 60, 1),
            "date": _int(r.get("timestamp_created")), "updated": _int(r.get("timestamp_updated")),
            "early": bool(r.get("written_during_early_access")), "free": bool(r.get("received_for_free")),
            "author_reviews": _int(a.get("num_reviews")),
        })
    return out


def review_summary(appid: int, lang: str = "all") -> dict | None:
    """Just the score ("Very Positive", 92% of 45,123), across every language like the store shows."""
    q = {"json": 1, "language": lang, "purchase_type": "all", "num_per_page": 0}
    data = _fetch(f"{STORE}/appreviews/{int(appid)}?{urllib.parse.urlencode(q)}", ttl=3600)
    qs = (data or {}).get("query_summary") or {} if isinstance(data, dict) else {}
    if not qs or not _int(qs.get("total_reviews")):
        return None
    pos, neg = _int(qs.get("total_positive")), _int(qs.get("total_negative"))
    return {"desc": qs.get("review_score_desc") or "", "score": _int(qs.get("review_score")), "positive": pos,
            "negative": neg, "total": _int(qs.get("total_reviews")), "pct": round(100 * pos / (pos + neg)) if pos + neg else None}


def news(appid: int, count: int = 8) -> list[dict]:
    data = _fetch(f"{API}/ISteamNews/GetNewsForApp/v2/?{_q(appid=appid, count=count, maxlength=600, format='json')}", ttl=1800)
    out = []
    for it in (data.get("appnews") or {}).get("newsitems") or []:
        out.append({
            "title": strip_html(it.get("title")),
            "url": it.get("url") or "",
            "date": _int(it.get("date")),
            "source": it.get("feedlabel") or "",
            "official": it.get("feedname") == "steam_community_announcements",
            "patch": "patchnotes" in (it.get("tags") or []),
            "text": _bbcode(it.get("contents"))[:500],
        })
    return out


def achievements(steamid: str, appid: int, api_key: str = "") -> dict:
    """Your achievements for a game: unlocked state, icons, descriptions, global rarity."""
    items: list[dict] = []
    if api_key:
        try:
            mine = _fetch(f"{API}/ISteamUserStats/GetPlayerAchievements/v1/?{_q(key=api_key, steamid=steamid, appid=appid, l='english')}", ttl=120)
            schema = _fetch(f"{API}/ISteamUserStats/GetSchemaForGame/v2/?{_q(key=api_key, appid=appid, l='english')}", ttl=86400)
            got = {a["apiname"]: a for a in (mine.get("playerstats") or {}).get("achievements") or []}
            for a in ((schema.get("game") or {}).get("availableGameStats") or {}).get("achievements") or []:
                m = got.get(a.get("name"), {})
                unlocked = bool(m.get("achieved"))
                items.append({"id": a.get("name"), "name": a.get("displayName") or a.get("name"),
                              "desc": a.get("description") or ("Hidden achievement" if a.get("hidden") else ""),
                              "icon": a.get("icon") if unlocked else a.get("icongray"),
                              "unlocked": unlocked, "time": _int(m.get("unlocktime"))})
        except SteamDataError:
            items = []
    if not items:
        raw = _fetch(f"{COMMUNITY}/profiles/{steamid}/stats/{appid}/achievements/?xml=1&l=english", ttl=120, as_json=False)
        try:
            root = ET.fromstring(raw)
        except ET.ParseError as e:
            raise SteamDataError("This game has no achievements, or your game details are private") from e
        err = _xml_text(root, "error")
        if err or root.find("achievements") is None:
            raise SteamDataError("This game has no achievements, or your game details are private")
        for a in root.find("achievements"):
            unlocked = a.get("closed") == "1"
            items.append({"id": _xml_text(a, "apiname"), "name": _xml_text(a, "name"),
                          "desc": _xml_text(a, "description"),
                          "icon": _xml_text(a, "iconClosed") if unlocked else _xml_text(a, "iconOpen"),
                          "unlocked": unlocked, "time": _int(_xml_text(a, "unlockTimestamp"))})
    if not items:
        raise SteamDataError("This game has no achievements")
    try:
        g = _fetch(f"{API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?{_q(gameid=appid)}", ttl=86400)
        pct = {x.get("name", "").lower(): float(x.get("percent") or 0)
               for x in (g.get("achievementpercentages") or {}).get("achievements") or []}
        for it in items:
            it["percent"] = round(pct.get((it["id"] or "").lower(), 0), 1) if pct else None
    except (SteamDataError, ValueError):
        pass
    items.sort(key=lambda x: (not x["unlocked"], -(x["time"] or 0) if x["unlocked"] else -(x.get("percent") or 0)))
    return {"total": len(items), "unlocked": sum(1 for x in items if x["unlocked"]), "items": items}


def dlc(appid: int, cc: str, installed: set[int]) -> list[dict]:
    """The game's DLC from the store, with price and whether it's installed."""
    data = _fetch(f"{STORE}/api/appdetails?{_q(appids=appid, cc=cc, l='english')}", ttl=3600)
    node = (data or {}).get(str(appid)) or {}
    ids = [int(x) for x in ((node.get("data") or {}).get("dlc") or [])][:120]
    if not ids:
        return []
    names = _names(ids, cc)
    price = prices(ids, cc)
    out = [{"appid": i, "name": names.get(i) or f"DLC {i}", "installed": i in installed, "price": price.get(i),
            "image": f"https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/{i}/header.jpg"} for i in ids]
    out.sort(key=lambda d: (not d["installed"], d["name"].lower()))
    return out


# ----------------------------------------------------------------- sale alerts

def new_sales(wishlist_items: list[dict], seen: dict) -> tuple[list[dict], dict]:
    """Wishlist items newly on sale (or on a deeper sale) since last time."""
    fresh, now_seen = [], {}
    for it in wishlist_items:
        p = it.get("price") or {}
        d = _int(p.get("discount"))
        if d <= 0:
            continue
        key = str(it["appid"])
        now_seen[key] = d
        if d > _int(seen.get(key)):
            fresh.append(it)
    return fresh, now_seen
