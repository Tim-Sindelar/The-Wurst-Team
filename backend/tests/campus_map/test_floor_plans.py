import json
from pathlib import Path

from app.features.campus_map.floor_plans import (
    FloorPlans,
    center_of,
    match_rooms,
    room_key,
    room_label,
    search_rooms,
    unit_id_name,
)


def test_room_key_ignores_spacing_case_and_zero_padding() -> None:
    assert room_key("HG  e 007.10") == "HG E 7.10"
    assert room_key(" CAB G 61 ") == "CAB G 61"


def test_unit_id_name() -> None:
    assert unit_id_name("ETH.HG.H.H_030.1") == "HG H 030.1"
    assert unit_id_name("ETH.HG") is None
    assert unit_id_name("ETH.HG.H.030") is None


def test_center_of_square() -> None:
    square = [[[0, 0, 10, 0, 10, 10, 0, 10]]]
    assert center_of([8.5, 47.3], 1e6, square) == {"lat": 47.300005, "lng": 8.500005}


def write_plans(folder: Path) -> None:
    (folder / "levels").mkdir(parents=True)
    (folder / "index.json").write_text(
        json.dumps({"levels": [{"id": "ETH.HG.E", "floor": 0}]}), encoding="utf-8"
    )
    level = {
        "id": "ETH.HG.E",
        "origin": [8.5, 47.3],
        "scale": 1e6,
        "rooms": [
            {
                "id": "ETH.HG.E.E_007",
                "name": "HG E 7",
                "label": None,
                "rings": [[[0, 0, 2, 0, 2, 2]]],
            },
            {
                "id": "ETH.HG.E.E_041",
                "name": None,
                "label": None,
                "use": "Hörsaal",
                "area": 120.5,
                "rings": [[[0, 0, 2, 0, 2, 2]]],
            },
            {
                "id": "ETH.HG.E.E_041.1",
                "name": None,
                "label": None,
                "rings": [[[0, 0, 2, 0, 2, 2]]],
            },
        ],
    }
    (folder / "levels" / "ETH.HG.E.json").write_text(json.dumps(level), encoding="utf-8")


def test_matches_by_name_then_unit_id(tmp_path: Path) -> None:
    write_plans(tmp_path)
    plans = FloorPlans(tmp_path)
    index = plans.index()
    assert index is not None
    assert index.by_id["ETH.HG.E.E_007"]["lat"] == 47.3000007
    assert index.by_id["ETH.HG.E.E_041.1"]["unitId"] == "ETH.HG.E.E_041.1"
    assert "ETH.HG.E.E_041" in index.by_id
    snapshot = {"rooms": [{"id": "HG E 7"}, {"id": "HG E 41"}, {"id": "HG Z 1"}]}
    result = match_rooms(snapshot, index)
    assert [p["unitId"] for p in result["matches"]["HG E 7"]] == ["ETH.HG.E.E_007"]
    assert [p["unitId"] for p in result["matches"]["HG E 41"]] == ["ETH.HG.E.E_041"]
    assert result["unmatched"] == ["HG Z 1"]


def test_missing_floor_plans(tmp_path: Path) -> None:
    plans = FloorPlans(tmp_path / "nothing")
    assert plans.index() is None
    assert match_rooms({"rooms": [{"id": "HG E 7"}]}, None)["unmatched"] == ["HG E 7"]


def test_room_label() -> None:
    assert room_label("ETH.HG.H.H_030.1") == "HG H 30.1"
    assert room_label("ETH.CAB.G.G_061") == "CAB G 61"


def test_search_rooms_ranks_exact_then_prefix(tmp_path: Path) -> None:
    write_plans(tmp_path)
    index = FloorPlans(tmp_path).index()
    assert index is not None
    names = lambda q: [r["name"] for r in search_rooms(index, q, 10)]  # noqa: E731
    assert names("hg e 41") == ["HG E 41", "HG E 41.1"]
    assert names("  HG   E 7") == ["HG E 7"]
    assert names("hörsaal") == ["HG E 41"]
    assert names("e") == ["HG E 7", "HG E 41", "HG E 41.1"]
    assert len(search_rooms(index, "hg", 2)) == 2
    assert search_rooms(index, "hg e 41", 1)[0] == {
        "id": "ETH.HG.E.E_041",
        "name": "HG E 41",
        "levelId": "ETH.HG.E",
        "use": "Hörsaal",
        "area": 120.5,
    }
