"""API shapes of the campus map, in the camelCase JSON the map's frontend uses.

The validation rules are the ones of frontend/src/campus-map/domain/validate.ts
and navigation.ts. Models allow extra fields, so data written by newer tools
passes through unchanged.
"""

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

MAX_OUTLINE_VERTICES = 5_000
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow")


class LatLng(CamelModel):
    lat: float
    lng: float


def check_multipolygon(coordinates: list[list[list[list[float]]]]) -> list:
    vertices = 0
    for polygon in coordinates:
        if not polygon:
            raise ValueError("has an empty polygon")
        for ring in polygon:
            if len(ring) < 4:
                raise ValueError("has a ring with fewer than 4 positions")
            if any(len(pos) < 2 for pos in ring):
                raise ValueError("has an invalid position")
            if ring[0][:2] != ring[-1][:2]:
                raise ValueError("has a ring that is not closed")
            vertices += len(ring)
    if vertices > MAX_OUTLINE_VERTICES:
        raise ValueError(f"exceeds {MAX_OUTLINE_VERTICES} vertices")
    return coordinates


class MultiPolygon(CamelModel):
    """GeoJSON MultiPolygon, coordinates as [lng, lat]."""

    type: Literal["MultiPolygon"]
    coordinates: list[list[list[list[float]]]]

    _check = field_validator("coordinates")(check_multipolygon)


# ---- workspaces ------------------------------------------------------------

WorkspaceKind = Literal["library", "study", "group", "computer", "lounge", "other"]
Campus = Literal["Zentrum", "Hönggerberg"]
SeatStatus = Literal["free", "occupied", "unknown"]


class TimeRange(CamelModel):
    """Times as "HH:MM" (24h), from < to, within one day."""

    from_: str = Field(alias="from")
    to: str

    @model_validator(mode="after")
    def check_range(self) -> "TimeRange":
        if not (HHMM.match(self.from_) and HHMM.match(self.to) and self.from_ < self.to):
            raise ValueError("opening hours must be HH:MM ranges with from < to")
        return self


class OpeningHours(CamelModel):
    """Opening ranges per weekday; an empty list means closed that day."""

    mon: list[TimeRange]
    tue: list[TimeRange]
    wed: list[TimeRange]
    thu: list[TimeRange]
    fri: list[TimeRange]
    sat: list[TimeRange]
    sun: list[TimeRange]


class Library(CamelModel):
    """A place with seats: a library, study area, group room, etc. ("workspace")."""

    id: str
    name: str
    kind: WorkspaceKind
    address: str | None
    campus: Campus
    operator: str
    # Admin-only fields: absent in pipeline output.
    availability_note: str | None = None
    card_access_24h: bool = Field(default=False, alias="cardAccess24h")
    opening_hours: OpeningHours | None
    description: str | None
    position: LatLng
    position_approximate: bool
    source_url: str | None
    outline: MultiPolygon | None
    facility_id: str | None
    level_id: str | None
    floor: int | None
    enabled: bool = False
    rooms: list[str]
    levels: list[str]


class Table(CamelModel):
    id: str
    library_id: str
    label: str
    position: LatLng


class Seat(CamelModel):
    id: str
    table_id: str
    label: str
    position: LatLng
    status: SeatStatus


class OccupancyData(CamelModel):
    """All workspaces, their tables and seats: the generated data with the admin
    overrides applied."""

    schema_version: Literal[1]
    updated_at: str
    libraries: list[Library]
    tables: list[Table]
    seats: list[Seat]

    @model_validator(mode="after")
    def check_references(self) -> "OccupancyData":
        errors: list[str] = []

        def unique(kind: str, ids: list[str]) -> set[str]:
            seen: set[str] = set()
            for i, eid in enumerate(ids):
                if eid in seen:
                    errors.append(f"{kind}[{i}]: duplicate id {eid}")
                seen.add(eid)
            return seen

        library_ids = unique("libraries", [lib.id for lib in self.libraries])
        table_ids = unique("tables", [t.id for t in self.tables])
        unique("seats", [s.id for s in self.seats])
        for i, t in enumerate(self.tables):
            if t.library_id not in library_ids:
                errors.append(f"tables[{i}]: unknown libraryId")
        for i, s in enumerate(self.seats):
            if s.table_id not in table_ids:
                errors.append(f"seats[{i}]: unknown tableId")
        # A room belongs to at most one workspace.
        owner: dict[str, str] = {}
        for lib in self.libraries:
            for room in lib.rooms:
                if owner.get(room, lib.id) != lib.id:
                    errors.append(f"room {room} is in both {owner[room]} and {lib.id}")
                owner[room] = lib.id
        if errors:
            raise ValueError("; ".join(errors))
        return self


class CollectionOverrides(CamelModel):
    added: list[dict[str, Any]]
    changed: dict[str, dict[str, Any]]
    deleted: list[str]


class AdminOverrides(CamelModel):
    """Admin edits as a diff against the generated data (map-data/overrides.json)."""

    schema_version: Literal[1]
    updated_at: str
    libraries: CollectionOverrides
    tables: CollectionOverrides
    seats: CollectionOverrides


# ---- map style and navigation ----------------------------------------------


class ThemeStyle(CamelModel):
    parts: dict[str, Any]


class MapStyle(CamelModel):
    """The per-theme minimal map styles (map-data/map-style.json)."""

    light: ThemeStyle
    dark: ThemeStyle


Zoom = Annotated[float, Field(ge=0, le=24)]


class NavZone(CamelModel):
    """Clicking inside a zone flies the map to it, while the zoom is in its active range."""

    id: str
    name: str
    kind: Literal["area", "building"]
    outline: MultiPolygon | None
    zoom: Zoom
    active_below_zoom: Zoom
    active_from_zoom: Zoom | None


class NavigationConfig(CamelModel):
    zones: list[NavZone]

    @field_validator("zones")
    @classmethod
    def unique_ids(cls, zones: list[NavZone]) -> list[NavZone]:
        ids = [z.id for z in zones]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(f"duplicate zone ids: {', '.join(dupes)}")
        return zones


# ---- campus datasets -------------------------------------------------------


class DatasetTime(CamelModel):
    support: Literal["full", "partial", "live"]
    resolution: Literal["day", "hour", "minute"] | None = None
    note: str


class DatasetMeta(CamelModel):
    """datasets/<id>/dataset.json"""

    id: str
    title: str
    description: str
    glyph: str
    color: str
    ttl_seconds: int
    default_on: bool
    time: DatasetTime | None = None


class DatasetItem(CamelModel):
    id: str
    name: str
    lat: float
    lng: float
    approximate: bool
    category: str
    campus: str | None
    subtitle: str | None
    url: str | None
    details: dict[str, Any]


class DatasetDocument(CamelModel):
    """What datasets/<id>/fetch.py produces."""

    dataset: str
    fetched_at: str
    at: str | None = None
    sources: list[str]
    errors: list[str]
    items: list[DatasetItem]


class DatasetResponse(CamelModel):
    meta: DatasetMeta
    document: DatasetDocument
    at: str | None
    age_seconds: int
    refreshing: bool
    last_error: str | None


# ---- ETH rooms -------------------------------------------------------------


class Booking(CamelModel):
    """One booking of the day, in minutes after midnight (Zurich time)."""

    s: int
    e: int
    kind: Literal[
        "lecture",
        "exercise",
        "lecture_exercise",
        "course_other",
        "event",
        "reserved",
        "cancelled",
        "closed",
    ]
    title: str | None
    number: str | None
    organiser: str | None


class EthRoom(CamelModel):
    id: str
    building: str
    floor: str
    room: str
    type: str
    seats: int | None
    workplaces: int | None
    campus: str | None
    equipment: list[str]
    bookings: list[Booking]
    error: str | None


class EthSnapshot(CamelModel):
    schema_version: Literal[1]
    fetched_at: str
    date: str
    ttl_seconds: int
    buildings: dict[str, str | None]
    rooms: list[EthRoom]
    errors: int


class RoomPlace(CamelModel):
    """Where an ETH room is on the floor plans."""

    unit_id: str
    level_id: str
    floor: int
    lat: float
    lng: float


class FloorPlanRoom(CamelModel):
    """A room of the floor plans, found by the room search."""

    id: str
    name: str
    level_id: str
    use: str
    area: float


class BookingWindow(CamelModel):
    min: str | None
    max: str | None


class EthRoomsResponse(CamelModel):
    """running: fetching from ETH; error: the last fetch failed and there is no
    current snapshot."""

    state: Literal["ok", "running", "error"]
    done: int
    total: int
    error: str | None
    stale: bool
    age_seconds: int | None
    next_fetch_in_seconds: int | None
    snapshot: EthSnapshot | None
    matches: dict[str, list[RoomPlace]]
    unmatched: list[str]
    floor_plans: bool
    window: BookingWindow | None


class UzhLocation(CamelModel):
    id: str
    name: str
    label: str
    fraction: float | None


class UzhOccupancy(CamelModel):
    fetched_at: str
    source: str
    locations: list[UzhLocation]
