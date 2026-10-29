"""Finds the right picture for every game.

Order of preference, for each kind of art:
  1. Steam's own local cache, using Steam's asset index (appcache/librarycache/
     assetcache.vdf). Newer Steam versions keep art in hashed subfolders with names
     like library_capsule.jpg / library_header.jpg, and that index says which.
  2. The same file on Steam's image servers (the index's path works there too).
  3. Steam's store API, for games Steam hasn't cached yet (e.g. owned but never
     opened). Results are saved to %APPDATA%/Cinder/art.json.
  4. The classic image URL, which still works for many older games.
"""

from __future__ import annotations

import json
import struct
import threading
import urllib.parse
import urllib.request
from pathlib import Path

from cinderlog import log

CDN = "https://shared.cloudflare.steamstatic.com/store_item_assets/"

# kind -> (slot in Steam's asset index, local file names to look for, store API asset keys, classic file)
KINDS = {
    "portrait": ("0f", ["library_600x900.jpg", "library_600x900_2x.jpg", "library_capsule.jpg", "library_capsule_2x.jpg"],
                 ["library_capsule_2x", "library_capsule"], "library_600x900.jpg"),
    "hero": ("1f", ["library_hero.jpg", "library_hero_2x.jpg"], ["library_hero_2x", "library_hero"], "library_hero.jpg"),
    "logo": ("2f", ["logo.png", "logo_2x.png"], ["library_logo_2x", "library_logo"], "logo.png"),
    "header": ("3f", ["header.jpg", "library_header.jpg", "library_header_2x.jpg"], ["header", "library_header", "main_capsule"], "header.jpg"),
}


# ------------------------------------------------------------- binary KeyValues

def parse_binary_vdf(b: bytes) -> dict:
    """Valve's binary KeyValues (used by assetcache.vdf, appinfo, shortcuts.vdf)."""
    def node(i):
        out = {}
        while i < len(b):
            t = b[i]
            i += 1
            if t in (0x08, 0x0B):
                return out, i
            j = b.index(b"\0", i)
            name = b[i:j].decode("utf-8", "replace")
            i = j + 1
            if t == 0x00:
                v, i = node(i)
            elif t == 0x01:
                j = b.index(b"\0", i)
                v = b[i:j].decode("utf-8", "replace")
                i = j + 1
            elif t in (0x02, 0x04, 0x06):
                v = struct.unpack_from("<i", b, i)[0]
                i += 4
            elif t == 0x03:
                v = struct.unpack_from("<f", b, i)[0]
                i += 4
            elif t in (0x07, 0x0A):
                v = struct.unpack_from("<Q", b, i)[0]
                i += 8
            else:
                raise ValueError(f"unknown type {t:#x} at byte {i}")
            out[name] = v
        return out, i
    return node(0)[0]


class ArtFinder:
    def __init__(self, steam_path: Path | None, data_dir: Path):
        self.base = steam_path / "appcache" / "librarycache" if steam_path else None
        self.store_file = data_dir / "art.json"
        self._lock = threading.Lock()
        self._index: dict = {}
        self._index_mtime = None
        self._resolved: dict[tuple[int, str], tuple[str, str] | None] = {}
        self._store: dict[str, dict] = {}
        self._offline_until = 0.0
        self._tmp = threading.local()
        self._prefetch_done = threading.Event()
        self._prefetch_done.set()
        try:
            self._store = json.loads(self.store_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass

    # -- Steam's asset index ---------------------------------------------------
    def _steam_index(self) -> dict:
        if not self.base:
            return {}
        p = self.base / "assetcache.vdf"
        try:
            mtime = p.stat().st_mtime
        except OSError:
            return {}
        if mtime != self._index_mtime:
            try:
                root = parse_binary_vdf(p.read_bytes())
                root = root.get("", root)
                apps = root.get("0", {})
                self._index = apps if isinstance(apps, dict) else {}
                log.info("asset index: %d games", len(self._index))
            except Exception as e:
                log.warning("couldn't read assetcache.vdf: %r", e)
                self._index = {}
            self._index_mtime = mtime
            with self._lock:
                self._resolved.clear()
        return self._index

    # -- lookup ------------------------------------------------------------------
    def find(self, appid: int, kind: str) -> tuple[str, str] | None:
        """("file", path) or ("url", url), or None if there's nothing for this game."""
        idx = self._steam_index()
        key = (appid, kind)
        with self._lock:
            if key in self._resolved:
                return self._resolved[key]
        self._tmp.provisional = False
        result = self._find(appid, kind, idx)
        if not self._tmp.provisional:  # a guess made while the store lookup runs isn't kept
            with self._lock:
                self._resolved[key] = result
        return result

    def _find(self, appid: int, kind: str, idx: dict):
        slot, names, store_keys, classic = KINDS[kind]
        folder = self.base / str(appid) if self.base else None
        entry = idx.get(str(appid))
        rel = entry.get(slot) if isinstance(entry, dict) else None

        # 1. local file named by Steam's index
        if folder and rel:
            p = folder / rel
            if p.is_file():
                return "file", str(p)
        # 1b. local file by name (older layouts, flat or in a subfolder)
        if folder and folder.is_dir():
            for n in names:
                p = folder / n
                if p.is_file():
                    return "file", str(p)
            for n in names:
                for p in folder.glob(f"*/{n}"):
                    return "file", str(p)
        if self.base:
            flat = self.base / f"{appid}_{names[0]}"
            if flat.is_file():
                return "file", str(flat)
        # 2. the index's file on Steam's servers
        if rel:
            return "url", f"{CDN}steam/apps/{appid}/{rel}"
        # 3. store API (cached on disk)
        info = self._store.get(str(appid))
        import time
        if info is None and time.monotonic() < self._offline_until:
            info = {}
        if info is None and not self._prefetch_done.is_set():
            # A library-wide lookup is running: don't hold up this image (and the browser's
            # few connections) waiting for it. Use the classic address now, the real one next time.
            self._tmp.provisional = True
            return "url", f"{CDN}steam/apps/{appid}/{classic}"
        if info is None:
            info = self._fetch_store([appid]).get(str(appid))
        if info:
            fmt = info.get("asset_url_format")
            for k in store_keys:
                if info.get(k) and fmt:
                    return "url", CDN + fmt.replace("${FILENAME}", info[k])
            if info.get("_known"):
                # Steam knows the game but has no art of this kind (e.g. no tall cover).
                if kind == "portrait":
                    return None
        # 4. classic URL
        return "url", f"{CDN}steam/apps/{appid}/{classic}"

    # -- store API ---------------------------------------------------------------
    def _fetch_store(self, appids: list[int]) -> dict:
        found = {}
        for i in range(0, len(appids), 100):
            chunk = appids[i:i + 100]
            req = {"ids": [{"appid": a} for a in chunk],
                   "context": {"language": "english", "country_code": "US"},
                   "data_request": {"include_assets": True}}
            url = ("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?"
                   + urllib.parse.urlencode({"input_json": json.dumps(req)}))
            try:
                r = urllib.request.Request(url, headers={"User-Agent": "Cinder"})
                with urllib.request.urlopen(r, timeout=8) as resp:
                    data = json.loads(resp.read())
            except Exception as e:
                log.info("store art lookup failed: %r", e)
                # Don't keep retrying while offline; try again in 10 minutes.
                import time
                self._offline_until = time.monotonic() + 600
                return found
            for it in (data.get("response") or {}).get("store_items") or []:
                a = str(it.get("appid") or it.get("id") or "")
                if not a:
                    continue
                assets = dict(it.get("assets") or {})
                assets["_known"] = True
                found[a] = assets
            for a in chunk:  # remember misses too, so we don't ask again
                found.setdefault(str(a), {"_known": False})
        if found:
            with self._lock:
                self._store.update(found)
                for a in found:
                    for k in KINDS:
                        self._resolved.pop((int(a), k), None)
            self._save()
        return found

    def _save(self):
        try:
            with self._lock:
                data = json.dumps(self._store)
            tmp = self.store_file.with_suffix(".tmp")
            tmp.write_text(data, encoding="utf-8")
            tmp.replace(self.store_file)
        except OSError:
            pass

    def prefetch(self, appids: list[int]) -> None:
        """In the background, look up store art for games Steam's cache doesn't cover."""
        idx = self._steam_index()
        missing = [a for a in appids if str(a) not in idx and str(a) not in self._store]
        import time
        if not missing or not self._prefetch_done.is_set() or time.monotonic() < self._offline_until:
            return
        self._prefetch_done.clear()

        def run():
            try:
                self._fetch_store(missing)
            finally:
                self._prefetch_done.set()
        threading.Thread(target=run, daemon=True).start()
