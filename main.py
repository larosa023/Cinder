"""Cinder - a fast, clean front end for your local Steam library."""

from __future__ import annotations

import argparse
import secrets
import sys
import threading
import webbrowser
from pathlib import Path

from config import Config, data_dir
from server import Context, make_server
from steamlib import Steam


def resource_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


class WindowApi:
    """Exposed to the page as window.pywebview.api for the custom title bar."""

    def __init__(self):
        self._window = None
        self._max = False

    def minimize(self):
        self._window.minimize()

    def toggle_maximize(self):
        if self._max:
            self._window.restore()
        else:
            self._window.maximize()
        self._max = not self._max
        return self._max

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

    res = resource_dir()
    window_api = None if args.browser else WindowApi()
    ctx = Context(
        token=secrets.token_urlsafe(24),
        steam=steam,
        config=cfg,
        ui_dir=res / "ui",
        theme_dirs=[res / "themes", ddir / "themes"],
        data_dir=ddir,
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
    window_api._window = window
    webview.start(private_mode=False, storage_path=str(ddir / "webview"))
    srv.shutdown()


if __name__ == "__main__":
    main()
