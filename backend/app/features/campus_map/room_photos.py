"""The first photo of each study space's ETH room, for the space cards.

Room sheets come from the ETH Room Info API one room at a time, so they are looked up in
the background and remembered: a room with a photo or without one for a day, a failed
lookup for a few minutes. A list asks for every room it shows and waits a moment for
the ones not known yet; those still missing get their photo on a later list.
"""

import threading
import time
from collections.abc import Iterable
from concurrent.futures import Future, ThreadPoolExecutor, wait

from app.features.campus_map import eth_rooms
from app.features.campus_map.floor_plans import room_label

# How long a list waits for rooms it has never looked up.
WAIT_SECONDS = 1.5
RETRY_SECONDS = 300


def photo_url(file_id: int | str) -> str:
    return f"/api/v1/map/eth/file?id={file_id}"


def first_photo(sheet: dict) -> str | None:
    for tab in sheet.get("tabs") or []:
        for image in (tab.get("attachments") or {}).get("images") or []:
            if image.get("id") is not None:
                return photo_url(image["id"])
    return None


class RoomPhotos:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        # map room id -> (looked up until, photo url or None)
        self._known: dict[str, tuple[float, str | None]] = {}
        self._pending: dict[str, Future[None]] = {}
        self._executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="room-photos")

    def lookup(self, map_room_ids: Iterable[str]) -> dict[str, str | None]:
        """The photo of each map room ("ETH.HG.D.D_003.1"), or None while unknown or absent."""
        ids = set(map_room_ids)
        now = time.time()
        started = []
        with self._lock:
            for room in ids - self._pending.keys():
                known = self._known.get(room)
                if known is None:
                    started.append(self._start(room))
                elif known[0] < now:
                    self._start(room)
        if started:
            wait(started, timeout=WAIT_SECONDS)
        with self._lock:
            return {room: self._known[room][1] if room in self._known else None for room in ids}

    def _start(self, room: str) -> Future[None]:
        future = self._executor.submit(self._fetch, room)
        self._pending[room] = future
        return future

    def _fetch(self, room: str) -> None:
        try:
            sheet = eth_rooms.eth_json(
                f"/v2/rooms/{room_label(room)}", eth_rooms.DETAIL_TTL, lang="en"
            )
            result = (time.time() + eth_rooms.DETAIL_TTL, first_photo(sheet))
        except ValueError:
            # ETH has no sheet for this room (it answers with an HTML page).
            result = (time.time() + eth_rooms.DETAIL_TTL, None)
        except Exception:
            # ETH is unreachable: keep any photo we had and try again soon.
            with self._lock:
                old = self._known.get(room, (0.0, None))[1]
            result = (time.time() + RETRY_SECONDS, old)
        with self._lock:
            self._known[room] = result
            self._pending.pop(room, None)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
