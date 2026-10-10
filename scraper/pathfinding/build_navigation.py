"""Build walkable-space grids and floor connections for indoor pathfinding from the PolyMaps layers.

Usage: python scraper/pathfinding/build_navigation.py [polymaps_dir] [app_dir]
       NAV_FACILITIES=ETH.HG,ETH.CAB to build only some buildings (quick checks)
Needs numpy, Pillow, scipy and shapely (pip install numpy pillow scipy shapely).

How PolyMaps draws a floor (EGDB_Units = rooms, EGDB_Details = lines):
  - Rooms are polygons. Mostly a wall-thick gap separates neighbouring rooms, so walls are implicit.
    Some rooms touch without a gap (light partitions, or sloppy drawing).
  - Corridors, foyers and stairs are split into several touching polygons that are one open space.
  - Explicit wall lines (WAND_*) exist mostly on façades and around shafts, as outlines of the wall.
  - Doors (TUER) are leaf + swing-arc symbols sitting on a room boundary, spanning the gap.
  - Stairs and lifts are rooms (Treppe, Aufzug) stacked across floors.

So per level, on a CELL m grid:
  walkable = inside a room
           - outlines of closed rooms (rooms you enter through a door)
           - explicit wall lines
           + door openings: gap and outline cells near each door symbol
           + walkway repair: cells along PolyMaps' walkway network (EGDB_Public_Network) of that floor.
             Some halls and atria have walls but no room polygon, and some doorways no door symbol;
             the walkways go through them. NAV_NETWORK=0 builds from the drawing alone.
Rooms are then checked for how well they are drawn (see classify()): rooms with no door that
open onto a corridor are treated as open areas, rooms cut off with a door symbol just out of reach
get a wider opening, and what remains unreachable is reported. Stairs and lifts connect overlapping
stair / lift rooms of consecutive floors; building entrances connect buildings through outdoors.

Writes  <app_dir>/public/nav/index.json            levels, links between levels, room index
        <app_dir>/public/nav/levels/<LEVEL_ID>.bin  walkable grid (run-length encoded)
        <app_dir>/public/nav/report.json           drawing quality per room and level
"""
import json, math, os, struct, sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import shape

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent.parent / "polymaps_data")
APP = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).parent.parent.parent / "polymaps-ar")

CELL = 0.25  # m
M_PER_DEG_LAT = 111_132.0
DOOR_REACH = 0.6  # m around a door symbol that may be opened (spans gaps of walls up to ~0.5 m)
DOOR_REACH_WIDE = 1.2  # second try for rooms still cut off with a door nearby
ROOM_APPROACH = 3.0  # m around an unreachable room searched for its doorstep
MIN_OVERLAP_M2 = 1.0  # stair / lift rooms on two floors must overlap this much to connect
STAIR_COST = 15.0  # m-equivalent per flight (~3.5 m rise, 15-20 s), on top of the horizontal distance
LIFT_COST = 30.0  # waiting and riding
OUTDOOR_MAX = 600.0  # m between entrances of different buildings
OUTDOOR_FACTOR = 1.2  # detour factor of an outdoor straight line
OUTDOOR_NEIGHBOURS = 25  # buildings each exit links to (the search only loads start and goal buildings)
EXIT_MAX_VO = 1  # façade doors count as exits on floors with |vertical order| <= this
EXIT_SPACING = 10.0  # m: façade doors closer than this on one floor are one exit
EXIT_REACH = 3.0  # m from a façade door or walkway end to the walkable cell it attaches to
PASSAGE_COST = 2.0  # m-equivalent for crossing into another building indoors
NETWORK_REACH = 0.6  # m around walkway lines that is walkable inside halls (repair, see above)
HALL_MIN_HALF_WIDTH = 0.75  # m: room-free space narrower than twice this is a wall gap, not a hall
USE_NETWORK = os.environ.get("NAV_NETWORK", "1") != "0"

# Room uses that are open space: you walk between touching ones without a door.
OPEN_USES = {"Gang", "Korridor / Gang", "Foyer", "Treppe", "Eingang und Ausgang", "Rampe", "Halle",
             "Strasse, Platz, Weg", "Terrassen", "Baugrubenumgang", "Aussentreppen / Fluchttreppen",
             "Aufzug"}  # lift doors are rarely drawn
# Rooms that are never open areas, even when drawn touching a corridor without a door symbol.
NEVER_OPEN = {"Betriebsraum", "Schrank", "Lager", "Sicherheitsraum", "Reinraum", "Labor", "Werkstatt"}
STAIRS, LIFT = "Treppe", "Aufzug"
ENTRANCE = "Eingang und Ausgang"


def clean(s):
    return (s or "").replace("�", "").replace("\xa0", " ").strip()


def use_of(p):
    u = clean(p.get("USE_TYPE")) or clean(p.get("RaumTyp"))
    return {"Gang": "Gang"}.get(u, u)


def polygons(geom):
    if not geom:
        return []
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def load(name):
    return json.loads((SRC / name).read_text(encoding="utf-8"))["features"]


class Frame:
    """Grid frame of one level: cell (i, j) = column i east, row j south of the top-left corner."""

    def __init__(self, bbox, pad=2.0):
        lng0, lat0, lng1, lat1 = bbox
        self.kx = 111_320.0 * math.cos(math.radians((lat0 + lat1) / 2))
        self.lng0 = lng0 - pad / self.kx
        self.lat1 = lat1 + pad / M_PER_DEG_LAT
        self.w = int(math.ceil(((lng1 - lng0) * self.kx + 2 * pad) / CELL)) + 1
        self.h = int(math.ceil(((lat1 - lat0) * M_PER_DEG_LAT + 2 * pad) / CELL)) + 1

    def px(self, lng, lat):
        return ((lng - self.lng0) * self.kx / CELL, (self.lat1 - lat) * M_PER_DEG_LAT / CELL)

    def lnglat(self, i, j):
        return (self.lng0 + (i + 0.5) * CELL / self.kx, self.lat1 - (j + 0.5) * CELL / M_PER_DEG_LAT)


def draw_mask(frame, draw_fn):
    img = Image.new("1", (frame.w, frame.h), 0)
    draw_fn(ImageDraw.Draw(img))
    return np.array(img, dtype=bool)


def disk(radius_cells):
    r = int(math.ceil(radius_cells))
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= radius_cells * radius_cells


def door_openings(frame, room, door_lines, reach):
    """Per door symbol: the cells within `reach` m of it (as a crop of the grid) and the rooms it
    serves, i.e. the rooms that zone overlaps substantially. A door only opens the gap cells and
    the outlines of its own rooms, so a door next to a corner doesn't also open the room around it."""
    openings = []
    r = int(math.ceil(reach / CELL)) + 1
    for lines in door_lines:
        pts = [frame.px(*c[:2]) for line in lines for c in line]
        if len(pts) < 2:
            continue
        i0 = max(0, int(min(p[0] for p in pts)) - r)
        j0 = max(0, int(min(p[1] for p in pts)) - r)
        i1 = min(frame.w, int(max(p[0] for p in pts)) + r + 2)
        j1 = min(frame.h, int(max(p[1] for p in pts)) + r + 2)
        if i1 <= i0 or j1 <= j0:
            continue
        img = Image.new("1", (i1 - i0, j1 - j0), 0)
        local = [(x - i0, y - j0) for x, y in pts]
        d = ImageDraw.Draw(img)
        if len(local) > 2:
            d.polygon(local, fill=1, outline=1)
        else:
            d.line(local, fill=1)
        zone = ndimage.binary_dilation(np.array(img, dtype=bool), structure=disk(reach / CELL))
        ids, counts = np.unique(room[j0:j1, i0:i1][zone], return_counts=True)
        counts = {int(k): int(c) for k, c in zip(ids, counts) if k > 0}
        top = max(counts.values(), default=0)
        served = np.array([k for k, c in counts.items() if c >= 0.25 * top], dtype=np.int32)
        openings.append((slice(j0, j1), slice(i0, i1), zone, served))
    return openings


def openings_union(frame, openings):
    out = np.zeros((frame.h, frame.w), bool)
    for sj, si, zone, _ in openings:
        out[sj, si] |= zone
    return out


def group_doors(features, tol=1.0):
    """A door symbol is several line features (leaf, arc); group those within tol m of each other."""
    groups = []
    for f in features:
        coords = f["geometry"]["coordinates"]
        lines = coords if f["geometry"]["type"] == "MultiLineString" else [coords]
        xs = [c[0] for l in lines for c in l]
        ys = [c[1] for l in lines for c in l]
        box = (min(xs), min(ys), max(xs), max(ys))
        for g in groups:
            b = g["box"]
            dx = max(0, b[0] - box[2], box[0] - b[2]) * 75_000
            dy = max(0, b[1] - box[3], box[1] - b[3]) * M_PER_DEG_LAT
            if dx < tol and dy < tol and g["n"] < 6:
                g["lines"] += lines
                g["box"] = (min(b[0], box[0]), min(b[1], box[1]), max(b[2], box[2]), max(b[3], box[3]))
                g["n"] += 1
                break
        else:
            groups.append({"lines": lines, "box": box, "n": 1})
    return [g["lines"] for g in groups]


def supercover(mask, x0, y0, x1, y1):
    """Mark the cells a segment passes through, 4-connected (no diagonal-only steps)."""
    i, j = int(math.floor(x0)), int(math.floor(y0))
    i1, j1 = int(math.floor(x1)), int(math.floor(y1))
    dx, dy = x1 - x0, y1 - y0
    si, sj = (1 if dx > 0 else -1), (1 if dy > 0 else -1)
    tx = ((i + (si > 0)) - x0) / dx if dx else math.inf
    ty = ((j + (sj > 0)) - y0) / dy if dy else math.inf
    ddx, ddy = (abs(1 / dx) if dx else math.inf), (abs(1 / dy) if dy else math.inf)
    h, w = mask.shape
    for _ in range(abs(i1 - i) + abs(j1 - j) + 1):
        if 0 <= j < h and 0 <= i < w:
            mask[j, i] = True
        if tx < ty:
            tx += ddx
            i += si
        else:
            ty += ddy
            j += sj


def network_mask(frame, lines, room, outline_poly):
    """Walkway repair: the walkway lines themselves (4-connected, so they cross a wall only where
    PolyMaps' walkway does), widened by NETWORK_REACH only inside halls: space without any room
    polygon that is wide (survives an opening of HALL_MIN_HALF_WIDTH), not the thin gaps of walls,
    where widened spur ends in two neighbouring rooms would bridge the wall between them."""
    line = np.zeros((frame.h, frame.w), bool)
    for l in lines:
        pts = [frame.px(*c[:2]) for c in l]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            supercover(line, x0, y0, x1, y1)
    if not line.any():
        return line
    inside = draw_mask(frame, lambda d: [d.polygon([frame.px(*c[:2]) for c in ring], fill=1) for poly in outline_poly for ring in poly[:1]])
    hall = ndimage.binary_opening((room == 0) & inside, structure=disk(HALL_MIN_HALF_WIDTH / CELL))
    return line | (ndimage.binary_dilation(line, structure=disk(NETWORK_REACH / CELL)) & hall)


def build_level(level, units, details, network=()):
    lp = level["properties"]
    pts = [c for poly in polygons(level["geometry"]) for ring in poly for c in ring]
    pts += [c for u in units for poly in polygons(u["geometry"]) for ring in poly for c in ring]
    if not pts:
        return None
    frame = Frame((min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)))

    # Room id raster (0 = no room). Open rooms first, closed on top so their outlines stay whole.
    order = sorted(range(len(units)), key=lambda k: use_of(units[k]["properties"]) not in OPEN_USES)
    img = Image.new("I", (frame.w, frame.h), 0)
    d = ImageDraw.Draw(img)
    for k in order:
        for poly in polygons(units[k]["geometry"]):
            d.polygon([frame.px(*c[:2]) for c in poly[0]], fill=k + 1)
            for hole in poly[1:]:
                d.polygon([frame.px(*c[:2]) for c in hole], fill=0)
    room = np.array(img, dtype=np.int32)

    walls = [f for f in details if f["properties"]["USE_TYPE"].startswith("WAND")]
    wall_mask = draw_mask(frame, lambda d: [d.line([frame.px(*c[:2]) for c in line], fill=1, width=1)
                                            for f in walls
                                            for line in (f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiLineString"
                                                         else [f["geometry"]["coordinates"]])])
    doors = group_doors([f for f in details if f["properties"]["USE_TYPE"] == "TUER"])
    openings = door_openings(frame, room, doors, DOOR_REACH)
    inside = draw_mask(frame, lambda d: [d.polygon([frame.px(*c[:2]) for c in poly[0]], fill=1) for poly in polygons(level["geometry"])])
    return {"level": lp, "frame": frame, "units": units, "room": room, "walls": wall_mask, "doors": doors,
            "openings": openings, "zone": openings_union(frame, openings), "inside": inside,
            "network": network_mask(frame, network, room, polygons(level["geometry"]))}


def walkable(lv, open_rooms, extra_openings=()):
    """Walkable grid for the current open/closed classification."""
    frame, units, room = lv["frame"], lv["units"], lv["room"]
    outline = draw_mask(frame, lambda d: [d.polygon([frame.px(*c[:2]) for c in ring], outline=1)
                                          for k, u in enumerate(units) if k not in open_rooms
                                          for poly in polygons(u["geometry"]) for ring in poly])
    walk = (room > 0) & ~outline & ~lv["walls"]
    # Door openings: near a door, the gap and the outlines of the door's own rooms (never explicit walls).
    for sj, si, zone, served in list(lv["openings"]) + list(extra_openings):
        r = room[sj, si]
        allowed = (r == 0) | (outline[sj, si] & np.isin(r, served))
        walk[sj, si] |= zone & allowed & ~lv["walls"][sj, si]
    walk |= lv["network"]
    return walk


def classify(lv):
    """Decide how each room is drawn and build the final grid. Returns (walk grid, room report)."""
    units, room = lv["units"], lv["room"]
    n = len(units)
    uses = [use_of(u["properties"]) for u in units]
    open_rooms = {k for k in range(n) if uses[k] in OPEN_USES}
    cells = ndimage.sum_labels(np.ones_like(room), room, index=np.arange(1, n + 1)).astype(int)
    # Rooms each door symbol touches (its points, give or take half a metre).
    f = lv["frame"]
    door_rooms = []
    for lines in lv["doors"]:
        hit = set()
        for line in lines:
            for c in line:
                i, j = (int(v) for v in f.px(*c[:2]))
                for di in (-2, 0, 2):
                    for dj in (-2, 0, 2):
                        if 0 <= j + dj < f.h and 0 <= i + di < f.w and room[j + dj, i + di]:
                            hit.add(int(room[j + dj, i + di]) - 1)
        door_rooms.append(hit)
    door_count = [0] * n
    for hit in door_rooms:
        for k in hit:
            door_count[k] += 1

    # Rooms without any door that touch an open room (no gap) over > 2 m are open areas drawn as
    # separate rooms (study spots, lounges, niches in corridors).
    touching = Counter()
    for a, b in ((room[:, :-1], room[:, 1:]), (room[:-1, :], room[1:, :])):
        diff = (a != b) & (a > 0) & (b > 0)
        for x, y in zip(a[diff], b[diff]):
            touching[(x - 1, y - 1)] += 1
            touching[(y - 1, x - 1)] += 1
    auto_open = set()
    for (k, other), cnt in touching.items():
        if (k not in open_rooms and other in open_rooms and door_count[k] == 0 and cnt * CELL > 2.0
                and uses[k] not in NEVER_OPEN):
            auto_open.add(k)
    open_rooms |= auto_open

    walk = walkable(lv, open_rooms)
    labels, _ = ndimage.label(walk)  # 4-connected, as the search moves

    def component_of(k):
        vals = labels[(room == k + 1) & walk]
        return Counter(vals.tolist()).most_common(1)[0][0] if vals.size else 0

    comp = [component_of(k) for k in range(n)]
    circulation = Counter(comp[k] for k in range(n) if uses[k] in OPEN_USES and comp[k])
    main = {c for c, _ in circulation.most_common()}  # every component holding circulation

    # Rooms with a door that are still cut off: open wider around their doors.
    cut_off = [k for k in range(n) if comp[k] not in main and door_count[k] > 0]
    if cut_off:
        cut = set(cut_off)
        near = [lines for lines, hit in zip(lv["doors"], door_rooms) if hit & cut]
        walk = walkable(lv, open_rooms, door_openings(lv["frame"], room, near, DOOR_REACH_WIDE))
        labels, _ = ndimage.label(walk)  # 4-connected, as the search moves
        comp = [component_of(k) for k in range(n)]
        circulation = Counter(comp[k] for k in range(n) if uses[k] in OPEN_USES and comp[k])
        main = {c for c, _ in circulation.most_common()}
        widened = set(cut_off)
    else:
        widened = set()

    report = []
    for k, u in enumerate(units):
        p = u["properties"]
        if comp[k] in main:
            status = "open-area" if k in auto_open else ("door-widened" if k in widened else "ok")
        elif cells[k] * CELL * CELL < 1.5:
            status = "tiny"
        elif door_count[k] == 0:
            status = "no-door"  # shafts, cupboards, technical rooms, or a missing door symbol
        else:
            status = "cut-off"
        report.append({"id": p["UNIT_ID"], "name": clean(p.get("NAME")), "use": uses[k], "doors": door_count[k],
                       "area": round(cells[k] * CELL * CELL, 1), "status": status})
    # Cell classes for the router: 0 blocked, 1 circulation (corridors, halls, doorways, open
    # areas), 2 inside a closed room. Routes may start or end in a room but should not cut through
    # meeting rooms or offices with two doors; the router charges extra for class 2.
    closed = np.ones(n + 1, bool)
    closed[0] = False
    closed[[k + 1 for k in open_rooms]] = False
    cls = np.where(walk, np.where(closed[room], 2, 1), 0).astype(np.uint8)
    return cls, labels, main, comp, report


def rle(cls):
    """Row-major runs of equal class: u32 count, count × u16 run length, count × u8 class."""
    flat = cls.ravel()
    change = np.flatnonzero(np.diff(flat)) + 1
    starts = np.concatenate([[0], change])
    lengths = np.diff(np.concatenate([starts, [flat.size]]))
    runs, values = [], []
    for start, length in zip(starts.tolist(), lengths.tolist()):
        v = int(flat[start])
        while length > 65535:
            runs.append(65535)
            values.append(v)
            length -= 65535
        runs.append(length)
        values.append(v)
    return struct.pack(f"<I{len(runs)}H{len(values)}B", len(runs), *runs, *values)


def representative_cell(lv, walk, k, main_labels=None, labels=None):
    """Cell to route to for room k: its walkable cell closest to its centroid, in a main component
    if possible. A room the grid can't reach (door symbol missing or off) gets the nearest reachable
    cell within ROOM_APPROACH m of it instead, so routes still lead to its doorstep."""
    room_mask = lv["room"] == k + 1
    js, is_ = np.nonzero(room_mask)
    if js.size == 0:
        return None
    cj, ci = js.mean(), is_.mean()
    mask = room_mask & walk
    if main_labels is not None:
        in_main = mask & np.isin(labels, list(main_labels))
        if in_main.any():
            mask = in_main
        else:
            r = int(ROOM_APPROACH / CELL)
            j0, j1 = max(0, js.min() - r), js.max() + r + 1
            i0, i1 = max(0, is_.min() - r), is_.max() + r + 1
            near = np.zeros_like(mask)
            near[j0:j1, i0:i1] = walk[j0:j1, i0:i1] & np.isin(labels[j0:j1, i0:i1], list(main_labels))
            if near.any():
                mask = near
    js, is_ = np.nonzero(mask)
    if js.size == 0:
        return None
    best = np.argmin((js - cj) ** 2 + (is_ - ci) ** 2)
    return int(is_[best]), int(js[best])


def unit_cells(lv, walk, k, main_labels, labels):
    """Walkable cells of room k, in a main component if it has any there."""
    mask = (lv["room"] == k + 1) & walk
    in_main = mask & np.isin(labels, list(main_labels))
    js, is_ = np.nonzero(in_main if in_main.any() else mask)
    return np.stack([is_, js], axis=1)


def nearest_in_mask(mask, i, j, radius):
    """Cell of mask nearest to (i, j) within radius cells, or None."""
    r = int(math.ceil(radius))
    i0, j0 = max(0, int(i) - r), max(0, int(j) - r)
    sub = mask[j0:int(j) + r + 1, i0:int(i) + r + 1]
    js, is_ = np.nonzero(sub)
    if js.size == 0:
        return None
    d = (is_ + i0 + 0.5 - i) ** 2 + (js + j0 + 0.5 - j) ** 2
    k = int(np.argmin(d))
    return (int(is_[k] + i0), int(js[k] + j0)) if d[k] <= radius * radius else None


def nearest_cell(node, lnglat):
    """The node's walkable cell closest to a point."""
    i, j = node["frame"].px(*lnglat)
    c = node["cells"]
    best = np.argmin((c[:, 0] + 0.5 - i) ** 2 + (c[:, 1] + 0.5 - j) ** 2)
    return int(c[best, 0]), int(c[best, 1])


def footprint(u):
    pts = [c for poly in polygons(u["geometry"]) for c in poly[0]]
    return (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))


def overlap(a, b, tol=0.5):
    t = tol / 75_000
    return a[0] - t <= b[2] and b[0] - t <= a[2] and a[1] - t <= b[3] and b[1] - t <= a[3]


def main():
    only = set(filter(None, os.environ.get("NAV_FACILITIES", "").split(",")))
    levels = {f["properties"]["LEVEL_ID"]: f for f in load("EGDB_Levels_4.geojson")
              if not only or f["properties"]["FACILITY_ID"] in only}
    units_by_level, details_by_level = defaultdict(list), defaultdict(list)
    for u in load("EGDB_Units_3.geojson"):
        if u["geometry"]:
            units_by_level[u["properties"]["LEVEL_ID"]].append(u)
    print("reading details (large)...", file=sys.stderr)
    for f in load("EGDB_Details_1.geojson"):
        use = f["properties"]["USE_TYPE"] or ""
        if f["geometry"] and (use == "TUER" or use.startswith("WAND")):
            details_by_level[f["properties"]["LEVEL_ID"]].append(f)

    network_by_level = defaultdict(list)
    network_ends = defaultdict(lambda: (set(), set(), set()))  # point -> (levels, pathway types, levels with a vertical line)
    if USE_NETWORK and (SRC / "EGDB_EGDB_Public_Network_2.geojson").exists():
        for f in load("EGDB_EGDB_Public_Network_2.geojson"):
            p, g = f["properties"], f["geometry"]
            if not g:
                continue
            lines = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
            if p["LEVEL_NAME_FROM"] == p["LEVEL_NAME_TO"]:  # horizontal walkways
                network_by_level[p["LEVEL_ID"]] += lines
            vertical = p["PATHWAY_TYPE"] in (2, 3) or p["LEVEL_NAME_FROM"] != p["LEVEL_NAME_TO"]
            for line in lines:
                for c in (line[0], line[-1]):
                    levels_at, types_at, vertical_at = network_ends[(round(c[0], 6), round(c[1], 6))]
                    levels_at.add(p["LEVEL_ID"])
                    types_at.add(p["PATHWAY_TYPE"])
                    if vertical:
                        vertical_at.add(p["LEVEL_ID"])

    out = APP / "public" / "nav"
    (out / "levels").mkdir(parents=True, exist_ok=True)
    for old in (out / "levels").glob("*.bin"):
        old.unlink()

    index_levels, report_levels, rooms_index, nodes = [], [], [], defaultdict(list)
    exits = []
    level_masks = {}
    for n, (level_id, level) in enumerate(sorted(levels.items())):
        units = units_by_level.get(level_id, [])
        if not units:
            continue
        lv = build_level(level, units, details_by_level.get(level_id, []), network_by_level.get(level_id, []))
        if lv is None:
            continue
        cls, labels, main_labels, comp, report = classify(lv)
        walk = cls > 0
        # Building exits: door symbols whose opening reaches outside the floor's outline.
        main_walk = walk & np.isin(labels, list(main_labels))
        # Only near the ground: façade doors higher up open onto balconies and terraces.
        for sj, si, zone, _ in (lv["openings"] if abs(lv["level"]["VERTICAL_ORDER"]) <= EXIT_MAX_VO else []):
            if not (zone & ~lv["inside"][sj, si]).any():
                continue
            zj, zi = np.nonzero(zone)
            cell = nearest_in_mask(main_walk, si.start + zi.mean(), sj.start + zj.mean(), EXIT_REACH / CELL)
            if cell and not any(e["level"] == level_id and math.hypot(e["cell"][0] - cell[0], e["cell"][1] - cell[1]) * CELL < EXIT_SPACING
                                for e in exits[-200:]):
                exits.append({"level": level_id, "facility": lv["level"]["FACILITY_ID"], "cell": cell, "lnglat": lv["frame"].lnglat(*cell)})
        # Kept for linking stairs that arrive in space without a room polygon (see below).
        level_masks[level_id] = (lv["frame"], np.packbits(walk & np.isin(labels, list(main_labels))), np.packbits(lv["room"] == 0),
                                 lv["level"]["FACILITY_ID"], lv["level"]["VERTICAL_ORDER"])
        f = lv["frame"]
        (out / "levels" / f"{level_id}.bin").write_bytes(rle(cls))
        lp = lv["level"]
        index_levels.append({"id": level_id, "facility": lp["FACILITY_ID"], "vo": lp["VERTICAL_ORDER"],
                             "lng0": round(f.lng0, 8), "lat1": round(f.lat1, 8), "kx": round(f.kx, 4),
                             "w": f.w, "h": f.h})
        statuses = Counter(r["status"] for r in report)
        # Walkway cells outside any room and away from doors: space the drawing has no container for.
        repaired = int((lv["network"] & (lv["room"] == 0) & ~lv["zone"]).sum())
        report_levels.append({"level": level_id, "rooms": len(report), "status": dict(statuses),
                              "walkwayRepairM2": round(repaired * CELL * CELL, 1),
                              "problems": [r for r in report if r["status"] in ("cut-off", "no-door") and r["area"] >= 4]})
        for k, u in enumerate(units):
            use = use_of(u["properties"])
            cell = representative_cell(lv, walk, k, main_labels, labels)
            if cell is None:
                continue
            name = clean(u["properties"].get("NAME"))
            if name:
                rooms_index.append([name, clean(u["properties"].get("Anzeigetext")) or use, level_id, cell[0], cell[1]])
            if use in (STAIRS, LIFT, ENTRANCE) or (use == "Aussentreppen / Fluchttreppen"):
                nodes[lp["FACILITY_ID"]].append({"level": level_id, "vo": lp["VERTICAL_ORDER"], "use": use,
                                                 "box": footprint(u), "cell": cell, "lnglat": f.lnglat(*cell),
                                                 "shape": shape(u["geometry"]).buffer(0), "frame": f,
                                                 "cells": unit_cells(lv, walk, k, main_labels, labels)})
        if n % 25 == 0:
            print(f"  {len(index_levels)} levels...", file=sys.stderr)

    # Floor changes: stair rooms of consecutive vertical orders whose footprints overlap, lifts of any
    # two levels. A link is anchored where the two footprints overlap, on each floor at the room's
    # walkable cell nearest to that spot: a big stair hall overlapping two stairwells above gets two
    # links at two places, instead of one cell that would teleport between them.
    links = []
    for facility, ns in nodes.items():
        for a in ns:
            for b in ns:
                if a is b or a["level"] >= b["level"] or not overlap(a["box"], b["box"]):
                    continue
                if a["use"] == b["use"] == LIFT:
                    kind, cost = "lift", LIFT_COST + 0.5 * abs(a["vo"] - b["vo"])
                elif STAIRS in (a["use"], b["use"]) and LIFT not in (a["use"], b["use"]) and abs(a["vo"] - b["vo"]) == 1:
                    kind, cost = "stairs", STAIR_COST
                else:
                    continue
                inter = a["shape"].intersection(b["shape"])
                area = inter.area * a["frame"].kx * M_PER_DEG_LAT
                if area < MIN_OVERLAP_M2 or not len(a["cells"]) or not len(b["cells"]):
                    continue
                spot = inter.representative_point()
                links.append([a["level"], *nearest_cell(a, (spot.x, spot.y)), b["level"], *nearest_cell(b, (spot.x, spot.y)), kind, cost])
    # Stairs arriving in undrawn space: a stairwell with no stair room overlapping it on the floor
    # above or below still links there if that floor has walkable cells without any room polygon
    # (a hall the walkways run through) inside the stairwell's footprint. Requiring room-free cells
    # keeps a stair's top from linking into whatever ordinary room lies above it.
    linked = {(l[0], l[3]) for l in links} | {(l[3], l[0]) for l in links}
    for facility, ns in nodes.items():
        stairs = [n for n in ns if n["use"] == STAIRS and len(n["cells"])]
        for a in stairs:
            for m_id, (mf, mwalk, mfree, mfac, mvo) in level_masks.items():
                if mfac != facility or abs(mvo - a["vo"]) != 1:
                    continue
                if any(b["level"] == m_id and b["use"] in (STAIRS, LIFT) and a["shape"].intersects(b["shape"])
                       and a["shape"].intersection(b["shape"]).area * mf.kx * M_PER_DEG_LAT >= MIN_OVERLAP_M2 for b in ns):
                    continue
                foot = draw_mask(mf, lambda d: [d.polygon([mf.px(*c[:2]) for c in poly.exterior.coords], fill=1)
                                                for poly in getattr(a["shape"], "geoms", [a["shape"]])])
                n_cells = mf.w * mf.h
                hit = foot & np.unpackbits(mwalk)[:n_cells].reshape(mf.h, mf.w).astype(bool) \
                    & np.unpackbits(mfree)[:n_cells].reshape(mf.h, mf.w).astype(bool)
                if hit.sum() * CELL * CELL < 2.0:
                    continue
                c = a["shape"].centroid
                ci, cj = mf.px(c.x, c.y)
                js, is_ = np.nonzero(hit)
                k = int(np.argmin((is_ + 0.5 - ci) ** 2 + (js + 0.5 - cj) ** 2))
                links.append([a["level"], *nearest_cell(a, (c.x, c.y)), m_id, int(is_[k]), int(js[k]), "stairs", STAIR_COST])
    # Passages from the walkway network: a walkway end shared by two floors is a connection between
    # them. Between buildings these are bridges and tunnels; within one building they fill in floor
    # changes the drawing doesn't show (mezzanines, stairs without stair rooms).
    unpacked = {}

    def main_walk_of(level_id):
        if level_id not in unpacked:
            f, packed = level_masks[level_id][0], level_masks[level_id][1]
            unpacked[level_id] = np.unpackbits(packed)[:f.w * f.h].reshape(f.h, f.w).astype(bool)
        return unpacked[level_id]

    passage_seen = set()
    for (x, y), (levels_at, types_at, vertical_at) in network_ends.items():
        ls = sorted(l for l in levels_at if l in level_masks)
        for i_a, la in enumerate(ls):
            for lb in ls[i_a + 1:]:
                fa, fb = level_masks[la][3], level_masks[lb][3]
                # The same corridor drawn on stacked floors shares coordinates; within a building only
                # a stair / lift walkway ending here is a real floor change.
                if fa == fb and not (vertical_at & {la, lb}):
                    continue
                key = (la, lb, round(x, 4), round(y, 4))  # one link per pair and ~10 m
                if key in passage_seen:
                    continue
                ca = nearest_in_mask(main_walk_of(la), *level_masks[la][0].px(x, y), EXIT_REACH / CELL)
                cb = nearest_in_mask(main_walk_of(lb), *level_masks[lb][0].px(x, y), EXIT_REACH / CELL)
                if not ca or not cb:
                    continue
                passage_seen.add(key)
                if fa != fb:
                    kind, cost = "passage", PASSAGE_COST
                elif 3 in types_at:
                    kind, cost = "lift", LIFT_COST
                else:
                    kind, cost = "stairs", STAIR_COST * max(1, abs(level_masks[la][4] - level_masks[lb][4]))
                links.append([la, *ca, lb, *cb, kind, cost])

    # Buildings through outdoors: entrance rooms and façade doors (exits). Each links to the nearest
    # exit of each of the OUTDOOR_NEIGHBOURS closest other buildings, and to its own building's
    # nearest exits on other floors (buildings on a slope, wings joined only outside).
    entrances = [{"level": n["level"], "facility": n["level"].rsplit(".", 1)[0], "cell": n["cell"], "lnglat": n["lnglat"]}
                 for ns in nodes.values() for n in ns if n["use"] in (ENTRANCE, "Aussentreppen / Fluchttreppen")] + exits
    pairs = {}
    for a in entrances:
        best, own = {}, []
        for b in entrances:
            if b is a:
                continue
            dist = math.hypot((a["lnglat"][0] - b["lnglat"][0]) * 75_300, (a["lnglat"][1] - b["lnglat"][1]) * M_PER_DEG_LAT)
            if dist >= OUTDOOR_MAX:
                continue
            if b["facility"] != a["facility"]:
                if b["facility"] not in best or dist < best[b["facility"]][0]:
                    best[b["facility"]] = (dist, b)
            elif b["level"] != a["level"]:
                own.append((dist, b))
        chosen = sorted(best.values(), key=lambda t: t[0])[:OUTDOOR_NEIGHBOURS] + sorted(own, key=lambda t: t[0])[:2]
        for dist, b in chosen:
            key = tuple(sorted([(a["level"], *a["cell"]), (b["level"], *b["cell"])]))
            pairs[key] = round(max(dist, 1.0) * OUTDOOR_FACTOR, 1)
    for ((la, ia, ja), (lb, ib, jb)), cost in pairs.items():
        links.append([la, ia, ja, lb, ib, jb, "outdoor", cost])

    (out / "index.json").write_text(json.dumps({
        "cell": CELL, "levels": index_levels, "links": links, "rooms": rooms_index,
    }, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    totals = Counter()
    for r in report_levels:
        totals.update(r["status"])
    (out / "report.json").write_text(json.dumps({"cell": CELL, "totals": dict(totals), "levels": report_levels},
                                                indent=1, ensure_ascii=False), encoding="utf-8")
    kinds = Counter(l[6] for l in links)
    print(f"{len(index_levels)} levels, links {dict(kinds)}, rooms {dict(totals)} -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
