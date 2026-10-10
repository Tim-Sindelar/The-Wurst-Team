"""Turn the PolyMaps indoor positioning (IPS) radio map into the compact files polymaps-ar loads.

Usage: python extract_ips.py [polymaps_dir] [app_dir]

PolyMaps' blue dot comes from ArcGIS IPS: the ETH App listens to ~12 000 Bluetooth iBeacons and
matches what it hears against a radio map. That radio map is public: it is the attachment of the
single record in the EGDB_IPS "IPS_Positioning" table, a SQLite database (despite its .zip name) with
  fingerprintpoint  x, y (mm in a local frame) and floor of each surveyed point (~0.75 m hex grid)
  fingerprint       which beacons (networks) were heard at a point
  statistic         mean and variance of the RSSI (dBm) of one beacon at one point
  networkmetadata   ibeacon_uuid / ibeacon_major / ibeacon_minor of each beacon
  floor             floor id -> PolyMaps VERTICAL_ORDER
  building          the frame's origin (micro-degrees) and rotation

The local frame: y mm along bearing 180 from the origin, then x mm along bearing 90 (great circles,
R = 6378137), plus a small linear correction. The correction was fitted against the IPS_Recordings
survey lines (layer 5), after which every recording vertex lies within 1 m of a fingerprint point
(median 0.56 m, the grid spacing); see CORRECTION.

Reads   <polymaps_dir>/EGDB_Levels_4.geojson (from scrape_polymaps.py) and downloads the radio map
        to <polymaps_dir>/ips_positioning.sqlite if it is not there yet (~140 MB).
Writes  <app_dir>/public/ips/index.json        beacons, levels, tiles
        <app_dir>/public/ips/tiles/<key>.bin   fingerprints of one tile, see write_tile()
"""
import json, math, sqlite3, struct, sys, urllib.request
from collections import defaultdict
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "polymaps_data")
APP = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).parent.parent / "polymaps-ar")
IPS_SERVICE = "https://arcgis-prd-web.ethz.ch/server/rest/services/EGDB/EGDB_IPS/FeatureServer/4"

R = 6378137.0
# Metres east / north to add, linear in the IPS x, y in km: [c0, cx, cy] (see module docstring).
CORRECTION = {"east": (2.0608, -1.9711, 0.4127), "north": (-1.4144, 0.1345, -1.7752)}
TILE_DEG = 0.002  # ~150 m x 220 m; a phone needs the few tiles around the beacons it hears
LEVEL_TOLERANCE_DEG = 3e-5  # fingerprints a few metres outside a level outline still belong to it


def get_json(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def download_radio_map(path):
    rows = get_json(f"{IPS_SERVICE}/query?where=1%3D1&outFields=OBJECTID,comment,date_created&f=json")["features"]
    latest = max(rows, key=lambda f: f["attributes"]["date_created"])["attributes"]
    att = get_json(f"{IPS_SERVICE}/{latest['OBJECTID']}/attachments?f=json")["attachmentInfos"][0]
    print(f"downloading radio map '{latest['comment']}' ({att['size'] / 1e6:.0f} MB)...", file=sys.stderr)
    tmp = path.with_suffix(".part")
    with urllib.request.urlopen(f"{IPS_SERVICE}/{latest['OBJECTID']}/attachments/{att['id']}", timeout=600) as r, \
            open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.replace(path)
    path.with_suffix(".json").write_text(json.dumps(latest), encoding="utf-8")


def destination(lat, lng, dist, bearing):
    """Point dist metres from (lat, lng) along the great circle with the given bearing (degrees)."""
    la, lo, b, d = math.radians(lat), math.radians(lng), math.radians(bearing), dist / R
    la2 = math.asin(math.sin(la) * math.cos(d) + math.cos(la) * math.sin(d) * math.cos(b))
    lo2 = lo + math.atan2(math.sin(b) * math.sin(d) * math.cos(la), math.cos(d) - math.sin(la) * math.sin(la2))
    return math.degrees(la2), math.degrees(lo2)


def make_projection(lat0, lng0, rotation):
    def to_lnglat(x_mm, y_mm):
        lat, lng = destination(lat0, lng0, y_mm / 1000, rotation + 90)
        lat, lng = destination(lat, lng, x_mm / 1000, rotation)
        xk, yk = x_mm / 1e6, y_mm / 1e6
        e = sum(c * v for c, v in zip(CORRECTION["east"], (1, xk, yk)))
        n = sum(c * v for c, v in zip(CORRECTION["north"], (1, xk, yk)))
        return lng + e / (111320 * math.cos(math.radians(lat))), lat + n / 111132
    return to_lnglat


def polygons(geom):
    if not geom:
        return []
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def in_ring(x, y, ring):
    inside = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def near_ring(x, y, ring, tol):
    """Whether (x, y) lies within tol (degrees, roughly) of one of the ring's edges."""
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        dx, dy = x1 - x0, y1 - y0
        t = max(0, min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy or 1)))
        if math.hypot(x0 + t * dx - x, y0 + t * dy - y) < tol:
            return True
    return False


class LevelIndex:
    """Finds the PolyMaps level of a point from its vertical order, via a coarse grid of level bboxes."""

    def __init__(self, levels, cell=0.002):
        self.cell, self.grid = cell, defaultdict(list)
        for lv in levels:
            polys = [[[p[:2] for p in ring] for ring in poly] for poly in polygons(lv["geometry"])]
            if not polys:
                continue
            xs = [p[0] for poly in polys for p in poly[0]]
            ys = [p[1] for poly in polys for p in poly[0]]
            box = (min(xs), min(ys), max(xs), max(ys))
            entry = (lv["properties"]["LEVEL_ID"], lv["properties"]["VERTICAL_ORDER"], box, polys)
            for i in range(int((box[0] - LEVEL_TOLERANCE_DEG) // cell), int((box[2] + LEVEL_TOLERANCE_DEG) // cell) + 1):
                for j in range(int((box[1] - LEVEL_TOLERANCE_DEG) // cell), int((box[3] + LEVEL_TOLERANCE_DEG) // cell) + 1):
                    self.grid[i, j].append(entry)

    def find(self, x, y, vertical_order):
        near = None
        for level_id, vo, box, polys in self.grid.get((int(x // self.cell), int(y // self.cell)), ()):
            if vo != vertical_order:
                continue
            t = LEVEL_TOLERANCE_DEG
            if not (box[0] - t <= x <= box[2] + t and box[1] - t <= y <= box[3] + t):
                continue
            for poly in polys:
                if in_ring(x, y, poly[0]) and not any(in_ring(x, y, hole) for hole in poly[1:]):
                    return level_id
                if near is None and near_ring(x, y, poly[0], t):
                    near = level_id
        return near


def write_tile(path, points):
    """Little-endian: u32 count, then per point
         f64 lng, f64 lat, u16 level index, u16 beacon count,
         per beacon: u16 beacon index, i16 mean RSSI * 10 (dBm), u16 std * 10 (dB)."""
    out = bytearray(struct.pack("<I", len(points)))
    for lng, lat, level, beacons in points:
        out += struct.pack("<ddHH", lng, lat, level, len(beacons))
        for b, mean, std in beacons:
            out += struct.pack("<hhH", b, round(mean * 10), min(65535, round(std * 10)))
    path.write_bytes(bytes(out))


def main():
    db_path = SRC / "ips_positioning.sqlite"
    if not db_path.exists():
        download_radio_map(db_path)
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    lat0, lng0, rotation = db.execute("select latorigin, lonorigin, rotation from building").fetchone()
    to_lnglat = make_projection(lat0 / 1e6, lng0 / 1e6, rotation)
    vertical_order = dict(db.execute("select id, level from floor"))

    meta = defaultdict(dict)
    for network, name, value in db.execute("select network_id, name, value from networkmetadata"):
        meta[network][name.removeprefix("ibeacon_")] = value
    uuids = {m["uuid"] for m in meta.values()}
    # Beacon index: sorted by (major, minor) so the order is stable across radio map versions.
    keys = sorted({(int(m["major"]), int(m["minor"])) for m in meta.values()})
    beacon_index = {k: i for i, k in enumerate(keys)}
    network_beacon = {n: beacon_index[int(m["major"]), int(m["minor"])] for n, m in meta.items()}

    levels = json.loads((SRC / "EGDB_Levels_4.geojson").read_text(encoding="utf-8"))["features"]
    level_index = LevelIndex(levels)
    level_ids, level_of_id = [], {}

    print("reading fingerprints...", file=sys.stderr)
    points = {}
    for pid, x, y, floor in db.execute("select id, x, y, floor_id from fingerprintpoint"):
        lng, lat = to_lnglat(x, y)
        level_id = level_index.find(lng, lat, vertical_order[floor])
        if level_id is None:
            continue
        if level_id not in level_of_id:
            level_of_id[level_id] = len(level_ids)
            level_ids.append(level_id)
        points[pid] = (lng, lat, level_of_id[level_id], [])
    total = db.execute("select count(*) from fingerprintpoint").fetchone()[0]
    print(f"{len(points)} of {total} fingerprint points lie on a PolyMaps level", file=sys.stderr)

    strongest = defaultdict(list)  # beacon -> [(mean, lng, lat, level)] for its approximate position
    for pid, network, mean, variance in db.execute(
            "select f.point_id, f.network_id, s.mean, s.variance from fingerprint f join statistic s on s.fingerprint_id = f.id"):
        p = points.get(pid)
        if p is None or network not in network_beacon:
            continue
        b = network_beacon[network]
        p[3].append((b, mean, math.sqrt(variance)))
        s = strongest[b]
        s.append((mean, p[0], p[1], p[2]))
        if len(s) > 64:
            s.sort(reverse=True)
            del s[16:]

    beacons = []
    for i, (major, minor) in enumerate(keys):
        top = sorted(strongest.get(i, []), reverse=True)[:16]
        if not top:
            beacons.append([major, minor, None, None, None])
            continue
        w = [10 ** (m / 20) for m, *_ in top]  # amplitude weights
        lng = sum(wi * t[1] for wi, t in zip(w, top)) / sum(w)
        lat = sum(wi * t[2] for wi, t in zip(w, top)) / sum(w)
        level = max(set(t[3] for t in top), key=[t[3] for t in top].count)
        beacons.append([major, minor, round(lng, 7), round(lat, 7), level])

    out = APP / "public" / "ips"
    (out / "tiles").mkdir(parents=True, exist_ok=True)
    for old in (out / "tiles").glob("*.bin"):
        old.unlink()
    tiles = defaultdict(list)
    for p in points.values():
        if p[3]:
            tiles[f"{math.floor(p[0] / TILE_DEG)}_{math.floor(p[1] / TILE_DEG)}"].append(p)
    for key, pts in tiles.items():
        write_tile(out / "tiles" / f"{key}.bin", pts)

    path_info = db_path.with_suffix(".json")
    comment = json.loads(path_info.read_text())["comment"] if path_info.exists() else "unknown version"
    (out / "index.json").write_text(json.dumps({
        "uuid": sorted(uuids),
        "tileDeg": TILE_DEG,
        "levels": level_ids,
        # Every PolyMaps level's facility and vertical order, to place GPS fixes that carry a floor.
        "levelInfo": {l["properties"]["LEVEL_ID"]: [l["properties"]["FACILITY_ID"], l["properties"]["VERTICAL_ORDER"]]
                      for l in levels},
        "tiles": {k: len(v) for k, v in sorted(tiles.items())},
        "beacons": beacons,
        "source": f"{IPS_SERVICE} (radio map: {comment})",
    }, separators=(",", ":")), encoding="utf-8")
    print(f"{len(beacons)} beacons, {len(level_ids)} levels, {len(tiles)} tiles -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
