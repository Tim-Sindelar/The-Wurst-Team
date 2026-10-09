"""Turn the scraped PolyMaps layers into the floor plan files and library list of occupancy-map-preview.

Usage: python extract_floors.py [polymaps_dir] [app_dir]

Writes
  <app_dir>/public/floors/index.json        floors, building footprints and level outlines
  <app_dir>/public/floors/levels/<id>.json  rooms and wall/door/stair lines of one level
  <app_dir>/data/occupancy.json             libraries rebuilt from the "Bibliothek" rooms;
                                            curated metadata, tables and seats are kept

Coordinates in level files are integers in micro-degrees relative to the level's
`origin` ([lng, lat]); rings and lines are flat [x0, y0, x1, y1, ...] arrays.
"""
import json, re, sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "polymaps_data")
APP = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).parent.parent / "occupancy-map-preview")
SCALE = 1_000_000  # micro-degrees: ~0.11 m north-south, ~0.08 m east-west in Zurich

# Room use type -> coarse kind used for styling in the app.
KINDS = {
    "library": ["Bibliothek"],
    "teaching": ["Hörsaal", "Seminarraum", "Übungsraum", "Computerraum", "Zeichensaal", "Schulungsraum"],
    "study": ["Arbeitsplatz", "Aufenthaltsraum", "Rückzugsraum", "Meetingbox", "Sitzungszimmer", "Mehrzweckraum"],
    "office": ["Büro"],
    "lab": ["Labor", "Werkstatt"],
    "circulation": ["Gang", "Foyer", "Eingang und Ausgang", "Rampe"],
    "stairs": ["Treppe", "Aufzug"],
    "sanitary": ["WC", "Dusche", "Garderobe"],
    "food": ["Verpflegung", "Einkauf"],
    "outdoor": ["Terrassen", "Parkplatz", "Sport"],
    "service": ["Betriebsraum", "Lager", "Schrank", "Sicherheitsraum", "Drucken und Kopieren"],
}
KIND_OF = {use: kind for kind, uses in KINDS.items() for use in uses}

# Detail line use type -> layer. Windows (FENSTER_H) are too rare to matter.
LINE_LAYERS = {"WAND_1": "wall", "WAND_2": "wall", "WAND_3": "wall", "WAND_4": "wall", "WAND_4_V": "wall",
               "TUER": "door", "TREPPELIFT": "stair", "TREPPE_O": "stair"}

# Rooms of the curated libraries in data/occupancy.json. Every other "Bibliothek"
# room is grouped spatially into an additional library.
LIBRARY_ROOMS = {
    "lib-hauptbibliothek": ["HG H 30.1", "HG J 30.1"],
    "lib-sammlungen-archive": ["HG H 26", "HG H 27.5", "HG H 15.1", "HG J 26.1"],
    "lib-gess": ["IFW A 35", "IFW B 35.1"],
    "lib-gruene": ["CHN H 33", "CHN H 43", "CHN H 43.1", "CHN H 43.2", "CHN H 43.3", "CHN J 43"],
    "lib-informatik": ["CAB G 41", "CAB GO 41"],
    "lib-mathbib": ["HG G 7"],
    "lib-baubibliothek": ["HIL D 10.5", "HIL E 2.1", "HIL F 2.1", "HIL G 10.3"],
    "lib-physik": ["HIT E 12.1"],
    "lib-icbp": ["HCI G 5.1", "HCI H 5.1", "HCI J 56", "HCI J 58",
                 "HCI J 59.1", "HCI J 59.2", "HCI J 59.3", "HCI J 59.4", "HCI J 59.5", "HCI J 59.6"],
}
HONGGERBERG_LAT = 47.395


def load(name):
    return json.loads((SRC / name).read_text(encoding="utf-8"))["features"]


def clean(s):
    """The service returns a few names with U+FFFD for umlauts and trailing NBSPs."""
    if not s:
        return s
    return s.replace("Gr�ne", "Grüne").replace("�", "").replace("\xa0", " ").strip()


def polygons(geom):
    if not geom:
        return []
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def bbox(points):
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def r6(v):
    return round(v, 6)


def encode(coords, origin):
    """[[lng, lat], ...] -> flat int array relative to origin, dropping repeated points."""
    out, last = [], None
    for lng, lat, *_ in coords:
        p = (round((lng - origin[0]) * SCALE), round((lat - origin[1]) * SCALE))
        if p != last:
            out += p
            last = p
    return out


def ring_area_centroid(ring):
    """Signed shoelace area (deg^2) and centroid of a ring."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    if abs(a) < 1e-14:
        xs, ys = zip(*ring)
        return 0.0, (sum(xs) / len(xs), sum(ys) / len(ys))
    return a / 2, (cx / (3 * a), cy / (3 * a))


def round_ring(ring):
    return [[r6(x), r6(y)] for x, y, *_ in ring]


def main():
    out = APP / "public" / "floors"
    (out / "levels").mkdir(parents=True, exist_ok=True)
    for old in (out / "levels").glob("*.json"):
        old.unlink()

    levels = {f["properties"]["LEVEL_ID"]: f for f in load("EGDB_Levels_4.geojson")}
    units = load("EGDB_Units_3.geojson")
    pois = load("EGDB_PointsOfInterest_0.geojson")
    facilities = load("EGDB_Facilities_7.geojson")

    # ---- per-level files --------------------------------------------------
    by_level = defaultdict(lambda: {"units": [], "lines": defaultdict(list)})
    for u in units:
        by_level[u["properties"]["LEVEL_ID"]]["units"].append(u)
    print("reading details (large)...", file=sys.stderr)
    for d in load("EGDB_Details_1.geojson"):
        p, g = d["properties"], d["geometry"]
        layer = LINE_LAYERS.get(p["USE_TYPE"])
        if layer and g and p["LEVEL_ID"] in levels:
            by_level[p["LEVEL_ID"]]["lines"][layer].append(g["coordinates"])

    index_levels = []
    for level_id, lf in sorted(levels.items()):
        lp = lf["properties"]
        outline = polygons(lf["geometry"])
        pts = [pt for poly in outline for ring in poly for pt in ring]
        if not pts:
            continue
        box = bbox(pts)
        origin = [r6(box[0]), r6(box[1])]
        content = by_level.get(level_id, {"units": [], "lines": {}})
        rooms = []
        for u in content["units"]:
            up = u["properties"]
            use = clean(up["USE_TYPE"]) or clean(up["RaumTyp"]) or ""
            rooms.append({
                "id": up["UNIT_ID"],
                "name": clean(up["NAME"]),
                "label": clean(up["Anzeigetext"]),
                "use": use,
                "kind": KIND_OF.get(use) or next((k for prefix, k in KIND_OF.items() if use.startswith(prefix)), "other"),
                "area": round(up["Fläche"] or 0, 1),
                "rings": [[encode(ring, origin) for ring in poly] for poly in polygons(u["geometry"])],
            })
        lines = {layer: [encode(c, origin) for c in coords] for layer, coords in content["lines"].items()}
        (out / "levels" / f"{level_id}.json").write_text(
            json.dumps({"id": level_id, "origin": origin, "scale": SCALE, "rooms": rooms, "lines": lines},
                       separators=(",", ":"), ensure_ascii=False),
            encoding="utf-8")
        index_levels.append({
            "id": level_id,
            "facilityId": lp["FACILITY_ID"],
            "name": lp["NAME"],
            "floor": lp["VERTICAL_ORDER"],
            "bbox": [r6(v) for v in box],
            "outline": {"type": "MultiPolygon", "coordinates": [[round_ring(r) for r in poly] for poly in outline]},
        })

    index_facilities = []
    for f in facilities:
        fp = f["properties"]
        polys = polygons(f["geometry"])
        if not polys:
            continue
        index_facilities.append({
            "id": fp["FACILITY_ID"],
            "name": clean(fp["NAME_LONG"] or fp["NAME"]),
            "address": ", ".join(x for x in [clean(fp["Strasse"]), f'{fp["PLZ"] or ""} {clean(fp["Ort"]) or ""}'.strip()] if x) or None,
            "outline": {"type": "MultiPolygon", "coordinates": [[round_ring(r) for r in poly] for poly in polys]},
        })

    floors = sorted({l["floor"] for l in index_levels})
    (out / "index.json").write_text(
        json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "floors": floors, "levels": index_levels, "facilities": index_facilities},
                   separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8")
    print(f"{len(index_levels)} levels, {len(index_facilities)} buildings, floors {floors[0]}..{floors[-1]}",
          file=sys.stderr)

    write_libraries(units, pois, levels, {f["id"]: f for f in index_facilities})


def write_libraries(units, pois, levels, facilities):
    data_file = APP / "data" / "occupancy.json"
    data = json.loads(data_file.read_text(encoding="utf-8"))
    curated = {l["id"]: l for l in data["libraries"]}

    rooms = [u for u in units if u["properties"]["USE_TYPE"] == "Bibliothek"]
    room_by_name = {clean(u["properties"]["NAME"]): u for u in rooms}
    # Named library POIs (CreateType 1) are hand-placed labels; the others mark single rooms.
    labels = [p for p in pois if p["properties"]["USE_TYPE"] == "Bibliothek" and p["properties"]["CreateType"] == 1]
    room_pois = {p["properties"]["UNIT_ID"]: p for p in pois if p["properties"]["CreateType"] == 0}

    groups = []  # (curated id or None, [unit])
    assigned = set()
    for lib_id, names in LIBRARY_ROOMS.items():
        members = [room_by_name[n] for n in names if n in room_by_name]
        missing = [n for n in names if n not in room_by_name]
        if missing:
            print(f"  warning: {lib_id}: rooms not found: {missing}", file=sys.stderr)
        assigned.update(id(u) for u in members)
        if members:
            groups.append((lib_id, members))
    groups += [(None, g) for g in spatial_groups([u for u in rooms if id(u) not in assigned])]

    def footprint(u):
        return sum(abs(ring_area_centroid(poly[0])[0]) for poly in polygons(u["geometry"]))

    libraries, kept, used_labels = [], set(), set()
    for lib_id, members in groups:
        members.sort(key=lambda u: -footprint(u))
        main = members[0]["properties"]
        level = levels[main["LEVEL_ID"]]["properties"]
        facility_id = level["FACILITY_ID"]
        unit_ids = {u["properties"]["UNIT_ID"] for u in members}
        level_ids = {u["properties"]["LEVEL_ID"] for u in members}
        free_labels = [l for l in labels if id(l) not in used_labels]
        label = next((l for l in free_labels if l["properties"]["UNIT_ID"].removesuffix("_DOUBLE") in unit_ids), None)
        if label is None:  # e.g. "Graphische Sammlung" is labelled in a neighbouring room on the floor below
            label = next((l for l in free_labels if l["properties"]["LEVEL_ID"].rsplit(".", 1)[0] == facility_id
                          and near(l, members)), None)
        if label:
            used_labels.add(id(label))
            lng, lat = label["geometry"]["coordinates"][:2]
        elif main["UNIT_ID"] in room_pois:
            lng, lat = room_pois[main["UNIT_ID"]]["geometry"]["coordinates"][:2]
        else:
            lng, lat = ring_area_centroid(polygons(members[0]["geometry"])[0][0])[1]
        room_names = [clean(u["properties"]["NAME"]) for u in members]
        lib_id = lib_id or "lib-" + re.sub(r"[^a-z0-9]+", "-", room_names[0].lower()).strip("-")
        # Re-runs keep whatever was edited in admin mode; only the location comes from PolyMaps.
        base = curated.get(lib_id) or {
            "id": lib_id,
            "name": clean(label["properties"]["NAME"]) if label else f"Bibliothek {room_names[0]}",
            "address": None,
            "campus": "Hönggerberg" if lat > HONGGERBERG_LAT else "Zentrum",
            "operator": "Weitere",
            "openingHours": None,
            "description": None,
            "sourceUrl": None,
            "outline": None,
        }
        if base.get("address") is None and facility_id in facilities:
            fac = facilities[facility_id]
            base["address"] = ", ".join(x for x in [fac["address"], ", ".join(room_names)] if x)
        libraries.append({
            **base,
            "position": {"lat": r6(lat), "lng": r6(lng)},
            "positionApproximate": False,
            "facilityId": facility_id,
            "levelId": main["LEVEL_ID"],
            "floor": level["VERTICAL_ORDER"],
            "rooms": sorted(unit_ids),
            "levels": sorted(level_ids),
        })
        kept.add(lib_id)

    # Curated libraries PolyMaps doesn't know about (other buildings) stay as they were.
    for lib in data["libraries"]:
        if lib["id"] not in kept and not lib.get("rooms"):
            libraries.append({**lib, "facilityId": lib.get("facilityId"), "levelId": lib.get("levelId"),
                              "floor": lib.get("floor"), "rooms": lib.get("rooms", []), "levels": lib.get("levels", [])})

    ids = {l["id"] for l in libraries}
    tables = [t for t in data["tables"] if t["libraryId"] in ids]
    table_ids = {t["id"] for t in tables}
    data.update({
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "libraries": libraries,
        "tables": tables,
        "seats": [s for s in data["seats"] if s["tableId"] in table_ids],
    })
    data_file.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    from_polymaps = sum(1 for l in libraries if l["rooms"])
    print(f"{len(libraries)} libraries ({from_polymaps} located from PolyMaps rooms)", file=sys.stderr)


def near(poi, members, tol=2e-4):
    x, y = poi["geometry"]["coordinates"][:2]
    for u in members:
        b = bbox([pt for poly in polygons(u["geometry"]) for pt in poly[0]])
        if b[0] - tol <= x <= b[2] + tol and b[1] - tol <= y <= b[3] + tol:
            return True
    return False


def spatial_groups(rooms, pad=2e-5):
    """Union rooms of one building whose bounding boxes touch on the same or an adjacent floor."""
    boxes = [bbox([pt for poly in polygons(u["geometry"]) for pt in poly[0]]) for u in rooms]
    parent = list(range(len(rooms)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, a in enumerate(rooms):
        for j in range(i):
            pa, pb = a["properties"], rooms[j]["properties"]
            if pa["LEVEL_ID"].rsplit(".", 1)[0] != pb["LEVEL_ID"].rsplit(".", 1)[0]:
                continue
            if abs(pa["VERTICAL_ORDER"] - pb["VERTICAL_ORDER"]) > 1:
                continue
            ba, bb = boxes[i], boxes[j]
            if ba[0] - pad <= bb[2] and bb[0] - pad <= ba[2] and ba[1] - pad <= bb[3] and bb[1] - pad <= ba[3]:
                parent[find(i)] = find(j)
    groups = defaultdict(list)
    for i, u in enumerate(rooms):
        groups[find(i)].append(u)
    return list(groups.values())


if __name__ == "__main__":
    main()
