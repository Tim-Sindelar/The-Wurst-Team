"""Where each ETH room is on the PolyMaps floor plans.

The floor plans are written by scraper/extract_floors.py: an index.json plus
one levels/<id>.json per level, rooms as rings of micro-degree offsets from the
level's origin. ETH room ids ("HG E 7") are matched to PolyMaps rooms by name
first, then by unit id, then by display label.
"""

import json
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOM_NAME = re.compile(r"^[A-Z0-9]+ \S+ \S+$", re.IGNORECASE)

Place = dict[str, Any]


def room_key(name: str) -> str:
    """Comparable form of a room name, so ETH ids and PolyMaps names match despite
    spacing, case and zero padding: "HG  e 007.10" and "HG E 7.10" -> "HG E 7.10"."""
    return " ".join(
        re.sub(r"\d+", lambda m: str(int(m.group())), token) for token in name.upper().split()
    )


def unit_id_name(unit_id: str) -> str | None:
    """ "ETH.HG.H.H_030.1" -> "HG H 030.1" (the name PolyMaps would give it), or None."""
    parts = unit_id.split(".")
    if len(parts) < 4:
        return None
    _, building, _, first, *rest = parts
    sep = first.find("_")
    if sep <= 0:
        return None
    return f"{building} {first[:sep]} {'.'.join([first[sep + 1 :], *rest])}"


def center_of(origin: list[float], scale: float, rings: list[list[list[float]]]) -> dict:
    """Area-weighted centroid of the largest polygon's outer ring (flat x,y lists)."""
    lng0, lat0 = origin
    best = (-1.0, 0.0, 0.0)
    for polygon in rings:
        if not polygon:
            continue
        outer = polygon[0]
        if not outer or len(outer) < 2:
            continue
        n = len(outer) // 2
        a = cx = cy = sx = sy = 0.0
        for i in range(n):
            x0, y0 = outer[2 * i], outer[2 * i + 1]
            j = (i + 1) % n
            x1, y1 = outer[2 * j], outer[2 * j + 1]
            f = x0 * y1 - x1 * y0
            a += f
            cx += (x0 + x1) * f
            cy += (y0 + y1) * f
            sx += x0
            sy += y0
        area = abs(a / 2)
        if area > best[0]:
            best = (area, cx / (3 * a), cy / (3 * a)) if area > 0 else (area, sx / n, sy / n)
    return {"lat": round(lat0 + best[2] / scale, 7), "lng": round(lng0 + best[1] / scale, 7)}


@dataclass
class PlanIndex:
    stamp: float
    by_id: dict[str, Place] = field(default_factory=dict)
    by_name: dict[str, list[Place]] = field(default_factory=dict)
    by_unit: dict[str, list[Place]] = field(default_factory=dict)
    by_label: dict[str, list[Place]] = field(default_factory=dict)


def build_plan_index(floors_dir: Path, stamp: float) -> PlanIndex:
    index = json.loads((floors_dir / "index.json").read_text(encoding="utf-8"))
    out = PlanIndex(stamp)

    def add(table: dict[str, list[Place]], name: str | None, place: Place) -> None:
        if name and ROOM_NAME.match(name.strip()):
            table.setdefault(room_key(name), []).append(place)

    for info in index["levels"]:
        level = json.loads(
            (floors_dir / "levels" / f"{info['id']}.json").read_text(encoding="utf-8")
        )
        for room in level["rooms"]:
            place = {
                "unitId": room["id"],
                "levelId": info["id"],
                "floor": info["floor"],
                **center_of(level["origin"], level["scale"], room["rings"]),
            }
            out.by_id[room["id"]] = place
            add(out.by_name, room.get("name"), place)
            add(out.by_unit, unit_id_name(room["id"]), place)
            add(out.by_label, room.get("label"), place)
    return out


def match_rooms(snapshot: dict, plans: PlanIndex | None) -> dict:
    """Places of every ETH room, looked up by name first, then by unit id, then by label."""
    matches: dict[str, list[Place]] = {}
    unmatched: list[str] = []
    for room in snapshot["rooms"]:
        key = room_key(room["id"])
        places = plans and (
            plans.by_name.get(key) or plans.by_unit.get(key) or plans.by_label.get(key)
        )
        if places:
            matches[room["id"]] = places
        else:
            unmatched.append(room["id"])
    return {"matches": matches, "unmatched": unmatched}


class FloorPlans:
    """The plan index of a floors folder, rebuilt when index.json changes
    (re-running extract_floors.py), and the matches of the latest snapshot."""

    def __init__(self, floors_dir: Path) -> None:
        self.floors_dir = floors_dir
        self._lock = threading.Lock()
        self._index: PlanIndex | None = None
        self._matched: tuple[str, dict] | None = None

    def index(self) -> PlanIndex | None:
        try:
            stamp = (self.floors_dir / "index.json").stat().st_mtime
        except OSError:
            return None
        with self._lock:
            if self._index is None or self._index.stamp != stamp:
                try:
                    self._index = build_plan_index(self.floors_dir, stamp)
                except (OSError, ValueError, KeyError):
                    return None
            return self._index

    def match(self, snapshot: dict, plans: PlanIndex | None) -> dict:
        key = f"{snapshot['date']}|{snapshot['fetchedAt']}|{plans.stamp if plans else 'none'}"
        with self._lock:
            if self._matched is None or self._matched[0] != key:
                self._matched = (key, match_rooms(snapshot, plans))
            return self._matched[1]
