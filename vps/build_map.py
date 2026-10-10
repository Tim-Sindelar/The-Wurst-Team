"""Builds the 3D map of one LaMAR scene: SuperPoint features of the map images, LightGlue matches
between images with nearby poses, triangulation with the dataset's ground-truth poses (hloc).

    python build_map.py data/lamar/HGE data/maps/HGE

Writes <out>/features.h5, pairs.txt, matches.h5 (hloc formats), reference/ (poses only) and sfm/
(the triangulated COLMAP model), all in LaMAR's world frame. Georeferencing is georeference.py.
"""
import argparse
import logging
import re
import sqlite3
from pathlib import Path

import cv2
import h5py
import numpy as np
import pycolmap
import torch
from lightglue import LightGlue, SuperPoint
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation
from tqdm import tqdm

from hloc import triangulation
from hloc.utils.io import list_h5_names
from hloc.utils.parsers import names_to_pair

from vps.lamar import ImageRecord, load_session

log = logging.getLogger('build_map')


def device() -> str:
    if torch.cuda.is_available():
        return 'cuda'
    if hasattr(torch, 'xpu') and torch.xpu.is_available():
        return 'xpu'
    return 'cpu'


def subsample(recs: list[ImageRecord], min_dist: float, min_angle: float) -> list[ImageRecord]:
    """Per camera stream, keep a frame once it moved or turned enough since the last kept one."""
    keep = []
    last: dict[str, ImageRecord] = {}
    # Phones have one sensor id per frame (cam_phone_<timestamp>): group by the stream.
    stream = lambda r: re.sub(r'_\d+$', '', r.sensor_id)
    for r in sorted(recs, key=lambda r: (stream(r), r.timestamp)):
        p = last.get(stream(r))
        if p is not None:
            d = np.linalg.norm(r.world_from_cam.t - p.world_from_cam.t)
            a = np.degrees(np.arccos(np.clip((np.trace(p.world_from_cam.R.T @ r.world_from_cam.R) - 1) / 2, -1, 1)))
            if d < min_dist and a < min_angle:
                continue
        keep.append(r)
        last[stream(r)] = r
    return keep


def write_reference(recs: list[ImageRecord], out: Path) -> None:
    """COLMAP text model with the known poses and no points."""
    out.mkdir(parents=True, exist_ok=True)
    cams: dict[tuple, int] = {}
    with open(out / 'cameras.txt', 'w') as fc, open(out / 'images.txt', 'w') as fi:
        for i, r in enumerate(recs, 1):
            key = (r.camera.model, r.camera.width, r.camera.height, *r.camera.params)
            if key not in cams:
                cams[key] = len(cams) + 1
                fc.write(f'{cams[key]} {r.camera.model} {r.camera.width} {r.camera.height} {" ".join(map(str, r.camera.params))}\n')
            cam_from_world = r.world_from_cam.inverse()
            qx, qy, qz, qw = Rotation.from_matrix(cam_from_world.R).as_quat()
            t = cam_from_world.t
            fi.write(f'{i} {qw} {qx} {qy} {qz} {t[0]} {t[1]} {t[2]} {cams[key]} {r.name}\n\n')
    (out / 'points3D.txt').write_text('')


def read_gray(path: Path, resize_max: int):
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(path)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    gray = img @ np.array([0.299, 0.587, 0.114], np.float32)  # kornia's rgb_to_grayscale
    h, w = gray.shape
    scale = min(1.0, resize_max / max(h, w))
    if scale < 1:
        gray = cv2.resize(gray, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return gray, (w, h), np.array([w / gray.shape[1], h / gray.shape[0]], np.float32)


def extract(recs, image_dir: Path, path: Path, resize_max: int, max_kp: int, dev: str) -> None:
    done = set(list_h5_names(path)) if path.exists() else set()
    todo = [r for r in recs if r.name not in done]
    if not todo:
        return
    sp = SuperPoint(max_num_keypoints=max_kp).eval().to(dev)
    with h5py.File(path, 'a', libver='latest') as f, torch.no_grad():
        for r in tqdm(todo, desc='features'):
            gray, size, scale = read_gray(image_dir / r.name, resize_max)
            pred = sp({'image': torch.from_numpy(gray)[None, None].to(dev)})
            kp = pred['keypoints'][0].cpu().numpy()
            kp = (kp + 0.5) * scale - 0.5  # to original image pixels (hloc convention)
            g = f.require_group(r.name)
            for k, v in (('keypoints', kp.astype(np.float32)),
                         ('descriptors', pred['descriptors'][0].cpu().numpy().T.astype(np.float16)),
                         ('scores', pred['keypoint_scores'][0].cpu().numpy().astype(np.float16)),
                         ('image_size', np.array(size))):
                if k in g:
                    del g[k]
                g.create_dataset(k, data=v)


def pairs_from_poses(recs, k: int, max_dist: float, max_angle: float) -> list[tuple[str, str]]:
    centers = np.stack([r.world_from_cam.t for r in recs])
    axes = np.stack([r.world_from_cam.R[:, 2] for r in recs])  # viewing directions
    tree = cKDTree(centers)
    pairs = set()
    cos_max = np.cos(np.radians(max_angle))
    for i in range(len(recs)):
        idx = tree.query_ball_point(centers[i], max_dist)
        idx = [j for j in idx if j != i and axes[i] @ axes[j] > cos_max]
        # Closest in position and direction.
        idx.sort(key=lambda j: np.linalg.norm(centers[j] - centers[i]) + 2 * (1 - axes[i] @ axes[j]))
        for j in idx[:k]:
            pairs.add((min(i, j), max(i, j)))
    return [(recs[i].name, recs[j].name) for i, j in sorted(pairs)]


def nn_mutual(d0: torch.Tensor, d1: torch.Tensor, min_sim: float = 0.755, ratio: float = 0.95):
    """Mutual nearest neighbours with a distance threshold (0.7, as hloc's NN-mutual for SuperPoint)
    and a ratio test. d0 (N, D), d1 (M, D) unit rows -> matches0 (N,) (-1: none), similarity."""
    sim = d0 @ d1.T
    top = sim.topk(2, dim=1) if sim.shape[1] > 1 else sim.topk(1, dim=1)
    best, nn01 = top.values[:, 0], top.indices[:, 0]
    nn10 = sim.argmax(0)
    ok = (nn10[nn01] == torch.arange(len(nn01), device=d0.device)) & (best > min_sim)
    if sim.shape[1] > 1:
        # ratio on distances: |d - n1| < ratio * |d - n2|, with |a - b|^2 = 2 - 2 a.b
        d1st = (2 - 2 * best).clamp(min=0).sqrt()
        d2nd = (2 - 2 * top.values[:, 1]).clamp(min=0).sqrt()
        ok &= d1st < ratio * d2nd
    return torch.where(ok, nn01, torch.full_like(nn01, -1)), best


def match(pairs, features: Path, path: Path, dev: str, method: str = 'nn', max_kp: int = 1024) -> None:
    """Matches image pairs into an hloc matches file. 'nn' (mutual nearest neighbours) is fast
    and, with the known poses' epipolar check in triangulate(), good enough for the map;
    'lightglue' is better but ~100x slower on this machine."""
    todo = pairs
    if path.exists():
        with h5py.File(path, 'r') as f:
            todo = [p for p in pairs if names_to_pair(*p) not in f]
    if not todo:
        return
    if method == 'lightglue':
        # Adaptive depth / width pruning only pays off on the CPU (dynamic shapes are slow on the XPU).
        adaptive = dev == 'cpu'
        lg = LightGlue(features='superpoint', depth_confidence=0.95 if adaptive else -1,
                       width_confidence=0.99 if adaptive else -1).eval().to(dev)
        lg.pruning_keypoint_thresholds.setdefault(dev, lg.pruning_keypoint_thresholds['cuda'])
    else:
        max_kp = None
    cache: dict[str, dict] = {}

    def load(fh, name):
        if name not in cache:
            if len(cache) > 3000:
                cache.clear()
            g = fh[name]
            # Keypoints are sorted by score: the first max_kp are the best, indices stay valid.
            cache[name] = {
                'keypoints': torch.from_numpy(g['keypoints'][:max_kp])[None].to(dev),
                'descriptors': torch.from_numpy(g['descriptors'][:, :max_kp].T.astype(np.float32))[None].to(dev),
                'image_size': torch.from_numpy(g['image_size'][()].astype(np.float32))[None].to(dev),
            }
        return cache[name]

    todo.sort()  # consecutive pairs share images: better cache hits
    with h5py.File(features, 'r') as ff, h5py.File(path, 'a', libver='latest') as fm, torch.no_grad():
        for n0, n1 in tqdm(todo, desc='matching'):
            f0, f1 = load(ff, n0), load(ff, n1)
            if method == 'lightglue':
                out = lg({'image0': f0, 'image1': f1})
                m0, sc = out['matches0'][0], out['matching_scores0'][0]
            else:
                m0, sc = nn_mutual(f0['descriptors'][0], f1['descriptors'][0])
            g = fm.require_group(names_to_pair(n0, n1))
            g.create_dataset('matches0', data=m0.cpu().numpy().astype(np.int32))
            g.create_dataset('matching_scores0', data=sc.cpu().numpy().astype(np.float16))


def merge_shards(out: Path) -> None:
    shards = sorted(out.glob('matches.*.h5'))
    if not shards:
        return
    with h5py.File(out / 'matches.h5', 'a') as fo:
        for sh in shards:
            with h5py.File(sh, 'r') as fi:
                def copy(name, obj):
                    if isinstance(obj, h5py.Group) and 'matches0' in obj and name not in fo:
                        fi.copy(obj, fo, name=name)
                fi.visititems(copy)
    for sh in shards:
        sh.unlink()


def triangulate(out: Path, image_dir: Path) -> pycolmap.Reconstruction:
    """hloc.triangulation.main, except that verified pairs are marked as calibrated two-view
    geometries: COLMAP >= 3.12 ignores pairs whose configuration is undefined."""
    sfm = out / 'sfm'
    sfm.mkdir(parents=True, exist_ok=True)
    database = sfm / 'database.db'
    reference = pycolmap.Reconstruction(out / 'reference')
    image_ids = triangulation.create_db_from_model(reference, database)
    with pycolmap.Database.open(database) as db:
        triangulation.import_features(image_ids, db, out / 'features.h5')
        triangulation.import_matches(image_ids, db, out / 'pairs.txt', out / 'matches.h5')
        triangulation.geometric_verification(image_ids, reference, db, out / 'features.h5', out / 'pairs.txt', out / 'matches.h5')
    con = sqlite3.connect(database)
    con.execute('UPDATE two_view_geometries SET config = 2 WHERE rows > 0')
    con.commit()
    con.close()
    return triangulation.run_triangulation(sfm, database, image_dir, reference)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('capture', type=Path)
    p.add_argument('out', type=Path)
    p.add_argument('--session', default='map')
    p.add_argument('--resize', type=int, default=800)
    p.add_argument('--max-kp', type=int, default=2048)
    p.add_argument('--min-dist', type=float, default=0.4)
    p.add_argument('--min-angle', type=float, default=12)
    p.add_argument('--pairs', type=int, default=10)
    p.add_argument('--limit', type=int, default=0, help='first N images only (testing)')
    p.add_argument('--stage', choices=['all', 'prepare', 'match', 'triangulate'], default='all')
    p.add_argument('--shard', default='0/1', help='match stage: i[,j...]/n, the pairs k with k %% n in {i, j...}')
    p.add_argument('--device', help='match stage: torch device')
    p.add_argument('--matcher', choices=['nn', 'lightglue'], default='nn')
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO)
    dev = device()
    session = args.capture / 'sessions' / args.session
    recs = load_session(session)
    log.info('%d posed images in %s', len(recs), session)
    recs = subsample(recs, args.min_dist, args.min_angle)
    if args.limit:
        recs = recs[: args.limit]
    log.info('%d after subsampling', len(recs))
    args.out.mkdir(parents=True, exist_ok=True)
    image_dir = session / 'raw_data'
    if args.stage in ('all', 'prepare'):
        write_reference(recs, args.out / 'reference')
        extract(recs, image_dir, args.out / 'features.h5', args.resize, args.max_kp, dev)
        pairs = pairs_from_poses(recs, args.pairs, max_dist=6.0, max_angle=60)
        (args.out / 'pairs.txt').write_text('\n'.join(' '.join(p) for p in pairs))
        log.info('%d pairs', len(pairs))
    pairs = [tuple(line.split()) for line in (args.out / 'pairs.txt').read_text().splitlines()]
    if args.stage == 'match':
        # One of several processes (e.g. GPU + CPU) matching every n-th pair into its own file.
        ids, n = args.shard.split('/')
        ids = [int(i) for i in ids.split(',')]
        mine = [p for k, p in enumerate(pairs) if k % int(n) in ids]
        match(mine, args.out / 'features.h5', args.out / f'matches.{ids[0]}.h5', args.device or dev, args.matcher)
        return
    if args.stage == 'all':
        match(pairs, args.out / 'features.h5', args.out / 'matches.h5', dev, args.matcher)
    if args.stage in ('all', 'triangulate'):
        merge_shards(args.out)
        rec = triangulate(args.out, image_dir)
        log.info(rec.summary())


if __name__ == '__main__':
    main()
