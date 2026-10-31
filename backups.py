"""Save and mod backups, made before a game updates (and whenever you ask).

What gets copied for a game:
- its Steam Cloud save folder (userdata/<you>/<appid>), when it has one
- any save folders you've added for it (many games keep saves in Documents or AppData)
- its Workshop mods (steamapps/workshop/content/<appid>), unless they're bigger than the limit

Backups are zip files in %APPDATA%/Cinder/backups/<appid>/. Cinder keeps the newest few
automatic ones per game; ones you make yourself stay until you delete them.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
import zipfile
from pathlib import Path

from cinderlog import log

KEEP_AUTO = 3
WORKSHOP_LIMIT = 2 * 1024 ** 3


def _size(p: Path) -> int:
    total = 0
    for root, _, files in os.walk(p):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


class Backups:
    def __init__(self, steam, config, data_dir: Path):
        self.steam, self.config = steam, config
        self.dir = data_dir / "backups"
        self.file = data_dir / "backup_folders.json"
        self._lock = threading.Lock()
        self._busy: set[int] = set()
        self._done_builds: dict[int, str] = {}
        try:
            self.folders: dict[str, list[str]] = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.folders = {}

    # -- your extra save folders ----------------------------------------------------
    def set_folders(self, appid: int, folders: list[str]) -> list[str]:
        clean = []
        for f in folders[:8]:
            f = str(f or "").strip()
            if f and os.path.isabs(f) and f not in clean:
                clean.append(f)
        with self._lock:
            if clean:
                self.folders[str(appid)] = clean
            else:
                self.folders.pop(str(appid), None)
            try:
                self.file.write_text(json.dumps(self.folders), encoding="utf-8")
            except OSError:
                pass
        return clean

    def sources(self, appid: int) -> list[tuple[str, Path]]:
        """(label, folder) pairs that exist right now."""
        out = []
        ud = self.steam._userdata()
        if ud and (ud / str(appid)).is_dir():
            out.append(("saves", ud / str(appid)))
        for i, f in enumerate(self.folders.get(str(appid)) or []):
            if Path(f).is_dir():
                out.append((f"folder{i + 1}", Path(f)))
        if self.config["backup_workshop"]:
            for lib in self.steam.library_dirs():
                w = lib / "steamapps" / "workshop" / "content" / str(appid)
                if w.is_dir():
                    out.append(("workshop", w))
                    break
        return out

    # -- listing -----------------------------------------------------------------
    def list(self, appid: int) -> list[dict]:
        d = self.dir / str(appid)
        out = []
        for z in sorted(d.glob("*.zip"), reverse=True) if d.is_dir() else []:
            meta = {}
            try:
                with zipfile.ZipFile(z) as zf:
                    meta = json.loads(zf.read("cinder-backup.json"))
            except Exception:
                pass
            out.append({"id": z.name, "size": z.stat().st_size, "time": meta.get("time") or int(z.stat().st_mtime),
                        "reason": meta.get("reason", ""), "build": meta.get("build", ""), "parts": [p["label"] for p in meta.get("parts", [])],
                        "skipped": meta.get("skipped", [])})
        return out

    def info(self, appid: int) -> dict:
        src = self.sources(appid)
        return {"backups": self.list(appid), "folders": list(self.folders.get(str(appid)) or []),
                "sources": [{"label": l, "path": str(p)} for l, p in src], "busy": appid in self._busy}

    # -- making ------------------------------------------------------------------
    def make(self, appid: int, reason: str = "manual", build: str = "") -> dict | None:
        with self._lock:
            if appid in self._busy:
                return None
            self._busy.add(appid)
        try:
            src = self.sources(appid)
            if not src:
                return None
            d = self.dir / str(appid)
            d.mkdir(parents=True, exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            dest = d / f"{stamp}-{reason}.zip"
            tmp = dest.with_suffix(".part")
            meta = {"appid": appid, "time": int(time.time()), "reason": reason, "build": build, "parts": [], "skipped": []}
            with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as zf:
                for label, root in src:
                    if label == "workshop" and _size(root) > WORKSHOP_LIMIT:
                        meta["skipped"].append("workshop (over 2 GB)")
                        continue
                    n = 0
                    for dirpath, _, files in os.walk(root):
                        for f in files:
                            full = Path(dirpath) / f
                            try:
                                zf.write(full, f"{label}/{full.relative_to(root).as_posix()}")
                                n += 1
                            except (OSError, ValueError):
                                pass
                    meta["parts"].append({"label": label, "root": str(root), "files": n})
                zf.writestr("cinder-backup.json", json.dumps(meta))
            tmp.replace(dest)
            self._prune(appid)
            log.info("backup %s for %s: %s (%d bytes)", reason, appid, [p["label"] for p in meta["parts"]], dest.stat().st_size)
            return {"id": dest.name, **meta}
        except Exception:
            log.exception("backup for %s failed", appid)
            return None
        finally:
            with self._lock:
                self._busy.discard(appid)

    def _prune(self, appid: int) -> None:
        autos = [z for z in sorted((self.dir / str(appid)).glob("*-update.zip"), reverse=True)]
        for z in autos[KEEP_AUTO:]:
            try:
                z.unlink()
            except OSError:
                pass

    def before_update(self, games: list[dict]) -> None:
        """Called with the library: back up any game that's waiting on an update (once per build)."""
        if not self.config["backup_before_updates"]:
            return
        for g in games:
            if not (g.get("installed") and g.get("update_pending")) or g.get("shortcut"):
                continue
            appid, build = g["appid"], str(g.get("buildid") or "")
            key = f"{build}"
            if self._done_builds.get(appid) == key or appid in self._busy:
                continue
            self._done_builds[appid] = key
            if any(b["reason"] == "update" and b["build"] == build for b in self.list(appid)):
                continue
            threading.Thread(target=self.make, args=(appid, "update", build), name=f"backup-{appid}", daemon=True).start()

    # -- restoring -----------------------------------------------------------------
    def restore(self, appid: int, bid: str) -> dict:
        z = self.dir / str(appid) / Path(bid).name
        if not z.is_file():
            raise FileNotFoundError("That backup isn't there anymore")
        with zipfile.ZipFile(z) as zf:
            meta = json.loads(zf.read("cinder-backup.json"))
            self.make(appid, "before-restore")  # so a restore can be undone too
            restored = 0
            for part in meta.get("parts", []):
                root = Path(part["root"])
                prefix = part["label"] + "/"
                for info in zf.infolist():
                    if not info.filename.startswith(prefix) or info.is_dir():
                        continue
                    rel = info.filename[len(prefix):]
                    target = (root / rel).resolve()
                    if root.resolve() not in target.parents:
                        continue  # never write outside the folder it came from
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(info) as src, open(target, "wb") as out:
                        shutil.copyfileobj(src, out)
                    restored += 1
        log.info("restored %s for %s: %d files", bid, appid, restored)
        return {"files": restored}

    def delete(self, appid: int, bid: str) -> None:
        z = self.dir / str(appid) / Path(bid).name
        if z.is_file():
            z.unlink()
