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


def _windows(pids: set[int], titles: tuple[str, ...]) -> set[int]:
    """Visible, full-size top-level Steam windows with one of these exact titles."""
    found: set[int] = set()
    if not pids:
        return found

    def cb(h, _):
        if not user32.IsWindowVisible(h) or user32.IsIconic(h):
            return True
        p = wintypes.DWORD()
        user32.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value not in pids:
            return True
        buf = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(h, buf, 256)
        if buf.value not in titles:
            return True
        r = wintypes.RECT()
        user32.GetWindowRect(h, ctypes.byref(r))
        # Steam's main window and friends list are big; its prompts are small dialogs.
        if (r.right - r.left) >= 600 and (r.bottom - r.top) >= 400:
            found.add(h)
        return True

    user32.EnumWindows(EnumProc(cb), 0)
    return found


class SteamQuiet:
    MAIN = ("Steam",)
    FRIENDS = ("Friends List",)

    def __init__(self, enabled=lambda: True):
        self.enabled = enabled
        self._until = 0.0
        self._titles: set[str] = set()
        self._before: set[int] = set()
        self._lock = threading.Lock()
        self._thread = None

    def snapshot(self, titles=MAIN) -> set[int]:
        """Call right before triggering Steam: remembers windows that are already open."""
        if not IS_WIN or not self.enabled():
            return set()
        return _windows(steam_pids(), tuple(titles))

    def watch(self, before: set[int], seconds: float = 25, titles=MAIN) -> None:
        if not IS_WIN or not self.enabled():
            return
        with self._lock:
            self._until = max(self._until, time.monotonic() + seconds)
            self._titles |= set(titles)
            self._before |= before
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def cancel(self) -> None:
        """Stop watching (e.g. the user asked Cinder to open Steam)."""
        with self._lock:
            self._until = 0.0

    def _run(self):
        closed = 0
        sent: dict[int, float] = {}  # window -> when we last asked it to close
        while True:
            with self._lock:
                if time.monotonic() > self._until:
                    self._titles.clear()
                    self._before.clear()
                    break
                titles, before = tuple(self._titles), set(self._before)
            try:
                now = time.monotonic()
                for h in _windows(steam_pids(), titles) - before:
                    if now - sent.get(h, -10) < 1.0:
                        continue  # asked recently; give Steam a moment
                    user32.PostMessageW(h, WM_CLOSE, 0, 0)  # Steam hides to the tray on close
                    sent[h] = now
                    closed += 1
            except Exception:
                log.exception("steam window watch failed")
                break
            time.sleep(0.15)
        if closed:
            log.info("sent %d Steam window(s) back to the tray", closed)
