"""Windows-style moving, snapping and resizing for Cinder's borderless window.

The borderless window has no native title bar, so Windows' own drag-to-snap
doesn't apply. This recreates it with plain Win32 calls:

  * drag the title bar to the top edge  -> maximize (taskbar stays visible)
  * drag to the left or right edge       -> snap to that half of the screen
  * drag a maximized/snapped window      -> restores to its previous size
  * drag any window edge or corner       -> resize
  * double-click the title bar           -> maximize / restore

Works per monitor and with any display scaling. Not on Windows: no-ops.
"""

from __future__ import annotations

import os
import sys
import threading
import time

IS_WIN = sys.platform == "win32"

if IS_WIN:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                    ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

    user32.MonitorFromPoint.restype = wintypes.HMONITOR
    user32.MonitorFromPoint.argtypes = [wintypes.POINT, wintypes.DWORD]
    user32.MonitorFromWindow.restype = wintypes.HMONITOR
    user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
    user32.GetMonitorInfoW.argtypes = [wintypes.HMONITOR, ctypes.POINTER(MONITORINFO)]
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                    ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE = 0x1, 0x4, 0x10
MONITOR_DEFAULTTONEAREST = 2
EDGE_PX = 2          # how close to the screen edge counts as "at the edge"
RESTORE_DRAG_PX = 6  # movement before a maximized window pops back to normal size


class WinSnap:
    def __init__(self, title: str = "Cinder", min_w: int = 960, min_h: int = 600):
        self.title = title
        self.min_w, self.min_h = min_w, min_h
        self.window = None          # pywebview window
        self._hwnd = None
        self.state = "normal"       # normal | max | left | right
        self._restore = None        # (x, y, w, h) before max/snap
        self._busy = threading.Lock()
        self.on_state = None        # callback(state) so the UI can update its icons

    # ---------------------------------------------------------------- helpers
    def hwnd(self):
        if self._hwnd or not IS_WIN:
            return self._hwnd
        try:
            self._hwnd = int(self.window.native.Handle.ToInt64())
            return self._hwnd
        except Exception:
            pass
        pid, found = os.getpid(), []

        def cb(h, _):
            p = wintypes.DWORD()
            user32.GetWindowThreadProcessId(h, ctypes.byref(p))
            if p.value == pid and user32.IsWindowVisible(h):
                buf = ctypes.create_unicode_buffer(256)
                user32.GetWindowTextW(h, buf, 256)
                if buf.value == self.title:
                    found.append(h)
                    return False
            return True

        user32.EnumWindows(EnumProc(cb), 0)
        self._hwnd = found[0] if found else None
        return self._hwnd

    @staticmethod
    def _cursor():
        pt = wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        return pt

    def _rect(self):
        r = wintypes.RECT()
        user32.GetWindowRect(self.hwnd(), ctypes.byref(r))
        return r.left, r.top, r.right - r.left, r.bottom - r.top

    @staticmethod
    def _monitor(pt=None, hwnd=None):
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        h = (user32.MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST) if pt is not None
             else user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST))
        user32.GetMonitorInfoW(h, ctypes.byref(mi))
        return mi.rcMonitor, mi.rcWork

    def _place(self, x, y, w=None, h=None):
        flags = SWP_NOZORDER | SWP_NOACTIVATE | (SWP_NOSIZE if w is None else 0)
        user32.SetWindowPos(self.hwnd(), None, int(x), int(y), int(w or 0), int(h or 0), flags)

    @staticmethod
    def _button_down() -> bool:
        vk = 0x02 if user32.GetSystemMetrics(23) else 0x01  # honor swapped mouse buttons
        return bool(user32.GetAsyncKeyState(vk) & 0x8000)

    def _set_state(self, st):
        self.state = st
        if self.on_state:
            try:
                self.on_state(st)
            except Exception:
                pass

    def _scale(self) -> float:
        try:
            return user32.GetDpiForWindow(self.hwnd()) / 96
        except Exception:
            return 1.0

    # --------------------------------------------------------------- actions
    def maximize(self, pt=None, save=True):
        if not IS_WIN or not self.hwnd():
            return self.window and self.window.maximize()
        if save and self.state == "normal":
            self._restore = self._rect()
        _, work = self._monitor(pt=pt) if pt is not None else self._monitor(hwnd=self.hwnd())
        self._place(work.left, work.top, work.right - work.left, work.bottom - work.top)
        self._set_state("max")

    def snap(self, side, pt, save=True):
        if save and self.state == "normal":
            self._restore = self._rect()
        _, work = self._monitor(pt=pt)
        half = (work.right - work.left) // 2
        x = work.left if side == "left" else work.left + half
        self._place(x, work.top, half if side == "left" else (work.right - work.left) - half,
                    work.bottom - work.top)
        self._set_state(side)

    def restore(self):
        if not IS_WIN or not self.hwnd():
            return self.window and self.window.restore()
        if self._restore:
            self._place(*self._restore)
        self._set_state("normal")

    def toggle_maximize(self):
        if self.state == "normal":
            self.maximize()
        else:
            self.restore()
        return self.state

    # ------------------------------------------------------------------ drag
    def drag(self):
        """Called on mouse-down in the title bar. Runs until the button is released."""
        if not IS_WIN or not self.hwnd() or not self._busy.acquire(blocking=False):
            return
        threading.Thread(target=self._drag_loop, daemon=True).start()

    def _drag_loop(self):
        try:
            start = self._cursor()
            x, y, w, h = self._rect()
            offx, offy = start.x - x, start.y - y
            pre_drag = (x, y, w, h) if self.state == "normal" else None

            if self.state != "normal":
                # Wait for a real drag before popping out of max/snap (a click is not a drag).
                while self._button_down():
                    pt = self._cursor()
                    if abs(pt.x - start.x) > RESTORE_DRAG_PX or abs(pt.y - start.y) > RESTORE_DRAG_PX:
                        break
                    time.sleep(0.008)
                else:
                    return
                frac = offx / max(w, 1)
                rw, rh = (self._restore[2], self._restore[3]) if self._restore else (int(w * .7), int(h * .7))
                offx, offy = int(rw * frac), min(offy, int(24 * self._scale()))
                pt = self._cursor()
                self._place(pt.x - offx, pt.y - offy, rw, rh)
                self._set_state("normal")

            last = None
            while self._button_down():
                pt = self._cursor()
                if (pt.x, pt.y) != last:
                    self._place(pt.x - offx, pt.y - offy)
                    last = (pt.x, pt.y)
                time.sleep(0.006)

            pt = self._cursor()
            mon, _ = self._monitor(pt=pt)
            # Remember where the window was before this drag, like Windows does.
            target = None
            if pt.y <= mon.top + EDGE_PX:
                target = "max"
            elif pt.x <= mon.left + EDGE_PX:
                target = "left"
            elif pt.x >= mon.right - 1 - EDGE_PX:
                target = "right"
            if target:
                if pre_drag:
                    self._restore = pre_drag
                elif self._restore is None:
                    self._restore = self._rect()
                if target == "max":
                    self.maximize(pt, save=False)
                else:
                    self.snap(target, pt, save=False)
        finally:
            self._busy.release()

    # ---------------------------------------------------------------- resize
    def resize(self, edge: str):
        """edge: any of n, s, e, w, ne, nw, se, sw."""
        if not IS_WIN or not self.hwnd() or not self._busy.acquire(blocking=False):
            return
        threading.Thread(target=self._resize_loop, args=(edge,), daemon=True).start()

    def _resize_loop(self, edge):
        try:
            start = self._cursor()
            x, y, w, h = self._rect()
            s = self._scale()
            mw, mh = int(self.min_w * s), int(self.min_h * s)
            if self.state != "normal":
                self._set_state("normal")
            last = None
            while self._button_down():
                pt = self._cursor()
                if (pt.x, pt.y) == last:
                    time.sleep(0.006)
                    continue
                last = (pt.x, pt.y)
                dx, dy = pt.x - start.x, pt.y - start.y
                nx, ny, nw, nh = x, y, w, h
                if "e" in edge:
                    nw = max(mw, w + dx)
                if "s" in edge:
                    nh = max(mh, h + dy)
                if "w" in edge:
                    nw = max(mw, w - dx)
                    nx = x + w - nw
                if "n" in edge:
                    nh = max(mh, h - dy)
                    ny = y + h - nh
                self._place(nx, ny, nw, nh)
                time.sleep(0.006)
        finally:
            self._busy.release()
