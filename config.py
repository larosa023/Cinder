import json
import os
import threading
from pathlib import Path

APP_NAME = "Cinder"

DEFAULTS = {
    "theme": "midnight",
    "sort": "recent",
    "card_size": 180,
    "freeze_updates": True,
    "autostart_steam": True,
    "frameless": True,
    "steam_path": "",
    "check_updates": True,
    "store_region": "US",
    "api_key": "",
    "start_tab": "library",
    "style": {},
    "show_steam_updates": False,
    "hide_steam_on_launch": True,
    "persona": "online",
    "close_to_tray": True,
    "tray_hint_shown": False,
    "when_playing": "minimize",
    "restore_after_play": True,
    "favorites": [],
    "hidden": [],
    "sale_alerts": True,
    "session_recap": True,
    "couch_theme": "case",  # couch mode look: case, cart, modern, neon, oled  # show a recap card after you close a game
    "lists": [],          # [{"id", "name", "appids"}] - your Cinder game lists
    "profile_style": {},  # background appid, showcase appids, sections
    "steam_bridge": True,
    "steam_on_demand": False,  # only run Steam while a game, download or Steam window needs it
    "steam_idle_minutes": 5,
    "seen_version": "",  # newest What's new entry you've opened  # update games / pause downloads through Steam's own interface
}
EDITABLE = {"theme", "sort", "card_size", "freeze_updates", "autostart_steam", "frameless", "steam_path", "check_updates",
            "store_region", "api_key", "start_tab", "style", "show_steam_updates",
            "hide_steam_on_launch", "persona", "close_to_tray", "tray_hint_shown",
            "when_playing", "restore_after_play", "favorites", "hidden", "sale_alerts",
            "lists", "profile_style", "steam_bridge",
            "steam_on_demand", "steam_idle_minutes", "seen_version", "session_recap", "couch_theme"}


def data_dir() -> Path:
    base = os.environ.get("APPDATA") or (Path.home() / ".config")
    d = Path(base) / APP_NAME
    (d / "themes").mkdir(parents=True, exist_ok=True)
    return d


class Config:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self.data = dict(DEFAULTS)
        try:
            self.data.update(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass

    def public(self) -> dict:
        """Config safe to send to the UI (the API key is never sent back)."""
        d = dict(self.data)
        d["api_key_set"] = bool(d.pop("api_key", ""))
        return d

    def __getitem__(self, key):
        return self.data.get(key, DEFAULTS.get(key))

    def update(self, changes: dict) -> dict:
        with self._lock:
            for k, v in changes.items():
                if k in EDITABLE:
                    self.data[k] = v
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
            os.replace(tmp, self.path)
            return dict(self.data)
