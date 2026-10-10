"""Minimal reader for LaMAR Capture sessions (Kapture-style text files, see lamar-benchmark CAPTURE.md).

sensors.txt       sensor_id, name, sensor_type, model, width, height, params...
rigs.txt          rig_id, sensor_id, qw, qx, qy, qz, tx, ty, tz            (camera -> rig)
trajectories.txt  timestamp, device_id, qw, qx, qy, qz, tx, ty, tz[, cov]  (sensor or rig -> world)
images.txt        timestamp, sensor_id, image_path (relative to raw_data/)
"""
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation


def read_csv(path: Path) -> list[list[str]]:
    rows = []
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        rows.append([c.strip() for c in line.split(',')])
    return rows


@dataclass
class Camera:
    model: str
    width: int
    height: int
    params: list[float]


@dataclass
class Pose:
    """x_world = R @ x_sensor + t"""
    R: np.ndarray
    t: np.ndarray

    @staticmethod
    def from_qt(q_wxyz, t) -> 'Pose':
        q = np.asarray(q_wxyz, float)
        return Pose(Rotation.from_quat(q[[1, 2, 3, 0]]).as_matrix(), np.asarray(t, float))

    def __mul__(self, other: 'Pose') -> 'Pose':
        return Pose(self.R @ other.R, self.R @ other.t + self.t)

    def inverse(self) -> 'Pose':
        return Pose(self.R.T, -self.R.T @ self.t)


@dataclass
class ImageRecord:
    name: str  # path relative to the session's raw_data/
    sensor_id: str
    timestamp: int
    camera: Camera
    world_from_cam: Pose


def load_session(session_dir: Path, trajectories: str = 'trajectories.txt') -> list[ImageRecord]:
    session_dir = Path(session_dir)
    cameras = {}
    for row in read_csv(session_dir / 'sensors.txt'):
        sid, _name, stype, *p = row
        if stype != 'camera':
            continue
        model, w, h, *params = p
        cameras[sid] = Camera(model, int(float(w)), int(float(h)), [float(x) for x in params])
    rigs: dict[str, dict[str, Pose]] = {}
    if (session_dir / 'rigs.txt').exists():
        for rid, sid, *qt in read_csv(session_dir / 'rigs.txt'):
            rigs.setdefault(rid, {})[sid] = Pose.from_qt(qt[:4], qt[4:7])
    poses: dict[tuple[int, str], Pose] = {}
    for ts, dev, *qt in read_csv(session_dir / trajectories):
        poses[(int(ts), dev)] = Pose.from_qt(qt[:4], qt[4:7])
    # Rig poses -> poses of the rig's cameras (HoloLens: one rig per timestamp).
    for (ts, dev), pose in list(poses.items()):
        for sid, cam_to_rig in rigs.get(dev, {}).items():
            poses.setdefault((ts, sid), pose * cam_to_rig)
    out = []
    for ts, sid, path in read_csv(session_dir / 'images.txt'):
        ts = int(ts)
        if sid in cameras and (ts, sid) in poses:
            out.append(ImageRecord(path, sid, ts, cameras[sid], poses[(ts, sid)]))
    return out
