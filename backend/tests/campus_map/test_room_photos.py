from app.features.campus_map import eth_rooms
from app.features.campus_map.room_photos import RoomPhotos, first_photo


def test_first_photo_takes_the_first_image_of_any_tab():
    sheet = {
        "tabs": [
            {"attachments": {"documents": [{"id": 1}]}},
            {"attachments": {"images": [{"id": 7}, {"id": 8}]}},
        ]
    }
    assert first_photo(sheet) == "/api/v1/map/eth/file?id=7"
    assert first_photo({"tabs": [{"attachments": None}]}) is None


def test_lookup_asks_eth_once_per_room(monkeypatch):
    asked = []

    def eth_json(path, ttl, **params):
        asked.append(path)
        if path == "/v2/rooms/HG D 3.1":
            return {"tabs": [{"attachments": {"images": [{"id": 5}]}}]}
        raise ValueError("ETH returned text/html")

    monkeypatch.setattr(eth_rooms, "eth_json", eth_json)
    photos = RoomPhotos()
    try:
        rooms = ["ETH.HG.D.D_003.1", "ETH.HG.E.E_051"]
        expected = {"ETH.HG.D.D_003.1": "/api/v1/map/eth/file?id=5", "ETH.HG.E.E_051": None}
        assert photos.lookup(rooms) == expected
        assert photos.lookup(rooms) == expected
        assert sorted(asked) == ["/v2/rooms/HG D 3.1", "/v2/rooms/HG E 51"]
    finally:
        photos.shutdown()
