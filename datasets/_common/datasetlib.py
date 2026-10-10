"""Shared helpers for the dataset fetchers in datasets/<name>/fetch.py.

Every fetcher prints (or writes with --out) one JSON document:

    {
      "dataset": "<name>",
      "fetchedAt": "<ISO time, UTC>",
      "sources": ["<url>", ...],
      "errors": ["<what failed>", ...],
      "items": [ { "id", "name", "lat", "lng", "approximate", "category",
                   "campus", "subtitle", "url", "details": {...} }, ... ]
    }

Items always come from the checked-in location files, so the map has
something to show offline; the live parts (menus, departures, ...) go into
"details" and anything that fails to load is listed in "errors".

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


def zurich_now():
    """Current time in Zurich (CET/CEST), without needing tzdata."""
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("Europe/Zurich"))
    except Exception:
        utc = dt.datetime.now(dt.timezone.utc)
        # EU rule: summer time from the last Sunday of March to the last Sunday of October, 01:00 UTC.
        def last_sunday(month):
            d = dt.datetime(utc.year, month, 31, 1, tzinfo=dt.timezone.utc)
            return d - dt.timedelta(days=(d.weekday() + 1) % 7)
        offset = 2 if last_sunday(3) <= utc < last_sunday(10) else 1
        return utc.astimezone(dt.timezone(dt.timedelta(hours=offset)))


def load_local(file_path, name):
    """Load a JSON file that sits next to the calling fetcher."""
    with open(os.path.join(os.path.dirname(os.path.abspath(file_path)), name), encoding="utf-8") as f:
        return json.load(f)


def error_text(what, err):
    return f"{what}: {type(err).__name__}: {err}"


def main(dataset, build):
    """Run `build() -> (items, sources, errors)` and write the document."""
    parser = argparse.ArgumentParser(description=f"Fetch the {dataset} dataset")
    parser.add_argument("--out", help="write here instead of stdout")
    args = parser.parse_args()
    items, sources, errors = build()
    doc = {"dataset": dataset, "fetchedAt": now_iso(), "sources": sources, "errors": errors, "items": items}
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        tmp = args.out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, args.out)
    else:
        sys.stdout.write(text + "\n")
    for e in errors:
        print(f"[{dataset}] {e}", file=sys.stderr)
