"""HTTP server: POST /localize with a VPS1 request (features only, see protocol.py) -> JSON pose.

    python -m vps.server --db data/db/HGE.h5 data/db/CAB.h5 --port 8090 [--debug-dir /tmp/vps-debug]

Debug mode (the app's "debug" switch): a request whose header has a `debug` id gets the localizer's
intermediate results in its answer, and request + answer are stored under --debug-dir; the phone
then uploads the image and its context with PUT /debug/<id>/frame.png and /debug/<id>/client.json.
"""
import argparse
import logging
import threading
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from .debugstore import DebugStore
from .localizer import Localizer, LocalizerConfig
from .mapdb import MapSet
from .protocol import decode

log = logging.getLogger('vps')


def create_app(db_paths, conf: LocalizerConfig = LocalizerConfig(), debug_dir: Path | None = None) -> FastAPI:
    maps = MapSet(db_paths)
    localizers = {db.scene: Localizer(db, conf) for db in maps.dbs}
    store = DebugStore(debug_dir) if debug_dir else None
    lock = threading.Lock()  # one query at a time: the VM has 4 cores and torch uses them all
    app = FastAPI(title='ETH VPS')
    app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

    @app.get('/health')
    def health():
        return {'ok': True, 'debug': store is not None,
                'scenes': [{'scene': db.scene, 'images': len(db.names), 'points': len(db.points),
                            'levels': [lv['id'] for lv in db.levels]} for db in maps.dbs]}

    @app.post('/localize')
    async def localize(request: Request):
        body = await request.body()
        try:
            q = decode(body)
        except ValueError as e:
            raise HTTPException(400, str(e))
        debug_id = q.debug if store else None
        db = maps.pick(q.prior)
        t0 = time.time()
        if db is None:
            out = {'ok': False, 'reason': 'outside the mapped area (HG E floor, CAB)'}
        else:
            with lock:
                out = localizers[db.scene].localize(q, debug=debug_id is not None)
            log.info('%s n=%d -> %s (%.0f ms)%s', db.scene, len(q.keypoints),
                     {k: out.get(k) for k in ('ok', 'reason', 'inliers', 'levelId', 'heading')}, 1000 * (time.time() - t0),
                     f' debug {debug_id}' if debug_id else '')
        if debug_id:
            try:
                store.save_query(debug_id, body, out)
                out['debugStored'] = True
            except (ValueError, OSError) as e:
                out['debugStored'] = False
                log.warning('debug %s: %s', debug_id, e)
        return out

    @app.put('/debug/{debug_id}/{name}')
    async def debug_upload(debug_id: str, name: str, request: Request):
        if store is None:
            raise HTTPException(404, 'debug storage is off')
        try:
            store.save_upload(debug_id, name, await request.body())
        except FileNotFoundError:
            raise HTTPException(404, 'unknown debug id')
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {'ok': True}

    return app


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--db', nargs='+', required=True)
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=8090)
    p.add_argument('--threads', type=int, default=0)
    p.add_argument('--debug-dir', type=Path, help='store debug-mode queries here (off without)')
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    if args.threads:
        import torch
        torch.set_num_threads(args.threads)
    uvicorn.run(create_app(args.db, debug_dir=args.debug_dir), host=args.host, port=args.port, log_level='info')


if __name__ == '__main__':
    main()
