"""Read-only access to a local Steam install: library, user, artwork, launching.

Cinder never talks to Valve's servers and never touches your credentials.
Everything here reads files Steam already keeps on disk, and hands launches
back to the real Steam client through steam:// URLs.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
from pathlib import Path

IS_WIN = sys.platform == "win32"
STEAMID64_BASE = 76561197960265728

# Launch flags that keep Steam on its current build.
FREEZE_ARGS = [
    "-noverifyfiles",
    "-nobootstrapupdate",
    "-skipinitialbootstrap",
    "-norepairfiles",
    "-overridepackageurl",
]
FREEZE_LINES = ["BootStrapperInhibitAll=enable", "BootStrapperForceSelfUpdate=disable"]

# Things in steamapps that aren't games.
EXCLUDED_APPIDS = {228980}  # Steamworks Common Redistributables
EXCLUDED_NAME = re.compile(
    r"^(Proton\b|Steam Linux Runtime|Steamworks Common Redistributables|Steamworks SDK)",
    re.I,
)

ART = {
    "portrait": ("library_600x900", "jpg"),
    "hero": ("library_hero", "jpg"),
    "logo": ("logo", "png"),
    "header": ("header", "jpg"),
}
CDN = "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/{appid}/{stem}.{ext}"

_NO_WINDOW = 0x08000000 if IS_WIN else 0


# --------------------------------------------------------------------------- VDF

def _tokens(text: str):
    """Yield (token, quoted) pairs from Valve KeyValues text."""
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c.isspace():
            i += 1
        elif c == "/" and text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
        elif c in "{}":
            yield c, False
            i += 1
        elif c == '"':
            i += 1
            buf = []
            while i < n and text[i] != '"':
                if text[i] == "\\" and i + 1 < n:
                    nxt = text[i + 1]
                    buf.append({"n": "\n", "t": "\t", "\\": "\\", '"': '"'}.get(nxt, "\\" + nxt))
                    i += 2
                else:
                    buf.append(text[i])
                    i += 1
            yield "".join(buf), True
            i += 1
        else:
            j = i
            while j < n and not text[j].isspace() and text[j] not in '{}"':
                j += 1
            yield text[i:j], False
            i = j


def parse_vdf(text: str) -> dict:
    """Parse KeyValues text into nested dicts. Keys are lower-cased."""
    root: dict = {}
    stack = [root]
    key = None
    for tok, quoted in _tokens(text):
        if not quoted and tok == "{":
            if key is None:
                continue
            node: dict = {}
            stack[-1][key] = node
            stack.append(node)
            key = None
        elif not quoted and tok == "}":
            if len(stack) > 1:
                stack.pop()
            key = None
        elif not quoted and tok.startswith("[") and tok.endswith("]"):
            continue  # platform conditionals like [$WIN32]
        elif key is None:
            key = tok.lower()
        else:
            stack[-1][key] = tok
            key = None
    return root


def read_vdf(path: Path) -> dict:
    try:
        return parse_vdf(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return {}


def _int(v, default=0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


# ------------------------------------------------------------------------ Steam

def find_steam_path(override: str | None = None) -> Path | None:
    for cand in (override, os.environ.get("CINDER_STEAM_PATH")):
        if cand and Path(cand).is_dir():
            return Path(cand)
    if IS_WIN:
        import winreg

        for hive, sub, val in (
            (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath"),
        ):
            try:
                with winreg.OpenKey(hive, sub) as k:
                    p = Path(winreg.QueryValueEx(k, val)[0])
                    if p.is_dir():
                        return p
            except OSError:
                pass
    for p in (
        r"C:\Program Files (x86)\Steam",
        r"C:\Program Files\Steam",
        "~/.steam/steam",
        "~/.local/share/Steam",
        "~/Library/Application Support/Steam",
    ):
        p = Path(p).expanduser()
        if p.is_dir():
            return p
    return None


class Steam:
    def __init__(self, path_override: str | None = None):
        self.path = find_steam_path(path_override)
        self._art_cache: dict[tuple[int, str], Path | None] = {}
        self._lc: tuple[Path | None, float, dict] = (None, 0.0, {})
        self._lock = threading.Lock()

    # -- basics -------------------------------------------------------------
    @property
    def found(self) -> bool:
        return self.path is not None

    @property
    def exe(self) -> Path | None:
        if not self.path:
            return None
        for name in ("steam.exe", "steam.sh", "steam"):
            p = self.path / name
            if p.exists():
                return p
        return None

    def library_dirs(self) -> list[Path]:
        if not self.path:
            return []
        dirs = [self.path]
        data = read_vdf(self.path / "steamapps" / "libraryfolders.vdf")
        folders = data.get("libraryfolders") or data.get("libraryfolders".lower()) or {}
        for k, v in folders.items():
            if not k.isdigit():
                continue
            p = v.get("path") if isinstance(v, dict) else v
            if p:
                dirs.append(Path(p))
        seen, out = set(), []
        for d in dirs:
            key = os.path.normcase(str(d.resolve() if d.exists() else d))
            if key not in seen and (d / "steamapps").is_dir():
                seen.add(key)
                out.append(d)
        return out

    # -- user ---------------------------------------------------------------
    def user(self) -> dict | None:
        if not self.path:
            return None
        users = read_vdf(self.path / "config" / "loginusers.vdf").get("users", {})
        if not users:
            return None
        sid, info = next(
            ((k, v) for k, v in users.items() if isinstance(v, dict) and v.get("mostrecent") == "1"),
            next(iter(users.items())),
        )
        sid64 = _int(sid)
        return {
            "steamid": str(sid64),
            "accountid": sid64 - STEAMID64_BASE if sid64 else 0,
            "name": info.get("personaname") or info.get("accountname") or "Steam user",
            "has_avatar": self.avatar_path(str(sid64)) is not None,
        }

    def avatar_path(self, steamid: str | None = None) -> Path | None:
        if not self.path:
            return None
        if steamid is None:
            u = self.user()
            steamid = u["steamid"] if u else None
        if not steamid:
            return None
        p = self.path / "config" / "avatarcache" / f"{steamid}.png"
        return p if p.exists() else None

    def _localconfig_apps(self) -> dict:
        u = self.user()
        if not u or not u["accountid"]:
            return {}
        p = self.path / "userdata" / str(u["accountid"]) / "config" / "localconfig.vdf"
        try:
            mtime = p.stat().st_mtime
        except OSError:
            return {}
        with self._lock:
            cp, cm, apps = self._lc
            if cp == p and cm == mtime:
                return apps
        data = read_vdf(p)
        node = data.get("userlocalconfigstore", {})
        for k in ("software", "valve", "steam", "apps"):
            node = node.get(k, {}) if isinstance(node, dict) else {}
        apps = node if isinstance(node, dict) else {}
        with self._lock:
            self._lc = (p, mtime, apps)
        return apps

    # -- library ------------------------------------------------------------
    def library(self) -> list[dict]:
        stats = self._localconfig_apps()
        games: dict[int, dict] = {}
        for lib in self.library_dirs():
            for acf in (lib / "steamapps").glob("appmanifest_*.acf"):
                st = read_vdf(acf).get("appstate", {})
                appid = _int(st.get("appid"))
                name = st.get("name") or ""
                if not appid or appid in EXCLUDED_APPIDS or EXCLUDED_NAME.match(name):
                    continue
                flags = _int(st.get("stateflags"))
                s = stats.get(str(appid), {}) if isinstance(stats, dict) else {}
                game = {
                    "appid": appid,
                    "name": name or f"App {appid}",
                    "installed": bool(flags & 4),
                    "update_pending": bool(flags & 2) or bool(flags & 1024),
                    "size": _int(st.get("sizeondisk")),
                    "lastupdated": _int(st.get("lastupdated")),
                    "lastplayed": _int(s.get("lastplayed")) if isinstance(s, dict) else 0,
                    "playtime": _int(s.get("playtime")) if isinstance(s, dict) else 0,
                    "installdir": str(lib / "steamapps" / "common" / st.get("installdir", "")),
                    "library": str(lib),
                }
                prev = games.get(appid)
                if not prev or (game["installed"] and not prev["installed"]):
                    games[appid] = game
        return sorted(games.values(), key=lambda g: g["name"].lower())

    # -- art ----------------------------------------------------------------
    def art(self, appid: int, kind: str) -> tuple[str, str]:
        """Return ("file", path) for a local cached image, else ("url", cdn_url)."""
        stem, ext = ART[kind]
        key = (appid, kind)
        if key not in self._art_cache:
            self._art_cache[key] = self._find_local_art(appid, stem, ext)
        local = self._art_cache[key]
        if local:
            return "file", str(local)
        return "url", CDN.format(appid=appid, stem=stem, ext=ext)

    def _find_local_art(self, appid: int, stem: str, ext: str) -> Path | None:
        if not self.path:
            return None
        base = self.path / "appcache" / "librarycache"
        for p in (base / f"{appid}_{stem}.{ext}", base / str(appid) / f"{stem}.{ext}"):
            if p.exists():
                return p
        d = base / str(appid)
        if d.is_dir():
            for name in (f"{stem}.{ext}", f"{stem}_2x.{ext}"):
                for p in d.rglob(name):
                    return p
        return None

    # -- process control ----------------------------------------------------
    def running(self) -> bool:
        try:
            if IS_WIN:
                out = subprocess.run(
                    ["tasklist", "/FI", "IMAGENAME eq steam.exe", "/NH"],
                    capture_output=True, text=True, creationflags=_NO_WINDOW, timeout=5,
                ).stdout
                return "steam.exe" in out.lower()
            out = subprocess.run(["pgrep", "-x", "steam"], capture_output=True, timeout=5)
            return out.returncode == 0
        except Exception:
            return False

    def start(self, silent: bool = True, extra: list[str] | None = None) -> bool:
        exe = self.exe
        if not exe:
            return False
        args = [str(exe), *FREEZE_ARGS]
        if silent:
            args.append("-silent")
        args += extra or []
        kw = {"cwd": str(self.path)}
        if IS_WIN:
            kw["creationflags"] = 0x00000008 | 0x00000200 | _NO_WINDOW  # detached, new group
        else:
            kw["start_new_session"] = True
        subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kw)
        return True

    @staticmethod
    def open_url(url: str) -> None:
        if IS_WIN:
            os.startfile(url)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", url])
        else:
            subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def steam_url(self, url: str) -> None:
        """Send a steam:// URL; if Steam is closed, start it frozen first."""
        if self.running():
            self.open_url(url)
        else:
            self.start(silent=True, extra=[url])

    def launch(self, appid: int) -> None:
        if self.running():
            self.open_url(f"steam://rungameid/{appid}")
        else:
            self.start(silent=True, extra=["-applaunch", str(appid)])

    def shutdown(self) -> None:
        if self.running() and self.exe:
            subprocess.Popen([str(self.exe), "-shutdown"], creationflags=_NO_WINDOW)

    # -- update freeze ------------------------------------------------------
    @property
    def cfg_path(self) -> Path | None:
        return self.path / "steam.cfg" if self.path else None

    def freeze_enabled(self) -> bool:
        p = self.cfg_path
        if not p or not p.exists():
            return False
        text = p.read_text(errors="replace").lower()
        return all(line.lower() in text for line in FREEZE_LINES)

    def set_freeze(self, enable: bool) -> tuple[bool, str]:
        p = self.cfg_path
        if not p:
            return False, "Steam folder not found"
        try:
            lines = p.read_text(errors="replace").splitlines() if p.exists() else []
            keep = [l for l in lines if l.split("=")[0].strip().lower() not in
                    {f.split("=")[0].lower() for f in FREEZE_LINES}]
            if enable:
                p.write_text("\n".join(FREEZE_LINES + keep) + "\n")
                return True, "Steam updates blocked"
            if any(l.strip() for l in keep):
                p.write_text("\n".join(keep) + "\n")
            elif p.exists():
                p.unlink()
            return True, "Steam updates allowed"
        except PermissionError:
            return False, "No permission to write steam.cfg - run Cinder as admin once, or copy steam.cfg in manually"
        except OSError as e:
            return False, str(e)
