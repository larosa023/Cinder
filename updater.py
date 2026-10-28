"""Cinder self-updater, backed by GitHub releases.

Three install styles are handled:
  exe     - running as Cinder.exe (PyInstaller). Downloads the new exe from the
            latest release and swaps it in (Windows lets you rename a running exe).
  git     - running from a git clone. Runs `git pull --ff-only`.
  source  - running from an unzipped copy. Downloads the release source zip and
            unpacks it over the app folder.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from version import REPO, VERSION

API_LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"
EXE_ASSET = "Cinder.exe"
_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def parse_version(s: str) -> tuple[int, ...]:
    nums = [int(n) for n in re.findall(r"\d+", s or "")[:3]]
    return tuple(nums + [0] * (3 - len(nums)))


def http_get(url: str, timeout: float = 15, accept: str = "*/*") -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": f"Cinder/{VERSION}", "Accept": accept})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _download(url: str, dest: Path, progress) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": f"Cinder/{VERSION}", "Accept": "application/octet-stream"})
    with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total:
                progress(done / total)


class Updater:
    def __init__(self, app_dir: Path):
        self.app_dir = app_dir
        self.frozen = bool(getattr(sys, "frozen", False))
        self.exe = Path(sys.executable).resolve() if self.frozen else None
        if self.frozen:
            self.mode = "exe"
        elif (app_dir / ".git").exists() and shutil.which("git"):
            self.mode = "git"
        else:
            self.mode = "source"
        self._lock = threading.Lock()
        self._release: dict | None = None
        self.state = {
            "current": VERSION,
            "mode": self.mode,
            "latest": None,
            "available": False,
            "notes": "",
            "url": f"https://github.com/{REPO}/releases",
            "checked_at": 0,
            "busy": False,
            "phase": "",
            "progress": None,
            "error": None,
            "ready": False,  # update applied, restart needed
        }

    # -- housekeeping -------------------------------------------------------
    def cleanup(self) -> None:
        """Remove the previous exe left behind by an update."""
        if self.exe:
            old = self.exe.with_name(self.exe.name + ".old")
            try:
                old.unlink(missing_ok=True)
            except OSError:
                pass

    def _set(self, **kw):
        with self._lock:
            self.state.update(kw)

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self.state)

    # -- check --------------------------------------------------------------
    def check(self) -> dict:
        self._set(error=None)
        try:
            rel = json.loads(http_get(API_LATEST, accept="application/vnd.github+json"))
        except urllib.error.HTTPError as e:
            msg = "No releases published yet" if e.code == 404 else f"GitHub returned {e.code}"
            self._set(error=msg, checked_at=time.time())
            return self.snapshot()
        except Exception as e:
            self._set(error=f"Couldn't reach GitHub ({e.__class__.__name__})", checked_at=time.time())
            return self.snapshot()
        self._release = rel
        latest = (rel.get("tag_name") or "").lstrip("vV")
        available = parse_version(latest) > parse_version(VERSION)
        if available and self.mode == "exe" and not self._exe_asset():
            available = False
            self._set(error=f"Release {latest} has no {EXE_ASSET} yet (it may still be building)")
        self._set(
            latest=latest,
            available=available,
            notes=(rel.get("body") or "")[:4000],
            url=rel.get("html_url") or self.state["url"],
            checked_at=time.time(),
        )
        return self.snapshot()

    def check_async(self) -> None:
        threading.Thread(target=self.check, daemon=True).start()

    def _exe_asset(self) -> dict | None:
        for a in (self._release or {}).get("assets", []):
            if a.get("name", "").lower() == EXE_ASSET.lower():
                return a
        return None

    # -- apply --------------------------------------------------------------
    def apply_async(self) -> bool:
        with self._lock:
            if self.state["busy"] or not self.state["available"]:
                return False
            self.state.update(busy=True, error=None, phase="Starting", progress=None)
        threading.Thread(target=self._apply, daemon=True).start()
        return True

    def _apply(self):
        try:
            {"exe": self._apply_exe, "git": self._apply_git, "source": self._apply_source}[self.mode]()
            self._set(ready=True, available=False, phase="Restart Cinder to finish", progress=None)
        except Exception as e:
            self._set(error=str(e) or e.__class__.__name__, phase="", progress=None)
        finally:
            self._set(busy=False)

    def _apply_exe(self):
        asset = self._exe_asset()
        if not asset:
            raise RuntimeError("Release has no Cinder.exe")
        new = self.exe.with_name(self.exe.name + ".new")
        old = self.exe.with_name(self.exe.name + ".old")
        self._set(phase="Downloading")
        _download(asset["browser_download_url"], new, lambda p: self._set(progress=p))

        digest = (asset.get("digest") or "").lower()
        if digest.startswith("sha256:"):
            self._set(phase="Verifying")
            h = hashlib.sha256(new.read_bytes()).hexdigest()
            if h != digest.split(":", 1)[1]:
                new.unlink(missing_ok=True)
                raise RuntimeError("Download failed verification; nothing was changed")
        if new.stat().st_size < 1_000_000:
            new.unlink(missing_ok=True)
            raise RuntimeError("Downloaded file looks incomplete; nothing was changed")

        self._set(phase="Installing")
        old.unlink(missing_ok=True)
        os.replace(self.exe, old)  # renaming the running exe is allowed on Windows
        try:
            os.replace(new, self.exe)
        except OSError:
            os.replace(old, self.exe)  # roll back
            raise

    def _apply_git(self):
        self._set(phase="Pulling from GitHub")
        r = subprocess.run(
            ["git", "-C", str(self.app_dir), "pull", "--ff-only"],
            capture_output=True, text=True, creationflags=_NO_WINDOW, timeout=180,
        )
        if r.returncode:
            raise RuntimeError((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout) else "git pull failed")
        self._pip_install()

    def _apply_source(self):
        url = (self._release or {}).get("zipball_url")
        if not url:
            raise RuntimeError("Release has no source archive")
        self._set(phase="Downloading")
        with tempfile.TemporaryDirectory() as td:
            z = Path(td) / "src.zip"
            _download(url, z, lambda p: self._set(progress=p))
            self._set(phase="Installing", progress=None)
            with zipfile.ZipFile(z) as zf:
                for info in zf.infolist():
                    parts = Path(info.filename).parts[1:]  # strip "owner-repo-sha/"
                    if not parts or info.is_dir() or parts[0] in (".venv", ".git"):
                        continue
                    target = (self.app_dir / Path(*parts)).resolve()
                    if self.app_dir.resolve() not in target.parents:
                        continue  # never write outside the app folder
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(info) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
        self._pip_install()

    def _pip_install(self):
        req = self.app_dir / "requirements.txt"
        if req.exists():
            self._set(phase="Updating dependencies")
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "-q", "-r", str(req)],
                capture_output=True, creationflags=_NO_WINDOW, timeout=600,
            )

    # -- restart ------------------------------------------------------------
    def restart_command(self) -> list[str]:
        if self.frozen:
            return [str(self.exe)]
        return [sys.executable, str(self.app_dir / "main.py"), *sys.argv[1:]]

    def spawn_new(self) -> None:
        env = dict(os.environ)
        # Make the new Cinder.exe unpack into its own temp folder instead of reusing
        # this one's, so this copy can clean up after itself when it exits.
        env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
        for k in list(env):
            if k.startswith("_PYI_") or k in ("_MEIPASS2", "_PYI_ONEDIR_MODE"):
                env.pop(k, None)
        kw = {"cwd": str(self.app_dir), "env": env}
        if sys.platform == "win32":
            kw["creationflags"] = 0x00000008 | 0x00000200  # detached, new process group
        else:
            kw["start_new_session"] = True
        subprocess.Popen(self.restart_command(), **kw)
