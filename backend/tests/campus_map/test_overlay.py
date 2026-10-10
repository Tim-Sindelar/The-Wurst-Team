from app.features.campus_map.overlay import (
    diff_overrides,
    empty_data,
    empty_overrides,
    merge_overrides,
)


def library(lid: str, rooms: list[str], **fields: object) -> dict:
    return {"id": lid, "name": lid, "rooms": rooms, "levels": [], **fields}


def generated(*libraries: dict) -> dict:
    return {**empty_data(), "updatedAt": "2026-10-01T00:00:00Z", "libraries": list(libraries)}


def test_merge_fills_admin_fields_and_applies_changes() -> None:
    gen = generated(library("a", ["ETH.HG.E.E_1"]), library("b", ["ETH.HG.E.E_2"]))
    ov = empty_overrides()
    ov["libraries"]["changed"]["a"] = {"name": "Renamed", "enabled": True}
    ov["libraries"]["deleted"] = ["b"]
    merged = merge_overrides(gen, ov)
    assert [lib["id"] for lib in merged["libraries"]] == ["a"]
    a = merged["libraries"][0]
    assert (a["name"], a["enabled"], a["cardAccess24h"], a["availabilityNote"]) == (
        "Renamed",
        True,
        False,
        None,
    )
    assert merged["updatedAt"] == "2026-10-01T00:00:00Z"


def test_rooms_assigned_by_an_admin_leave_generated_workspaces() -> None:
    gen = generated(
        library("a", ["ETH.HG.E.E_1", "ETH.HG.F.F_1"]),
        library("b", ["ETH.HG.G.G_1"]),
    )
    ov = empty_overrides()
    ov["libraries"]["added"] = [library("new", ["ETH.HG.E.E_1", "ETH.HG.G.G_1"])]
    merged = merge_overrides(gen, ov)
    by_id = {lib["id"]: lib for lib in merged["libraries"]}
    # "a" keeps its other room, "b" only existed because of its room and is dropped.
    assert by_id["a"]["rooms"] == ["ETH.HG.F.F_1"]
    assert by_id["a"]["levels"] == ["ETH.HG.F"]
    assert set(by_id) == {"a", "new"}


def test_diff_round_trip() -> None:
    gen = generated(library("a", ["r1"]), library("b", ["r2"]))
    data = merge_overrides(gen, empty_overrides())
    data["libraries"][0]["name"] = "Changed"
    data["libraries"] = [data["libraries"][0], library("c", ["r3"], enabled=True)]
    ov = diff_overrides(gen, data)
    assert ov["libraries"]["changed"] == {"a": {"name": "Changed"}}
    assert [x["id"] for x in ov["libraries"]["added"]] == ["c"]
    assert ov["libraries"]["deleted"] == ["b"]
    assert merge_overrides(gen, ov)["libraries"] == data["libraries"]


def test_diff_keeps_edits_the_client_could_not_see() -> None:
    gen = generated(library("a", ["r1"]))
    previous = empty_overrides()
    # A change to a workspace the latest pipeline run didn't produce.
    previous["libraries"]["changed"]["gone"] = {"name": "Kept"}
    data = merge_overrides(gen, previous)
    ov = diff_overrides(gen, data, previous)
    assert ov["libraries"]["changed"] == {"gone": {"name": "Kept"}}
