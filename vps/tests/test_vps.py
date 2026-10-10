"""python -m pytest tests  (no map data needed)"""
import json

import h5py
import numpy as np
import pycolmap
import pytest
from scipy.spatial.transform import Rotation

from vps.mapdb import MapDB, from_local, to_local
from vps.protocol import decode, encode


def test_protocol_roundtrip():
    rng = np.random.default_rng(0)
    n = 50
    desc = rng.normal(size=(n, 256)).astype(np.float32)
    desc /= np.linalg.norm(desc, axis=1, keepdims=True)
    kp = rng.uniform(0, 600, (n, 2)).astype(np.float32)
    prior = {'lng': 8.5, 'lat': 47.3, 'levelId': 'ETH.HG.E', 'accuracy': 2.0}
    q = decode(encode(kp, rng.uniform(size=n), desc, 640, 480, 500.0, prior))
    assert (q.width, q.height, q.focal, q.prior) == (640, 480, 500.0, prior)
    np.testing.assert_array_equal(q.keypoints, kp)
    # int8 quantisation keeps descriptors (and so matching) nearly unchanged
    assert np.min(np.sum(q.descriptors * desc, 1)) > 0.995


def test_protocol_rejects_garbage():
    with pytest.raises(ValueError):
        decode(b'nope')
    good = encode(np.zeros((3, 2)), np.zeros(3), np.zeros((3, 256)), 8, 8, 1.0, None)
    with pytest.raises(ValueError):
        decode(good[:-1])


def test_local_roundtrip():
    o = (8.5471, 47.3758)
    x, y = to_local(8.548, 47.376, *o)
    np.testing.assert_allclose(from_local(x, y, *o), (8.548, 47.376))


@pytest.fixture
def tiny_db(tmp_path):
    p = tmp_path / 'db.h5'
    with h5py.File(p, 'w') as f:
        f.create_group('features')
        f['points'] = np.zeros((1, 3), np.float32)
        f['names'] = np.array(['a'], dtype=h5py.string_dtype())
        f['centers'] = np.zeros((1, 3), np.float32)
        f['image_sizes'] = np.array([[640, 480]], np.int32)
        f['image_level'] = np.zeros(1, np.int32)
        f.attrs['scene'] = 'T'
        f.attrs['origin_lng'], f.attrs['origin_lat'] = 8.5, 47.3
        f.attrs['levels'] = json.dumps([{'id': 'L.E', 'z': 0.0, 'cameraZ': 1.5}, {'id': 'L.F', 'z': 4.0, 'cameraZ': 5.5}])
    return MapDB(p)


def pose_looking(heading_deg, pitch_deg, center):
    """COLMAP cam_from_world of a camera at `center` (x east, y north, z up) looking at the heading."""
    h, p = np.radians(heading_deg), np.radians(pitch_deg)
    fwd = np.array([np.sin(h) * np.cos(p), np.cos(h) * np.cos(p), np.sin(p)])
    right = np.cross(fwd, [0, 0, 1.0])
    right /= np.linalg.norm(right)
    down = np.cross(fwd, right)
    R_wc = np.stack([right, down, fwd], 1)  # columns: camera x (right), y (down), z (forward)
    R_cw = R_wc.T
    return pycolmap.Rigid3d(pycolmap.Rotation3d(R_cw), -R_cw @ np.asarray(center, float))


@pytest.mark.parametrize('heading', [0, 37, 90, 200, 315])
def test_describe_pose_conventions(tiny_db, heading):
    out = tiny_db.describe_pose(pose_looking(heading, -10, [3.0, 4.0, 5.6]))
    assert out['heading'] == pytest.approx(heading % 360, abs=1e-6)
    assert out['pitch'] == pytest.approx(-10, abs=1e-6)
    assert out['levelId'] == 'L.F'
    assert out['height'] == pytest.approx(1.6, abs=1e-6)
    x, y = tiny_db.to_local(out['lng'], out['lat'])
    np.testing.assert_allclose([x, y], [3, 4], atol=1e-6)
    # three.js camera looks along -z; AR world: x east, y up, z south
    R = Rotation.from_quat(out['quaternion']).as_matrix()
    fwd = R @ np.array([0, 0, -1.0])
    h = np.radians(heading)
    np.testing.assert_allclose(fwd, [np.sin(h) * np.cos(np.radians(10)), -np.sin(np.radians(10)),
                                     -np.cos(h) * np.cos(np.radians(10))], atol=1e-9)
    # camera up stays up-ish (no roll)
    assert (R @ np.array([0, 1.0, 0]))[1] > 0.9
