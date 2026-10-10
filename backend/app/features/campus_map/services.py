"""Process-wide state of the campus map: the dataset cache, the floor plan index and
the ETH room module, configured from the settings once."""

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

from fastapi import Depends

from app.config import Settings, get_settings
from app.features.campus_map import eth_rooms
from app.features.campus_map.dataset_cache import DatasetCache
from app.features.campus_map.floor_plans import FloorPlans
from app.features.campus_map.room_photos import RoomPhotos


@dataclass
class MapServices:
    datasets: DatasetCache
    floor_plans: FloorPlans
    room_photos: RoomPhotos


_lock = threading.Lock()
_services: dict[tuple[Path, Path], MapServices] = {}


def get_services(settings: Annotated[Settings, Depends(get_settings)]) -> MapServices:
    key = (settings.map_cache_dir, settings.map_floors_dir)
    with _lock:
        services = _services.get(key)
        if services is None:
            cache = settings.map_cache_dir
            eth_rooms.configure(
                cache_dir=str(cache / "eth"), snapshot_file=str(cache / "eth-rooms.json")
            )
            services = MapServices(
                datasets=DatasetCache(cache / "datasets"),
                floor_plans=FloorPlans(settings.map_floors_dir),
                room_photos=RoomPhotos(),
            )
            _services[key] = services
        return services


def shutdown_services() -> None:
    with _lock:
        for services in _services.values():
            services.datasets.shutdown()
            services.room_photos.shutdown()
        _services.clear()


def get_room_photos(services: Annotated[MapServices, Depends(get_services)]) -> RoomPhotos:
    return services.room_photos
