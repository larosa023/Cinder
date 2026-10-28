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
from steamquiet import SteamQuiet
from updater import Updater
from cinderlog import log, setup as setup_log
from winsnap import IS_WIN, WinSnap


def resource_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def app_dir() -> Path:
    """Where Cinder lives on disk (the exe's folder, or the source folder)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def clean_stale_temp() -> None:
    """Remove Cinder's own leftover PyInstaller _MEI folders from earlier runs.

    Only folders that contain Cinder's UI are touched, and only after Windows lets
    the folder be renamed, which fails while anything inside is still in use.
    """
    if not getattr(sys, "frozen", False):
        return
    import shutil
    import tempfile
    mine = Path(getattr(sys, "_MEIPASS", "")).resolve()
    for d in Path(tempfile.gettempdir()).glob("_MEI*"):
        try:
            if not d.is_dir() or d.resolve() == mine or not (d / "ui" / "js" / "core.js").exists():
                continue
            trash = d.with_name(d.name + "_old")
            os.rename(d, trash)
            shutil.rmtree(trash, ignore_errors=True)
            log.info("removed leftover temp folder %s", d.name)
        except OSError:
            pass  # still in use (e.g. another copy of Cinder is running)


class WindowApi:
    """Exposed to the page as window.pywebview.api for the custom title bar."""

    def __init__(self):
        self._window = None
        self._snap = WinSnap("Cinder")

    def _attach(self, window):
        self._window = window
        self._snap.window = window

    def minimize(self):
        self._window.minimize()

    def toggle_maximize(self):
        if IS_WIN:
            return self._snap.toggle_maximize()
        self._window.toggle_fullscreen()
        return "max"

    def log(self, msg):
        """Lets the page write to cinder.log."""
        log.info("page: %s", str(msg)[:500])

    def drag(self):
        """Title bar pressed: Windows moves the window until the button is released."""
        state = self._snap.drag()
        log.info("drag finished: %s", state)
        return state

    def resize(self, edge):
        if isinstance(edge, str):
            return self._snap.resize(edge)
        return self._snap.state

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
    setup_log(ddir)
    log.info("Cinder %s starting (%s, frozen=%s)", __import__("version").VERSION, sys.platform, getattr(sys, "frozen", False))
    clean_stale_temp()
    cfg = Config(ddir / "config.json")
    steam = Steam(cfg["steam_path"] or None)
    steam.quiet = SteamQuiet(enabled=lambda: bool(cfg["hide_steam_on_launch"]))

    if steam.found:
        if cfg["freeze_updates"] and not steam.freeze_enabled():
            steam.set_freeze(True)  # best effort; the UI reports if it couldn't
        if cfg["autostart_steam"] and not args.no_steam and not steam.running():
            steam.start(silent=True)

    updater = Updater(app_dir())
    updater.cleanup()
    # Right after an update the previous copy may still be closing, which keeps its
    # old exe locked; try again a few times in the background.
    def _retry_cleanup():
        import time
        for _ in range(6):
            time.sleep(5)
            updater.cleanup()
    threading.Thread(target=_retry_cleanup, daemon=True).start()
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
