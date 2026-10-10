from copy import deepcopy
from uuid import uuid4

import pytest

from tests.reservations.test_admin import ADMIN, room_path, seat_path
from tests.reservations.test_reservations import action, book, identity, walk_up


def layout(seat_id=None):
    chair = {
        "id": "chair",
        "type": "seat",
        "x": 320,
        "y": 256,
        "width": 32,
        "height": 36,
        "angle": 0,
        "number": 1,
        "tableId": "table",
        "slot": "top:0",
        "badges": ["outlet"],
    }
    if seat_id:
        chair["backendSeatId"] = str(seat_id)
    return {
        "schemaVersion": 1,
        "unitsPerMeter": 64,
        "room": {
            "id": "ETH.HG.E.E_001",
            "label": "HG E 1",
            "width": 1024,
            "height": 1024,
            "widthMeters": 16,
            "heightMeters": 16,
            "points": [[0, 0], [1024, 0], [1024, 1024], [0, 1024]],
        },
        "objects": [
            {
                "id": "table",
                "type": "table",
                "shape": "rect",
                "x": 320,
                "y": 300,
                "width": 128,
                "height": 32,
                "angle": 0,
                "label": "A",
            },
            chair,
        ],
    }


def test_layout_save_is_atomic_and_preserves_seat_token(client, seats):
    path = room_path(seats)
    proposed = layout(seats[0].id)
    proposed["objects"][1]["qr_token"] = "never publish"
    saved = client.put(path + "/layout", headers=ADMIN, json={"layout": proposed})
    assert saved.status_code == 200, saved.text
    objects = saved.json()["space"]["layout"]["objects"]
    assert objects[1]["backendSeatId"] == str(seats[0].id)
    assert "qr_token" not in objects[1]
    assert (
        client.get(seat_path(seats), headers=ADMIN).json()["seat"]["qr_token"] == seats[0].qr_token
    )
    repeated = client.put(
        path + "/layout", headers=ADMIN, json={"layout": saved.json()["space"]["layout"]}
    )
    assert repeated.status_code == 200
    assert len(repeated.json()["space"]["seats"]) == 3
    assert repeated.json()["space"]["seats"][0]["id"] == str(seats[0].id)
    invalid = deepcopy(proposed)
    invalid["objects"][1]["backendSeatId"] = str(uuid4())
    assert client.put(path + "/layout", headers=ADMIN, json={"layout": invalid}).status_code == 400
    assert (
        client.get(path + "/overview", headers=ADMIN).json()["space"]["layout"]
        == repeated.json()["space"]["layout"]
    )


def test_removing_booked_seat_requires_review_and_rolls_back(client, seats):
    reservation = book(client, seats[0], identity()).json()["reservation"]
    proposed = layout()
    proposed["objects"] = proposed["objects"][:1]
    response = client.put(room_path(seats) + "/layout", headers=ADMIN, json={"layout": proposed})
    assert response.status_code == 409
    assert response.json()["reservation_impacts"][0]["reservation_id"] == reservation["id"]
    assert client.get(seat_path(seats), headers=ADMIN).json()["seat"]["is_active"]
    assert client.get(room_path(seats) + "/overview", headers=ADMIN).json()["space"]["layout"] == {}
    forced = client.put(
        room_path(seats) + "/layout",
        headers=ADMIN,
        params={"force": True},
        json={"layout": proposed},
    )
    assert forced.status_code == 200
    assert not any(s["is_active"] for s in forced.json()["space"]["seats"])


def test_archive_is_recoverable_and_blocks_booking(client, seats):
    path = room_path(seats)
    assert client.delete(path).status_code == 403
    assert client.delete(path, headers=ADMIN).status_code == 200
    assert client.get(path + "/overview", headers=ADMIN).json()["space"]["is_archived"]
    assert not any(
        s["id"] == str(seats[0].space_id) for s in client.get("/api/v1/spaces").json()["spaces"]
    )
    assert book(client, seats[0]).status_code == 409
    assert client.get(f"/api/v1/spaces/{seats[0].space_id}").status_code == 404
    assert client.post(path + "/restore", headers=ADMIN).status_code == 200
    assert book(client, seats[0]).status_code == 201
    assert client.delete(path, headers=ADMIN).status_code == 409


def test_admin_user_history_and_study_time_excludes_breaks(client, seats, clock):
    user = identity()
    response = book(client, seats[0], user).json()["reservation"]
    assert walk_up(client, seats[0], user).status_code == 200
    clock.advance(minutes=20)
    assert action(client, response["id"], "break", user).status_code == 200
    clock.advance(minutes=5)
    assert action(client, response["id"], "return", user).status_code == 200
    clock.advance(minutes=10)
    users = client.get("/api/v1/admin/users", headers=ADMIN).json()["users"]
    summary = next(u for u in users if u["id"] == user["X-Demo-User-Id"])
    assert summary["study_seconds"] == 1800
    path = "/api/v1/admin/users/" + summary["id"]
    assert client.get(path).status_code == 403
    updated = client.patch(path, headers=ADMIN, json={"name": "  Student One  "})
    assert updated.status_code == 200
    assert updated.json()["user"]["name"] == "Student One"
    assert updated.json()["reservations"][0]["id"] == response["id"]
    assert client.get("/api/v1/me", headers=user).json()["name"] == "Student One"
    assert client.patch(path, headers=ADMIN, json={"name": " "}).status_code == 422


@pytest.mark.parametrize(
    "change", ["boundary", "hole", "dimensions", "numbering", "binding", "parent"]
)
def test_layout_rejects_invalid_geometry_without_writes(client, seats, change):
    proposed = layout(seats[0].id)
    if change == "boundary":
        proposed["room"]["points"] = [[0, 0], [1, 1], [2, 2]]
    elif change == "hole":
        proposed["room"]["holes"] = [[[600, 600], [700, 600]]]
    elif change == "dimensions":
        proposed["objects"][0]["width"] = -1
    elif change == "numbering":
        proposed["objects"][1]["number"] = 3
    elif change == "binding":
        proposed["objects"][1]["backendSeatId"] = {"id": "bad"}
    else:
        proposed["objects"][1]["tableId"] = []
    response = client.put(room_path(seats) + "/layout", headers=ADMIN, json={"layout": proposed})
    assert response.status_code == 400
    assert client.get(room_path(seats) + "/overview", headers=ADMIN).json()["space"]["layout"] == {}


def test_layout_keeps_room_holes_without_checking_furniture(client, seats):
    proposed = layout(seats[0].id)
    # The pillar sits under the table: avoiding it is up to the admin.
    pillar = [[300, 290], [340, 290], [340, 310], [300, 310]]
    proposed["room"]["holes"] = [pillar]
    response = client.put(room_path(seats) + "/layout", headers=ADMIN, json={"layout": proposed})
    assert response.status_code == 200, response.text
    assert response.json()["space"]["layout"]["room"]["holes"] == [pillar]


def test_room_binding_is_unique_and_archive_restore_preserves_link(client, seats):
    proposed = layout(seats[0].id)
    proposed["room"]["mapRef"] = {"unitId": "ETH.HG.E.E_007"}
    saved = client.put(room_path(seats) + "/layout", headers=ADMIN, json={"layout": proposed})
    assert saved.status_code == 200
    assert saved.json()["space"]["map_unit_id"] == "ETH.HG.E.E_007"
    assert saved.headers["Cache-Control"] == "no-store"
    body = {"name": "Same room", "map_room_id": "ETH.HG.E.E_007", "layout": proposed}
    assert client.post("/api/v1/admin/spaces", headers=ADMIN, json=body).status_code == 409
    assert client.delete(room_path(seats), headers=ADMIN).status_code == 200
    assert client.post("/api/v1/admin/spaces", headers=ADMIN, json=body).status_code == 409
    assert client.post(room_path(seats) + "/restore", headers=ADMIN).status_code == 200


def test_layout_uses_geometry_engine_measurements(client, seats):
    proposed = layout(seats[0].id)
    boundary = proposed["room"]
    boundary["measurements"] = {
        "widthMeters": boundary.pop("widthMeters"),
        "heightMeters": boundary.pop("heightMeters"),
        "unitsPerMeter": 64,
        "areaSquareMeters": 256,
        "approximate": True,
    }
    response = client.put(room_path(seats) + "/layout", headers=ADMIN, json={"layout": proposed})
    assert response.status_code == 200, response.text
    assert response.json()["space"]["layout"]["room"]["measurements"] == boundary["measurements"]


def test_layout_cannot_reassign_the_linked_map_room(client, seats):
    proposed = layout(seats[0].id)
    proposed["room"]["mapRef"] = {"unitId": "ETH.HG.E.E_051"}
    response = client.put(room_path(seats) + "/layout", headers=ADMIN, json={"layout": proposed})
    assert response.status_code == 400
    assert response.json()["code"] == "room_mismatch"
    assert client.get(room_path(seats) + "/overview", headers=ADMIN).json()["space"]["layout"] == {}


def test_seat_label_and_activation_come_from_the_seat_row(client, seats):
    path = room_path(seats)
    proposed = layout(seats[0].id)
    proposed["objects"][1]["active"] = False
    saved = client.put(path + "/layout", headers=ADMIN, json={"layout": proposed})
    assert saved.status_code == 200, saved.text
    chair = saved.json()["space"]["layout"]["objects"][1]
    assert chair["active"] is False
    assert chair["backendLabel"] == "01"
    # Switching the seat back on elsewhere is reflected, not overwritten by stale layout JSON.
    patched = client.patch(seat_path(seats), headers=ADMIN, json={"is_active": True})
    assert patched.status_code == 200, patched.text
    chair = client.get(path + "/overview", headers=ADMIN).json()["space"]["layout"]["objects"][1]
    assert chair["active"] is True
