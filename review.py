"""Year (or month) in review, from the sessions Cinder has seen and your achievement unlock times."""

from __future__ import annotations

import time
from datetime import datetime, timedelta


def _bounds(period: str) -> tuple[float, float, str]:
    now = datetime.now()
    try:
        if len(period) == 7:  # 2026-10
            y, m = int(period[:4]), int(period[5:])
            a = datetime(y, m, 1)
            b = datetime(y + (m == 12), m % 12 + 1, 1)
            return a.timestamp(), b.timestamp(), a.strftime("%B %Y")
        y = int(period[:4])
        return datetime(y, 1, 1).timestamp(), datetime(y + 1, 1, 1).timestamp(), str(y)
    except (ValueError, IndexError):
        return datetime(now.year, 1, 1).timestamp(), datetime(now.year + 1, 1, 1).timestamp(), str(now.year)


def periods(sessions: list, ach_times: list[int]) -> list[dict]:
    """Years and months you have anything for, newest first."""
    seen = set()
    for _, s, _e in sessions:
        seen.add(datetime.fromtimestamp(s).strftime("%Y-%m"))
    for t in ach_times:
        seen.add(datetime.fromtimestamp(t).strftime("%Y-%m"))
    months = sorted(seen, reverse=True)
    years = sorted({m[:4] for m in months}, reverse=True)
    out = []
    for y in years:
        out.append({"id": y, "label": y})
        out += [{"id": m, "label": datetime.strptime(m, "%Y-%m").strftime("%B %Y")} for m in months if m.startswith(y)]
    return out


def build(period: str, sessions: list, library: list[dict], ach_games: dict) -> dict:
    a, b, label = _bounds(period)
    names = {g["appid"]: g["name"] for g in library}
    sess = [(int(ap), max(s, a), min(e, b)) for ap, s, e in sessions if e > a and s < b]
    per_game: dict[int, float] = {}
    per_day: dict[str, float] = {}
    weekday = [0.0] * 7
    hours = [0.0] * 24
    longest = None
    first_seen: dict[int, float] = {}
    for ap, s, e in sessions:
        first_seen[int(ap)] = min(first_seen.get(int(ap), s), s)
    for ap, s, e in sess:
        dur = e - s
        per_game[ap] = per_game.get(ap, 0) + dur
        if not longest or dur > longest[2]:
            longest = (ap, s, dur)
        t = s
        while t < e:
            d = datetime.fromtimestamp(t)
            nxt = min(e, (d.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).timestamp())
            part = nxt - t
            per_day[d.strftime("%Y-%m-%d")] = per_day.get(d.strftime("%Y-%m-%d"), 0) + part
            weekday[d.weekday()] += part
            hours[d.hour] += part
            t = nxt
    total = sum(per_game.values())
    # Days in a row with some play.
    streak, best = 0, 0
    days = sorted(per_day)
    prev = None
    for d in days:
        cur = datetime.strptime(d, "%Y-%m-%d")
        streak = streak + 1 if prev and (cur - prev).days == 1 else 1
        best = max(best, streak)
        prev = cur
    # Achievements unlocked in the period.
    unlocked, rarest, per_game_ach = 0, None, {}
    for appid, g in (ach_games or {}).items():
        for it in g.get("items") or []:
            t = it.get("time") or 0
            if it.get("unlocked") and a <= t < b:
                unlocked += 1
                per_game_ach[int(appid)] = per_game_ach.get(int(appid), 0) + 1
                p = it.get("percent")
                if p is not None and (rarest is None or p < rarest["percent"]):
                    rarest = {"appid": int(appid), "game": names.get(int(appid), ""), "name": it.get("name"), "icon": it.get("icon"),
                              "percent": p, "time": t}
    perfect = [int(ap) for ap, g in (ach_games or {}).items()
               if g.get("total") and g.get("unlocked") == g.get("total")
               and a <= max((it.get("time") or 0) for it in g.get("items") or [{}]) < b]
    top = sorted(per_game.items(), key=lambda x: -x[1])[:10]
    busiest = max(per_day.items(), key=lambda x: x[1]) if per_day else None
    new_games = [ap for ap, t in first_seen.items() if a <= t < b]
    wd = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]
    return {
        "period": period, "label": label, "since": min((s for _, s, _e in sessions), default=0),
        "hours": round(total / 3600, 1), "sessions": len(sess), "games": len(per_game), "days": len(per_day),
        "top": [{"appid": ap, "name": names.get(ap, f"App {ap}"), "hours": round(sec / 3600, 1),
                 "share": round(100 * sec / total) if total else 0, "achievements": per_game_ach.get(ap, 0)} for ap, sec in top],
        "longest": {"appid": longest[0], "name": names.get(longest[0], ""), "start": int(longest[1]), "hours": round(longest[2] / 3600, 1)} if longest else None,
        "busiest": {"day": busiest[0], "hours": round(busiest[1] / 3600, 1)} if busiest else None,
        "streak": best,
        "weekday": max(range(7), key=lambda i: weekday[i]) if total else None, "weekday_name": wd[max(range(7), key=lambda i: weekday[i])] if total else "",
        "hour": max(range(24), key=lambda i: hours[i]) if total else None,
        "by_hour": [round(h / 3600, 2) for h in hours],
        "achievements": unlocked, "rarest": rarest, "perfect": [{"appid": ap, "name": names.get(ap, "")} for ap in perfect],
        "new_games": [{"appid": ap, "name": names.get(ap, f"App {ap}")} for ap in sorted(new_games, key=lambda x: first_seen[x])][:12],
        "generated": int(time.time()),
    }
