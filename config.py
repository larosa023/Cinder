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
}
EDITABLE = {"theme", "sort", "card_size", "freeze_updates", "autostart_steam", "frameless", "steam_path", "check_updates"}


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
