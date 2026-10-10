import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import get_session
from app.features.campus_map import eth_rooms
from app.features.campus_map.dataset_cache import DatasetCache
from app.features.campus_map.floor_plans import FloorPlans
from app.features.campus_map.importer import MAP_DATA_DIR, import_files
from app.features.campus_map.models import MapOverride
from app.features.campus_map.overlay import merge_overrides
from app.features.campus_map.services import MapServices, get_services
from app.main import app

ADMIN = {"X-Demo-Admin": "true"}

FETCHER = """
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_common"))
import datasetlib as lib

def build(at=None):
    item = {"id": "a", "name": "A", "lat": 47.3, "lng": 8.5, "approximate": False,
            "category": "x", "campus": None, "subtitle": None, "url": None,
            "details": {"at": at.isoformat() if at else None}}
    return [item], ["https://example.org"], []
"""


@pytest.fixture
def datasets_dir(tmp_path: Path) -> Path:
    folder = tmp_path / "datasets"
    (folder / "_common").mkdir(parents=True)
    (folder / "_common" / "datasetlib.py").write_text(
        (MAP_DATA_DIR.parent / "datasets" / "_common" / "datasetlib.py").read_text("utf-8"),
        encoding="utf-8",
    )
    (folder / "demo").mkdir()
    (folder / "demo" / "fetch.py").write_text(FETCHER, encoding="utf-8")
    meta = {
        "title": "Demo",
        "description": "",
        "glyph": "D",
        "color": "#000000",
        "ttlSeconds": 60,
        "defaultOn": True,
        "time": {"support": "full", "note": ""},
    }
    (folder / "demo" / "dataset.json").write_text(json.dumps(meta), encoding="utf-8")
    return folder


@pytest.fixture
def client(db: Engine, tmp_path: Path, datasets_dir: Path) -> Iterator[TestClient]:
    def test_session() -> Iterator[Session]:
        with Session(db) as session:
            yield session

    services = MapServices(
        datasets=DatasetCache(tmp_path / "cache", datasets_dir),
        floor_plans=FloorPlans(tmp_path / "floors"),
    )
    app.dependency_overrides[get_session] = test_session
    app.dependency_overrides[get_services] = lambda: services
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, auth_mode="demo")
    try:
        with TestClient(app) as client:
            yield client
    finally:
        services.datasets.shutdown()
        app.dependency_overrides.clear()


@pytest.fixture
def imported(db: Engine) -> None:
    with Session(db) as session:
        import_files(session, MAP_DATA_DIR)
        session.commit()


def test_workspaces_are_the_merged_files(client: TestClient, imported: None) -> None:
    response = client.get("/api/v1/map/workspaces")
    assert response.status_code == 200
    files = {
        name: json.loads((MAP_DATA_DIR / f"{name}.json").read_text("utf-8"))
        for name in ("generated", "overrides")
    }
    assert response.json() == merge_overrides(files["generated"], files["overrides"])


def test_saving_workspaces_needs_an_admin_and_valid_data(
    client: TestClient, imported: None, db: Engine
) -> None:
    data = client.get("/api/v1/map/workspaces").json()
    assert client.put("/api/v1/map/workspaces", json=data).status_code == 403

    broken = {**data, "libraries": [{**data["libraries"][0], "kind": "castle"}]}
    assert client.put("/api/v1/map/workspaces", json=broken, headers=ADMIN).status_code == 422

    with Session(db) as session:
        before = {(r.collection, r.action, r.id) for r in session.scalars(select(MapOverride))}
    data["libraries"][0]["name"] = "Renamed in a test"
    assert client.put("/api/v1/map/workspaces", json=data, headers=ADMIN).status_code == 204
    first = data["libraries"][0]
    assert client.get("/api/v1/map/workspaces").json()["libraries"][0]["name"] == first["name"]
    with Session(db) as session:
        after = {(r.collection, r.action, r.id) for r in session.scalars(select(MapOverride))}
    assert after - before <= {("libraries", "changed", first["id"])}


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("style", {"light": {"parts": {}}, "dark": {"parts": {}}}),
        ("navigation", {"zones": []}),
    ],
)
def test_documents_404_until_saved(client: TestClient, path: str, body: dict) -> None:
    url = f"/api/v1/map/{path}"
    assert client.get(url).status_code == 404
    assert client.put(url, json=body).status_code == 403
    assert client.put(url, json={"nope": 1}, headers=ADMIN).status_code == 422
    assert client.put(url, json=body, headers=ADMIN).status_code == 204
    assert client.get(url).json() == body


def test_navigation_checks_zoom_and_outline(client: TestClient) -> None:
    zone = {
        "id": "z",
        "name": "Zone",
        "kind": "area",
        "outline": {"type": "MultiPolygon", "coordinates": [[[[0, 0], [1, 0], [1, 1]]]]},
        "zoom": 30,
        "activeBelowZoom": 15,
        "activeFromZoom": None,
    }
    response = client.put("/api/v1/map/navigation", json={"zones": [zone]}, headers=ADMIN)
    assert response.status_code == 422


def test_datasets(client: TestClient, tmp_path: Path) -> None:
    metas = client.get("/api/v1/map/datasets").json()
    assert [m["id"] for m in metas] == ["demo"]

    now = client.get("/api/v1/map/datasets/demo").json()
    assert now["at"] is None
    assert now["document"]["items"][0]["details"] == {"at": None}
    assert (tmp_path / "cache" / "demo.json").exists()

    later = client.get("/api/v1/map/datasets/demo", params={"at": "2026-10-20T14:00"}).json()
    assert later["at"] == "2026-10-20T14:00"
    assert later["document"]["items"][0]["details"]["at"].startswith("2026-10-20T14:00")
    assert (tmp_path / "cache" / "at" / "demo" / "2026-10-20T1400.json").exists()

    assert client.get("/api/v1/map/datasets/demo", params={"at": "tomorrow"}).status_code == 422
    assert client.get("/api/v1/map/datasets/nope").status_code == 404


def test_eth_rooms_adds_floor_plan_matches(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    snapshot = {
        "schemaVersion": 1,
        "fetchedAt": "2026-10-10T10:00:00+02:00",
        "date": "2026-10-10",
        "ttlSeconds": 3600,
        "buildings": {"HG": "Hauptgebäude"},
        "rooms": [{"id": "HG E 7"}],
        "errors": 0,
    }
    status = {
        "state": "ok",
        "done": 1,
        "total": 1,
        "error": None,
        "stale": False,
        "ageSeconds": 5,
        "nextFetchInSeconds": 3595,
        "snapshot": snapshot,
        "window": {"min": "2026-01-01", "max": "2027-01-01"},
    }
    monkeypatch.setattr(eth_rooms, "snapshot_status", lambda date=None: status)
    body = client.get("/api/v1/map/eth/rooms").json()
    assert body["unmatched"] == ["HG E 7"]
    assert body["floorPlans"] is False
    assert client.get("/api/v1/map/eth/rooms", params={"date": "10.10."}).status_code == 422
