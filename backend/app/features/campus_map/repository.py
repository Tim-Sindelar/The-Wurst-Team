"""Reading and writing the map's Postgres tables as the JSON documents the API speaks."""

from typing import Any

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.features.campus_map.models import MapDocument, MapEntity, MapOverride
from app.features.campus_map.overlay import (
    COLLECTIONS,
    EPOCH,
    diff_overrides,
    empty_overrides,
    merge_overrides,
)

GENERATED = "generated"
OVERRIDES = "overrides"
MAP_STYLE = "map-style"
NAVIGATION = "navigation"


class MapRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    # ---- documents ---------------------------------------------------------

    def document(self, name: str) -> dict[str, Any] | None:
        row = self.session.get(MapDocument, name)
        return row.data if row else None

    def put_document(self, name: str, data: dict[str, Any]) -> None:
        stmt = insert(MapDocument).values(name=name, data=data)
        self.session.execute(
            stmt.on_conflict_do_update(
                index_elements=[MapDocument.name],
                set_={"data": stmt.excluded.data, "updated_at": stmt.excluded.updated_at},
            )
        )

    def _header(self, name: str) -> dict[str, Any]:
        return self.document(name) or {"schemaVersion": 1, "updatedAt": EPOCH}

    # ---- layers ------------------------------------------------------------

    def generated(self) -> dict[str, Any]:
        out: dict[str, Any] = {**self._header(GENERATED), **{k: [] for k in COLLECTIONS}}
        for row in self.session.scalars(select(MapEntity).order_by(MapEntity.position)):
            out[row.collection].append(row.data)
        return out

    def overrides(self) -> dict[str, Any]:
        out = {**empty_overrides(), **self._header(OVERRIDES)}
        rows = self.session.scalars(select(MapOverride).order_by(MapOverride.position))
        for row in rows:
            coll = out[row.collection]
            if row.action == "added":
                coll["added"].append(row.data)
            elif row.action == "changed":
                coll["changed"][row.id] = row.data
            else:
                coll["deleted"].append(row.id)
        return out

    def replace_generated(self, data: dict[str, Any]) -> None:
        self.session.execute(delete(MapEntity))
        self.session.add_all(
            MapEntity(collection=key, id=item["id"], position=i, data=item)
            for key in COLLECTIONS
            for i, item in enumerate(data[key])
        )
        self.put_document(
            GENERATED, {"schemaVersion": data["schemaVersion"], "updatedAt": data["updatedAt"]}
        )

    def replace_overrides(self, overrides: dict[str, Any]) -> None:
        self.session.execute(delete(MapOverride))
        rows: list[MapOverride] = []
        for key in COLLECTIONS:
            coll = overrides[key]
            rows += [
                MapOverride(collection=key, action="added", id=x["id"], position=i, data=x)
                for i, x in enumerate(coll["added"])
            ]
            rows += [
                MapOverride(collection=key, action="changed", id=eid, position=i, data=patch)
                for i, (eid, patch) in enumerate(coll["changed"].items())
            ]
            rows += [
                MapOverride(collection=key, action="deleted", id=eid, position=i, data=None)
                for i, eid in enumerate(coll["deleted"])
            ]
        self.session.add_all(rows)
        self.put_document(
            OVERRIDES,
            {"schemaVersion": overrides["schemaVersion"], "updatedAt": overrides["updatedAt"]},
        )

    # ---- the merged workspaces ---------------------------------------------

    def is_empty(self) -> bool:
        return self.session.scalar(select(MapEntity.id).limit(1)) is None

    def workspaces(self) -> dict[str, Any]:
        return merge_overrides(self.generated(), self.overrides())

    def save_workspaces(self, data: dict[str, Any]) -> None:
        """Stores what turns the generated layer into `data` as the admin layer."""
        # Serializes concurrent saves, like the old file API's write queue.
        self.session.execute(text("SELECT pg_advisory_xact_lock(hashtext('map_overrides'))"))
        self.replace_overrides(diff_overrides(self.generated(), data, self.overrides()))
