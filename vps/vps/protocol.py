"""Wire format of a localization request (see polymaps-ar/src/vps/protocol.ts).

    "VPS1" | u32 header length | header JSON | f32 keypoints (N x 2) | f32 scores (N) | i8 descriptors (N x 256)
"""
import json
import struct
from dataclasses import dataclass

import numpy as np

MAGIC = b'VPS1'


@dataclass
class Query:
    width: int
    height: int
    focal: float
    prior: dict | None
    keypoints: np.ndarray  # (N, 2) float32
    scores: np.ndarray  # (N,) float32
    descriptors: np.ndarray  # (N, 256) float32, unit rows


def decode(buf: bytes, max_keypoints: int = 4096) -> Query:
    if len(buf) < 8 or buf[:4] != MAGIC:
        raise ValueError('not a VPS1 request')
    (hlen,) = struct.unpack_from('<I', buf, 4)
    header = json.loads(buf[8:8 + hlen])
    n, dim = int(header['n']), int(header.get('dim', 256))
    if not 0 <= n <= max_keypoints or dim != 256:
        raise ValueError(f'bad feature count {n} x {dim}')
    o = 8 + hlen
    need = o + n * 8 + n * 4 + n * dim
    if len(buf) != need:
        raise ValueError(f'expected {need} bytes, got {len(buf)}')
    kp = np.frombuffer(buf, '<f4', 2 * n, o).reshape(n, 2)
    o += 8 * n
    scores = np.frombuffer(buf, '<f4', n, o)
    o += 4 * n
    desc = np.frombuffer(buf, 'i1', n * dim, o).reshape(n, dim).astype(np.float32) / float(header.get('descScale', 256))
    desc /= np.maximum(np.linalg.norm(desc, axis=1, keepdims=True), 1e-6)
    return Query(int(header['width']), int(header['height']), float(header['focal']), header.get('prior'),
                 kp.astype(np.float32), scores.astype(np.float32), desc)


def encode(kp: np.ndarray, scores: np.ndarray, desc: np.ndarray, width: int, height: int, focal: float,
           prior: dict | None, desc_scale: float = 256) -> bytes:
    """The client's encoding, for tests and the offline evaluation."""
    n = len(kp)
    header = json.dumps({'n': n, 'width': width, 'height': height, 'focal': focal, 'prior': prior,
                         'descScale': desc_scale, 'dim': 256}).encode()
    q = np.clip(np.round(desc * desc_scale), -127, 127).astype('i1')
    return b''.join([MAGIC, struct.pack('<I', len(header)), header, kp.astype('<f4').tobytes(),
                     scores.astype('<f4').tobytes(), q.tobytes()])
