"""Two-layer workspace storage: generated data plus admin overrides.

The scraper pipeline owns the generated layer (rebuilt from PolyMaps on every
run); admin edits are a diff against it. Clients only ever see the merged
result; saving diffs that result against the current generated data, so
pipeline re-runs never clobber admin edits and admin edits never write into
pipeline output. Port of frontend/src/campus-map/domain/overlay.ts, on the
camelCase JSON dicts the API sends.
"""

from typing import Any

Entity = dict[str, Any]
Data = dict[str, Any]
COLLECTIONS = ("libraries", "tables", "seats")
EPOCH = "1970-01-01T00:00:00.000Z"


def empty_collection() -> dict:
    return {"added": [], "changed": {}, "deleted": []}


def empty_overrides() -> Data:
    return {"schemaVersion": 1, "updatedAt": EPOCH, **{k: empty_collection() for k in COLLECTIONS}}


def empty_data() -> Data:
    return {"schemaVersion": 1, "updatedAt": EPOCH, **{k: [] for k in COLLECTIONS}}


# ---- merge -----------------------------------------------------------------


def _apply(base: list[Entity], ov: dict) -> list[Entity]:
    deleted = set(ov["deleted"])
    added = {x["id"]: x for x in ov["added"]}
    out = [
        {**x, **ov["changed"][x["id"]]} if x["id"] in ov["changed"] else x
        for x in base
        if x["id"] not in deleted and x["id"] not in added
    ]
    return [*out, *added.values()]


def _levels_of(rooms: list[str]) -> list[str]:
    return sorted({".".join(r.split(".")[:3]) for r in rooms})


def _with_enabled(data: Data) -> Data:
    """Pipeline output has no admin-only fields: workspaces are off until enabled,
    with no note and no card access."""
    return {
        **data,
        "libraries": [
            {
                **lib,
                "enabled": lib.get("enabled") is True,
                "availabilityNote": lib.get("availabilityNote"),
                "cardAccess24h": lib.get("cardAccess24h") is True,
            }
            for lib in data["libraries"]
        ],
    }


def merge_overrides(raw_generated: Data, overrides: Data) -> Data:
    """Generated data with the admin overrides applied on top.

    A room belongs to one workspace only: rooms an admin assigned (added
    workspaces, or a changed `rooms` list) are taken away from untouched
    generated workspaces. An untouched generated workspace left without rooms
    that way is dropped, it only existed because of those rooms.
    """
    generated = _with_enabled(raw_generated)
    ov = overrides["libraries"]
    owned = {lib["id"] for lib in ov["added"]} | {
        lid for lid, patch in ov["changed"].items() if patch.get("rooms") is not None
    }
    libraries = _apply(generated["libraries"], ov)
    claimed = {r for lib in libraries if lib["id"] in owned for r in lib["rooms"]}
    resolved = []
    for lib in libraries:
        if lib["id"] in owned or not any(r in claimed for r in lib["rooms"]):
            resolved.append(lib)
            continue
        rooms = [r for r in lib["rooms"] if r not in claimed]
        if not rooms and lib["id"] not in ov["changed"]:
            continue
        resolved.append({**lib, "rooms": rooms, "levels": _levels_of(rooms)})

    library_ids = {lib["id"] for lib in resolved}
    tables = [
        t for t in _apply(generated["tables"], overrides["tables"]) if t["libraryId"] in library_ids
    ]
    table_ids = {t["id"] for t in tables}
    seats = [s for s in _apply(generated["seats"], overrides["seats"]) if s["tableId"] in table_ids]
    return {
        "schemaVersion": 1,
        "updatedAt": max(generated["updatedAt"], overrides["updatedAt"]),
        "libraries": resolved,
        "tables": tables,
        "seats": seats,
    }


# ---- diff ------------------------------------------------------------------

_MISSING = object()


def _diff(base: list[Entity], nxt: list[Entity]) -> dict:
    base_by_id = {x["id"]: x for x in base}
    ov = empty_collection()
    for item in nxt:
        orig = base_by_id.get(item["id"])
        if orig is None:
            ov["added"].append(item)
            continue
        patch = {k: v for k, v in item.items() if k != "id" and v != orig.get(k, _MISSING)}
        if patch:
            ov["changed"][item["id"]] = patch
    return ov


def diff_overrides(raw_generated: Data, data: Data, previous: Data | None = None) -> Data:
    """Overrides that turn `generated` into `data` (the full dataset a client saved).
    Entries of `previous` the client couldn't see, e.g. changes to a workspace the
    latest pipeline run didn't produce, are kept so they apply again if it comes back."""
    previous = previous or empty_overrides()
    generated = _with_enabled(raw_generated)
    nxt: Data = {
        "schemaVersion": 1,
        "updatedAt": data["updatedAt"],
        **{k: _diff(generated[k], data[k]) for k in COLLECTIONS},
    }

    # Deletions: generated entities that would show up with the other overrides
    # applied but are missing from `data`. Workspaces dropped because all their
    # rooms moved elsewhere aren't recorded as deleted.
    undeleted = merge_overrides(generated, nxt)
    visible_before = merge_overrides(generated, previous)
    for key in COLLECTIONS:
        kept = {x["id"] for x in data[key]}
        coll = nxt[key]
        coll["deleted"] = [x["id"] for x in undeleted[key] if x["id"] not in kept]

        # Carry over what the client never saw.
        prev = previous[key]
        seen = {x["id"] for x in visible_before[key]}
        generated_ids = {x["id"] for x in generated[key]}
        for eid in prev["deleted"]:
            if eid not in generated_ids and eid not in coll["deleted"]:
                coll["deleted"].append(eid)
        for eid, patch in prev["changed"].items():
            if eid not in seen and eid not in coll["changed"]:
                coll["changed"][eid] = patch
        for item in prev["added"]:
            if item["id"] not in seen and item["id"] not in kept:
                coll["added"].append(item)
    return nxt
