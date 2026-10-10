"""HTTP server: POST /localize with a VPS1 request (features only, see protocol.py) -> JSON pose.

    python -m vps.server --db data/db/HGE.h5 data/db/CAB.h5 --port 8090
"""
import argparse
import logging
import threading
import time

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from .localizer import Localizer, LocalizerConfig
from .mapdb import MapSet
from .protocol import decode

log = logging.getLogger('vps')


def create_app(db_paths, conf: LocalizerConfig = LocalizerConfig()) -> FastAPI:
    maps = MapSet(db_paths)
    localizers = {db.scene: Localizer(db, conf) for db in maps.dbs}
    lock = threading.Lock()  # one query at a time: the VM has 4 cores and torch uses them all
    app = FastAPI(title='ETH VPS')
    app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

    @app.get('/health')
    def health():
        return {'ok': True, 'scenes': [{'scene': db.scene, 'images': len(db.names), 'points': len(db.points),
                                        'levels': [lv['id'] for lv in db.levels]} for db in maps.dbs]}

    @app.post('/localize')
    async def localize(request: Request):
        body = await request.body()
        try:
            q = decode(body)
        except ValueError as e:
            raise HTTPException(400, str(e))
        db = maps.pick(q.prior)
        if db is None:
            return {'ok': False, 'reason': 'outside the mapped area (HG E floor, CAB)'}
        t0 = time.time()
        with lock:
            out = localizers[db.scene].localize(q)
        log.info('%s n=%d -> %s (%.0f ms)', db.scene, len(q.keypoints),
                 {k: out.get(k) for k in ('ok', 'reason', 'inliers', 'levelId', 'heading')}, 1000 * (time.time() - t0))
        return out

    return app


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--db', nargs='+', required=True)
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=8090)
    p.add_argument('--threads', type=int, default=0)
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    if args.threads:
        import torch
        torch.set_num_threads(args.threads)
    uvicorn.run(create_app(args.db), host=args.host, port=args.port, log_level='info')


if __name__ == '__main__':
    main()
