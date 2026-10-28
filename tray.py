"""A small Windows tray icon for Cinder (plain Win32, no extra packages).

Left-click opens Cinder; right-click shows Open / Quit. Also shows Windows
notifications (balloons), e.g. for wishlist sales. No-ops off Windows.
"""

from __future__ import annotations

import sys
import threading

from cinderlog import log

IS_WIN = sys.platform == "win32"

if IS_WIN:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    shell32 = ctypes.windll.shell32
    k32 = ctypes.windll.kernel32
    LRESULT = ctypes.c_ssize_t
    WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

    class WNDCLASSW(ctypes.Structure):
        _fields_ = [("style", wintypes.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                    ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HICON),
                    ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HBRUSH),
                    ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR)]

    class GUID(ctypes.Structure):
        _fields_ = [("a", ctypes.c_ulong), ("b", ctypes.c_ushort), ("c", ctypes.c_ushort), ("d", ctypes.c_ubyte * 8)]

    class NOTIFYICONDATAW(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("hWnd", wintypes.HWND), ("uID", wintypes.UINT),
                    ("uFlags", wintypes.UINT), ("uCallbackMessage", wintypes.UINT), ("hIcon", wintypes.HICON),
                    ("szTip", wintypes.WCHAR * 128), ("dwState", wintypes.DWORD), ("dwStateMask", wintypes.DWORD),
                    ("szInfo", wintypes.WCHAR * 256), ("uVersion", wintypes.UINT),
                    ("szInfoTitle", wintypes.WCHAR * 64), ("dwInfoFlags", wintypes.DWORD),
                    ("guidItem", GUID), ("hBalloonIcon", wintypes.HICON)]

    class MSG(ctypes.Structure):
        _fields_ = [("hwnd", wintypes.HWND), ("message", wintypes.UINT), ("wParam", wintypes.WPARAM),
                    ("lParam", wintypes.LPARAM), ("time", wintypes.DWORD), ("pt", wintypes.POINT)]

    user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.DefWindowProcW.restype = LRESULT
    user32.CreateWindowExW.restype = wintypes.HWND
    user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
                                       ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                       wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
    user32.LoadImageW.restype = wintypes.HANDLE
    user32.LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.CreatePopupMenu.restype = wintypes.HMENU
    user32.AppendMenuW.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR]
    user32.TrackPopupMenu.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                      wintypes.HWND, wintypes.LPVOID]
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.RegisterWindowMessageW.restype = wintypes.UINT
    user32.DestroyMenu.argtypes = [wintypes.HMENU]
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.DestroyWindow.argtypes = [wintypes.HWND]
    user32.GetMessageW.argtypes = [ctypes.POINTER(MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
    shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
    k32.GetModuleHandleW.restype = wintypes.HMODULE

WM_APP_TRAY = 0x8000 + 1
WM_CLOSE, WM_DESTROY, WM_COMMAND = 0x0010, 0x0002, 0x0111
WM_LBUTTONUP, WM_RBUTTONUP, WM_LBUTTONDBLCLK = 0x0202, 0x0205, 0x0203
NIN_BALLOONUSERCLICK = 0x0400 + 5
NIM_ADD, NIM_MODIFY, NIM_DELETE = 0, 1, 2
NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_INFO = 0x1, 0x2, 0x4, 0x10
CMD_OPEN, CMD_QUIT = 1, 2


class Tray:
    def __init__(self, icon_path: str, on_open, on_quit, tooltip: str = "Cinder"):
        self.icon_path = icon_path
        self.on_open = on_open
        self.on_quit = on_quit
        self.tooltip = tooltip
        self.hwnd = None
        self._nid = None
        self._ready = threading.Event()
        self._proc = None  # keep the callback alive

    def start(self) -> None:
        if not IS_WIN:
            return
        threading.Thread(target=self._run, name="tray", daemon=True).start()
        self._ready.wait(5)

    # ---------------------------------------------------------------- thread
    def _run(self):
        try:
            hinst = k32.GetModuleHandleW(None)
            self._taskbar_created = user32.RegisterWindowMessageW("TaskbarCreated")
            self._proc = WNDPROC(self._wndproc)
            wc = WNDCLASSW()
            wc.lpfnWndProc = self._proc
            wc.hInstance = hinst
            wc.lpszClassName = "CinderTray"
            user32.RegisterClassW(ctypes.byref(wc))
            self.hwnd = user32.CreateWindowExW(0, "CinderTray", "Cinder tray", 0, 0, 0, 0, 0, None, None, hinst, None)
            size = user32.GetSystemMetrics(49)  # SM_CXSMICON
            hicon = user32.LoadImageW(None, self.icon_path, 1, size, size, 0x10)  # IMAGE_ICON, LR_LOADFROMFILE
            nid = NOTIFYICONDATAW()
            nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
            nid.hWnd = self.hwnd
            nid.uID = 1
            nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
            nid.uCallbackMessage = WM_APP_TRAY
            nid.hIcon = hicon
            nid.szTip = self.tooltip
            self._nid = nid
            shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid))
        except Exception:
            log.exception("tray icon failed")
            self._ready.set()
            return
        self._ready.set()
        msg = MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

    def _wndproc(self, hwnd, msg, wparam, lparam):
        try:
            if msg == WM_APP_TRAY:
                event = lparam & 0xFFFF
                if event in (WM_LBUTTONUP, WM_LBUTTONDBLCLK, NIN_BALLOONUSERCLICK):
                    threading.Thread(target=self.on_open, daemon=True).start()
                elif event == WM_RBUTTONUP:
                    self._menu()
                return 0
            if msg == getattr(self, "_taskbar_created", -1) and self._nid:
                shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(self._nid))  # Explorer restarted
                return 0
            if msg == WM_CLOSE:
                user32.DestroyWindow(hwnd)
                return 0
            if msg == WM_DESTROY:
                user32.PostQuitMessage(0)
                return 0
        except Exception:
            log.exception("tray message failed")
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _menu(self):
        menu = user32.CreatePopupMenu()
        user32.AppendMenuW(menu, 0, CMD_OPEN, "Open Cinder")
        user32.AppendMenuW(menu, 0x800, 0, None)  # separator
        user32.AppendMenuW(menu, 0, CMD_QUIT, "Quit Cinder")
        pt = wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        user32.SetForegroundWindow(self.hwnd)  # so the menu closes when you click elsewhere
        cmd = user32.TrackPopupMenu(menu, 0x0100 | 0x0002, pt.x, pt.y, 0, self.hwnd, None)  # RETURNCMD|RIGHTBUTTON
        user32.PostMessageW(self.hwnd, 0, 0, 0)
        user32.DestroyMenu(menu)
        if cmd == CMD_OPEN:
            threading.Thread(target=self.on_open, daemon=True).start()
        elif cmd == CMD_QUIT:
            threading.Thread(target=self.on_quit, daemon=True).start()

    # ---------------------------------------------------------------- public
    def notify(self, title: str, text: str) -> None:
        """A Windows notification from Cinder's tray icon. Clicking it opens Cinder."""
        if not IS_WIN or not self._nid:
            return
        nid = self._nid
        nid.uFlags = NIF_INFO
        nid.szInfoTitle = title[:63]
        nid.szInfo = text[:255]
        nid.dwInfoFlags = 0x4  # NIIF_USER: use the app icon
        nid.hBalloonIcon = nid.hIcon
        shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(nid))
        nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP

    def stop(self) -> None:
        if not IS_WIN or not self._nid:
            return
        try:
            shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self._nid))
            user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
        except Exception:
            pass
        self._nid = None
