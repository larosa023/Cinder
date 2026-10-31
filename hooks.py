"""Before & after playing: things Cinder does when a game starts, and undoes when it closes.

Each hook is one of:
  {"kind": "power", "value": "high" | "ultimate" | "balanced"}   switch the Windows power plan
  {"kind": "close", "value": "Discord.exe", "reopen": true}       close an app (and open it again after)
  {"kind": "run", "value": "C:\\path\\app.exe", "args": "", "close_after": true}  open a program
Hooks are set per game, plus a list that runs for every game. Nothing here comes from
anywhere but your own settings.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path

from cinderlog import log
from steamlib import IS_WIN

POWER = {
    "high": "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",       # High performance (SCHEME_MIN)
    "ultimate": "e9a42b02-d5df-448d-aa00-03f14749eb61",   # Ultimate Performance (not on every PC)
    "balanced": "381b4222-f694-41f0-9685-ff5bb260df2e",   # Balanced (SCHEME_BALANCED)
}
NO_WINDOW = 0x08000000 if IS_WIN else 0
DETACHED = 0x00000008 if IS_WIN else 0
EXE = re.compile(r"^[\w .()&+-]{1,80}\.exe$", re.I)


def _run(args: list[str], timeout: float = 10) -> str:
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, creationflags=NO_WINDOW)
        return (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        log.info("hook command %s failed: %r", args[0], e)
        return ""


def clean(hooks) -> list[dict]:
    """Only well-formed hooks get stored."""
    out = []
    for h in hooks if isinstance(hooks, list) else []:
        if not isinstance(h, dict):
            continue
        k, v = h.get("kind"), str(h.get("value") or "").strip()
        if k == "power" and v in POWER:
            out.append({"kind": k, "value": v})
        elif k == "close" and EXE.match(v):
            out.append({"kind": k, "value": v, "reopen": bool(h.get("reopen", True))})
        elif k == "run" and v and len(v) < 400:
            out.append({"kind": k, "value": v, "args": str(h.get("args") or "")[:400], "close_after": bool(h.get("close_after"))})
    return out[:12]


class Hooks:
    def __init__(self, data_dir: Path):
        self.file = data_dir / "hooks.json"
        self._lock = threading.Lock()
        try:
            self.data = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.data = {}
        self._undo: dict[int, list] = {}   # appid -> what to put back when it closes
        self._ran: dict[int, float] = {}   # appid -> when its before-hooks last ran

    def get(self, scope: str) -> list[dict]:
        with self._lock:
            return list(self.data.get(scope) or [])

    def set(self, scope: str, hooks) -> list[dict]:
        hooks = clean(hooks)
        with self._lock:
            if hooks:
                self.data[scope] = hooks
            else:
                self.data.pop(scope, None)
            tmp = self.file.with_suffix(".tmp")
            try:
                tmp.write_text(json.dumps(self.data), encoding="utf-8")
                tmp.replace(self.file)
            except OSError:
                pass
        return hooks

    def for_game(self, appid: int) -> list[dict]:
        return self.get("*") + self.get(str(appid))

    # -- running ---------------------------------------------------------------
    def before(self, appid: int) -> None:
        """Run a game's before-hooks once (launching through Cinder and the game appearing both call this)."""
        hooks = self.for_game(appid)
        if not hooks or not IS_WIN:
            return
        with self._lock:
            if time.time() - self._ran.get(appid, 0) < 120 or appid in self._undo:
                return
            self._ran[appid] = time.time()
            self._undo[appid] = []
        undo = []
        for h in hooks:
            try:
                u = self._do(h)
                if u:
                    undo.append(u)
            except Exception:
                log.exception("before-play hook %s", h.get("kind"))
        with self._lock:
            self._undo[appid] = undo
        log.info("before playing %s: ran %d hook(s)", appid, len(hooks))

    def after(self, appid: int) -> None:
        with self._lock:
            undo = self._undo.pop(appid, None)
            self._ran.pop(appid, None)
        if not undo:
            return
        time.sleep(2)  # let the game finish closing
        for u in reversed(undo):
            try:
                u()
            except Exception:
                log.exception("after-play hook")
        log.info("after playing %s: put %d thing(s) back", appid, len(undo))

    def _do(self, h: dict):
        k, v = h["kind"], h["value"]
        if k == "power":
            cur = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", _run(["powercfg", "/getactivescheme"]), re.I)
            want = POWER[v]
            out = _run(["powercfg", "/setactive", want])
            if v == "ultimate" and "error" in out.lower():  # not on this PC: add it once, then use it
                dup = re.search(r"([0-9a-f]{8}-[0-9a-f-]{27})", _run(["powercfg", "-duplicatescheme", want]), re.I)
                if dup:
                    _run(["powercfg", "/setactive", dup.group(1)])
            if cur and cur.group(1).lower() != want:
                prev = cur.group(1)
                return lambda: _run(["powercfg", "/setactive", prev])
            return None
        if k == "close":
            name = v[:-4]
            path = _run(["powershell", "-NoProfile", "-Command",
                         f"(Get-Process -Name '{name}' -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1).Path"]).strip()
            if not path:
                return None  # not running
            _run(["taskkill", "/IM", v])
            for _ in range(10):
                time.sleep(0.4)
                if v.lower() not in _run(["tasklist", "/FI", f"IMAGENAME eq {v}", "/NH"]).lower():
                    break
            else:
                _run(["taskkill", "/IM", v, "/F"])
            if h.get("reopen") and os.path.isfile(path):
                return lambda: subprocess.Popen([path], creationflags=DETACHED, close_fds=True)
            return None
        if k == "run":
            if not os.path.exists(v):
                log.info("before-play program missing: %s", v)
                return None
            args = [v] + (_split(h.get("args") or ""))
            p = subprocess.Popen(args, creationflags=DETACHED, close_fds=True, cwd=os.path.dirname(v) or None)
            if h.get("close_after"):
                return lambda: (p.poll() is None) and p.terminate()
            return None
        return None


def _split(s: str) -> list[str]:
    import shlex
    try:
        return shlex.split(s, posix=False)
    except ValueError:
        return s.split()
