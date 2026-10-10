#!/usr/bin/env python3
"""ETH room occupancy dashboard.

Visualises everything the (undocumented) ETH Room Info API exposes - see
eth-room-occupancy-api.md - plus the live UZH library study-space occupancy,
which is the closest public "surrounding occupancy" source.

The ETH API sends no CORS headers, so a browser page cannot call it directly.
This script runs a small local server that proxies + caches the API calls and
serves a single-page dashboard.

    python eth_room_dashboard.py            # opens http://127.0.0.1:8765
    python eth_room_dashboard.py --port 9000 --no-browser
    python eth_room_dashboard.py --snapshot # refresh the map snapshot if stale, then exit

Stdlib only. Responses are cached on disk (system temp dir) so a reload of the
same day does not hit ETH ~450 times again.

The occupancy map (occupancy-map-preview) reads /api/snapshot: every room
with today's bookings in one document. It is kept in a local file together
with the time it was fetched (--snapshot-file, default
occupancy-map-preview/data/cache/eth-rooms.json) and fetched again from ETH
at most once an hour, or when the day changed. Every fetch is logged with its
timestamp to the same path with a .log suffix.

ETH Room Info endpoints used (base: https://ethz.ch/bin/ethz/roominfo?path=):
    /rooms                                   room list incl. equipment fields
    /types&lang=en                           room type codes -> English names
    /buildings                               building codes, names, floors
    /locations                               campus areas / regions
    /min-max-allocation-date                 date window with booking data
    /rooms/<B F R>/allocations&from=&to=     bookings of one room
    /v2/rooms/<B F R>&lang=en                full room detail (tabs, images)
    /v2/files/<id>                           room photos / PDF attachments
    /v2/roomgroup&building=&floor=&room=     room-group ids (not visualised)
    /v2/filters&lang=en                      equipment filter catalogue
Nearby occupancy:
    https://www.ub.uzh.ch/en/ub-besuchen/belegung-alle.html   UZH library
    https://hbzwwws04.uzh.ch/occusense/occusense_progressbar_150_en.php?id=N
"""

import argparse
import datetime as dt
import gzip
import hashlib
import html
import json
import os
import re
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ETH_BASE = "https://ethz.ch/bin/ethz/roominfo?path="
UZH_PAGE = "https://www.ub.uzh.ch/en/ub-besuchen/belegung-alle.html"
UZH_WIDGET = "https://hbzwwws04.uzh.ch/occusense/occusense_progressbar_150_en.php?id={}"
CACHE_DIR = os.path.join(tempfile.gettempdir(), "eth_room_dashboard_cache")
USER_AGENT = "the-wurst-team room dashboard (hackathon prototype)"

META_TTL = 24 * 3600
DAY_TTL = 6 * 3600
DETAIL_TTL = 24 * 3600
UZH_TTL = 120
SNAPSHOT_TTL = 3600
# After a failed snapshot fetch, wait this long before trying ETH again.
SNAPSHOT_RETRY = 300
WORKERS = 12
SNAPSHOT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "occupancy-map-preview", "data", "cache", "eth-rooms.json")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ROOM_RE = re.compile(r"^[A-Z0-9]{1,6} [A-Z0-9]{1,3} [A-Za-z0-9.\-]{1,12}$")


# --------------------------------------------------------------------------- #
# HTTP + cache
# --------------------------------------------------------------------------- #

def http_get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(), resp.headers.get_content_type()


_mem_cache = {}
_cache_lock = threading.Lock()


def cached(key, ttl, fetch):
    """Memory + disk cache for JSON-serialisable values."""
    now = time.time()
    with _cache_lock:
        hit = _mem_cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    path = os.path.join(CACHE_DIR, hashlib.sha1(key.encode()).hexdigest() + ".json")
    try:
        mtime = os.path.getmtime(path)
        if now - mtime < ttl:
            with open(path, encoding="utf-8") as f:
                value = json.load(f)
            with _cache_lock:
                _mem_cache[key] = (mtime, value)
            return value
    except (OSError, ValueError):
        pass
    value = fetch()
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f)
    with _cache_lock:
        _mem_cache[key] = (now, value)
    return value


def eth_url(path, **params):
    url = ETH_BASE + urllib.parse.quote(path, safe="/")
    for k, v in params.items():
        url += f"&{k}={urllib.parse.quote(str(v))}"
    return url


def eth_file(fid):
    """Room photo or attachment. Files never change under their id, so they are kept on disk."""
    path = os.path.join(CACHE_DIR, f"file-{fid}")
    try:
        with open(path + ".type", encoding="utf-8") as f:
            ctype = f.read().strip()
        with open(path, "rb") as f:
            return f.read(), ctype
    except OSError:
        pass
    body, ctype = http_get(eth_url(f"/v2/files/{fid}"))
    if ctype.startswith(("image/", "application/pdf")):
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)
        with open(path + ".type", "w", encoding="utf-8") as f:
            f.write(ctype)
    return body, ctype


def eth_json(path, ttl, **params):
    url = eth_url(path, **params)

    def fetch():
        body, ctype = http_get(url)
        # Unknown paths answer 200 with an HTML error page instead of a 404.
        if ctype != "application/json":
            raise ValueError(f"ETH returned {ctype} for {path}")
        return json.loads(body.decode("utf-8"))

    return cached(url, ttl, fetch)


# --------------------------------------------------------------------------- #
# ETH data
# --------------------------------------------------------------------------- #

def room_id(room):
    return f"{room['building']} {room['floor']} {room['room']}"


def get_meta():
    return {
        "rooms": eth_json("/rooms", META_TTL),
        "types": eth_json("/types", META_TTL, lang="en"),
        "buildings": eth_json("/buildings", META_TTL, lang="en"),
        "locations": eth_json("/locations", META_TTL, lang="en"),
        "minmax": eth_json("/min-max-allocation-date", META_TTL),
    }


def normalize_allocation(a):
    series = a.get("belegungsserie") or {}
    event = series.get("veranstaltung")
    btype = series.get("belegungstyp")
    if event is None:
        kind = "closed" if btype == 8 else "reserved"
    elif event.get("findetStatt") == 0:
        kind = "cancelled"
    elif event.get("veranstaltungstyp") == "Lehrveranstaltung":
        kind = {"V": "lecture", "U": "exercise", "G": "lecture_exercise"}.get(
            event.get("lehrveranstaltungstyp"), "course_other")
    else:
        kind = "event"
    event = event or {}
    return {
        "start": a.get("date_from"),
        "end": a.get("date_to"),
        "kind": kind,
        "btype": btype,
        "title": event.get("allocationTitle"),
        "number": event.get("veranstaltungsnummer"),
        "organiser": event.get("veranstalter"),
        "eventType": event.get("veranstaltungstyp"),
        "courseType": event.get("lehrveranstaltungstyp"),
    }


def room_allocations(rid, date_from, date_to, ttl=DAY_TTL):
    raw = eth_json(f"/rooms/{rid}/allocations", ttl, **{"from": date_from, "to": date_to})
    return [normalize_allocation(a) for a in raw if a.get("date_from") and a.get("date_to")]


# One background job per date fans out one request per room (~446) and
# reports progress so the page can show a loading bar.
_day_jobs = {}
_jobs_lock = threading.Lock()


def _run_day_job(date, job):
    try:
        ids = [room_id(r) for r in get_meta()["rooms"]]
        job["total"] = len(ids)
        rooms, errors = {}, {}

        def one(rid):
            return rid, room_allocations(rid, date, date)

        with ThreadPoolExecutor(WORKERS) as pool:
            futures = {pool.submit(one, rid): rid for rid in ids}
            for fut in as_completed(futures):
                rid = futures[fut]
                try:
                    rooms[rid] = fut.result()[1]
                except Exception as e:  # keep going, report per room
                    errors[rid] = str(e)
                job["done"] += 1
        job["data"] = {"date": date, "rooms": rooms, "errors": errors}
        job["state"] = "done"
    except Exception as e:
        job["error"] = str(e)
        job["state"] = "error"
    job["finished"] = time.time()


def day_job(date):
    with _jobs_lock:
        job = _day_jobs.get(date)
        stale = job and job["state"] != "running" and (
            job["state"] == "error" or time.time() - job["finished"] > DAY_TTL)
        if job is None or stale:
            job = {"state": "running", "done": 0, "total": 0, "data": None, "error": None}
            _day_jobs[date] = job
            threading.Thread(target=_run_day_job, args=(date, job), daemon=True).start()
    return job


# --------------------------------------------------------------------------- #
# Map snapshot: all rooms + today's bookings, refreshed at most hourly
# --------------------------------------------------------------------------- #

BUSY_KINDS = {"lecture", "exercise", "lecture_exercise", "course_other", "event", "reserved"}
EQUIPMENT = [
    ("Projector", lambda r: bool(r.get("beamer"))),
    ("Speakers", lambda r: bool(r.get("speakers"))),
    ("HDMI input", lambda r: (num(r.get("hdmiConnections")) or 0) > 0),
    ("Microphones", lambda r: (num(r.get("microphones")) or 0) + (num(r.get("microphonesWireless")) or 0) > 0),
    ("Board / wallchart", lambda r: bool(r.get("wallchart"))),
    ("Lecturer desk", lambda r: bool(r.get("lecturersDesk"))),
    ("Projection screen", lambda r: bool(r.get("projectionScreen"))),
    ("Recording", lambda r: bool(r.get("record"))),
    ("Visualizer", lambda r: bool(r.get("visualizer"))),
    ("Video conference", lambda r: bool(r.get("videoConference"))),
    ("Hearing assistance", lambda r: bool(r.get("hearingImpairedSupport"))),
    ("Lecture transmission", lambda r: bool(r.get("dataTransfer"))),
]


def num(v):
    """Seats etc. come back as numbers or numeric strings."""
    try:
        return None if v is None or v == "" else float(v)
    except (TypeError, ValueError):
        return None


def zurich_now():
    """Booking times are Zurich local time, whatever the machine's time zone."""
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("Europe/Zurich"))
    except Exception:  # no tz database (e.g. Windows without tzdata)
        return dt.datetime.now().astimezone()


def to_minute(stamp, date):
    """'2026-10-10T08:15:00' -> minutes after midnight of `date`, clamped to the day."""
    d = stamp[:10]
    if d < date:
        return 0
    if d > date:
        return 1440
    h, m = int(stamp[11:13]), int(stamp[14:16])
    return 1440 if (h, m) == (23, 59) else h * 60 + m


def snapshot_room(r, allocations, date, type_names, error=None):
    bookings = []
    for a in allocations:
        s, e = to_minute(a["start"], date), to_minute(a["end"], date)
        if e > s:
            bookings.append({"s": s, "e": e, "kind": a["kind"], "title": a["title"],
                             "number": a["number"], "organiser": a["organiser"]})
    bookings.sort(key=lambda b: (b["s"], b["e"]))
    seats, workplaces = num(r.get("seats")), num(r.get("workplaces"))
    return {
        "id": room_id(r),
        "building": r["building"],
        "floor": r["floor"],
        "room": r["room"],
        "type": type_names.get(r.get("typecode")) or r.get("type") or "Unknown",
        "seats": int(seats) if seats is not None else None,
        "workplaces": int(workplaces) if workplaces is not None else None,
        "campus": (r.get("location") or {}).get("areaDesc"),
        "equipment": [label for label, has in EQUIPMENT if has(r)],
        "bookings": bookings,
        "error": error,
    }


def build_snapshot(progress):
    """Every room with its bookings for today (Zurich), as the map consumes it."""
    started = time.time()
    meta = get_meta()
    date = zurich_now().date().isoformat()
    type_names = {t.get("typecode"): t.get("type") for t in meta["types"]}
    rooms = meta["rooms"]
    progress["total"], progress["done"] = len(rooms), 0
    allocations, errors = {}, {}
    with ThreadPoolExecutor(WORKERS) as pool:
        futures = {pool.submit(room_allocations, room_id(r), date, date, SNAPSHOT_TTL): room_id(r) for r in rooms}
        for fut in as_completed(futures):
            rid = futures[fut]
            try:
                allocations[rid] = fut.result()
            except Exception as e:  # keep going, the room shows as "no data"
                errors[rid] = str(e)
            progress["done"] += 1
    return {
        "schemaVersion": 1,
        "fetchedAt": zurich_now().isoformat(timespec="seconds"),
        "date": date,
        "ttlSeconds": SNAPSHOT_TTL,
        "fetchSeconds": round(time.time() - started, 1),
        "source": ETH_BASE,
        "buildings": {b.get("code"): b.get("name") for b in meta["buildings"]},
        "rooms": [snapshot_room(r, allocations.get(room_id(r), []), date, type_names, errors.get(room_id(r)))
                  for r in rooms],
        "errors": len(errors),
    }


def read_snapshot(path):
    try:
        with open(path, encoding="utf-8") as f:
            snap = json.load(f)
        return snap if isinstance(snap, dict) and snap.get("fetchedAt") else None
    except (OSError, ValueError):
        return None


def snapshot_age(snap, now=None):
    """Seconds since the snapshot was fetched; None if it has no usable timestamp."""
    try:
        fetched = dt.datetime.fromisoformat(snap["fetchedAt"])
    except (TypeError, KeyError, ValueError):
        return None
    now = now or zurich_now()
    if fetched.tzinfo is None:
        fetched = fetched.astimezone()
    return (now - fetched).total_seconds()


def snapshot_stale(snap, now=None):
    """Older than an hour, from another day, or missing."""
    if not snap:
        return True
    now = now or zurich_now()
    age = snapshot_age(snap, now)
    return age is None or age >= SNAPSHOT_TTL or snap.get("date") != now.date().isoformat()


def write_snapshot(path, snap):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def log_fetch(path, line):
    """Appends one line per ETH fetch, starting with its timestamp, to <snapshot>.log."""
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(os.path.splitext(path)[0] + ".log", "a", encoding="utf-8") as f:
            f.write(f"{zurich_now().isoformat(timespec='seconds')}\t{line}\n")
    except OSError:
        pass


class Snapshots:
    """The snapshot file plus at most one background refresh at a time."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.value = read_snapshot(path)
        self.running = False
        self.progress = {"done": 0, "total": 0}
        self.error = None
        self.failed_at = 0.0

    def refresh(self):
        """Fetches from ETH and stores the result; keeps the old snapshot on failure."""
        try:
            snap = build_snapshot(self.progress)
            write_snapshot(self.path, snap)
            log_fetch(self.path, f"ok\tdate={snap['date']}\trooms={len(snap['rooms'])}"
                                 f"\terrors={snap['errors']}\tseconds={snap['fetchSeconds']}")
            with self.lock:
                self.value, self.error = snap, None
        except Exception as e:
            log_fetch(self.path, f"failed\t{type(e).__name__}: {e}")
            with self.lock:
                self.error, self.failed_at = f"{type(e).__name__}: {e}", time.time()
        finally:
            with self.lock:
                self.running = False

    def status(self, background=True):
        """Current snapshot and refresh state; starts a refresh when it is stale."""
        with self.lock:
            # Another process (e.g. a cron --snapshot run) may have written a newer file.
            if snapshot_stale(self.value):
                on_disk = read_snapshot(self.path)
                if on_disk and not snapshot_stale(on_disk):
                    self.value = on_disk
            start = (snapshot_stale(self.value) and not self.running
                     and time.time() - self.failed_at >= SNAPSHOT_RETRY)
            if start:
                self.running, self.progress = True, {"done": 0, "total": 0}
        if start:
            if background:
                threading.Thread(target=self.refresh, daemon=True).start()
            else:
                self.refresh()
        with self.lock:
            snap = self.value
            age = snapshot_age(snap) if snap else None
            return {
                "state": "running" if self.running else "error" if self.error and snapshot_stale(snap) else "ok",
                "done": self.progress["done"],
                "total": self.progress["total"],
                "error": self.error,
                "stale": snapshot_stale(snap),
                "ageSeconds": None if age is None else round(age),
                "nextFetchInSeconds": None if age is None else max(0, round(SNAPSHOT_TTL - age)),
                "snapshot": snap,
            }


snapshots = None  # set in main()


# --------------------------------------------------------------------------- #
# UZH library occupancy (nearest public live occupancy source)
# --------------------------------------------------------------------------- #

def _uzh_fetch():
    page = http_get(UZH_PAGE)[0].decode("utf-8", "replace")
    # The page is a table: a row of location names, then a row of iframes
    # (one occusense widget per name), repeated.
    locations, names = [], []
    for row in re.findall(r"<tr.*?</tr>", page, re.S):
        ids = re.findall(r"occusense_progressbar_\d+_en\.php\?id=(\d+)", row)
        if ids:
            locations += [{"id": i, "name": n} for i, n in zip(ids, names)]
            names = []
        else:
            cells = [" ".join(html.unescape(re.sub(r"<[^>]+>", " ", c)).split())
                     for c in re.findall(r"<t[hd][ >].*?</t[hd]>", row, re.S)]
            names = [c for c in cells if c]

    def widget(loc):
        body = http_get(UZH_WIDGET.format(loc["id"]))[0].decode("utf-8", "replace")
        label = re.search(r"text:\s*\{\s*value:\s*'([^']*)'", body)
        frac = re.search(r"bar\.animate\(\s*([\d.]+)\s*\)", body)
        return {**loc,
                "label": label.group(1) if label else "",
                "fraction": float(frac.group(1)) if frac else None}

    if not locations:
        raise ValueError("no occupancy widgets found on the UZH page")
    with ThreadPoolExecutor(6) as pool:
        locations = list(pool.map(widget, locations))
    return {"fetchedAt": dt.datetime.now().isoformat(timespec="seconds"),
            "source": UZH_PAGE, "locations": locations}


def uzh_occupancy():
    return cached("uzh-occupancy", UZH_TTL, _uzh_fetch)


# --------------------------------------------------------------------------- #
# HTTP server
# --------------------------------------------------------------------------- #

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json", cache=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        # Large uncompressed bodies got reset mid-transfer on Windows; gzip
        # keeps the room list ~10x smaller.
        if len(body) > 1024 and not ctype.startswith("image/") and                 "gzip" in self.headers.get("Accept-Encoding", ""):
            body = gzip.compress(body, 5)
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        if cache:
            self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(body)

    def _bad(self, msg):
        self._send(400, {"error": msg})

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        try:
            if url.path == "/":
                self._send(200, PAGE, "text/html; charset=utf-8")
            elif url.path == "/api/meta":
                self._send(200, get_meta())
            elif url.path == "/api/day":
                date = q.get("date", "")
                if not DATE_RE.match(date):
                    return self._bad("date must be YYYY-MM-DD")
                job = day_job(date)
                self._send(200, {k: job[k] for k in ("state", "done", "total", "data", "error")})
            elif url.path == "/api/allocs":
                rid, f, t = q.get("id", ""), q.get("from", ""), q.get("to", "")
                if not (ROOM_RE.match(rid) and DATE_RE.match(f) and DATE_RE.match(t)):
                    return self._bad("need id, from, to")
                self._send(200, room_allocations(rid, f, t))
            elif url.path == "/api/room":
                rid = q.get("id", "")
                if not ROOM_RE.match(rid):
                    return self._bad("bad room id")
                self._send(200, eth_json(f"/v2/rooms/{rid}", DETAIL_TTL, lang="en"))
            elif url.path == "/api/file":
                fid = q.get("id", "")
                if not fid.isdigit():
                    return self._bad("bad file id")
                body, ctype = eth_file(fid)
                self._send(200, body, ctype, cache="max-age=86400")
            elif url.path == "/api/uzh":
                self._send(200, uzh_occupancy())
            elif url.path == "/api/snapshot":
                self._send(200, snapshots.status())
            else:
                self._send(404, {"error": "not found"})
        except Exception as e:
            self._send(502, {"error": f"{type(e).__name__}: {e}"})


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--snapshot-file", default=os.environ.get("ETH_ROOMS_SNAPSHOT", SNAPSHOT_FILE),
                    help="where the map snapshot and its fetch log are kept (default: %(default)s)")
    ap.add_argument("--snapshot", action="store_true",
                    help="refresh the map snapshot if it is over an hour old, print its state and exit")
    args = ap.parse_args()
    global snapshots
    snapshots = Snapshots(args.snapshot_file)
    if args.snapshot:
        st = snapshots.status(background=False)
        snap = st["snapshot"]
        print(f"{args.snapshot_file}: " + (f"fetched {snap['fetchedAt']}, {len(snap['rooms'])} rooms, "
                                          f"{snap['errors']} errors" if snap else "no snapshot")
              + (f" (last fetch failed: {st['error']})" if st["error"] else ""))
        return
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"ETH room dashboard on {url}  (cache: {CACHE_DIR})  Ctrl+C to stop")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


# --------------------------------------------------------------------------- #
# Page
# --------------------------------------------------------------------------- #

PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ETH Room Occupancy</title>
<style>
:root {
  color-scheme: light;
  --bg: #f3f3f1; --surface: #fcfcfb; --border: #e2e1dc; --grid: #ecebe7;
  --text: #0b0b0b; --text2: #52514e; --muted: #8a8984;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
  --s5: #e87ba4; --s6: #008300; --s7: #4a3aa7; --s8: #e34948;
  --cancel: #b9b8b2; --closed: #d6d5cf; --accent: #2a78d6;
  --heat: #cde2fb,#b7d3f6,#9ec5f4,#86b6ef,#6da7ec,#5598e7,#3987e5,#2a78d6,#256abf,#1c5cab,#184f95,#104281,#0d366b;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #111110; --surface: #1a1a19; --border: #33332f; --grid: #262624;
    --text: #ffffff; --text2: #c3c2b7; --muted: #8f8e86;
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
    --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
    --cancel: #5c5b56; --closed: #3a3a36; --accent: #3987e5;
    --heat: #222d3a,#1c2f48,#173556,#104281,#184f95,#1c5cab,#256abf,#2a78d6,#3987e5,#5598e7,#6da7ec,#86b6ef,#9ec5f4;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #111110; --surface: #1a1a19; --border: #33332f; --grid: #262624;
  --text: #ffffff; --text2: #c3c2b7; --muted: #8f8e86;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
  --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
  --cancel: #5c5b56; --closed: #3a3a36; --accent: #3987e5;
  --heat: #222d3a,#1c2f48,#173556,#104281,#184f95,#1c5cab,#256abf,#2a78d6,#3987e5,#5598e7,#6da7ec,#86b6ef,#9ec5f4;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { position: sticky; top: 0; z-index: 20; background: var(--surface);
  border-bottom: 1px solid var(--border); padding: 12px 16px; }
h1 { font-size: 18px; margin: 0 0 8px; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
h1 small { font-weight: 400; color: var(--text2); font-size: 13px; }
h2 { font-size: 15px; margin: 0 0 2px; }
h3 { font-size: 13px; margin: 14px 0 6px; color: var(--text2); font-weight: 600; }
.sub { color: var(--text2); font-size: 12.5px; margin: 0 0 12px; }
.controls { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; font-size: 13px; }
.controls label { display: flex; gap: 6px; align-items: center; color: var(--text2); }
select { max-width: 190px; }
input, select, button { font: inherit; color: var(--text); background: var(--surface);
  border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; }
button { cursor: pointer; }
button:hover { border-color: var(--accent); }
input[type=range] { padding: 0; width: 220px; accent-color: var(--accent); }
#timeLabel { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--text); min-width: 42px; }
main { padding: 16px; max-width: 1400px; margin: 0 auto; display: grid; gap: 16px;
  grid-template-columns: repeat(12, minmax(0, 1fr)); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 14px 16px; grid-column: span 12; min-width: 0; }
.w6 { grid-column: span 6; } .w4 { grid-column: span 4; } .w8 { grid-column: span 8; }
@media (max-width: 900px) { .w6, .w4, .w8 { grid-column: span 12; } }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
.kpi { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.kpi b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
.kpi span { color: var(--text2); font-size: 12px; }
.progress { height: 6px; background: var(--grid); border-radius: 3px; overflow: hidden; margin: 6px 0; }
.progress i { display: block; height: 100%; background: var(--accent); width: 0; transition: width .3s; }
.hb { display: grid; grid-template-columns: minmax(90px, 38%) 1fr 64px; gap: 8px; align-items: center;
  padding: 2px 0; font-size: 12.5px; }
.hb[data-click] { cursor: pointer; }
.hb-l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text2); }
.hb-t { height: 12px; }
.hb-b { display: block; height: 100%; border-radius: 0 4px 4px 0; min-width: 2px; }
.hb-v { text-align: right; font-variant-numeric: tabular-nums; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--text2); margin: 4px 0 8px; }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 5px; vertical-align: -2px; }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--grid); vertical-align: top; }
th { color: var(--text2); font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.click { cursor: pointer; } tr.click:hover td { background: var(--grid); }
.scroll { max-height: 520px; overflow: auto; }
.gantt { position: relative; font-size: 11.5px; }
.g-axis, .g-row, .g-head { display: grid; grid-template-columns: 150px 1fr; }
.g-axis { position: sticky; top: 0; background: var(--surface); z-index: 2; border-bottom: 1px solid var(--border); }
.g-axis .g-track { height: 20px; }
.g-axis .g-track span { position: absolute; top: 2px; transform: translateX(-50%); color: var(--muted); }
.g-head { font-weight: 600; color: var(--text2); padding-top: 6px; }
.g-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 8px; cursor: pointer; color: var(--text2); line-height: 18px; }
.g-label:hover { color: var(--accent); }
.g-track { position: relative; height: 18px;
  background-image: repeating-linear-gradient(to right, var(--grid) 0 1px, transparent 1px calc(100% / 18)); }
.g-bar { position: absolute; top: 2px; bottom: 2px; border-radius: 3px; }
.g-closed { position: absolute; top: 0; bottom: 0;
  background: repeating-linear-gradient(135deg, var(--closed) 0 4px, transparent 4px 7px); }
.g-cancel { background: transparent !important; border: 1.5px dashed var(--cancel); }
.g-now { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--text); opacity: .55; pointer-events: none; z-index: 1; }
.heat { display: grid; gap: 2px; font-size: 11.5px; }
.heat .c { height: 20px; border-radius: 2px; }
.heat .rl { color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; line-height: 20px; }
.heat .ax { color: var(--muted); text-align: center; }
.heatkey { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text2); margin-top: 8px; }
.heatkey i { display: block; width: 160px; height: 10px; border-radius: 2px; }
svg text { fill: var(--muted); font-size: 12px; }
#tip { position: fixed; z-index: 100; pointer-events: none; background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; font-size: 12px; white-space: pre-line;
  box-shadow: 0 4px 16px rgba(0,0,0,.18); max-width: 320px; display: none; }
.badge { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 10px; border: 1px solid var(--border); color: var(--text2); }
dialog { width: min(1000px, calc(100vw - 32px)); max-height: calc(100vh - 32px); border: 1px solid var(--border);
  border-radius: 12px; background: var(--surface); color: var(--text); padding: 0; }
dialog::backdrop { background: rgba(0,0,0,.45); }
.dlg-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;
  border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--surface); z-index: 3; }
.dlg-body { padding: 12px 16px 20px; }
.imgs { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.imgs img { height: 150px; border-radius: 6px; border: 1px solid var(--border); }
.attr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0 20px; }
.week { display: grid; grid-template-columns: 40px repeat(7, 1fr); gap: 0 2px; font-size: 11px; }
.week .day { position: relative; height: 448px; background-image: repeating-linear-gradient(to bottom, var(--grid) 0 1px, transparent 1px 28px); border-radius: 4px; }
.week .hr { position: relative; height: 448px; color: var(--muted); }
.week .hr span { position: absolute; right: 4px; transform: translateY(-50%); }
.week .dh { text-align: center; color: var(--text2); padding-bottom: 4px; font-weight: 600; }
.week .blk { position: absolute; left: 1px; right: 1px; border-radius: 3px; padding: 1px 3px; overflow: hidden;
  color: #fff; font-size: 10.5px; line-height: 1.2; }
.err { color: var(--s8); }
a { color: var(--accent); }
code { font-size: 12px; }
.empty { color: var(--muted); font-style: italic; padding: 8px 0; }
@media (max-width: 900px) { header { position: static; } }
@media (max-width: 600px) {
  .g-axis, .g-row, .g-head { grid-template-columns: 90px 1fr; }
  input[type=range] { width: 150px; }
}
</style>
</head>
<body>
<header>
  <h1>ETH room occupancy <small>Room Info API · centrally managed rooms · bookings, not sensor data</small></h1>
  <div class="controls">
    <label>Date <input type="date" id="date"></label>
    <label>Time <input type="range" id="time" min="360" max="1425" step="15"><span id="timeLabel"></span></label>
    <button id="nowBtn" title="Jump to today, current time">Now</button>
    <label>Campus <select id="fCampus"></select></label>
    <label>Type <select id="fType"></select></label>
    <label>Building <select id="fBuilding"></select></label>
    <label>Min seats <input type="number" id="fSeats" min="0" step="10" value="0" style="width:70px"></label>
    <label><input type="search" id="fQ" placeholder="Search room / building" style="width:170px"></label>
    <button id="themeBtn" title="Toggle light/dark">◐</button>
  </div>
</header>
<main>
  <section class="card" id="loadCard">
    <h2 id="loadTitle">Loading…</h2>
    <div class="progress"><i id="loadBar"></i></div>
    <p class="sub" id="loadSub">The API has no bulk endpoint, so a day needs one request per room. They are cached after the first load.</p>
  </section>

  <section class="card"><h2>At the selected time</h2>
    <p class="sub" id="kpiSub"></p><div class="kpis" id="kpis"></div></section>

  <section class="card w6"><h2>Free rooms at <span class="tl"></span></h2>
    <p class="sub">Not booked and building open. Cancelled bookings count as free. Sorted by how long they stay free. Click a row for details.</p>
    <div class="scroll" style="max-height:420px"><table id="freeTable"></table></div></section>

  <section class="card w6"><h2>Share of rooms in use over the day</h2>
    <p class="sub">Per campus, 15-minute steps. Hover to read values, click to set the time.</p>
    <div class="legend" id="lineLegend"></div><div id="line"></div></section>

  <section class="card"><h2>Use by building and hour</h2>
    <p class="sub">Share of a building's rooms booked during each hour. Click a building to filter to it.</p>
    <div id="heat"></div></section>

  <section class="card"><h2>Timeline of every room</h2>
    <p class="sub">All bookings of the selected day, 06:00–24:00. Hatched areas are building closed hours. Click a room name for details and its week.</p>
    <div class="legend" id="kindLegend"></div>
    <div class="scroll" style="max-height:640px"><div class="gantt" id="gantt"></div></div></section>

  <section class="card w4"><h2>Booked hours by kind</h2><p class="sub">Selected day, filtered rooms.</p><div id="byKind"></div></section>
  <section class="card w4"><h2>Top organisers</h2><p class="sub">By booked hours, selected day.</p><div id="byOrg"></div></section>
  <section class="card w4"><h2>Top courses and events</h2><p class="sub">By booked room-hours, selected day.</p><div id="byCourse"></div></section>

  <section class="card w6"><h2>Rooms by type</h2><p class="sub" id="invSub"></p><div id="byType"></div></section>
  <section class="card w6"><h2>Rooms by campus</h2><p class="sub">Count of rooms in the current filter.</p><div id="byCampus"></div>
    <h3>Room size (seats)</h3><div id="bySeats"></div></section>
  <section class="card w6"><h2>Equipment</h2><p class="sub">Share of rooms that list each item.</p><div id="byEquip"></div></section>
  <section class="card w6"><h2>Buildings by total seats</h2><p class="sub">Top 15 in the current filter.</p><div id="byBuilding"></div></section>

  <section class="card"><h2>Nearby: UZH library study spaces (live)</h2>
    <p class="sub">ETH publishes no live seat data for its libraries. UZH's University Library does (sensor-based, ignores reserved seats). Shown as the widget reports it. <a href="https://www.ub.uzh.ch/en/ub-besuchen/belegung-alle.html" target="_blank" rel="noopener">Source page</a>. <button id="uzhReload">Refresh</button></p>
    <div id="uzh"></div></section>

  <section class="card"><h2>Endpoints this page uses</h2>
    <p class="sub">Base <code>https://ethz.ch/bin/ethz/roominfo?path=</code>. Undocumented, found in the Room Info web app's JavaScript. Unknown paths return HTML with status 200, not a 404.</p>
    <table>
      <tr><th>Path</th><th>Returns</th><th>Shown in</th></tr>
      <tr><td><code>/rooms</code></td><td>~446 rooms with seats, area, campus and equipment fields</td><td>Inventory charts, filters</td></tr>
      <tr><td><code>/rooms/&lt;B F R&gt;/allocations&amp;from=&amp;to=</code></td><td>Bookings incl. course no., organiser, cancelled flag, closed hours</td><td>Everything day-based, week view</td></tr>
      <tr><td><code>/v2/rooms/&lt;B F R&gt;&amp;lang=en</code></td><td>Full room sheet: overview, equipment, multimedia, accessibility, photos</td><td>Room detail</td></tr>
      <tr><td><code>/v2/files/&lt;id&gt;</code></td><td>Room photos (JPEG) and PDF attachments such as seating plans</td><td>Room detail</td></tr>
      <tr><td><code>/types&amp;lang=en</code> · <code>/buildings</code> · <code>/locations</code></td><td>Type names, building names + floors, campus areas</td><td>Labels, filters</td></tr>
      <tr><td><code>/min-max-allocation-date</code></td><td>Date window with booking data</td><td>Date picker limits</td></tr>
      <tr><td><code>/v2/rooms&amp;lang=en</code>, <code>/v2/rooms/filter&amp;type=…</code></td><td>Slim room list (English), server-side filtering</td><td>Not used, <code>/rooms</code> has more fields</td></tr>
      <tr><td><code>/v2/filters&amp;lang=en</code> · <code>/v2/roomgroup&amp;building=&amp;floor=&amp;room=</code></td><td>Equipment filter catalogue · room-group ids</td><td>Not used</td></tr>
    </table></section>
</main>

<dialog id="dlg"><div class="dlg-head"><h2 id="dlgTitle"></h2><button id="dlgClose">Close</button></div><div class="dlg-body" id="dlgBody"></div></dialog>
<div id="tip"></div>

<script>
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const hhmm = m => m >= 1440 ? '24:00' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtH = h => (Math.round(h * 10) / 10).toLocaleString('en') + ' h';
const pct = v => Math.round(v * 100) + '%';

const KINDS = {
  lecture:          { label: 'Lecture (V)',            color: 'var(--s1)' },
  exercise:         { label: 'Exercise (U)',           color: 'var(--s2)' },
  lecture_exercise: { label: 'Lecture + exercise (G)', color: 'var(--s3)' },
  course_other:     { label: 'Other course type',      color: 'var(--s4)' },
  event:            { label: 'Other event',            color: 'var(--s5)' },
  reserved:         { label: 'Reserved, no details',   color: 'var(--s6)' },
  cancelled:        { label: 'Cancelled (counts as free)', color: 'var(--cancel)' },
};
const BUSY = new Set(['lecture', 'exercise', 'lecture_exercise', 'course_other', 'event', 'reserved']);
const CAMPUSES = ['Zentrum', 'Hönggerberg', 'Other sites'];
const G0 = 360, G1 = 1440;  // timeline window

const S = { meta: null, day: null, date: isoDate(new Date()), minute: 600,
  typeName: {}, buildingName: {} };

// ---------- helpers ----------
const rid = r => `${r.building} ${r.floor} ${r.room}`;
const campusOf = r => {
  const a = r.location?.areaDesc || '';
  return a.includes('Zentrum') ? 'Zentrum' : a.includes('Hönggerberg') ? 'Hönggerberg' : 'Other sites';
};
const typeOf = r => S.typeName[r.typecode] || r.type || 'Unknown';
// seats/workplaces come back as numbers or numeric strings
const num = v => v == null || v === '' || isNaN(+v) ? null : +v;
const seatCount = r => num(r.seats) || 0;
const capacity = r => num(r.seats) ?? num(r.workplaces);
const seatsText = r => num(r.seats) != null ? num(r.seats) : num(r.workplaces) != null ? `${num(r.workplaces)} wp` : '–';
function toMin(s, date) {
  const d = s.slice(0, 10);
  if (d < date) return 0;
  if (d > date) return 1440;
  const h = +s.slice(11, 13), m = +s.slice(14, 16);
  return h === 23 && m === 59 ? 1440 : h * 60 + m;
}
function api(path) {
  return fetch(path).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
  });
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function heatColor(v) {
  const ramp = cssVar('--heat').split(',').map(s => s.trim());
  return ramp[Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1)))];
}

// ---------- filters ----------
function filteredRooms() {
  const c = $('#fCampus').value, t = $('#fType').value, b = $('#fBuilding').value;
  const min = +$('#fSeats').value || 0, q = $('#fQ').value.trim().toLowerCase();
  return S.meta.rooms.filter(r =>
    (c === 'all' || campusOf(r) === c) &&
    (t === 'all' || typeOf(r) === t) &&
    (b === 'all' || r.building === b) &&
    (!min || (capacity(r) || 0) >= min) &&
    (!q || `${rid(r)} ${typeOf(r)} ${S.buildingName[r.building] || ''}`.toLowerCase().includes(q)));
}
function fillSelect(el, values, allLabel, labelFn = v => v) {
  el.innerHTML = `<option value="all">${esc(allLabel)}</option>` +
    values.map(v => `<option value="${esc(v)}">${esc(labelFn(v))}</option>`).join('');
}

// ---------- day model ----------
function prepareDay() {
  const date = S.day.date;
  for (const r of S.meta.rooms) {
    const list = (S.day.rooms[rid(r)] || []).map(a => ({ ...a, s: toMin(a.start, date), e: toMin(a.end, date) }))
      .filter(a => a.e > a.s).sort((a, b) => a.s - b.s);
    r._busy = list.filter(a => BUSY.has(a.kind));
    r._closed = list.filter(a => a.kind === 'closed');
    r._cancel = list.filter(a => a.kind === 'cancelled');
    r._err = S.day.errors[rid(r)];
  }
}
const covers = (list, t) => list.find(i => i.s <= t && t < i.e);
function statusAt(r, t) {
  if (covers(r._closed, t)) return { st: 'closed' };
  const b = covers(r._busy, t);
  return b ? { st: 'busy', a: b } : { st: 'free' };
}
function freeUntil(r, t) {
  let until = 1440, next = null;
  for (const i of r._busy.concat(r._closed)) if (i.s > t && i.s < until) { until = i.s; next = i; }
  return { until, next };
}

// ---------- generic charts ----------
function hbars(el, rows, { fmt = v => v, color = 'var(--s1)', max } = {}) {
  if (!rows.length) { el.innerHTML = '<div class="empty">No data for this filter.</div>'; return; }
  const m = max ?? Math.max(1e-9, ...rows.map(r => r.value));
  el.innerHTML = rows.map((r, i) => `<div class="hb" ${r.click ? `data-click="${i}"` : ''} data-tip="${esc(r.tip || `${r.label}: ${fmt(r.value)}`)}">
    <span class="hb-l">${esc(r.label)}</span>
    <span class="hb-t"><span class="hb-b" style="width:${Math.max(0, 100 * r.value / m)}%;background:${r.color || color}"></span></span>
    <span class="hb-v">${esc(fmt(r.value))}</span></div>`).join('');
  el.querySelectorAll('[data-click]').forEach(n => n.onclick = rows[+n.dataset.click].click);
}
const countBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());

// ---------- renderers ----------
function renderKpis(rooms) {
  const t = S.minute;
  let free = 0, busy = 0, closed = 0, freeSeats = 0, bookings = 0, cancelled = 0, hours = 0;
  for (const r of rooms) {
    const st = statusAt(r, t).st;
    if (st === 'free') { free++; freeSeats += seatCount(r); } else if (st === 'busy') busy++; else closed++;
    bookings += r._busy.length; cancelled += r._cancel.length;
    hours += r._busy.reduce((s, a) => s + (a.e - a.s) / 60, 0);
  }
  const k = [
    [rooms.length, 'rooms in filter'], [free, 'free now'], [busy, 'in use now'], [closed, 'building closed'],
    [freeSeats.toLocaleString('en'), 'seats in free rooms'], [bookings, 'bookings this day'],
    [cancelled, 'cancelled this day'], [fmtH(hours), 'booked room-hours'],
  ];
  $('#kpis').innerHTML = k.map(([v, l]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
  const errs = Object.keys(S.day.errors).length;
  $('#kpiSub').textContent = `${S.day.date}, ${hhmm(t)}.` + (errs ? ` ${errs} rooms failed to load and are shown as free.` : '');
}

function renderFree(rooms) {
  const t = S.minute;
  const rows = rooms.filter(r => statusAt(r, t).st === 'free')
    .map(r => ({ r, ...freeUntil(r, t) }))
    .sort((a, b) => b.until - a.until || (capacity(b.r) || 0) - (capacity(a.r) || 0));
  if (!rows.length) { $('#freeTable').innerHTML = '<tr><td class="empty">No free rooms at this time.</td></tr>'; return; }
  $('#freeTable').innerHTML = `<tr><th>Room</th><th>Type</th><th class="num">Seats</th><th>Free until</th><th>Next</th></tr>` +
    rows.map(({ r, until, next }) => `<tr class="click" data-id="${esc(rid(r))}">
      <td><b>${esc(rid(r))}</b></td><td>${esc(typeOf(r))}</td><td class="num">${esc(seatsText(r))}</td>
      <td>${until >= 1440 ? 'end of day' : hhmm(until)} <span class="badge">${fmtH((until - t) / 60)}</span></td>
      <td>${next ? esc(next.kind === 'closed' ? 'Building closes' : next.title || KINDS[next.kind]?.label) : ''}</td></tr>`).join('');
  $('#freeTable').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => openRoom(tr.dataset.id));
}

function renderLine(rooms) {
  const steps = []; for (let t = G0; t < G1; t += 15) steps.push(t);
  const groups = CAMPUSES.map((g, i) => ({ g, color: `var(--s${i + 1})`, rooms: rooms.filter(r => campusOf(r) === g) }))
    .filter(G => G.rooms.length);
  for (const G of groups) G.vals = steps.map(t => G.rooms.filter(r => covers(r._busy, t + 7)).length / G.rooms.length);
  $('#lineLegend').innerHTML = groups.map(G => `<span><i style="background:${G.color}"></i>${esc(G.g)} (${G.rooms.length} rooms)</span>`).join('');
  const W = 900, H = 250, L = 40, R = 90, T = 10, B = 26;
  const x = t => L + (t - G0) / (G1 - G0) * (W - L - R), y = v => T + (1 - v) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Share of rooms in use over the day">`;
  for (const v of [0, .25, .5, .75, 1]) svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${pct(v)}</text>`;
  for (let h = 6; h <= 24; h += 3) svg += `<text x="${x(h * 60)}" y="${H - 8}" text-anchor="middle">${pad(h)}:00</text>`;
  for (const G of groups) {
    svg += `<polyline fill="none" stroke="${G.color}" stroke-width="2" stroke-linejoin="round" points="${G.vals.map((v, i) => `${x(steps[i] + 7)},${y(v)}`).join(' ')}"/>`;
  }
  // direct labels at the line ends, nudged apart
  const ends = groups.map(G => ({ G, yy: y(G.vals.at(-1)) })).sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) ends[i].yy = Math.max(ends[i].yy, ends[i - 1].yy + 16);
  for (const e of ends) svg += `<text x="${W - R + 6}" y="${e.yy + 4}" style="fill:var(--text2);font-size:13px">${esc(e.G.g)}</text>`;
  svg += `<line id="lnSel" x1="${x(S.minute)}" x2="${x(S.minute)}" y1="${T}" y2="${H - B}" stroke="var(--text)" stroke-opacity=".5" stroke-width="2"/>`;
  svg += `<line id="lnHover" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>`;
  svg += groups.map((G, i) => `<circle id="lnDot${i}" r="4" fill="${G.color}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`).join('');
  svg += `<rect id="lnHit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" style="cursor:crosshair"/></svg>`;
  $('#line').innerHTML = svg;
  const hit = $('#lnHit'), svgEl = $('#line svg');
  const stepAt = ev => {
    const p = svgEl.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
    const lx = p.matrixTransform(svgEl.getScreenCTM().inverse()).x;
    const t = G0 + (lx - L) / (W - L - R) * (G1 - G0);
    return Math.max(0, Math.min(steps.length - 1, Math.floor((t - G0) / 15)));
  };
  hit.onmousemove = ev => {
    const i = stepAt(ev), xx = x(steps[i] + 7);
    const hv = $('#lnHover'); hv.setAttribute('x1', xx); hv.setAttribute('x2', xx); hv.setAttribute('visibility', 'visible');
    groups.forEach((G, gi) => { const d = $('#lnDot' + gi); d.setAttribute('cx', xx); d.setAttribute('cy', y(G.vals[i])); d.setAttribute('visibility', 'visible'); });
    showTip(ev, `${hhmm(steps[i])}–${hhmm(steps[i] + 15)}\n` + groups.map(G =>
      `${G.g}: ${pct(G.vals[i])} (${Math.round(G.vals[i] * G.rooms.length)} of ${G.rooms.length})`).join('\n'));
  };
  hit.onmouseleave = () => { hideTip(); $('#lnHover').setAttribute('visibility', 'hidden'); groups.forEach((G, gi) => $('#lnDot' + gi).setAttribute('visibility', 'hidden')); };
  hit.onclick = ev => setMinute(steps[stepAt(ev)]);
}

function renderHeat(rooms) {
  const byB = new Map();
  for (const r of rooms) { if (!byB.has(r.building)) byB.set(r.building, []); byB.get(r.building).push(r); }
  const blds = [...byB.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!blds.length) { $('#heat').innerHTML = '<div class="empty">No rooms in this filter.</div>'; return; }
  const hours = []; for (let h = 7; h < 23; h++) hours.push(h);
  let out = `<div class="heat" style="grid-template-columns:150px repeat(${hours.length},minmax(18px,1fr))"><div></div>` +
    hours.map(h => `<div class="ax">${pad(h)}</div>`).join('');
  for (const [b, rs] of blds) {
    out += `<div class="rl" data-b="${esc(b)}" data-tip="${esc(`${b} · ${S.buildingName[b] || ''}\n${rs.length} rooms`)}">${esc(b)} <span style="color:var(--muted)">(${rs.length})</span></div>`;
    for (const h of hours) {
      let busy = 0;
      for (let q = 0; q < 4; q++) { const t = h * 60 + q * 15 + 7; busy += rs.filter(r => covers(r._busy, t)).length; }
      const v = busy / (4 * rs.length);
      out += `<div class="c" style="background:${heatColor(v)}" data-tip="${esc(`${b} ${pad(h)}:00–${pad(h + 1)}:00\n${pct(v)} of ${rs.length} rooms in use (avg)`)}"></div>`;
    }
  }
  out += `</div><div class="heatkey">0% <i style="background:linear-gradient(to right,${cssVar('--heat')})"></i> 100% of the building's rooms in use</div>`;
  $('#heat').innerHTML = out;
  $('#heat').querySelectorAll('[data-b]').forEach(n => n.onclick = () => { $('#fBuilding').value = n.dataset.b; renderAll(); });
}

function bookingTip(r, a) {
  const k = a.kind === 'closed' ? 'Building closed' : KINDS[a.kind]?.label;
  return [`${rid(r)} · ${hhmm(a.s)}–${hhmm(a.e)}`, a.title, k, a.number && `No. ${a.number}`, a.organiser].filter(Boolean).join('\n');
}
function renderGantt(rooms) {
  $('#kindLegend').innerHTML = Object.values(KINDS).map(k => `<span><i style="background:${k.color}"></i>${esc(k.label)}</span>`).join('') +
    `<span><i style="background:repeating-linear-gradient(135deg,var(--closed) 0 3px,transparent 3px 6px)"></i>Building closed</span>`;
  const X = m => (Math.max(G0, Math.min(G1, m)) - G0) / (G1 - G0) * 100;
  const sorted = [...rooms].sort((a, b) => a.building.localeCompare(b.building) || rid(a).localeCompare(rid(b), 'en', { numeric: true }));
  let html = `<div class="g-axis"><div></div><div class="g-track" style="background:none">` +
    [6, 8, 10, 12, 14, 16, 18, 20, 22].map(h => `<span style="left:${X(h * 60)}%">${pad(h)}:00</span>`).join('') + `</div></div>`;
  let lastB = null;
  for (const r of sorted) {
    if (r.building !== lastB) { lastB = r.building; html += `<div class="g-head"><div>${esc(r.building)} <span style="font-weight:400">${esc(S.buildingName[r.building] || '')}</span></div><div></div></div>`; }
    let bars = '';
    for (const a of r._closed) if (a.e > G0) bars += `<div class="g-closed" style="left:${X(a.s)}%;width:${X(a.e) - X(a.s)}%" data-tip="${esc(bookingTip(r, a))}"></div>`;
    for (const a of r._busy.concat(r._cancel)) {
      if (a.e <= G0) continue;
      bars += `<div class="g-bar ${a.kind === 'cancelled' ? 'g-cancel' : ''}" style="left:calc(${X(a.s)}% + 1px);width:calc(${X(a.e) - X(a.s)}% - 2px);background:${KINDS[a.kind].color}" data-tip="${esc(bookingTip(r, a))}"></div>`;
    }
    const err = r._err ? ' ⚠' : '';
    html += `<div class="g-row"><div class="g-label" data-id="${esc(rid(r))}" data-tip="${esc(`${rid(r)} · ${typeOf(r)} · ${seatsText(r)} seats${r._err ? '\nFailed to load: ' + r._err : ''}`)}">${esc(rid(r))}${err} <span style="color:var(--muted)">${esc(seatsText(r))}</span></div>
      <div class="g-track">${bars}<div class="g-now" style="left:${X(S.minute)}%"></div></div></div>`;
  }
  $('#gantt').innerHTML = sorted.length ? html : '<div class="empty">No rooms in this filter.</div>';
  $('#gantt').querySelectorAll('.g-label').forEach(n => n.onclick = () => openRoom(n.dataset.id));
}

function renderBreakdowns(rooms) {
  const kindH = new Map(), orgH = new Map(), courseH = new Map();
  for (const r of rooms) for (const a of r._busy.concat(r._cancel)) {
    const h = (a.e - a.s) / 60;
    kindH.set(a.kind, (kindH.get(a.kind) || 0) + h);
    if (a.kind === 'cancelled') continue;
    if (a.organiser) orgH.set(a.organiser, (orgH.get(a.organiser) || 0) + h);
    if (a.title) { const k = a.title + (a.number ? ` (${a.number})` : ''); courseH.set(k, (courseH.get(k) || 0) + h); }
  }
  hbars($('#byKind'), Object.keys(KINDS).filter(k => kindH.get(k)).map(k => ({ label: KINDS[k].label, value: kindH.get(k), color: KINDS[k].color })), { fmt: fmtH });
  const top = m => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, value]) => ({ label, value }));
  hbars($('#byOrg'), top(orgH), { fmt: fmtH });
  hbars($('#byCourse'), top(courseH), { fmt: fmtH });
}

function renderInventory(rooms) {
  $('#invSub').textContent = `${rooms.length} of ${S.meta.rooms.length} rooms in the current filter. Click a type to filter by it.`;
  hbars($('#byType'), [...countBy(rooms, typeOf).entries()].sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, click: () => { $('#fType').value = label; renderAll(); } })));
  hbars($('#byCampus'), [...countBy(rooms, r => r.location?.areaDesc || 'Unknown').entries()].sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value })));
  const buckets = [['No seat count', r => capacity(r) == null], ['1–20', r => capacity(r) >= 1 && capacity(r) <= 20],
    ['21–40', r => capacity(r) > 20 && capacity(r) <= 40], ['41–80', r => capacity(r) > 40 && capacity(r) <= 80],
    ['81–150', r => capacity(r) > 80 && capacity(r) <= 150], ['151–300', r => capacity(r) > 150 && capacity(r) <= 300],
    ['Over 300', r => capacity(r) > 300]];
  hbars($('#bySeats'), buckets.map(([label, f]) => ({ label, value: rooms.filter(f).length })));
  const EQUIP = [['Projector', r => !!r.beamer], ['Speakers', r => !!r.speakers], ['HDMI input', r => r.hdmiConnections > 0],
    ['Microphones', r => (r.microphones || 0) + (r.microphonesWireless || 0) > 0], ['Board / wallchart', r => !!r.wallchart],
    ['Lecturer desk', r => !!r.lecturersDesk], ['Projection screen', r => !!r.projectionScreen], ['Recording', r => !!r.record],
    ['Visualizer', r => !!r.visualizer], ['Video conference', r => !!r.videoConference],
    ['Hearing assistance', r => !!r.hearingImpairedSupport], ['Lecture transmission', r => !!r.dataTransfer]];
  const n = Math.max(1, rooms.length);
  hbars($('#byEquip'), EQUIP.map(([label, f]) => { const c = rooms.filter(f).length; return { label, value: c / n, tip: `${label}: ${c} of ${rooms.length} rooms` }; })
    .sort((a, b) => b.value - a.value), { fmt: pct, max: 1 });
  const seatsB = new Map();
  for (const r of rooms) seatsB.set(r.building, (seatsB.get(r.building) || 0) + seatCount(r));
  hbars($('#byBuilding'), [...seatsB.entries()].filter(e => e[1]).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([b, value]) => ({ label: `${b} · ${S.buildingName[b] || ''}`, value, click: () => { $('#fBuilding').value = b; renderAll(); } })),
    { fmt: v => v.toLocaleString('en') });
}

function renderAll() {
  if (!S.meta) return;
  const rooms = filteredRooms();
  renderInventory(rooms);
  if (!S.day) return;
  renderKpis(rooms); renderFree(rooms); renderLine(rooms); renderHeat(rooms); renderGantt(rooms); renderBreakdowns(rooms);
}

// ---------- time / date ----------
function setMinute(m) {
  S.minute = m; $('#time').value = m;
  $('#timeLabel').textContent = hhmm(m);
  document.querySelectorAll('.tl').forEach(n => n.textContent = hhmm(m));
  renderAll();
}
let loadToken = 0;
async function loadDay(date) {
  const token = ++loadToken;
  S.date = date; S.day = null;
  $('#loadCard').style.display = '';
  $('#loadTitle').textContent = `Loading bookings for ${date}…`;
  $('#loadBar').style.width = '0';
  let failures = 0;
  while (token === loadToken) {
    let j;
    try { j = await api(`/api/day?date=${date}`); failures = 0; }
    catch (e) {
      if (++failures < 5) { await new Promise(r => setTimeout(r, 1000)); continue; }
      $('#loadTitle').innerHTML = `<span class="err">Failed: ${esc(e.message)}</span>`; return;
    }
    if (token !== loadToken) return;
    if (j.state === 'error') { $('#loadTitle').innerHTML = `<span class="err">Failed: ${esc(j.error)}</span>`; return; }
    if (j.state === 'done') {
      S.day = j.data; prepareDay();
      $('#loadCard').style.display = 'none';
      renderAll(); return;
    }
    $('#loadBar').style.width = j.total ? `${100 * j.done / j.total}%` : '0';
    $('#loadTitle').textContent = `Loading bookings for ${date}… ${j.done} / ${j.total || '?'} rooms`;
    await new Promise(r => setTimeout(r, 600));
  }
}

// ---------- room detail ----------
const dlg = $('#dlg');
$('#dlgClose').onclick = () => dlg.close();
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

async function openRoom(id) {
  const r = S.meta.rooms.find(x => rid(x) === id);
  $('#dlgTitle').textContent = `${id}${r ? ' · ' + typeOf(r) : ''}`;
  $('#dlgBody').innerHTML = '<p class="sub">Loading room sheet…</p>';
  dlg.showModal();
  const [b, f, n] = id.split(' ');
  const official = `https://ethz.ch/staffnet/en/service/rooms-and-buildings/roominfo/detail.html?building=${encodeURIComponent(b)}&floor=${encodeURIComponent(f)}&room=${encodeURIComponent(n)}`;
  let body = `<p class="sub">${esc(r?.location?.areaDesc || '')} · ${esc(S.buildingName[b] || '')} · <a href="${official}" target="_blank" rel="noopener">Official room page</a></p>`;
  body += `<h3>Week schedule <button id="wkPrev">‹</button> <span id="wkLabel"></span> <button id="wkNext">›</button></h3><div id="week"><p class="sub">Loading…</p></div>`;
  body += `<div id="sheet"><p class="sub">Loading room sheet…</p></div>`;
  $('#dlgBody').innerHTML = body;
  const monday = new Date(S.date + 'T12:00:00'); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  let wk = monday;
  const showWeek = () => loadWeek(id, wk);
  $('#wkPrev').onclick = () => { wk = new Date(wk); wk.setDate(wk.getDate() - 7); showWeek(); };
  $('#wkNext').onclick = () => { wk = new Date(wk); wk.setDate(wk.getDate() + 7); showWeek(); };
  showWeek();
  try {
    const d = await api(`/api/room?id=${encodeURIComponent(id)}`);
    let s = '';
    const images = [], docs = [];
    for (const tab of d.tabs || []) {
      const att = tab.attachments || {};
      for (const [k, arr] of Object.entries(att)) for (const a of arr || []) (k === 'images' ? images : docs).push(a);
    }
    if (images.length) s += `<h3>Photos</h3><div class="imgs">` + images.map(i =>
      `<a href="/api/file?id=${i.id}" target="_blank"><img src="/api/file?id=${i.id}" alt="${esc(i.altText || i.filename)}" title="${esc(i.altText || '')}"></a>`).join('') + `</div>`;
    s += '<div class="attr-grid">';
    for (const tab of d.tabs || []) {
      if (!tab.attributes?.length) continue;
      s += `<div><h3>${esc(tab.title || 'Other')}</h3><table>` + tab.attributes.map(a =>
        `<tr><th style="width:45%">${esc(a.label)}</th><td>${a.isAttachment ? `<a href="/api/file?id=${a.attachmentId}" target="_blank">${esc(a.name)}</a>` : esc(a.value)}</td></tr>`).join('') + `</table></div>`;
    }
    s += '</div>';
    if (docs.length) s += `<h3>Attachments</h3>` + docs.map(a => `<a href="/api/file?id=${a.id}" target="_blank">${esc(a.filename || a.id)}</a>`).join(' · ');
    if (d.orgunits?.length) s += `<h3>Managed by</h3><p>${d.orgunits.map(o => esc(o.name)).join(', ')}</p>`;
    $('#sheet').innerHTML = s;
  } catch (e) { $('#sheet').innerHTML = `<p class="err">Room sheet failed: ${esc(e.message)}</p>`; }
}

async function loadWeek(id, monday) {
  const days = [...Array(7)].map((_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });
  const from = isoDate(days[0]), to = isoDate(days[6]);
  $('#wkLabel').textContent = `${from} – ${to}`;
  $('#week').innerHTML = '<p class="sub">Loading…</p>';
  let list;
  try { list = await api(`/api/allocs?id=${encodeURIComponent(id)}&from=${from}&to=${to}`); }
  catch (e) { $('#week').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const H0 = 7 * 60, H1 = 23 * 60, PX = 448 / (H1 - H0);
  let html = '<div class="week"><div></div>' + days.map(d => `<div class="dh">${d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}</div>`).join('');
  html += '<div class="hr">' + [...Array(17)].map((_, i) => `<span style="top:${i * 28}px">${pad(7 + i)}</span>`).join('') + '</div>';
  for (const d of days) {
    const ds = isoDate(d);
    html += '<div class="day">';
    for (const a of list) {
      const s = Math.max(H0, toMin(a.start, ds)), e = Math.min(H1, toMin(a.end, ds));
      if (e <= s) continue;
      const style = `top:${(s - H0) * PX}px;height:${Math.max(3, (e - s) * PX - 2)}px`;
      const tip = [`${hhmm(s)}–${hhmm(e)}`, a.title, a.kind === 'closed' ? 'Building closed' : KINDS[a.kind]?.label, a.organiser].filter(Boolean).join('\n');
      if (a.kind === 'closed') html += `<div class="g-closed" style="${style};left:0;right:0" data-tip="${esc(tip)}"></div>`;
      else html += `<div class="blk ${a.kind === 'cancelled' ? 'g-cancel' : ''}" style="${style};background:${KINDS[a.kind].color};${a.kind === 'cancelled' ? 'color:var(--text2)' : ''}" data-tip="${esc(tip)}">${esc(a.title || '')}</div>`;
    }
    html += '</div>';
  }
  $('#week').innerHTML = html + '</div>' + (list.length ? '' : '<p class="empty">No bookings this week.</p>');
}

// ---------- UZH ----------
async function loadUzh() {
  $('#uzh').innerHTML = '<p class="sub">Loading…</p>';
  try {
    const j = await api('/api/uzh');
    if (!j.locations.length) { $('#uzh').innerHTML = '<div class="empty">No locations found on the UZH page. Its layout may have changed.</div>'; return; }
    const allClosed = j.locations.every(l => /closed|geschlossen/i.test(l.label));
    $('#uzh').innerHTML = `<p class="sub">Fetched ${esc(j.fetchedAt)}.${allClosed ? ' All locations currently report closed.' : ''}</p><div id="uzhBars"></div>`;
    hbars($('#uzhBars'), j.locations.map(l => ({ label: l.name, value: l.fraction ?? 0,
      tip: `${l.name}\nWidget text: ${l.label || '–'}\nBar fill: ${l.fraction == null ? 'n/a' : pct(l.fraction)}` })),
      { fmt: v => '', max: 1 });
    // show the widget's own text rather than our reading of the bar
    $('#uzhBars').querySelectorAll('.hb-v').forEach((n, i) => n.textContent = j.locations[i].label || '–');
  } catch (e) { $('#uzh').innerHTML = `<p class="err">UZH data failed: ${esc(e.message)}</p>`; }
}
$('#uzhReload').onclick = loadUzh;

// ---------- tooltip ----------
const tip = $('#tip');
function showTip(ev, text) {
  tip.textContent = text; tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - w - 8, ev.clientX + 14) + 'px';
  tip.style.top = (ev.clientY + h + 20 > window.innerHeight ? ev.clientY - h - 10 : ev.clientY + 14) + 'px';
}
function hideTip() { tip.style.display = 'none'; }
document.addEventListener('mousemove', ev => {
  if (ev.target.id === 'lnHit') return;
  const n = ev.target.closest?.('[data-tip]');
  n ? showTip(ev, n.dataset.tip) : hideTip();
});

// ---------- theme ----------
$('#themeBtn').onclick = () => {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const cur = document.documentElement.dataset.theme || (dark ? 'dark' : 'light');
  document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', document.documentElement.dataset.theme); } catch (e) {}
  renderAll();
};
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

// ---------- boot ----------
(async function init() {
  const now = new Date();
  S.minute = Math.min(1425, Math.max(360, Math.floor((now.getHours() * 60 + now.getMinutes()) / 15) * 15));
  $('#time').value = S.minute; $('#timeLabel').textContent = hhmm(S.minute);
  document.querySelectorAll('.tl').forEach(n => n.textContent = hhmm(S.minute));
  $('#date').value = S.date;
  loadUzh();
  try { S.meta = await api('/api/meta'); }
  catch (e) { $('#loadTitle').innerHTML = `<span class="err">Could not load room list: ${esc(e.message)}</span>`; return; }
  for (const t of S.meta.types) S.typeName[t.typecode] = t.type;
  for (const b of S.meta.buildings) S.buildingName[b.code] = b.name;
  $('#date').min = S.meta.minmax.minDateLoad; $('#date').max = S.meta.minmax.maxDateLoad;
  fillSelect($('#fCampus'), CAMPUSES, 'All campuses');
  fillSelect($('#fType'), [...new Set(S.meta.rooms.map(typeOf))].sort(), 'All types');
  fillSelect($('#fBuilding'), [...new Set(S.meta.rooms.map(r => r.building))].sort(), 'All buildings',
    b => `${b} · ${S.buildingName[b] || ''}`);
  for (const id of ['#fCampus', '#fType', '#fBuilding']) $(id).onchange = renderAll;
  for (const id of ['#fSeats', '#fQ']) $(id).oninput = renderAll;
  $('#time').oninput = e => setMinute(+e.target.value);
  $('#date').onchange = e => { if (DATE_OK(e.target.value)) loadDay(e.target.value); };
  $('#nowBtn').onclick = () => {
    const n = new Date(), d = isoDate(n);
    if (d !== S.date) { $('#date').value = d; loadDay(d); }
    setMinute(Math.min(1425, Math.max(360, Math.floor((n.getHours() * 60 + n.getMinutes()) / 15) * 15)));
  };
  renderAll();
  loadDay(S.date);
})();
const DATE_OK = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
</script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
