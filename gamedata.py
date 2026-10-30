"""Things Cinder keeps about your games: notes/ratings/status, play sessions, launch options.

Stored as small JSON files next to config.json in %APPDATA%/Cinder.
"""

from __future__ import annotations

import json
import re
import shutil
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from cinderlog import log

STATUSES = ("playing", "backlog", "beaten", "completed", "dropped")


class _JsonFile:
    def __init__(self, path: Path, default):
        self.path = path
        self.lock = threading.Lock()
        try:
            self.data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.data = default

    def save(self):
        try:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, separators=(",", ":")), encoding="utf-8")
            tmp.replace(self.path)
        except OSError:
            log.exception("couldn't save %s", self.path.name)


# ------------------------------------------------------------- notes & ratings

class GameMeta(_JsonFile):
    """{appid: {"note", "rating" (0-5), "status"}}"""

    def __init__(self, data_dir: Path):
        super().__init__(data_dir / "games.json", {})

    def all(self) -> dict:
        with self.lock:
            return {k: dict(v) for k, v in self.data.items()}

    def update(self, appid: int, fields: dict) -> dict:
        key = str(int(appid))
        with self.lock:
            cur = dict(self.data.get(key) or {})
            if "note" in fields:
                cur["note"] = str(fields["note"] or "")[:4000]
            if "rating" in fields:
                try:
                    cur["rating"] = max(0, min(5, int(fields["rating"] or 0)))
                except (TypeError, ValueError):
                    pass
            if "status" in fields:
                st = str(fields["status"] or "")
                cur["status"] = st if st in STATUSES else ""
            cur = {k: v for k, v in cur.items() if v}  # drop empty fields
            if cur:
                self.data[key] = cur
            else:
                self.data.pop(key, None)
            self.save()
            return cur


# ------------------------------------------------------------------ sessions

class Sessions(_JsonFile):
    """Play sessions Cinder saw: [[appid, start, end], ...] (newest last)."""
    MAX = 20000

    def __init__(self, data_dir: Path):
        super().__init__(data_dir / "sessions.json", [])
        if not isinstance(self.data, list):
            self.data = []

    def record(self, appid: int, start: float, end: float) -> None:
        if not appid or end - start < 30:  # crashes at launch and the like aren't sessions
            return
        with self.lock:
            self.data.append([int(appid), int(start), int(end)])
            if len(self.data) > self.MAX:
                del self.data[: len(self.data) - self.MAX]
            self.save()

    def stats(self, library: list[dict], playing: dict | None = None) -> dict:
        now = time.time()
        with self.lock:
            sess = [list(s) for s in self.data]
        if playing and playing.get("appid") and playing.get("since"):
            sess.append([playing["appid"], int(playing["since"]), int(now)])  # include the game you're in
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

        # Minutes per local day (sessions split at midnight).
        per_day: dict[str, float] = {}
        per_game_30: dict[int, float] = {}
        weekday = [0.0] * 7
        hours = [0.0] * 24
        for a, s, e in sess:
            t = s
            while t < e:
                d = datetime.fromtimestamp(t)
                nxt = (d.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)).timestamp()
                end = min(e, nxt)
                mins = (end - t) / 60
                key = d.strftime("%Y-%m-%d")
                per_day[key] = per_day.get(key, 0) + mins
                weekday[d.weekday()] += mins
                hours[d.hour] += mins
                if t >= now - 30 * 86400:
                    per_game_30[a] = per_game_30.get(a, 0) + mins
                t = end

        def day_key(n):
            return (today - timedelta(days=n)).strftime("%Y-%m-%d")

        days = [{"date": day_key(n), "minutes": round(per_day.get(day_key(n), 0))} for n in range(29, -1, -1)]
        week = sum(per_day.get(day_key(n), 0) for n in range(7))
        month = sum(per_day.get(day_key(n), 0) for n in range(30))

        # Streaks: days in a row with at least 5 minutes played.
        played_days = {k for k, v in per_day.items() if v >= 5}
        cur = 0
        n = 0 if day_key(0) in played_days else 1  # today not played yet doesn't break it
        while day_key(n) in played_days:
            cur += 1
            n += 1
        best, run, prev = 0, 0, None
        for k in sorted(played_days):
            d = datetime.strptime(k, "%Y-%m-%d")
            run = run + 1 if prev and (d - prev).days == 1 else 1
            best, prev = max(best, run), d
        names = {g["appid"]: g["name"] for g in library}
        longest = max(sess, key=lambda x: x[2] - x[1], default=None)
        played = [g for g in library if g.get("playtime")]
        return {
            "tracking_since": sess[0][1] if sess else 0,
            "sessions": len(sess),
            "week": round(week), "month": round(month),
            "two_weeks_steam": sum(int(g.get("playtime_2wks") or 0) for g in library),
            "total": sum(int(g.get("playtime") or 0) for g in library),
            "days": days,
            "weekday": [round(x) for x in weekday],
            "hours": [round(x) for x in hours],
            "streak": cur, "best_streak": best,
            "longest": {"appid": longest[0], "name": names.get(longest[0], f"App {longest[0]}"),
                        "minutes": round((longest[2] - longest[1]) / 60), "date": longest[1]} if longest else None,
            "recent_top": [{"appid": a, "name": names.get(a, f"App {a}"), "minutes": round(m)}
                           for a, m in sorted(per_game_30.items(), key=lambda x: -x[1])[:8]],
            "all_top": [{"appid": g["appid"], "name": g["name"], "minutes": g["playtime"]}
                        for g in sorted(played, key=lambda g: -g["playtime"])[:10]],
            "recent": [{"appid": a, "name": names.get(a, f"App {a}"), "start": s, "minutes": round((e - s) / 60)}
                       for a, s, e in reversed(sess[-15:])],
            "played_count": len(played), "library_count": len(library),
        }


# ------------------------------------------------------------- launch options

def _find_block(text: str, start: int, key: str) -> tuple[int, int] | None:
    """Find `"key" { ... }` at the top level of text[start:...] (within one block's body).

    Returns (open_brace_index, close_brace_index) or None. Keys match case-insensitively.
    """
    i, depth, n = start, 0, len(text)
    want = key.lower()
    last_key = None
    while i < n:
        c = text[i]
        if c == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            tok = text[i + 1:j]
            i = j + 1
            if depth == 0:
                last_key = tok if last_key is None else None  # key, then value
            continue
        if c == "{":
            if depth == 0 and last_key is not None and last_key.lower() == want:
                # matching close brace
                d, k = 1, i + 1
                while k < n and d:
                    if text[k] == '"':
                        k += 1
                        while k < n and text[k] != '"':
                            k += 2 if text[k] == "\\" else 1
                    elif text[k] == "{":
                        d += 1
                    elif text[k] == "}":
                        d -= 1
                    k += 1
                return i, k - 1
            depth += 1
            last_key = None
        elif c == "}":
            if depth == 0:
                return None  # end of the enclosing block
            depth -= 1
            last_key = None
        elif c == "/" and text.startswith("//", i):
            nl = text.find("\n", i)
            i = n if nl < 0 else nl
            continue
        i += 1
    return None


def _esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


def set_launch_options_in_text(text: str, appid: int, options: str) -> str | None:
    """Return localconfig.vdf text with this app's LaunchOptions set (None if the layout is unexpected)."""
    pos = 0
    for k in ("UserLocalConfigStore", "Software", "Valve", "Steam", "apps"):
        b = _find_block(text, pos, k)
        if not b:
            return None
        pos = b[0] + 1
    apps_open, apps_close = b
    app = _find_block(text, apps_open + 1, str(appid))
    line = f'"LaunchOptions"\t\t"{_esc(options)}"'
    if not app:
        # Add a block for the app at the end of "apps".
        indent = "\t\t\t\t\t"
        block = f'\t"{appid}"\n{indent}{{\n{indent}\t{line}\n{indent}}}\n{indent[:-1]}'
        return text[:apps_close] + block + text[apps_close:]
    a_open, a_close = app
    body = text[a_open + 1:a_close]
    m = re.search(r'"LaunchOptions"\s+"((?:[^"\\]|\\.)*)"', body, re.I)
    if m:
        new_body = body[:m.start()] + line + body[m.end():]
    else:
        tail = body[len(body.rstrip()):]  # the whitespace before the closing brace
        ind = re.search(r"\n([ \t]*)\"", body)
        pad = ind.group(1) if ind else "\t\t\t\t\t\t"
        new_body = body.rstrip() + "\n" + pad + line + (tail if "\n" in tail else "\n\t\t\t\t\t")
    return text[:a_open + 1] + new_body + text[a_close:]


class LaunchOptions(_JsonFile):
    """Launch options waiting to be written into Steam's localconfig.vdf (Steam overwrites it while running)."""

    def __init__(self, data_dir: Path):
        super().__init__(data_dir / "launch_options_pending.json", {})

    def pending(self) -> dict:
        with self.lock:
            return dict(self.data)

    def queue(self, appid: int, options: str) -> None:
        with self.lock:
            self.data[str(int(appid))] = options
            self.save()

    def apply_to_file(self, path: Path) -> list[str]:
        """Write every pending option into localconfig.vdf (Steam must be closed). Returns applied appids."""
        with self.lock:
            todo = dict(self.data)
        if not todo:
            return []
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            return []
        done = []
        for a, opts in todo.items():
            new = set_launch_options_in_text(text, int(a), opts)
            if new is None:
                log.warning("launch options: unexpected localconfig layout, not changing it")
                return []
            text = new
            done.append(a)
        try:
            backup = path.with_name("localconfig.vdf.cinder-backup")
            shutil.copy2(path, backup)
            tmp = path.with_suffix(".cinder-tmp")
            tmp.write_text(text, encoding="utf-8")
            tmp.replace(path)
        except OSError:
            log.exception("launch options: couldn't write localconfig")
            return []
        with self.lock:
            for a in done:
                if self.data.get(a) == todo[a]:
                    self.data.pop(a, None)
            self.save()
        log.info("launch options written for %s", done)
        return done
