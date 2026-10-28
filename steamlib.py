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
import time
import urllib.request
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

_NO_WINDOW = 0x08000000 if IS_WIN else 0


# -------------------------------------------------------------------- processes

def _process_running(exe_name: str) -> bool:
    """Windows: check the process list directly (much faster than running tasklist)."""
    import ctypes
    from ctypes import wintypes

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_void_p), ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD),
                    ("szExeFile", ctypes.c_wchar * 260)]

    k32 = ctypes.windll.kernel32
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = k32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    if not snap or snap == wintypes.HANDLE(-1).value:
        return False
    try:
        e = PROCESSENTRY32W()
        e.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        ok = k32.Process32FirstW(snap, ctypes.byref(e))
        target = exe_name.lower()
        while ok:
            if e.szExeFile.lower() == target:
                return True
            ok = k32.Process32NextW(snap, ctypes.byref(e))
        return False
    finally:
        k32.CloseHandle(snap)


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


_vdf_cache: dict[str, tuple[float, int, dict]] = {}
_vdf_lock = threading.Lock()


def read_vdf(path: Path) -> dict:
    """Parse a text VDF file, re-parsing only when it changes on disk."""
    try:
        st = path.stat()
    except OSError:
        return {}
    key = str(path)
    with _vdf_lock:
        hit = _vdf_cache.get(key)
        if hit and hit[0] == st.st_mtime and hit[1] == st.st_size:
            return hit[2]
    try:
        data = parse_vdf(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return {}
    with _vdf_lock:
        _vdf_cache[key] = (st.st_mtime, st.st_size, data)
    return data


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
        self.arts = None  # steamart.ArtFinder, created on first use
        self.quiet = None  # steamquiet.SteamQuiet, set by main
        self._running, self._running_at = False, -10.0
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

    def _localconfig(self) -> dict:
        """Parsed UserLocalConfigStore for the signed-in user (cached by mtime)."""
        u = self.user()
        if not u or not u["accountid"]:
            return {}
        p = self.path / "userdata" / str(u["accountid"]) / "config" / "localconfig.vdf"
        try:
            mtime = p.stat().st_mtime
        except OSError:
            return {}
        with self._lock:
            cp, cm, data = self._lc
            if cp == p and cm == mtime:
                return data
        data = read_vdf(p).get("userlocalconfigstore", {})
        with self._lock:
            self._lc = (p, mtime, data)
        return data

    def _localconfig_apps(self) -> dict:
        node = self._localconfig()
        for k in ("software", "valve", "steam", "apps"):
            node = node.get(k, {}) if isinstance(node, dict) else {}
        return node if isinstance(node, dict) else {}

    def local_friends(self) -> dict:
        """Steam's on-disk friends cache: {accountid: {name, avatar, ...}}."""
        node = self._localconfig().get("friends", {})
        return node if isinstance(node, dict) else {}

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
    def _art_finder(self):
        if self.arts is None:
            from steamart import ArtFinder
            from config import data_dir
            self.arts = ArtFinder(self.path, data_dir())
        return self.arts

    def art(self, appid: int, kind: str):
        """("file", path) / ("url", url) for a game's art, or None. See steamart.py."""
        return self._art_finder().find(appid, kind)

    def prefetch_art(self, appids: list[int]) -> None:
        self._art_finder().prefetch(appids)

    # -- process control ----------------------------------------------------
    def running(self) -> bool:
        """Is steam.exe running? Cached for 2 seconds; no subprocess on Windows."""
        now = time.monotonic()
        if now - self._running_at < 2:
            return self._running
        try:
            self._running = _process_running("steam.exe") if IS_WIN else (
                subprocess.run(["pgrep", "-x", "steam"], capture_output=True, timeout=5).returncode == 0)
        except Exception:
            self._running = False
        self._running_at = now
        return self._running

    def wait_stopped(self, timeout: float = 45) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            self._running_at = -10.0
            if not self.running():
                return True
            time.sleep(1.5)
        self._running_at = -10.0
        return not self.running()

    def start(self, silent: bool = True, extra: list[str] | None = None, freeze: bool = True) -> bool:
        exe = self.exe
        if not exe:
            return False
        args = [str(exe), *(FREEZE_ARGS if freeze else [])]
        if silent:
            args.append("-silent")
        args += extra or []
        kw = {"cwd": str(self.path)}
        if IS_WIN:
            kw["creationflags"] = 0x00000008 | 0x00000200 | _NO_WINDOW  # detached, new group
        else:
            kw["start_new_session"] = True
        subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kw)
        self._running_at = -10.0
        return True

    @staticmethod
    def open_url(url: str) -> None:
        if IS_WIN:
            os.startfile(url)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", url])
        else:
            subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def steam_url(self, url: str, quiet_titles=None) -> None:
        """Send a steam:// URL; if Steam is closed, start it frozen first.

        quiet_titles: Steam windows to keep in the tray if this makes them pop up.
        """
        before = self.quiet.snapshot(quiet_titles) if quiet_titles and self.quiet else set()
        if self.running():
            self.open_url(url)
        else:
            self.start(silent=True, extra=[url])
        if quiet_titles and self.quiet:
            self.quiet.watch(before, titles=quiet_titles)

    def launch(self, appid: int) -> None:
        """Launch through Steam, keeping Steam's main window from popping up."""
        before = self.quiet.snapshot() if self.quiet else set()
        was_running = self.running()
        if was_running:
            self.open_url(f"steam://rungameid/{appid}")
        else:
            self.start(silent=True, extra=["-applaunch", str(appid)])
        if self.quiet:
            # A cold Steam start takes a while before it would show its window.
            self.quiet.watch(before, seconds=15 if was_running else 45)

    def set_status(self, status: str) -> None:
        """Online / away / busy / invisible / offline / trade / play (Steam's friends status)."""
        from steamquiet import SteamQuiet
        self.steam_url(f"steam://friends/status/{status}", quiet_titles=SteamQuiet.MAIN + SteamQuiet.FRIENDS)

    def shutdown(self) -> None:
        if self.running() and self.exe:
            subprocess.Popen([str(self.exe), "-shutdown"], creationflags=_NO_WINDOW)
        self._running_at = -10.0

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

    # -- client version -----------------------------------------------------
    def client_version(self) -> str | None:
        """Installed Steam client build, e.g. '1788400362' (matches About Steam)."""
        if not self.path:
            return None
        pkg = self.path / "package"
        names = ["steam_client_win64.manifest", "steam_client_win32.manifest"]
        names += [p.name for p in sorted(pkg.glob("steam_client_*.manifest"))] if pkg.is_dir() else []
        for name in names:
            data = read_vdf(pkg / name)
            for node in data.values():
                if isinstance(node, dict) and node.get("version"):
                    return node["version"]
        return None


# --------------------------------------------------------------- Steam updater

CLIENT_MANIFEST_URLS = [
    "https://client-update.steamstatic.com/steam_client_win64",
    "https://client-update.akamai.steamstatic.com/steam_client_win64",
    "https://media.steampowered.com/client/steam_client_win64",
]


def latest_client_version() -> str | None:
    """Newest Steam client build Valve is serving, or None if unreachable."""
    for url in CLIENT_MANIFEST_URLS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Cinder"})
            with urllib.request.urlopen(req, timeout=10) as r:
                data = parse_vdf(r.read().decode("utf-8", "replace"))
            for node in data.values():
                if isinstance(node, dict) and node.get("version"):
                    return node["version"]
        except Exception:
            continue
    return None


class SteamUpdater:
    """Lets Steam update once, on request, then locks it again.

    Steps: close Steam -> remove the update block -> start Steam normally so it
    downloads its update -> once the new build is in place (or nothing changed
    after a few minutes) -> put the update block back.
    """

    NO_UPDATE_GRACE = 180   # seconds of Steam running with no version change
    SETTLE = 20             # seconds after the version changes before re-locking
    TIMEOUT = 20 * 60

    def __init__(self, steam: Steam, keep_blocked=lambda: True):
        self.steam = steam
        self.keep_blocked = keep_blocked  # re-block afterwards only if the user wants that
        self._lock = threading.Lock()
        self.state = {
            "installed": None, "latest": None, "available": None, "checked_at": 0,
            "busy": False, "phase": "", "error": None,
        }

    def _set(self, **kw):
        with self._lock:
            self.state.update(kw)

    def snapshot(self) -> dict:
        with self._lock:
            s = dict(self.state)
        if not s["busy"]:
            s["installed"] = self.steam.client_version()
        return s

    def check(self) -> dict:
        installed = self.steam.client_version()
        latest = latest_client_version()
        avail = None
        if installed and latest:
            avail = _int(latest) > _int(installed)
        self._set(installed=installed, latest=latest, available=avail, checked_at=time.time(),
                  error=None if latest else "Couldn't reach Valve's update server")
        return self.snapshot()

    def check_async(self):
        threading.Thread(target=self.check, daemon=True).start()

    def update_async(self) -> bool:
        with self._lock:
            if self.state["busy"]:
                return False
            self.state.update(busy=True, error=None, phase="Closing Steam")
        threading.Thread(target=self._run, daemon=True).start()
        return True

    def _run(self):
        s = self.steam
        relock_needed = False
        try:
            before = s.client_version()
            if s.running():
                s.shutdown()
                if not s.wait_stopped(60):
                    raise RuntimeError("Steam didn't close. Exit it from the tray and try again.")
            self._set(phase="Allowing update")
            ok, msg = s.set_freeze(False)
            if not ok:
                raise RuntimeError(msg)
            relock_needed = True
            self._set(phase="Steam is updating - leave it open")
            if not s.start(silent=False, freeze=False):
                raise RuntimeError("steam.exe not found")

            start = time.time()
            changed_at = None
            first_seen_running = None
            while time.time() - start < self.TIMEOUT:
                time.sleep(4)
                now = s.client_version()
                if now and now != before and changed_at is None:
                    changed_at = time.time()
                    self._set(phase=f"Updated to {now} - finishing up")
                if s.running():
                    first_seen_running = first_seen_running or time.time()
                if changed_at and s.running() and time.time() - changed_at > self.SETTLE:
                    break
                if not changed_at and first_seen_running and time.time() - first_seen_running > self.NO_UPDATE_GRACE:
                    self._set(phase="No update was downloaded")
                    break
            after = s.client_version()
            self._set(installed=after, available=False if after != before else self.state["available"])
        except Exception as e:
            self._set(error=str(e))
        finally:
            if relock_needed and self.keep_blocked():
                ok, msg = s.set_freeze(True)
                if not ok:
                    self._set(error=f"Update done, but couldn't re-block updates: {msg}")
            phase = self.state["phase"]
            self._set(busy=False, phase="" if self.state["error"] else
                      ("Done - updates blocked again" if "No update" not in phase else phase + " - updates blocked again"))
