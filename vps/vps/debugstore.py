"""Debug bundles of single queries (the AR app's debug mode), one directory each:

    <root>/<id>/request.bin   the VPS1 request as received (features, focal guess, beacon prior)
                server.json   the localizer's answer with its 'debug' details, scene, received time
                frame.png     the grayscale image SuperPoint ran on (uploaded by the phone)
                client.json   the phone's context: orientation at capture, camera, backend, timings...

Only the newest `keep` bundles are kept. debug_replay.py re-runs and draws one.
"""
import json
import os
import re
import shutil
import time
from pathlib import Path

ID_RE = re.compile(r'^[A-Za-z0-9_-]{6,64}$')
UPLOADS = {'frame.png': 8 << 20, 'client.json': 1 << 20}


class DebugStore:
    def __init__(self, root: Path, keep: int = 300):
        self.root = Path(root)
        self.keep = keep
        self.root.mkdir(parents=True, exist_ok=True)

    def dir(self, debug_id: str) -> Path:
        if not ID_RE.match(debug_id):
            raise ValueError('bad debug id')
        return self.root / debug_id

    def save_query(self, debug_id: str, request: bytes, response: dict):
        d = self.dir(debug_id)
        d.mkdir(exist_ok=True)
        os.chmod(d, 0o777)  # the container runs as root: let the VM's user delete bundles
        self.write(d / 'request.bin', request)
        self.write(d / 'server.json', json.dumps({**response, 'receivedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z')}, indent=1).encode())
        self.prune()

    @staticmethod
    def write(path: Path, data: bytes):
        path.write_bytes(data)
        os.chmod(path, 0o666)

    def save_upload(self, debug_id: str, name: str, data: bytes):
        if name not in UPLOADS:
            raise ValueError(f'unknown file {name}')
        if len(data) > UPLOADS[name]:
            raise ValueError(f'{name} too large')
        if name.endswith('.json'):
            json.loads(data)
        d = self.dir(debug_id)
        if not d.is_dir():  # only for a query the server has seen
            raise FileNotFoundError(debug_id)
        self.write(d / name, data)

    def prune(self):
        dirs = sorted((p for p in self.root.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime)
        for p in dirs[:-self.keep] if len(dirs) > self.keep else []:
            shutil.rmtree(p, ignore_errors=True)
