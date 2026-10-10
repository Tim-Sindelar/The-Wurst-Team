"""Campus datasets (datasets/<id>/): fetched in-process and cached on disk.

Each dataset folder has a dataset.json and a fetch.py with build(at). The
fetcher runs again when the cached document (<cache>/<id>.json) is older than
the dataset's ttlSeconds; meanwhile the cached copy is answered. A Zurich time
(`at`, YYYY-MM-DDTHH:MM) asks for the data at that time, cached apart in
<cache>/at/<id>/; datasets whose dataset.json says time.support "live" always
answer with now.
"""

import datetime as dt
import importlib.util
import json
import logging
import re
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from pathlib import Path
from types import ModuleType
from typing import Any

log = logging.getLogger(__name__)

DATASETS_DIR = Path(__file__).parent / "datasets"
ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
AT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
# Documents for a time over a day ago don't change any more: kept this long.
PAST_TTL_SECONDS = 30 * 86400
# Documents kept per dataset in <cache>/at/<id>/.
AT_KEPT = 40
FETCH_TIMEOUT_SECONDS = 120
# After a failed fetch, wait this long before running the fetcher again.
RETRY_SECONDS = 60


class UnknownDataset(Exception):
    pass


class DatasetUnavailable(Exception):
    pass


def _age_seconds(doc: dict[str, Any] | None) -> float:
    try:
        fetched = dt.datetime.fromisoformat(doc["fetchedAt"])  # type: ignore[index]
    except (TypeError, KeyError, ValueError):
        return float("inf")
    if fetched.tzinfo is None:
        fetched = fetched.replace(tzinfo=dt.UTC)
    return (dt.datetime.now(dt.UTC) - fetched).total_seconds()


class DatasetCache:
    def __init__(self, cache_dir: Path, datasets_dir: Path = DATASETS_DIR) -> None:
        self.dir = datasets_dir
        self.cache_dir = cache_dir
        self._lock = threading.Lock()
        self._running: dict[str, Future[None]] = {}
        self._last_error: dict[str, tuple[float, str]] = {}
        self._modules: dict[str, ModuleType] = {}
        self._executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="datasets")

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    # ---- dataset.json --------------------------------------------------------

    def list_metas(self) -> list[dict[str, Any]]:
        metas = [meta for d in self.dir.iterdir() if (meta := self.read_meta(d.name))]
        return sorted(metas, key=lambda m: m["title"])

    def read_meta(self, dataset_id: str) -> dict[str, Any] | None:
        if not ID.match(dataset_id):
            return None
        try:
            meta = json.loads((self.dir / dataset_id / "dataset.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None  # A folder without dataset.json is not a dataset.
        return {**meta, "id": dataset_id}

    # ---- cache files ---------------------------------------------------------

    def _at_dir(self, dataset_id: str) -> Path:
        return self.cache_dir / "at" / dataset_id

    def cache_file(self, dataset_id: str, at: str | None) -> Path:
        if at:
            return self._at_dir(dataset_id) / f"{at.replace(':', '')}.json"
        return self.cache_dir / f"{dataset_id}.json"

    def read_cache(self, dataset_id: str, at: str | None) -> dict[str, Any] | None:
        try:
            return json.loads(self.cache_file(dataset_id, at).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _prune_at(self, dataset_id: str) -> None:
        """Keeps the newest AT_KEPT documents of a dataset in <cache>/at/<id>/."""
        files = sorted(
            self._at_dir(dataset_id).glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True
        )
        for f in files[AT_KEPT:]:
            f.unlink(missing_ok=True)

    # ---- fetching ------------------------------------------------------------

    def _fetcher(self, dataset_id: str) -> ModuleType:
        with self._lock:
            module = self._modules.get(dataset_id)
            if module is None:
                path = self.dir / dataset_id / "fetch.py"
                name = f"campus_datasets_{dataset_id.replace('-', '_')}"
                spec = importlib.util.spec_from_file_location(name, path)
                if spec is None or spec.loader is None:
                    raise ImportError(f"cannot load {path}")
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                self._modules[dataset_id] = module
            return module

    def _fetch(self, dataset_id: str, at: str | None) -> None:
        key = f"{dataset_id}@{at}" if at else dataset_id
        try:
            module = self._fetcher(dataset_id)
            lib = module.lib
            doc = lib.document(dataset_id, module.build, lib.zurich_time(at) if at else None)
            for error in doc["errors"]:
                log.warning("[datasets] [%s] %s", dataset_id, error)
            lib.write_json(str(self.cache_file(dataset_id, at)), doc)
            with self._lock:
                self._last_error.pop(key, None)
            if at:
                self._prune_at(dataset_id)
        except Exception as exc:
            message = f"{dataset_id}/fetch.py failed: {type(exc).__name__}: {exc}"
            log.warning("[datasets] %s", message)
            with self._lock:
                self._last_error[key] = (time.time(), message)
        finally:
            with self._lock:
                self._running.pop(key, None)

    def _refresh(self, dataset_id: str, at: str | None) -> Future[None]:
        """Runs the fetcher into the cache; one run per dataset and time at a time."""
        key = f"{dataset_id}@{at}" if at else dataset_id
        with self._lock:
            run = self._running.get(key)
            if run is None:
                run = self._executor.submit(self._fetch, dataset_id, at)
                self._running[key] = run
            return run

    # ---- the API -------------------------------------------------------------

    def get(self, dataset_id: str, force: bool = False, asked_at: str | None = None) -> dict:
        meta = self.read_meta(dataset_id)
        if not meta:
            raise UnknownDataset(f"Unknown dataset {dataset_id}")
        # Live-only sources answer with now, whatever time was asked for.
        at = asked_at if asked_at and (meta.get("time") or {}).get("support") != "live" else None
        key = f"{dataset_id}@{at}" if at else dataset_id
        # Over a day in the past (whatever the time zone), the data doesn't change any more.
        ttl = meta["ttlSeconds"]
        if at:
            at_utc = dt.datetime.fromisoformat(f"{at}:00").replace(tzinfo=dt.UTC)
            if at_utc < dt.datetime.now(dt.UTC) - dt.timedelta(days=1):
                ttl = PAST_TTL_SECONDS
        doc = self.read_cache(dataset_id, at)
        with self._lock:
            failed = self._last_error.get(key)
        may_retry = force or not failed or time.time() - failed[0] > RETRY_SECONDS
        if (force or _age_seconds(doc) > ttl) and may_retry:
            run = self._refresh(dataset_id, at)
            # Without a cached copy (or when asked to), wait for the fetch;
            # otherwise answer the stale data now.
            if not doc or force:
                try:
                    run.result(timeout=FETCH_TIMEOUT_SECONDS)
                except FutureTimeout:
                    pass
                doc = self.read_cache(dataset_id, at)
        with self._lock:
            error = self._last_error.get(key)
            refreshing = key in self._running
        if not doc:
            raise DatasetUnavailable(error[1] if error else f"No data for {dataset_id} yet")
        age = _age_seconds(doc)
        return {
            "meta": meta,
            "document": doc,
            "at": at,
            "ageSeconds": round(age) if age != float("inf") else 0,
            "refreshing": refreshing,
            "lastError": error[1] if error else None,
        }
