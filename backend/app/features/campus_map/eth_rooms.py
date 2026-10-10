"""ETH Room Info API and UZH library occupancy: fetching, caching and the map snapshots.

The ETH Room Info API (https://ethz.ch/bin/ethz/roominfo?path=) is undocumented
and has no bulk endpoint, so a day of bookings needs one request per room
(~450). Responses are cached in memory and on disk; the map reads "snapshots":
every room with one day's bookings in one document, kept in a file with the
time it was fetched and fetched again at most once an hour (past days once).

Endpoints used:
    /rooms                                   room list incl. equipment fields
    /types&lang=en                           room type codes -> English names
    /buildings                               building codes, names, floors
    /locations                               campus areas / regions
    /min-max-allocation-date                 date window with booking data
    /rooms/<B F R>/allocations&from=&to=     bookings of one room
    /v2/rooms/<B F R>&lang=en                full room detail (tabs, images)
    /v2/files/<id>                           room photos / PDF attachments
Nearby occupancy:
    https://www.ub.uzh.ch/en/ub-besuchen/belegung-alle.html   UZH library
    https://hbzwwws04.uzh.ch/occusense/occusense_progressbar_150_en.php?id=N

Stdlib only: the standalone dashboard (eth_room_dashboard.py in the repo root)
imports this module without the backend's dependencies. Call configure() first.
"""

import datetime as dt
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
from concurrent.futures import ThreadPoolExecutor, as_completed

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


def configure(cache_dir=None, snapshot_file=None):
    """Where responses are cached (default: the system temp dir) and where today's map
    snapshot is kept; other days go next to it in <name>-days/<date>.json."""
    global CACHE_DIR, snapshots
    if cache_dir:
        CACHE_DIR = cache_dir
    if snapshot_file:
        snapshots = Snapshots(snapshot_file)


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
            event.get("lehrveranstaltungstyp"), "course_other"
        )
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
        stale = (
            job
            and job["state"] != "running"
            and (job["state"] == "error" or time.time() - job["finished"] > DAY_TTL)
        )
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
    (
        "Microphones",
        lambda r: (num(r.get("microphones")) or 0) + (num(r.get("microphonesWireless")) or 0) > 0,
    ),
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
            bookings.append(
                {
                    "s": s,
                    "e": e,
                    "kind": a["kind"],
                    "title": a["title"],
                    "number": a["number"],
                    "organiser": a["organiser"],
                }
            )
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


def build_snapshot(progress, date=None):
    """Every room with its bookings for `date` (default today, Zurich), as the map consumes it."""
    started = time.time()
    meta = get_meta()
    date = date or zurich_now().date().isoformat()
    type_names = {t.get("typecode"): t.get("type") for t in meta["types"]}
    rooms = meta["rooms"]
    progress["total"], progress["done"] = len(rooms), 0
    allocations, errors = {}, {}
    with ThreadPoolExecutor(WORKERS) as pool:
        futures = {
            pool.submit(room_allocations, room_id(r), date, date, SNAPSHOT_TTL): room_id(r)
            for r in rooms
        }
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
        "rooms": [
            snapshot_room(
                r, allocations.get(room_id(r), []), date, type_names, errors.get(room_id(r))
            )
            for r in rooms
        ],
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


def snapshot_stale(snap, now=None, date=None):
    """Missing, for another day than `date` (default today), or older than an hour.
    Bookings of past days don't change any more, so those never get old."""
    if not snap:
        return True
    now = now or zurich_now()
    today = now.date().isoformat()
    if snap.get("date") != (date or today):
        return True
    if date and date < today:
        return False
    age = snapshot_age(snap, now)
    return age is None or age >= SNAPSHOT_TTL


def write_snapshot(path, snap):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def log_fetch(path, line):
    """Appends one line per ETH fetch, starting with its timestamp, to `path`."""
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{zurich_now().isoformat(timespec='seconds')}\t{line}\n")
    except OSError:
        pass


class Snapshots:
    """The snapshot file of one day (None: whatever day it is) plus at most one background
    refresh at a time."""

    def __init__(self, path, date=None, log_path=None):
        self.path = path
        self.date = date
        self.log_path = log_path or os.path.splitext(path)[0] + ".log"
        self.lock = threading.Lock()
        self.value = read_snapshot(path)
        self.running = False
        self.progress = {"done": 0, "total": 0}
        self.error = None
        self.failed_at = 0.0

    def refresh(self):
        """Fetches from ETH and stores the result; keeps the old snapshot on failure."""
        try:
            snap = build_snapshot(self.progress, self.date)
            write_snapshot(self.path, snap)
            log_fetch(
                self.log_path,
                f"ok\tdate={snap['date']}\trooms={len(snap['rooms'])}"
                f"\terrors={snap['errors']}\tseconds={snap['fetchSeconds']}",
            )
            with self.lock:
                self.value, self.error = snap, None
        except Exception as e:
            log_fetch(
                self.log_path,
                f"failed\t{type(e).__name__}: {e}" + (f"\tdate={self.date}" if self.date else ""),
            )
            with self.lock:
                self.error, self.failed_at = f"{type(e).__name__}: {e}", time.time()
        finally:
            with self.lock:
                self.running = False

    def status(self, background=True):
        """Current snapshot and refresh state; starts a refresh when it is stale."""

        def stale(s):
            return snapshot_stale(s, date=self.date)

        with self.lock:
            # Another process (e.g. a cron --snapshot run) may have written a newer file.
            if stale(self.value):
                on_disk = read_snapshot(self.path)
                if on_disk and not stale(on_disk):
                    self.value = on_disk
            start = (
                stale(self.value)
                and not self.running
                and time.time() - self.failed_at >= SNAPSHOT_RETRY
            )
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
            final = bool(self.date and self.date < zurich_now().date().isoformat())
            return {
                "state": "running"
                if self.running
                else "error"
                if self.error and stale(snap)
                else "ok",
                "done": self.progress["done"],
                "total": self.progress["total"],
                "error": self.error,
                "stale": stale(snap),
                "ageSeconds": None if age is None else round(age),
                "nextFetchInSeconds": None
                if age is None or final
                else max(0, round(SNAPSHOT_TTL - age)),
                "snapshot": snap,
            }


snapshots = None  # set by configure()
_day_snapshots = {}
_day_lock = threading.Lock()
DAY_SNAPSHOTS_KEPT = 30


def booking_window():
    """First and last day ETH has bookings for, e.g. {"min": "2026-02-21", "max": "2027-02-21"}."""
    try:
        mm = get_meta()["minmax"]
        return {"min": mm.get("minDateLoad"), "max": mm.get("maxDateLoad")}
    except Exception:
        return None


def snapshot_status(date=None):
    """Today's snapshot, or the one of `date` (kept in <snapshot>-days/<date>.json)."""
    window = booking_window()
    if not date or date == zurich_now().date().isoformat():
        return {**snapshots.status(), "window": window}
    if window and window["min"] and window["max"] and not window["min"] <= date <= window["max"]:
        return {
            "state": "error",
            "done": 0,
            "total": 0,
            "stale": True,
            "ageSeconds": None,
            "nextFetchInSeconds": None,
            "snapshot": None,
            "window": window,
            "error": f"ETH has room bookings from {window['min']} to {window['max']} only",
        }
    with _day_lock:
        day = _day_snapshots.pop(date, None)
        if day is None:
            folder = os.path.splitext(snapshots.path)[0] + "-days"
            day = Snapshots(os.path.join(folder, f"{date}.json"), date, snapshots.log_path)
        _day_snapshots[date] = day  # most recently used last
        for old in [d for d, snap in _day_snapshots.items() if not snap.running][
            :-DAY_SNAPSHOTS_KEPT
        ]:
            del _day_snapshots[old]
    return {**day.status(), "window": window}


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
            locations += [{"id": i, "name": n} for i, n in zip(ids, names, strict=False)]
            names = []
        else:
            cells = [
                " ".join(html.unescape(re.sub(r"<[^>]+>", " ", c)).split())
                for c in re.findall(r"<t[hd][ >].*?</t[hd]>", row, re.S)
            ]
            names = [c for c in cells if c]

    def widget(loc):
        body = http_get(UZH_WIDGET.format(loc["id"]))[0].decode("utf-8", "replace")
        label = re.search(r"text:\s*\{\s*value:\s*'([^']*)'", body)
        frac = re.search(r"bar\.animate\(\s*([\d.]+)\s*\)", body)
        return {
            **loc,
            "label": label.group(1) if label else "",
            "fraction": float(frac.group(1)) if frac else None,
        }

    if not locations:
        raise ValueError("no occupancy widgets found on the UZH page")
    with ThreadPoolExecutor(6) as pool:
        locations = list(pool.map(widget, locations))
    return {
        "fetchedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "source": UZH_PAGE,
        "locations": locations,
    }


def uzh_occupancy():
    return cached("uzh-occupancy", UZH_TTL, _uzh_fetch)
