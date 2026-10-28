"""Cinder - a fast, clean front end for your local Steam library."""

from __future__ import annotations

import argparse
import os
import secrets
import sys
import threading
import webbrowser
from pathlib import Path

from config import Config, data_dir
from server import Context, make_server
from steamlib import Steam, SteamUpdater
from updater import Updater
from winsnap import IS_WIN, WinSnap


def resource_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def app_dir() -> Path:
    """Where Cinder lives on disk (the exe's folder, or the source folder)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


class WindowApi:
    """Exposed to the page as window.pywebview.api for the custom title bar."""

    def __init__(self):
        self._window = None
        self._snap = WinSnap("Cinder")
        self._snap.on_state = self._push_state

    def _attach(self, window):
        self._window = window
        self._snap.window = window

    def _push_state(self, state):
        try:
            self._window.evaluate_js(f"window.cinderWinState && window.cinderWinState({state!r})")
        except Exception:
            pass

    def minimize(self):
        self._window.minimize()

    def toggle_maximize(self):
        if IS_WIN:
            return self._snap.toggle_maximize()
        self._window.toggle_fullscreen()
        return "max"

    # Called by the page's pointer events on the title bar and window edges.
    def drag_begin(self):
        return self._snap.begin_drag()

    def drag_move(self):
        self._snap.drag_move()

    def drag_end(self):
        return self._snap.end_drag()

    def resize_begin(self, edge):
        if isinstance(edge, str) and edge in {"n", "s", "e", "w", "ne", "nw", "se", "sw"}:
            return self._snap.begin_resize(edge)
        return False

    def resize_move(self):
        self._snap.resize_move()

    def resize_end(self):
        self._snap.end_resize()

    def state(self):
        return self._snap.state

    def close(self):
        self._window.destroy()


def main() -> None:
    ap = argparse.ArgumentParser(description="Cinder Steam launcher")
    ap.add_argument("--browser", action="store_true", help="open in your web browser instead of a window")
    ap.add_argument("--port", type=int, default=0, help="fixed port (default: random)")
    ap.add_argument("--no-steam", action="store_true", help="don't start Steam automatically")
    args = ap.parse_args()

    ddir = data_dir()
    cfg = Config(ddir / "config.json")
    steam = Steam(cfg["steam_path"] or None)

    if steam.found:
        if cfg["freeze_updates"] and not steam.freeze_enabled():
            steam.set_freeze(True)  # best effort; the UI reports if it couldn't
        if cfg["autostart_steam"] and not args.no_steam and not steam.running():
            steam.start(silent=True)

    updater = Updater(app_dir())
    updater.cleanup()
    steam_updater = SteamUpdater(steam, keep_blocked=lambda: bool(cfg["freeze_updates"]))
    if cfg["check_updates"]:
        updater.check_async()
        if steam.found and cfg["show_steam_updates"]:
            steam_updater.check_async()

    res = resource_dir()
    window_api = None if args.browser else WindowApi()

    restart_requested = threading.Event()

    def restart():
        # Close this copy first, then start the new one once it has fully exited
        # (see the end of main), so nothing is still holding its files.
        restart_requested.set()

        def go():
            import time
            time.sleep(0.4)  # let the HTTP response go out first
            if window_api and window_api._window:
                window_api._window.destroy()
            else:
                srv.shutdown()
        threading.Thread(target=go, daemon=True).start()

    ctx = Context(
        token=secrets.token_urlsafe(24),
        steam=steam,
        config=cfg,
        ui_dir=res / "ui",
        theme_dirs=[res / "themes", ddir / "themes"],
        data_dir=ddir,
        updater=updater,
        steam_updater=steam_updater,
        restart=restart,
        window_api=window_api,
    )
    srv = make_server(ctx, args.port)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"

    if args.browser:
        print(f"Cinder running at {url}  (Ctrl+C to quit)")
        webbrowser.open(url)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass
        if restart_requested.is_set():
            updater.spawn_new()
        return

    threading.Thread(target=srv.serve_forever, daemon=True).start()
    import webview  # pywebview

    window = webview.create_window(
        "Cinder",
        url,
        width=1320,
        height=820,
        min_size=(960, 600),
        frameless=bool(cfg["frameless"]),
        easy_drag=False,
        background_color="#0b0d12",
        js_api=window_api,
    )
    window_api._attach(window)
    webview.start(private_mode=False, storage_path=str(ddir / "webview"))
    srv.shutdown()
    if restart_requested.is_set():
        updater.spawn_new()


if __name__ == "__main__":
    main()
