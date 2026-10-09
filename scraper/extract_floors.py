"""Turn the scraped PolyMaps layers into the floor plan files and workspace list of occupancy-map-preview.

Usage: python extract_floors.py [polymaps_dir] [app_dir]

Writes
  <app_dir>/public/floors/index.json        floors, building footprints and level outlines
  <app_dir>/public/floors/levels/<id>.json  rooms and wall/door/stair lines of one level
  <app_dir>/data/generated.json             workspaces built from the rooms of WORKSPACE_USES

The pipeline only ever writes generated.json, from scratch on every run. Edits made in admin
mode live in data/overrides.json and are applied on top of it by the app's API, so re-running
this script never loses them. Workspace ids are derived from PolyMaps room names, so they stay
stable across runs and the overrides keep pointing at the right workspaces.

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

# Fixed ids for the main libraries (their names, opening hours etc. are admin overrides).
# Every other "Bibliothek" room is grouped spatially into an additional library.
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

# Room use types that become workspaces: use type -> (workspace kind, German label for new names).
# Libraries are grouped spatially (a reading room often spans several units); every other
# room is its own workspace. The service returns umlauts as U+FFFD, so keys are compared via norm().
WORKSPACE_USES = {
    "Bibliothek": ("library", "Bibliothek"),
    "Arbeitsplatz": ("study", "Arbeitsplatz"),
    "Rückzugsraum": ("study", "Rückzugsraum"),
    "Zeichensaal": ("study", "Zeichensaal"),
    "Meetingbox": ("group", "Meetingbox"),
    "Übungsraum": ("group", "Übungsraum"),
    "Computerraum": ("computer", "Computerraum"),
    "Aufenthaltsraum": ("lounge", "Aufenthaltsraum"),
}


def norm(s):
    """Use type without U+FFFD placeholders, so 'R�ckzugsraum' and 'Rückzugsraum' compare equal."""
    return re.sub(r"[^a-z]", "", (s or "").replace("�", "").lower().replace("ü", "").replace("ö", "").replace("ä", ""))


WORKSPACE_BY_USE = {norm(use): v for use, v in WORKSPACE_USES.items()}


def workspace_of(unit):
    p = unit["properties"]
    return WORKSPACE_BY_USE.get(norm(p["USE_TYPE"] or p["RaumTyp"]))


# Floor letters as used in ETH room names ("HG E 41" = HG, floor E, room 41) go up one storey per
# letter, skipping I (ETL uses I instead of J). A trailing O marks an intermediate floor ("EO" lies
# between E and F) that counts as its base floor. Y and Z sit below A in some buildings (IFW, MM)
# but above X in others (OAT).
FLOOR_LETTERS = {c: i for i, c in enumerate("ABCDEFGHJKLMNOPQRSTUVWX")} | {"I": 8}
FLOOR_LETTERS_YZ = {"Y": (-2, 23), "Z": (-1, 24)}

# Ground floor letter of each building. By default it is the letter of PolyMaps' vertical order 0;
# these override it where the main entrances (the "Windfang" vestibules) are on another floor.
GROUND_FLOORS = {
    "ETH.CHN": "E",  # D only has a vehicle access, the entrance halls are on E
    "ETH.LEE": "E",  # both entrance halls are on E, PolyMaps puts F at 0
}


def letter_indexes(token):
    """Storey indexes of a floor letter like "E" or "EO" (intermediate floors count as their base)."""
    base = token[:-1] if len(token) > 1 and token.endswith("O") else token
    if base in FLOOR_LETTERS:
        return [FLOOR_LETTERS[base]]
    return list(FLOOR_LETTERS_YZ.get(base, ()))


def plausible(floor, vertical_order):
    """PolyMaps' VERTICAL_ORDER counts intermediate floors as floors of their own, so it lies at or
    somewhat further from the ground than the real floor; allow one floor of slack the other way."""
    excess = vertical_order - floor if vertical_order >= 0 else floor - vertical_order
    return -1 <= excess <= abs(vertical_order) // 2 + 1


def name_floor(token, ground, vertical_order):
    """Floor named by a floor letter relative to the ground letter, if plausible for the vertical order."""
    return next((i - ground for i in letter_indexes(token or "") if plausible(i - ground, vertical_order)), None)


def floor_token(name, facility_id):
    """Floor letter of a room name like "HG EO 41.2" (the word after the building), or None."""
    words = (name or "").split()
    return words[1] if len(words) > 2 and words[0] == facility_id.removeprefix("ETH.") else None


def ground_index(levels):
    facility = levels[0]["FACILITY_ID"]
    letter = GROUND_FLOORS.get(facility) or next(
        (l["NAME_SHORT"] for l in sorted(levels, key=lambda l: abs(l["VERTICAL_ORDER"])) if l["VERTICAL_ORDER"] >= 0), "E")
    return letter_indexes(letter)[0]


def building_floors(levels, units):
    """Floor of each level of one building, from the floor letters in its room names.

    Each room's letter is checked against its level's vertical order (falling back to the latter when
    it does not fit), then a level takes the floor most of its rooms agree on. Safeguards:
    - rooms PolyMaps puts on one level must agree on its floor, outliers are reported;
    - floors must rise with the vertical order, two levels share a floor only if one is the
      intermediate floor of the other; a level breaking this keeps its vertical order, and if the
      building is still inconsistent, all of its levels do."""
    ground = ground_index(levels)
    facility = levels[0]["FACILITY_ID"]
    floors, problems = {}, []
    for l in levels:
        vo = l["VERTICAL_ORDER"]
        votes = defaultdict(int)
        for u in units.get(l["LEVEL_ID"], []):
            token = floor_token(clean(u["properties"]["NAME"]), facility)
            if token is not None:
                found = name_floor(token, ground, vo)
                votes[vo if found is None else found] += 1
        if not votes:
            found = name_floor(l["NAME_SHORT"], ground, vo)
            votes[vo if found is None else found] += 1
        floors[l["LEVEL_ID"]] = max(votes, key=votes.get)
        if len(votes) > 1:
            problems.append(f"{l['LEVEL_ID']}: rooms disagree on the floor {dict(votes)}, using {floors[l['LEVEL_ID']]}")

    def base(l):
        token = l["NAME_SHORT"] or ""
        return token[:-1] if len(token) > 1 and token.endswith("O") else token

    def consistent(ordered):
        return all(floors[a["LEVEL_ID"]] < floors[b["LEVEL_ID"]] or
                   floors[a["LEVEL_ID"]] == floors[b["LEVEL_ID"]] and base(a) == base(b)
                   for a, b in zip(ordered, ordered[1:]))

    ordered = sorted(levels, key=lambda l: l["VERTICAL_ORDER"])
    # A single level out of place keeps its vertical order (e.g. ONA H, which PolyMaps puts above J).
    # Of the levels whose removal would fix the order, revert the one furthest from its vertical order.
    culprits = [] if consistent(ordered) else [l for l in ordered if consistent([o for o in ordered if o is not l])]
    if culprits:
        l = max(culprits, key=lambda l: abs(floors[l["LEVEL_ID"]] - l["VERTICAL_ORDER"]))
        problems.append(f"{l['LEVEL_ID']}: floor {floors[l['LEVEL_ID']]} out of order, using {l['VERTICAL_ORDER']}")
        floors[l["LEVEL_ID"]] = l["VERTICAL_ORDER"]
    if not consistent(ordered):
        problems.append(f"{facility}: floors out of order, using vertical orders")
        floors = {l["LEVEL_ID"]: l["VERTICAL_ORDER"] for l in levels}
    return floors, problems


def level_floors(levels, units):
    """LEVEL_ID -> floor for every level, see building_floors."""
    by_facility, by_level = defaultdict(list), defaultdict(list)
    for lp in levels.values():
        by_facility[lp["FACILITY_ID"]].append(lp)
    for u in units:
        by_level[u["properties"]["LEVEL_ID"]].append(u)
    floors = {}
    for ls in by_facility.values():
        found, problems = building_floors(ls, by_level)
        floors |= found
        for problem in problems:
            print(f"  warning: {problem}", file=sys.stderr)
    return floors


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
    floors = level_floors({lid: f["properties"] for lid, f in levels.items()}, units)
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
            "label": clean(lp["NAME_SHORT"]) or lp["NAME"],  # the building's own floor letter, e.g. "H" or "FO"
            "floor": floors[level_id],
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

    all_floors = sorted({l["floor"] for l in index_levels})
    (out / "index.json").write_text(
        json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "floors": all_floors, "levels": index_levels, "facilities": index_facilities},
                   separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8")
    print(f"{len(index_levels)} levels, {len(index_facilities)} buildings, floors {all_floors[0]}..{all_floors[-1]}",
          file=sys.stderr)

    write_libraries(units, pois, levels, floors, {f["id"]: f for f in index_facilities})


def write_libraries(units, pois, levels, floors, facilities):
    data_file = APP / "data" / "generated.json"
    data_file.parent.mkdir(parents=True, exist_ok=True)

    rooms = [u for u in units if workspace_of(u)]
    library_rooms = [u for u in rooms if workspace_of(u)[0] == "library"]
    room_by_name = {clean(u["properties"]["NAME"]): u for u in library_rooms}
    # Named library POIs (CreateType 1) are hand-placed labels; the others mark single rooms.
    labels = [p for p in pois if p["properties"]["USE_TYPE"] == "Bibliothek" and p["properties"]["CreateType"] == 1]
    room_pois = {p["properties"]["UNIT_ID"]: p for p in pois if p["properties"]["CreateType"] == 0}

    groups = []  # (fixed id or None, [unit]); new groups share the kind of their rooms
    assigned = set()
    for lib_id, names in LIBRARY_ROOMS.items():
        members = [room_by_name[n] for n in names if n in room_by_name]
        missing = [n for n in names if n not in room_by_name]
        if missing:
            print(f"  warning: {lib_id}: rooms not found: {missing}", file=sys.stderr)
        members = [u for u in members if u["properties"]["UNIT_ID"] not in assigned]
        assigned.update(u["properties"]["UNIT_ID"] for u in members)
        if members:
            groups.append((lib_id, members))
    free = [u for u in rooms if u["properties"]["UNIT_ID"] not in assigned]
    groups += [(None, g) for g in spatial_groups([u for u in free if workspace_of(u)[0] == "library"], floors)]
    groups += [(None, [u]) for u in free if workspace_of(u)[0] != "library"]

    def footprint(u):
        return sum(abs(ring_area_centroid(poly[0])[0]) for poly in polygons(u["geometry"]))

    libraries, ids, used_labels = [], set(LIBRARY_ROOMS), set()
    for lib_id, members in groups:
        members.sort(key=lambda u: (-footprint(u), u["properties"]["UNIT_ID"]))
        main = members[0]["properties"]
        level = levels[main["LEVEL_ID"]]["properties"]
        facility_id = level["FACILITY_ID"]
        unit_ids = {u["properties"]["UNIT_ID"] for u in members}
        level_ids = {u["properties"]["LEVEL_ID"] for u in members}
        found = workspace_of(members[0])
        kind, use_label = found if found else ("other", "Raum")
        free_labels = [l for l in labels if id(l) not in used_labels] if kind == "library" else []
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
        room_names = [clean(u["properties"]["NAME"]) or u["properties"]["Raumkennzeichen"] for u in members]
        if lib_id is None:
            stem = ("lib-" if kind == "library" else "ws-") + re.sub(r"[^a-z0-9]+", "-", room_names[0].lower()).strip("-")
            lib_id, n = stem, 2
            while lib_id in ids:
                lib_id, n = f"{stem}-{n}", n + 1
        ids.add(lib_id)
        address = None
        if facility_id in facilities:
            address = ", ".join(x for x in [facilities[facility_id]["address"], ", ".join(room_names)] if x)
        libraries.append({
            "id": lib_id,
            "name": clean(label["properties"]["NAME"]) if label else f"{use_label} {room_names[0]}",
            "kind": kind,
            "address": address,
            "campus": "Hönggerberg" if lat > HONGGERBERG_LAT else "Zentrum",
            "operator": "Weitere",
            "openingHours": None,
            "description": None,
            "position": {"lat": r6(lat), "lng": r6(lng)},
            "positionApproximate": False,
            "sourceUrl": None,
            "outline": None,
            "facilityId": facility_id,
            "levelId": main["LEVEL_ID"],
            "floor": floors[main["LEVEL_ID"]],
            "rooms": sorted(unit_ids),
            "levels": sorted(level_ids),
        })

    libraries.sort(key=lambda l: l["id"])
    data = {
        "schemaVersion": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "libraries": libraries,
        "tables": [],
        "seats": [],
    }
    data_file.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(libraries)} workspaces -> {data_file}", file=sys.stderr)


def near(poi, members, tol=2e-4):
    x, y = poi["geometry"]["coordinates"][:2]
    for u in members:
        b = bbox([pt for poly in polygons(u["geometry"]) for pt in poly[0]])
        if b[0] - tol <= x <= b[2] + tol and b[1] - tol <= y <= b[3] + tol:
            return True
    return False


def spatial_groups(rooms, floors, pad=2e-5):
    """Union rooms of one building whose bounding boxes touch on the same or an adjacent floor."""
    boxes = [bbox([pt for poly in polygons(u["geometry"]) for pt in poly[0]]) for u in rooms]
    room_floors = [floors[u["properties"]["LEVEL_ID"]] for u in rooms]
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
            if abs(room_floors[i] - room_floors[j]) > 1:
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
