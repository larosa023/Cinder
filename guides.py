"""Steam Community guides (achievement guides first), read and cleaned up for showing inside Cinder.

Also: descriptions of hidden achievements, from the stats schema Steam keeps on your PC
(appcache/stats/UserGameStatsSchema_<appid>.bin) for games you've played.
"""

from __future__ import annotations

import html as htmllib
import re
import urllib.parse
from html.parser import HTMLParser
from pathlib import Path

from cinderlog import log

COMMUNITY = "https://steamcommunity.com"
IMG_HOSTS = re.compile(r"^https://([a-z0-9-]+\.)*(steamusercontent\.com|steamuserimages-a\.akamaihd\.net|steamstatic\.com|akamaihd\.net|steampowered\.com)/", re.I)


# ----------------------------------------------------------------- guide lists

def list_url(appid: int, achievements: bool = True, page: int = 1) -> str:
    q = {"browsefilter": "toprated", "l": "english", "p": page}
    if achievements:
        q["requiredtags[]"] = "Achievements"
    return f"{COMMUNITY}/app/{int(appid)}/guides/?{urllib.parse.urlencode(q)}"


def _text(s: str) -> str:
    s = re.sub(r"<br\s*/?>", "\n", s or "", flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"[ \t]+", " ", htmllib.unescape(s)).strip()


def parse_list(page: str) -> list[dict]:
    """Guides on a Community guides page: id, title, short description, preview image, stars."""
    out, seen = [], set()
    parts = re.split(r'(?=<a [^>]*href="https://steamcommunity\.com/sharedfiles/filedetails/\?id=\d+)', page or "")
    for c in parts[1:]:
        m = re.match(r'<a [^>]*href="https://steamcommunity\.com/sharedfiles/filedetails/\?id=(\d+)', c)
        if not m or m.group(1) in seen:
            continue
        title = re.search(r'class="workshopItemTitle[^"]*"[^>]*>(.*?)</div>', c, re.S)
        if not title:
            continue
        seen.add(m.group(1))
        desc = re.search(r'class="workshopItemShortDesc[^"]*"[^>]*>(.*?)</div>', c, re.S)
        img = re.search(r'<img[^>]+class="workshopItemPreviewImage[^"]*"[^>]+src="([^"]+)"', c) or \
            re.search(r'<img[^>]+src="([^"]+)"[^>]+class="workshopItemPreviewImage', c)
        stars = re.search(r'(\d)-star', c)
        out.append({
            "id": m.group(1), "title": _text(title.group(1))[:200],
            "desc": _text(desc.group(1))[:300] if desc else "",
            "image": img.group(1) if img and IMG_HOSTS.match(img.group(1)) else "",
            "stars": int(stars.group(1)) if stars else 0,
        })
    return out


# ------------------------------------------------------------ one guide, cleaned

ALLOWED = {"b", "strong", "i", "em", "u", "br", "p", "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "hr",
           "table", "tr", "td", "th", "tbody", "thead", "div", "span", "a", "img", "s", "code", "pre"}
DROP = {"script", "style", "noscript", "iframe", "object", "svg", "form", "button", "input", "select", "textarea"}
VOID = {"br", "hr", "img"}


class _Clean(HTMLParser):
    """Keeps text and simple formatting from Steam's guide markup; everything else goes."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0
        self.stack: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in DROP:
            self.skip += 1
            return
        if self.skip or tag not in ALLOWED:
            return
        a = dict(attrs)
        if tag == "img":
            src = a.get("src") or ""
            if IMG_HOSTS.match(src):
                self.out.append(f'<img loading="lazy" alt="" src="{htmllib.escape(src)}">')
            return
        if tag == "a":
            href = a.get("href") or ""
            m = re.search(r"[?&](?:u|url)=([^&]+)", href) if "linkfilter" in href else None
            if m:
                href = urllib.parse.unquote(m.group(1))
            ok = re.match(r"^https?://", href)
            self.out.append(f'<a href="#" data-url="{htmllib.escape(href)}">' if ok else "<a>")
            self.stack.append("a")
            return
        if tag in ("div", "span"):
            cls = a.get("class") or ""
            if tag == "div" and "bb_h1" in cls:
                tag = "h3"
            elif tag == "div" and re.search(r"bb_h[23]", cls):
                tag = "h4"
            elif tag == "div" and "bb_code" in cls:
                tag = "pre"
            elif tag == "div" and "bb_quote" in cls:
                tag = "blockquote"
            elif tag == "span" and "bb_spoiler" in cls:
                self.out.append('<span class="spoiler">')
                self.stack.append("span")
                return
            else:
                self.stack.append("")  # dropped wrapper
                if tag == "div":
                    self.out.append("<br>") if self.out and not self.out[-1].endswith(">") else None
                return
        if tag in VOID:
            self.out.append(f"<{tag}>")
            return
        self.out.append(f"<{tag}>")
        self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in DROP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip or tag not in ALLOWED or tag in VOID:
            return
        if self.stack:
            t = self.stack.pop()
            if t:
                self.out.append(f"</{t}>")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(htmllib.escape(data))

    def result(self) -> str:
        while self.stack:
            t = self.stack.pop()
            if t:
                self.out.append(f"</{t}>")
        s = "".join(self.out)
        s = re.sub(r"(<br>\s*){3,}", "<br><br>", s)
        return s.strip()


def clean_html(fragment: str) -> str:
    p = _Clean()
    try:
        p.feed(fragment or "")
        p.close()
    except Exception:
        return htmllib.escape(_text(fragment))
    return p.result()


def _inner(page: str, cls: str) -> list[str]:
    """Inner HTML of every <div class="... cls ...">, with nested divs balanced."""
    out = []
    for m in re.finditer(r'<div[^>]*class="(?:[^"]*\s)?' + re.escape(cls) + r'(?:\s[^"]*)?"[^>]*>', page):
        i, depth = m.end(), 1
        for t in re.finditer(r"<(/?)div\b[^>]*>", page[i:]):
            depth += -1 if t.group(1) else 1
            if depth == 0:
                out.append(page[i:i + t.start()])
                break
    return out


def parse_guide(page: str, gid: str) -> dict:
    title = (_inner(page, "workshopItemTitle") or [""])[0]
    desc = (_inner(page, "guideTopDescription") or [""])[0]
    titles = _inner(page, "subSectionTitle")
    bodies = _inner(page, "subSectionDesc")
    sections = []
    for i, body in enumerate(bodies):
        sections.append({"title": _text(titles[i]) if i < len(titles) else "", "html": clean_html(body)})
    author = re.search(r'class="friendBlockContent"[^>]*>\s*([^<]+)', page)
    rating = re.search(r'(\d)-star_large', page)
    if not sections and not title:
        raise ValueError("not a guide page")
    return {
        "id": gid, "title": _text(title)[:300], "intro": clean_html(desc), "sections": sections[:200],
        "author": _text(author.group(1))[:80] if author else "", "stars": int(rating.group(1)) if rating else 0,
        "url": f"{COMMUNITY}/sharedfiles/filedetails/?id={gid}",
    }


def guide_url(gid: str) -> str:
    return f"{COMMUNITY}/sharedfiles/filedetails/?id={gid}&l=english"


# ---------------------------------------------------- tips for one achievement

def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", htmllib.unescape(s or "").lower()).strip()


def tips_for(guides: list[dict], name: str, limit: int = 3) -> list[dict]:
    """Bits of guides that talk about the achievement called `name`."""
    key = _norm(name)
    if len(key) < 3:
        return []
    out, seen = [], set()
    for g in guides:
        if g["id"] in seen:
            continue
        seen.add(g["id"])
        for s in g["sections"]:
            if key and key == _norm(s["title"]) or (len(key) > 5 and key in _norm(s["title"])):
                out.append({"guide": g["id"], "guide_title": g["title"], "section": s["title"], "html": s["html"][:6000]})
                break
            chunks = re.split(r"(?:<br>\s*){2,}|(?=<h[34]>)", s["html"])
            for i, ch in enumerate(chunks):
                if key in _norm(_text(ch)):
                    bit = ch
                    if len(_text(ch)) < 160 and i + 1 < len(chunks):
                        bit += "<br><br>" + chunks[i + 1]
                    out.append({"guide": g["id"], "guide_title": g["title"], "section": s["title"], "html": bit[:4000]})
                    break
            else:
                continue
            break
        if len(out) >= limit:
            break
    uniq, texts = [], set()
    for t in out:  # the same tip copied between guides only once
        k = _norm(_text(t["html"]))[:300]
        if k not in texts:
            texts.add(k)
            uniq.append(t)
    return uniq


# ------------------------------------------- hidden achievements, from your PC

def local_descriptions(steam_path: Path | None, appid: int) -> dict[str, dict]:
    """apiname -> {"desc", "hidden"} from Steam's cached stats schema (empty if the game was never run here)."""
    if not steam_path:
        return {}
    f = Path(steam_path) / "appcache" / "stats" / f"UserGameStatsSchema_{int(appid)}.bin"
    try:
        from steamart import parse_binary_vdf
        root = parse_binary_vdf(f.read_bytes())
    except FileNotFoundError:
        return {}
    except Exception as e:
        log.info("stats schema %s unreadable: %r", appid, e)
        return {}
    game = next(iter(root.values()), {}) if root else {}
    out = {}

    def lang(v):
        if isinstance(v, dict):
            return str(v.get("english") or next((x for x in v.values() if isinstance(x, str) and x and len(x) > 1), ""))
        return str(v or "")

    for stat in ((game or {}).get("stats") or {}).values():
        if not isinstance(stat, dict):
            continue
        for bit in (stat.get("bits") or {}).values():
            if not isinstance(bit, dict) or not bit.get("name"):
                continue
            d = bit.get("display") or {}
            out[str(bit["name"])] = {"desc": lang(d.get("desc")).strip(), "hidden": str(d.get("hidden", "0")) == "1"}
    return out
