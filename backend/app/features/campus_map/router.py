from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.auth import get_current_admin
from app.database import get_session
from app.features.campus_map import eth_rooms, floor_plans
from app.features.campus_map.dataset_cache import AT, DatasetUnavailable, UnknownDataset
from app.features.campus_map.repository import MAP_STYLE, NAVIGATION, MapRepository
from app.features.campus_map.schemas import (
    DatasetMeta,
    DatasetResponse,
    EthRoomsResponse,
    FloorPlanRoom,
    MapStyle,
    NavigationConfig,
    OccupancyData,
    UzhOccupancy,
)
from app.features.campus_map.services import MapServices, get_services
from app.schemas import ErrorResponse

router = APIRouter(prefix="/api/v1/map", tags=["campus-map"])

# Live data must not be cached by the browser; the server keeps its own caches.
NO_STORE = {"Cache-Control": "no-store"}


def get_repository(session: Annotated[Session, Depends(get_session)]) -> MapRepository:
    return MapRepository(session)


Repository = Annotated[MapRepository, Depends(get_repository)]
Services = Annotated[MapServices, Depends(get_services)]
Admin = Annotated[UUID, Depends(get_current_admin)]
ADMIN_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorResponse},
    403: {"model": ErrorResponse},
}


def json_document(name: str, data: dict | None) -> JSONResponse:
    if data is None:
        raise HTTPException(status_code=404, detail=f"No {name} saved yet")
    return JSONResponse(data, headers=NO_STORE)


# ---- workspaces, map style, navigation ----------------------------------------


@router.get("/workspaces", response_model=OccupancyData, operation_id="get_map_workspaces")
def get_workspaces(repository: Repository) -> JSONResponse:
    """All workspaces, tables and seats: the generated data with the admin edits applied."""
    return JSONResponse(repository.workspaces(), headers=NO_STORE)


@router.put(
    "/workspaces",
    status_code=204,
    operation_id="save_map_workspaces",
    responses=ADMIN_RESPONSES,
)
def save_workspaces(data: OccupancyData, repository: Repository, _admin: Admin) -> None:
    """Stores the edits that turn the generated data into `data`."""
    repository.save_workspaces(data.model_dump(mode="json", by_alias=True, exclude_unset=True))
    repository.session.commit()


@router.get(
    "/style",
    response_model=MapStyle,
    operation_id="get_map_style",
    responses={404: {"model": ErrorResponse}},
)
def get_style(repository: Repository) -> JSONResponse:
    """The standard map colours per theme."""
    return json_document("map style", repository.document(MAP_STYLE))


@router.put("/style", status_code=204, operation_id="save_map_style", responses=ADMIN_RESPONSES)
def save_style(style: MapStyle, repository: Repository, _admin: Admin) -> None:
    repository.put_document(MAP_STYLE, style.model_dump(mode="json", by_alias=True))
    repository.session.commit()


@router.get(
    "/navigation",
    response_model=NavigationConfig,
    operation_id="get_map_navigation",
    responses={404: {"model": ErrorResponse}},
)
def get_navigation(repository: Repository) -> JSONResponse:
    """The click-to-zoom areas and buildings."""
    return json_document("navigation", repository.document(NAVIGATION))


@router.put(
    "/navigation",
    status_code=204,
    operation_id="save_map_navigation",
    responses=ADMIN_RESPONSES,
)
def save_navigation(config: NavigationConfig, repository: Repository, _admin: Admin) -> None:
    repository.put_document(NAVIGATION, config.model_dump(mode="json", by_alias=True))
    repository.session.commit()


# ---- campus datasets ----------------------------------------------------------


@router.get("/datasets", response_model=list[DatasetMeta], operation_id="list_map_datasets")
def list_datasets(services: Services) -> JSONResponse:
    """The campus datasets (mensas, transport, sport, ...) without their data."""
    return JSONResponse(services.datasets.list_metas(), headers=NO_STORE)


@router.get(
    "/datasets/{dataset_id}",
    response_model=DatasetResponse,
    operation_id="get_map_dataset",
    responses={404: {"model": ErrorResponse}, 502: {"model": ErrorResponse}},
)
def get_dataset(
    dataset_id: str,
    services: Services,
    at: Annotated[
        str | None,
        Query(pattern=AT.pattern, description="Zurich time, YYYY-MM-DDTHH:MM (default: now)"),
    ] = None,
    refresh: Annotated[bool, Query(description="Fetch now instead of using the cache")] = False,
) -> JSONResponse:
    """A dataset's items, from the cache; fetched again when older than its ttl."""
    try:
        body = services.datasets.get(dataset_id, refresh, at)
    except UnknownDataset as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DatasetUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(body, headers=NO_STORE)


# ---- floor plan rooms -----------------------------------------------------------


@router.get(
    "/rooms",
    response_model=list[FloorPlanRoom],
    operation_id="search_map_rooms",
    responses={503: {"model": ErrorResponse}},
)
def search_rooms(
    services: Services,
    q: Annotated[str, Query(min_length=1, max_length=80, description='e.g. "HG E 1"')],
    limit: Annotated[int, Query(ge=1, le=50)] = 12,
) -> list[dict[str, Any]]:
    """Rooms of every building and floor whose name or use contains `q`."""
    plans = services.floor_plans.index()
    if plans is None:
        raise HTTPException(status_code=503, detail="The floor plans are not available")
    return floor_plans.search_rooms(plans, q, limit)


# ---- ETH rooms ----------------------------------------------------------------

ETH_RESPONSES: dict[int | str, dict[str, Any]] = {502: {"model": ErrorResponse}}


def upstream_error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}")


@router.get(
    "/eth/rooms",
    response_model=EthRoomsResponse,
    operation_id="get_eth_rooms",
    responses=ETH_RESPONSES,
)
def get_eth_rooms(
    services: Services,
    date: Annotated[
        str | None, Query(pattern=eth_rooms.DATE_RE.pattern, description="YYYY-MM-DD")
    ] = None,
) -> JSONResponse:
    """Every ETH room with its bookings of `date` (default today) and where it is on the
    floor plans. Fetching from ETH runs in the background; `state` says how far it is."""
    try:
        status = eth_rooms.snapshot_status(date)
    except Exception as exc:
        raise upstream_error(exc) from exc
    plans = services.floor_plans.index()
    snapshot = status.get("snapshot")
    if snapshot:
        match = services.floor_plans.match(snapshot, plans)
    else:
        match = {"matches": {}, "unmatched": []}
    return JSONResponse({**status, **match, "floorPlans": plans is not None}, headers=NO_STORE)


@router.get(
    "/eth/room",
    response_model=dict[str, Any],
    operation_id="get_eth_room",
    responses=ETH_RESPONSES,
)
def get_eth_room(
    _services: Services,
    id: Annotated[str, Query(pattern=eth_rooms.ROOM_RE.pattern, description='e.g. "HG E 7"')],
) -> dict[str, Any]:
    """The full room sheet from ETH (overview, equipment, photos), as ETH sends it."""
    try:
        return eth_rooms.eth_json(f"/v2/rooms/{id}", eth_rooms.DETAIL_TTL, lang="en")
    except Exception as exc:
        raise upstream_error(exc) from exc


@router.get("/eth/file", include_in_schema=False)
def get_eth_file(_services: Services, id: Annotated[str, Query(pattern=r"^\d+$")]) -> Response:
    """A room photo or attachment (PDF), for <img src>."""
    try:
        body, content_type = eth_rooms.eth_file(id)
    except Exception as exc:
        raise upstream_error(exc) from exc
    return Response(body, media_type=content_type, headers={"Cache-Control": "max-age=86400"})


@router.get(
    "/eth/uzh",
    response_model=UzhOccupancy,
    operation_id="get_uzh_occupancy",
    responses=ETH_RESPONSES,
)
def get_uzh_occupancy(_services: Services) -> JSONResponse:
    """Live seat occupancy of the UZH libraries (sensor based)."""
    try:
        return JSONResponse(eth_rooms.uzh_occupancy(), headers=NO_STORE)
    except Exception as exc:
        raise upstream_error(exc) from exc
