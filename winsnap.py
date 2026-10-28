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
        self._drag = None
        self._resize = None
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
    # The page drives these from its own pointer events (begin on press, move on
    # every pointer move, end on release); the cursor position comes from Windows.
    def begin_drag(self):
        if not IS_WIN or not self.hwnd():
            return False
        x, y, w, h = self._rect()
        start = self._cursor()
        self._drag = {
            "start": (start.x, start.y),
            "rect": (x, y, w, h),
            "pre": (x, y, w, h) if self.state == "normal" else None,
            "popped": self.state == "normal",
            "off": (start.x - x, start.y - y),
            "moved": False,
        }
        return True

    def drag_move(self):
        d = self._drag
        if not d:
            return
        pt = self._cursor()
        sx, sy = d["start"]
        if not d["popped"]:
            # A maximized/snapped window only pops out once it's really being dragged.
            if abs(pt.x - sx) <= RESTORE_DRAG_PX and abs(pt.y - sy) <= RESTORE_DRAG_PX:
                return
            x, y, w, h = d["rect"]
            frac = (sx - x) / max(w, 1)
            rw, rh = (self._restore[2], self._restore[3]) if self._restore else (int(w * .7), int(h * .7))
            d["off"] = (int(rw * frac), min(sy - y, int(24 * self._scale())))
            self._place(pt.x - d["off"][0], pt.y - d["off"][1], rw, rh)
            self._set_state("normal")
            d["popped"] = True
        else:
            self._place(pt.x - d["off"][0], pt.y - d["off"][1])
        d["moved"] = True

    def end_drag(self):
        d, self._drag = self._drag, None
        if not d or not d["moved"]:
            return self.state
        pt = self._cursor()
        mon, _ = self._monitor(pt=pt)
        target = None
        if pt.y <= mon.top + EDGE_PX:
            target = "max"
        elif pt.x <= mon.left + EDGE_PX:
            target = "left"
        elif pt.x >= mon.right - 1 - EDGE_PX:
            target = "right"
        if target:
            # Remember where the window was before this drag, like Windows does.
            if d["pre"]:
                self._restore = d["pre"]
            elif self._restore is None:
                self._restore = self._rect()
            if target == "max":
                self.maximize(pt, save=False)
            else:
                self.snap(target, pt, save=False)
        return self.state

    # ---------------------------------------------------------------- resize
    def begin_resize(self, edge: str):
        """edge: any of n, s, e, w, ne, nw, se, sw."""
        if not IS_WIN or not self.hwnd():
            return False
        start = self._cursor()
        s = self._scale()
        self._resize = {"edge": edge, "start": (start.x, start.y), "rect": self._rect(),
                        "min": (int(self.min_w * s), int(self.min_h * s))}
        if self.state != "normal":
            self._set_state("normal")
        return True

    def resize_move(self):
        r = self._resize
        if not r:
            return
        pt = self._cursor()
        edge, (sx, sy), (x, y, w, h), (mw, mh) = r["edge"], r["start"], r["rect"], r["min"]
        dx, dy = pt.x - sx, pt.y - sy
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

    def end_resize(self):
        self._resize = None
