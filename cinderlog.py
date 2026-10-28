"""Small diagnostic log at %APPDATA%\\Cinder\\cinder.log (rotates at 512 KB)."""

import logging
import logging.handlers
from pathlib import Path

log = logging.getLogger("cinder")


def setup(data_dir: Path) -> Path:
    path = data_dir / "cinder.log"
    if not log.handlers:
        h = logging.handlers.RotatingFileHandler(path, maxBytes=512 * 1024, backupCount=1, encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        log.addHandler(h)
        log.setLevel(logging.INFO)
    return path
