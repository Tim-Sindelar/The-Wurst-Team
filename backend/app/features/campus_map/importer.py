"""Loads the campus map's JSON files into Postgres, or writes them back.

    python -m app.features.campus_map.importer                  # all four files
    python -m app.features.campus_map.importer --generated-only # pipeline re-run, keeps admin edits
    python -m app.features.campus_map.importer --if-empty       # only into an empty database
    python -m app.features.campus_map.importer --export         # database -> files

The files live in map-data/: generated.json (scraper pipeline output),
overrides.json (workspace edits), map-style.json and navigation.json.
"""

import argparse
import json
from pathlib import Path

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.features.campus_map.repository import (
    MAP_STYLE,
    NAVIGATION,
    MapRepository,
)
from app.features.campus_map.schemas import (
    AdminOverrides,
    MapStyle,
    NavigationConfig,
    OccupancyData,
)

MAP_DATA_DIR = Path(__file__).parent / "map-data"
FILES = {
    "generated": "generated.json",
    "overrides": "overrides.json",
    MAP_STYLE: "map-style.json",
    NAVIGATION: "navigation.json",
}


def _read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def _write(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def import_files(session: Session, folder: Path, generated_only: bool = False) -> list[str]:
    """Validates and stores the files found in `folder`; returns what was imported."""
    repo = MapRepository(session)
    done = []
    generated = _read(folder / FILES["generated"])
    if generated is not None:
        OccupancyData.model_validate(generated)
        repo.replace_generated(generated)
        done.append(FILES["generated"])
    if generated_only:
        return done
    overrides = _read(folder / FILES["overrides"])
    if overrides is not None:
        AdminOverrides.model_validate(overrides)
        repo.replace_overrides(overrides)
        done.append(FILES["overrides"])
    for name, model in ((MAP_STYLE, MapStyle), (NAVIGATION, NavigationConfig)):
        doc = _read(folder / FILES[name])
        if doc is not None:
            model.model_validate(doc)
            repo.put_document(name, doc)
            done.append(FILES[name])
    return done


def export_files(session: Session, folder: Path) -> list[str]:
    repo = MapRepository(session)
    folder.mkdir(parents=True, exist_ok=True)
    docs = {
        "generated": repo.generated(),
        "overrides": repo.overrides(),
        MAP_STYLE: repo.document(MAP_STYLE),
        NAVIGATION: repo.document(NAVIGATION),
    }
    done = []
    for name, data in docs.items():
        if data is not None:
            _write(folder / FILES[name], data)
            done.append(FILES[name])
    return done


def main() -> None:
    parser = argparse.ArgumentParser(description="Import the campus map's JSON files")
    parser.add_argument("dir", nargs="?", type=Path, default=MAP_DATA_DIR)
    parser.add_argument("--generated-only", action="store_true", help="keep the admin edits")
    parser.add_argument("--if-empty", action="store_true", help="skip when the map has data")
    parser.add_argument("--export", action="store_true", help="write the database to the files")
    args = parser.parse_args()
    with SessionLocal() as session:
        if args.export:
            print(f"Exported {', '.join(export_files(session, args.dir))} to {args.dir}")
            return
        if args.if_empty and not MapRepository(session).is_empty():
            print("Campus map data already imported")
            return
        done = import_files(session, args.dir, args.generated_only)
        session.commit()
        print(f"Imported {', '.join(done) or 'nothing'} from {args.dir}")


if __name__ == "__main__":
    main()
