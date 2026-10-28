"""Keeps Steam's own windows out of the way while Cinder drives it (Windows only).

When Cinder launches a game or changes your status, Steam sometimes brings its
main library window (or the friends list) to the front. For a short while after
each such action, this sends any of those windows that *newly* appear back to
the tray - exactly what clicking their close button does. Windows that were
already open stay open, and Steam's small prompts (launch options, cloud save
conflicts, sign-in) are left alone.
"""

from __future__ import annotations

import sys
import threading
import time

from cinderlog import log

IS_WIN = sys.platform == "win32"
WM_CLOSE = 0x0010

if IS_WIN:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    k32 = ctypes.windll.kernel32
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.IsWindow.argtypes = [wintypes.HWND]
    EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_void_p), ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD),
                    ("szExeFile", ctypes.c_wchar * 260)]

    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE


def steam_pids() -> set[int]:
    """Process ids of steam.exe and its UI helper (steamwebhelper.exe)."""
    pids: set[int] = set()
    if not IS_WIN:
        return pids
    snap = k32.CreateToolhelp32Snapshot(0x2, 0)
    if not snap or snap == wintypes.HANDLE(-1).value:
        return pids
    try:
        e = PROCESSENTRY32W()
        e.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        ok = k32.Process32FirstW(snap, ctypes.byref(e))
        while ok:
            if e.szExeFile.lower() in ("steam.exe", "steamwebhelper.exe"):
                pids.add(e.th32ProcessID)
            ok = k32.Process32NextW(snap, ctypes.byref(e))
    finally:
        k32.CloseHandle(snap)
    return pids


def steam_windows(pids: set[int]) -> dict[int, tuple[str, str, int, int]]:
    """Visible top-level windows owned by Steam: hwnd -> (title, class, width, height)."""
    found: dict[int, tuple[str, str, int, int]] = {}
    if not pids:
        return found

    def cb(h, _):
        if not user32.IsWindowVisible(h) or user32.IsIconic(h):
            return True
        p = wintypes.DWORD()
        user32.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value not in pids:
            return True
        r = wintypes.RECT()
        user32.GetWindowRect(h, ctypes.byref(r))
        w, hh = r.right - r.left, r.bottom - r.top
        if w < 120 or hh < 80:
            return True  # tooltips, menus, hidden helpers
        title = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(h, title, 256)
        cls = ctypes.create_unicode_buffer(128)
        user32.GetClassNameW(h, cls, 128)
        found[h] = (title.value, cls.value, w, hh)
        return True

    user32.EnumWindows(EnumProc(cb), 0)
    return found


def _is_big(info, titles) -> bool:
    """Steam's main window / friends list: known title and full size."""
    title, _cls, w, h = info
    return title in titles and w >= 600 and h >= 400


class SteamQuiet:
    """See the module docstring.

    Big windows (main library, friends list) are sent back to the tray.
    During a game launch, new *small* Steam popups (like "Starting game") are hidden
    too. That popup closes by itself once the game starts; anything still around
    after RESHOW_AFTER seconds probably needs you (cloud conflict, launch options,
    shader processing), so it is shown again and left alone.
    """
    MAIN = ("Steam",)
    FRIENDS = ("Friends List",)
    RESHOW_AFTER = 10.0

    def __init__(self, enabled=lambda: True):
        self.enabled = enabled
        self._until = 0.0
        self._titles: set[str] = set()
        self._before: set[int] = set()
        self._popups = False
        self._lock = threading.Lock()
        self._thread = None

    def snapshot(self, titles=MAIN) -> set[int]:
        """Call right before triggering Steam: remembers windows that are already open."""
        if not IS_WIN or not self.enabled():
            return set()
        return set(steam_windows(steam_pids()))

    def watch(self, before: set[int], seconds: float = 25, titles=MAIN, popups: bool = False) -> None:
        if not IS_WIN or not self.enabled():
            return
        with self._lock:
            self._until = max(self._until, time.monotonic() + seconds)
            self._titles |= set(titles)
            self._before |= before
            self._popups = self._popups or popups
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def cancel(self) -> None:
        """Stop watching (e.g. the user asked Cinder to open Steam)."""
        with self._lock:
            self._until = 0.0

    def _run(self):
        sent: dict[int, float] = {}    # big window -> when we last asked it to close
        hidden: dict[int, float] = {}  # popup -> when we hid it
        released: set[int] = set()     # popups we gave back; never touch again
        seen: set[int] = set()
        while True:
            now = time.monotonic()
            with self._lock:
                active = now <= self._until
                titles, before, popups = tuple(self._titles), set(self._before), self._popups
            if not active and not hidden:
                break
            try:
                wins = steam_windows(steam_pids())
                # Hidden popups: gone means it was the launch popup; still there means it needs you.
                for h, t0 in list(hidden.items()):
                    if not user32.IsWindow(h):
                        log.info("steam popup %s closed by itself", h)
                        del hidden[h]
                    elif now - t0 >= self.RESHOW_AFTER or not active:
                        user32.ShowWindow(h, 5)  # SW_SHOW
                        log.info("steam popup %s still open after %.0fs; showing it", h, now - t0)
                        released.add(h)
                        del hidden[h]
                if active:
                    for h, info in wins.items():
                        if h in before or h in released or h in hidden:
                            continue
                        if h not in seen:
                            seen.add(h)
                            log.info("steam window appeared: title=%r class=%r size=%dx%d", *info)
                        if _is_big(info, titles):
                            if now - sent.get(h, -10) >= 1.0:
                                user32.PostMessageW(h, WM_CLOSE, 0, 0)  # Steam hides to the tray on close
                                sent[h] = now
                                log.info("sent Steam window %r back to the tray", info[0])
                        elif popups:
                            user32.ShowWindow(h, 0)  # SW_HIDE
                            hidden[h] = now
                            log.info("hid steam popup %r (%dx%d)", info[0], info[2], info[3])
            except Exception:
                log.exception("steam window watch failed")
                for h in hidden:
                    try:
                        user32.ShowWindow(h, 5)
                    except Exception:
                        pass
                break
            time.sleep(0.1)
        with self._lock:
            self._titles.clear()
            self._before.clear()
            self._popups = False
