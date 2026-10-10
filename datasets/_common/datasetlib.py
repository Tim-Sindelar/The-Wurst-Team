"""Shared helpers for the dataset fetchers in datasets/<name>/fetch.py.

Every fetcher prints (or writes with --out) one JSON document:

    {
      "dataset": "<name>",
      "fetchedAt": "<ISO time, UTC>",
      "at": "<the Zurich time asked for with --at, or null for now>",
      "sources": ["<url>", ...],
      "errors": ["<what failed>", ...],
      "items": [ { "id", "name", "lat", "lng", "approximate", "category",
                   "campus", "subtitle", "url", "details": {...} }, ... ]
    }

Items always come from the checked-in location files, so the map has
something to show offline; the live parts (menus, departures, ...) go into
"details" and anything that fails to load is listed in "errors".

`--at 2026-10-20T14:00` (Zurich time) asks for the data at another time:
build(at) gets it as an aware datetime (None for now). Each dataset.json says
under "time" how far its source supports that.

Stdlib only.
"""

import argparse
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request

USER_AGENT = "the-wurst-team campus map (student project)"
TIMEOUT = 25


def http_json(url, params=None, body=None, headers=None, timeout=TIMEOUT):
    """GET (or POST, with a JSON `body`) and parse the JSON answer."""
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
    data = None
    h = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_post_form(url, form, timeout=TIMEOUT):
    """POST a urlencoded form, parse the JSON answer (Overpass)."""
    data = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _zurich_offset(utc):
    """CET/CEST offset at a UTC time by the EU rule (summer time from the last Sunday
    of March to the last Sunday of October, 01:00 UTC), for systems without tzdata."""
    def last_sunday(month):
        d = dt.datetime(utc.year, month, 31, 1, tzinfo=dt.timezone.utc)
        return d - dt.timedelta(days=(d.weekday() + 1) % 7)
    return dt.timezone(dt.timedelta(hours=2 if last_sunday(3) <= utc < last_sunday(10) else 1))


def zurich_now():
    """Current time in Zurich (CET/CEST), without needing tzdata."""
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("Europe/Zurich"))
    except Exception:
        utc = dt.datetime.now(dt.timezone.utc)
        return utc.astimezone(_zurich_offset(utc))


def zurich_time(text):
    """'2026-10-20T14:00' (Zurich wall time) -> aware datetime."""
    local = dt.datetime.fromisoformat(text).replace(tzinfo=None, second=0, microsecond=0)
    try:
        from zoneinfo import ZoneInfo
        return local.replace(tzinfo=ZoneInfo("Europe/Zurich"))
    except Exception:
        # Guess the offset from the time read as UTC; only off for an hour on the switch nights.
        return local.replace(tzinfo=_zurich_offset(local.replace(tzinfo=dt.timezone.utc) - dt.timedelta(hours=1)))


def load_local(file_path, name):
    """Load a JSON file that sits next to the calling fetcher."""
    with open(os.path.join(os.path.dirname(os.path.abspath(file_path)), name), encoding="utf-8") as f:
        return json.load(f)


def error_text(what, err):
    return f"{what}: {type(err).__name__}: {err}"


def main(dataset, build):
    """Run `build(at) -> (items, sources, errors)` and write the document."""
    parser = argparse.ArgumentParser(description=f"Fetch the {dataset} dataset")
    parser.add_argument("--out", help="write here instead of stdout")
    parser.add_argument("--at", type=zurich_time, help="Zurich time to fetch the data for, e.g. 2026-10-20T14:00 (default: now)")
    args = parser.parse_args()
    items, sources, errors = build(args.at)
    at = args.at.strftime("%Y-%m-%dT%H:%M") if args.at else None
    doc = {"dataset": dataset, "fetchedAt": now_iso(), "at": at, "sources": sources, "errors": errors, "items": items}
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        tmp = args.out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, args.out)
    else:
        sys.stdout.buffer.write((text + "\n").encode("utf-8"))  # not the console code page (Windows)
    for e in errors:
        print(f"[{dataset}] {e}", file=sys.stderr)
