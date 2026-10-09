"""Derive a map outline for every library from its PolyMaps rooms.

Reads occupancy-map-preview/data/generated.json and the level files written by
extract_floors.py, and writes occupancy-map-preview/public/floors/library-outlines.json:

    { "<libraryId>": { "type": "MultiPolygon", "coordinates": [...] } }

Outlines drawn by hand in the admin UI (library.outline) take precedence over these.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'occupancy-map-preview'
FLOORS = ROOT / 'public' / 'floors'


def decode(flat, origin, scale):
    lng0, lat0 = origin
    ring = [[round(lng0 + flat[i] / scale, 7), round(lat0 + flat[i + 1] / scale, 7)] for i in range(0, len(flat), 2)]
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def main():
    data = json.loads((ROOT / 'data' / 'generated.json').read_text(encoding='utf-8'))
    levels = {}

    def level(level_id):
        if level_id not in levels:
            path = FLOORS / 'levels' / f'{level_id}.json'
            levels[level_id] = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
        return levels[level_id]

    out = {}
    for lib in data['libraries']:
        wanted = set(lib.get('rooms') or [])
        if not wanted:
            continue
        polygons = []
        for level_id in lib.get('levels') or []:
            plan = level(level_id)
            if not plan:
                continue
            for room in plan['rooms']:
                if room['id'] not in wanted:
                    continue
                for poly in room['rings']:
                    rings = [decode(r, plan['origin'], plan['scale']) for r in poly]
                    rings = [r for r in rings if len(r) >= 4]
                    if rings:
                        polygons.append(rings)
        if polygons:
            out[lib['id']] = {'type': 'MultiPolygon', 'coordinates': polygons}

    target = FLOORS / 'library-outlines.json'
    target.write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
    print(f'{len(out)}/{len(data["libraries"])} libraries -> {target} ({target.stat().st_size // 1024} KiB)')


if __name__ == '__main__':
    main()
