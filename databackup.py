"""Back up and restore everything Cinder keeps (not your games or their saves).

A Cinder backup is a zip with your settings, notes and ratings, lists, play sessions,
price alerts, before/after-play hooks, save-folder choices, custom art and themes.
Optionally a copy is written every week to a folder you pick (put it in OneDrive,
Dropbox or Google Drive and it follows you to another PC).
"""

from __future__ import annotations

import json
import threading
import time
import zipfile
from pathlib import Path

from cinderlog import log
from version import VERSION

FILES = ["config.json", "games.json", "sessions.json", "prices.json", "sales.json", "hooks.json",
         "backup_folders.json", "achievements.json", "workshop_support.json"]
FOLDERS = ["customart", "themes"]
KEEP_SYNCED = 4
WEEK = 7 * 86400


def export(data_dir: Path, dest: Path) -> dict:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    n = 0
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in FILES:
            p = data_dir / name
            if p.is_file():
                zf.write(p, name)
                n += 1
        for folder in FOLDERS:
            d = data_dir / folder
            for f in sorted(d.rglob("*")) if d.is_dir() else []:
                if f.is_file():
                    zf.write(f, f"{folder}/{f.relative_to(d).as_posix()}")
                    n += 1
        zf.writestr("cinder-data.json", json.dumps({"version": VERSION, "time": int(time.time()), "files": n}))
    tmp.replace(dest)
    log.info("cinder backup: %d files -> %s", n, dest)
    return {"path": str(dest), "files": n, "size": dest.stat().st_size}


def inspect(src: Path) -> dict:
    with zipfile.ZipFile(src) as zf:
        meta = json.loads(zf.read("cinder-data.json"))
    return meta


def restore(data_dir: Path, src: Path) -> dict:
    """Replace Cinder's data with a backup's. A copy of what's there now is kept first."""
    src = Path(src)
    with zipfile.ZipFile(src) as zf:
        if "cinder-data.json" not in zf.namelist():
            raise ValueError("That isn't a Cinder backup")
        export(data_dir, data_dir / "before-restore.cinderbackup")
        n = 0
        for info in zf.infolist():
            name = info.filename
            if info.is_dir() or name == "cinder-data.json":
                continue
            top = name.split("/", 1)[0]
            if not (name in FILES or (top in FOLDERS and "/" in name)) or ".." in Path(name).parts:
                continue  # only Cinder's own files, only inside its folder
            target = (data_dir / name).resolve()
            if data_dir.resolve() not in target.parents:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(info))
            n += 1
    log.info("cinder restore: %d files from %s", n, src)
    return {"files": n}


class Sync:
    """Writes a weekly copy to your chosen folder (and when you ask)."""

    def __init__(self, config, data_dir: Path):
        self.config, self.data_dir = config, data_dir
        self._stop = threading.Event()

    def start(self):
        threading.Thread(target=self._run, name="cinder-sync", daemon=True).start()

    def _run(self):
        wait = 300
        while not self._stop.wait(wait):
            wait = 6 * 3600
            try:
                self.maybe()
            except Exception:
                log.exception("weekly cinder backup")

    def latest(self) -> dict | None:
        folder = self.config["sync_folder"]
        if not folder or not Path(folder).is_dir():
            return None
        files = sorted(Path(folder).glob("Cinder-*.cinderbackup"), reverse=True)
        if not files:
            return None
        f = files[0]
        return {"path": str(f), "time": int(f.stat().st_mtime), "size": f.stat().st_size}

    def maybe(self, force: bool = False) -> dict | None:
        folder = self.config["sync_folder"]
        if not folder or not Path(folder).is_dir():
            return None
        last = self.latest()
        if not force and last and time.time() - last["time"] < WEEK:
            return None
        out = export(self.data_dir, Path(folder) / f"Cinder-{time.strftime('%Y-%m-%d_%H%M')}.cinderbackup")
        for old in sorted(Path(folder).glob("Cinder-*.cinderbackup"), reverse=True)[KEEP_SYNCED:]:
            try:
                old.unlink()
            except OSError:
                pass
        return out
