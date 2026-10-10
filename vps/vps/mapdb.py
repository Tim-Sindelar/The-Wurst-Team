"""The map database the server localizes against (written by build_db.py).

db.h5
  attrs        scene, origin_lng, origin_lat, levels (JSON: [{id, z, cameraZ}] camera-height clusters with
               their PolyMaps level and floor height; several clusters can be one level on a slope)
  names        map image names
  cameras      (N, 4) f, cx, cy, k?  (only for reference), image_sizes (N, 2) width, height
  centers      (N, 3) camera centres, world frame (x east, y north, z up, metres from the origin)
  image_level  (N,) index into levels
  points       (P, 3) triangulated points, world frame
  features/<i> kp (M, 2) f32, desc (M, 256) f16, p3d (M,) i32 (-1: not triangulated)
"""
import json
from functools import lru_cache
from pathlib import Path

import h5py
import numpy as np
from scipy.spatial.transform import Rotation

M_PER_DEG_LAT = 111_132.0
M_PER_DEG_LNG_EQUATOR = 111_320.0

# ENU (x east, y north, z up) -> AR world (x east, y up, z south), as polymaps-ar/src/ar.
ENU_TO_AR = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)
# COLMAP camera (x right, y down, z forward) -> three.js camera (x right, y up, z backward).
COLMAP_TO_THREE_CAM = np.diag([1.0, -1.0, -1.0])


def to_local(lng, lat, origin_lng, origin_lat):
    """Metres east / north of the origin, the same equirectangular approximation as polymaps-ar/src/geo.ts."""
    kx = M_PER_DEG_LNG_EQUATOR * np.cos(np.radians(origin_lat))
    return (np.asarray(lng) - origin_lng) * kx, (np.asarray(lat) - origin_lat) * M_PER_DEG_LAT


def from_local(x, y, origin_lng, origin_lat):
    kx = M_PER_DEG_LNG_EQUATOR * np.cos(np.radians(origin_lat))
    return origin_lng + np.asarray(x) / kx, origin_lat + np.asarray(y) / M_PER_DEG_LAT


class MapDB:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.h5 = h5py.File(self.path, 'r')
        a = self.h5.attrs
        self.scene = str(a['scene'])
        self.origin = (float(a['origin_lng']), float(a['origin_lat']))
        self.levels = json.loads(a['levels'])
        self.level_index: dict[str, list[int]] = {}
        for i, lv in enumerate(self.levels):
            self.level_index.setdefault(lv['id'], []).append(i)
        self.names = [n.decode() if isinstance(n, bytes) else n for n in self.h5['names'][()]]
        self.centers = self.h5['centers'][()]
        self.image_sizes = self.h5['image_sizes'][()]
        self.image_level = self.h5['image_level'][()]
        self.points = self.h5['points'][()].astype(np.float64)
        self.features = lru_cache(maxsize=4096)(self._features)

    def _features(self, i: int):
        g = self.h5['features'][str(i)]
        return g['kp'][()], g['desc'][()], g['p3d'][()]

    def to_local(self, lng, lat):
        return to_local(lng, lat, *self.origin)

    def level_of_height(self, z: float) -> int:
        """The camera-height cluster nearest to a camera at height z."""
        return int(np.argmin([abs(lv['cameraZ'] - z) for lv in self.levels]))

    def describe_pose(self, cam_from_world) -> dict:
        """World-frame camera pose -> what the AR app needs."""
        R_cw = np.asarray(cam_from_world.rotation.matrix())
        t_cw = np.asarray(cam_from_world.translation)
        R_wc = R_cw.T
        center = -R_wc @ t_cw
        fwd = R_wc @ np.array([0.0, 0.0, 1.0])
        lng, lat = from_local(center[0], center[1], *self.origin)
        li = self.level_of_height(center[2])
        q = Rotation.from_matrix(ENU_TO_AR @ R_wc @ COLMAP_TO_THREE_CAM).as_quat()  # x, y, z, w
        return {
            'lng': float(lng), 'lat': float(lat), 'levelId': self.levels[li]['id'],
            'height': float(center[2] - self.levels[li]['z']),
            'quaternion': [float(v) for v in q],
            'heading': float(np.degrees(np.arctan2(fwd[0], fwd[1])) % 360),
            'pitch': float(np.degrees(np.arcsin(np.clip(fwd[2], -1, 1)))),
        }


class MapSet:
    """Several scenes (HG, CAB): a query goes to the one around its prior."""

    def __init__(self, paths):
        self.dbs = [MapDB(p) for p in paths]

    def pick(self, prior: dict | None) -> MapDB | None:
        if not prior:
            return None
        best, best_d = None, 1e9
        for db in self.dbs:
            x, y = db.to_local(prior['lng'], prior['lat'])
            d = np.min(np.hypot(db.centers[:, 0] - x, db.centers[:, 1] - y))
            if d < best_d:
                best, best_d = db, d
        return best if best_d < 50 else None
