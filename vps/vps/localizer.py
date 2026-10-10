"""Localizes a query (SuperPoint features of one phone frame) against a map database.

The standard hierarchical pipeline (hloc), with the beacon fix in place of global retrieval:
  1. candidates: map images whose camera is within a radius of the coarse position, on its floor;
  2. shortlist: the candidates sharing the most mutual nearest-neighbour descriptor matches;
  3. matching: LightGlue between the query and each shortlisted image;
  4. 2D-3D: matched map keypoints that are triangulated give 2D-3D correspondences;
  5. pose: LO-RANSAC P3P / P4Pf (unknown focal) + non-linear refinement (pycolmap).
Everything is in the map database's world frame: x east, y north, z up, metres from its origin.
"""
import time
from dataclasses import dataclass

import numpy as np
import pycolmap
import torch
from lightglue import LightGlue

from .mapdb import MapDB
from .protocol import Query


@dataclass
class LocalizerConfig:
    radius: float = 12.0  # metres around the prior, grown with its accuracy
    max_candidates: int = 120
    shortlist: int = 5
    min_mnn: int = 12
    ransac_px: float = 10.0  # in a 640 px image
    min_inliers: int = 50  # fewer: often a wrong pose (CAB validation queries)
    max_prior_dist: float = 8.0  # metres
    device: str = 'cpu'


class Localizer:
    def __init__(self, db: MapDB, conf: LocalizerConfig = LocalizerConfig()):
        self.db = db
        self.conf = conf
        torch.set_grad_enabled(False)
        self.matcher = LightGlue(features='superpoint', depth_confidence=0.95, width_confidence=0.99).eval().to(conf.device)

    def candidates(self, prior: dict | None) -> np.ndarray:
        db = self.db
        if prior is None:
            return np.zeros(0, int)
        x, y = db.to_local(prior['lng'], prior['lat'])
        radius = max(self.conf.radius, 3 * float(prior.get('accuracy') or 0))
        d = np.hypot(db.centers[:, 0] - x, db.centers[:, 1] - y)
        mask = d < radius
        level = prior.get('levelId')
        if level and level in db.level_index:
            mask &= np.isin(db.image_level, db.level_index[level])
        idx = np.flatnonzero(mask)
        # Nearest first, then thinned evenly so a long corridor doesn't only give the closest frames.
        idx = idx[np.argsort(d[idx])]
        if len(idx) > self.conf.max_candidates:
            idx = idx[np.linspace(0, len(idx) - 1, self.conf.max_candidates).round().astype(int)]
        return idx

    def shortlist(self, q: Query, cands: np.ndarray) -> list[tuple[int, int]]:
        """(mutual NN matches, image index) of the most similar candidates."""
        return self.select_shortlist(self.shortlist_scores(q, cands))

    def select_shortlist(self, scored: list[tuple[int, int]]) -> list[tuple[int, int]]:
        return [s for s in scored[: self.conf.shortlist] if s[0] >= self.conf.min_mnn]

    def shortlist_scores(self, q: Query, cands: np.ndarray) -> list[tuple[int, int]]:
        """All candidates by mutual NN matches, best first."""
        qd = torch.from_numpy(q.descriptors)
        scored = []
        for i in cands:
            kp, desc, _ = self.db.features(i)
            if len(kp) == 0:
                continue
            sim = qd @ torch.from_numpy(desc.astype(np.float32)).T
            nn01 = sim.argmax(1)
            nn10 = sim.argmax(0)
            mutual = (nn10[nn01] == torch.arange(len(nn01))) & (sim.max(1).values > 0.75)
            scored.append((int(mutual.sum()), int(i)))
        scored.sort(reverse=True)
        return scored

    def match(self, q: Query, i: int, return_all: bool = False):
        """Indices into the query keypoints and the 3D points they match (only triangulated ones);
        with `return_all` also the number of LightGlue matches before that."""
        kp, desc, p3d = self.db.features(i)
        w, h = self.db.image_sizes[i]
        dev = self.conf.device
        data = {
            'image0': {'keypoints': torch.from_numpy(q.keypoints)[None].to(dev),
                       'descriptors': torch.from_numpy(q.descriptors)[None].to(dev),
                       'image_size': torch.tensor([[q.width, q.height]], dtype=torch.float32, device=dev)},
            'image1': {'keypoints': torch.from_numpy(kp)[None].to(dev),
                       'descriptors': torch.from_numpy(desc.astype(np.float32))[None].to(dev),
                       'image_size': torch.tensor([[w, h]], dtype=torch.float32, device=dev)},
        }
        m = self.matcher(data)['matches'][0].cpu().numpy()
        keep = p3d[m[:, 1]] >= 0
        if return_all:
            return m[keep, 0], p3d[m[keep, 1]], len(m)
        return m[keep, 0], p3d[m[keep, 1]]

    def localize(self, q: Query, debug: bool = False) -> dict:
        """The pose, or ok=False and a reason. With `debug`, also every intermediate step under
        'debug' (see debug_replay.py): candidates, shortlist, matched and inlier keypoints, both
        solvers' results and the pose even when it is rejected."""
        t0 = time.time()
        dbg: dict = {'timing': {}, 'keypoints': len(q.keypoints)}
        lap_t = [t0]

        def lap(name: str):
            now = time.time()
            dbg['timing'][name] = round(1000 * (now - lap_t[0]))
            lap_t[0] = now

        def done(out: dict) -> dict:
            out.setdefault('scene', self.db.scene)
            out.setdefault('ms', round(1000 * (time.time() - t0)))
            if debug:
                out['debug'] = dbg
            return out

        cands = self.candidates(q.prior)
        if q.prior:
            x, y = self.db.to_local(q.prior['lng'], q.prior['lat'])
            d = np.hypot(self.db.centers[cands, 0] - x, self.db.centers[cands, 1] - y)
            dbg['prior'] = {'x': round(float(x), 2), 'y': round(float(y), 2), 'levelId': q.prior.get('levelId'),
                            'radius': max(self.conf.radius, 3 * float(q.prior.get('accuracy') or 0))}
            dbg['candidates'] = [{'name': self.db.names[i], 'dist': round(float(di), 2)} for i, di in zip(cands, d)]
        lap('candidates')
        if len(cands) == 0:
            return done({'ok': False, 'reason': 'no map images near this position'})
        scored = self.shortlist_scores(q, cands)
        short = self.select_shortlist(scored)
        lap('shortlist')
        # The best candidates also when they fall below min_mnn: how close was it?
        dbg['shortlist'] = [{'name': self.db.names[i], 'mnn': mnn, 'used': k < len(short),
                             'center': [round(float(v), 2) for v in self.db.centers[i]]}
                            for k, (mnn, i) in enumerate(scored[:max(len(short), self.conf.shortlist)])]
        if not short:
            return done({'ok': False, 'reason': 'no similar map images', 'candidates': len(cands)})
        qi, pi = [], []
        for s, (_, i) in zip(dbg['shortlist'], short):
            a, b, n_lg = self.match(q, i, return_all=True)
            s['matches'] = n_lg
            s['matches3d'] = len(a)
            qi.append(a)
            pi.append(b)
        lap('match')
        qi = np.concatenate(qi)
        pi = np.concatenate(pi)
        # One correspondence per (query keypoint, 3D point).
        pairs = np.unique(np.stack([qi, pi], 1), axis=0)
        dbg['matchedKp'] = sorted({int(k) for k in pairs[:, 0]})
        if len(pairs) < self.conf.min_inliers:
            return done({'ok': False, 'reason': f'only {len(pairs)} 2D-3D matches', 'candidates': len(cands),
                         'matches': len(pairs)})
        pts2d = q.keypoints[pairs[:, 0]].astype(np.float64) + 0.5  # COLMAP pixel centres
        pts3d = self.db.points[pairs[:, 1]]
        ret = self.solve(q, pts2d, pts3d, dbg)
        lap('pose')
        n = 0 if ret is None else int(ret['num_inliers'])
        if ret is not None and debug:
            self.describe_inliers(q, ret, pairs, pts2d, pts3d, dbg)
        if ret is None or n < self.conf.min_inliers:
            return done({'ok': False, 'reason': f'pose not found ({n} inliers)', 'candidates': len(cands),
                         'matches': len(pairs), 'inliers': n})
        out = self.db.describe_pose(ret['cam_from_world'])
        if not self.plausible(q, out):
            return done({'ok': False, 'reason': 'pose too far from the beacon position', 'candidates': len(cands),
                         'matches': len(pairs), 'inliers': n})
        out.update(ok=True, focal=float(ret['focal']), inliers=n, matches=len(pairs),
                   candidates=len(cands), shortlist=len(short))
        return done(out)

    def describe_inliers(self, q: Query, ret: dict, pairs, pts2d, pts3d, dbg: dict):
        """Inlier keypoints, where the pose puts their 3D points in the image, and the pose itself
        (also a rejected one)."""
        mask = np.asarray(ret['inlier_mask'], bool)
        R = np.asarray(ret['cam_from_world'].rotation.matrix())
        t = np.asarray(ret['cam_from_world'].translation)
        pc = pts3d[mask] @ R.T + t
        uv = ret['focal'] * pc[:, :2] / pc[:, 2:3] + np.array([q.width / 2, q.height / 2]) - 0.5
        err = np.linalg.norm(uv - (pts2d[mask] - 0.5), axis=1)
        dbg['inlierKp'] = [int(k) for k in pairs[mask, 0]]
        dbg['reprojected'] = [[round(float(u), 1), round(float(v), 1)] for u, v in uv]
        if mask.any():
            dbg['reprojError'] = {'median': round(float(np.median(err)), 2), 'p90': round(float(np.percentile(err, 90)), 2)}
            dbg['inlierDepth'] = {'median': round(float(np.median(pc[:, 2])), 2), 'min': round(float(pc[:, 2].min()), 2),
                                  'max': round(float(pc[:, 2].max()), 2)}
        pose = self.db.describe_pose(ret['cam_from_world'])
        pose['focal'] = round(float(ret['focal']), 1)
        if 'prior' in dbg:
            x, y = self.db.to_local(pose['lng'], pose['lat'])
            pose['priorDist'] = round(float(np.hypot(x - dbg['prior']['x'], y - dbg['prior']['y'])), 2)
        dbg['pose'] = pose

    def solve(self, q: Query, pts2d: np.ndarray, pts3d: np.ndarray, dbg: dict | None = None):
        """P3P with the client's focal guess, then refined with the focal free. P4Pf (focal unknown)
        only when that clearly explains more matches: far, flat scenes let focal length and distance
        trade off, and P4Pf then finds wrong poses metres along the viewing direction."""
        scale = max(q.width, q.height) / 640
        results = {}
        for estimate_focal in (False, True):
            cam = pycolmap.Camera(model='SIMPLE_PINHOLE', width=q.width, height=q.height,
                                  params=[q.focal, q.width / 2, q.height / 2])
            est = pycolmap.AbsolutePoseEstimationOptions()
            est.estimate_focal_length = estimate_focal
            est.ransac.max_error = self.conf.ransac_px * scale
            est.ransac.max_num_trials = 5000
            ref = pycolmap.AbsolutePoseRefinementOptions()
            ref.refine_focal_length = True
            ret = pycolmap.estimate_and_refine_absolute_pose(pts2d, pts3d, cam, est, ref)
            key = 'p4pf' if estimate_focal else 'p3p'
            if ret is None:
                if dbg is not None:
                    dbg.setdefault('solvers', {})[key] = None
                continue
            f = cam.params[0]
            fov = 2 * np.degrees(np.arctan(max(q.width, q.height) / 2 / f))
            if dbg is not None:
                dbg.setdefault('solvers', {})[key] = {'inliers': int(ret['num_inliers']), 'focal': round(float(f), 1),
                                                      'fov': round(float(fov), 1)}
            if not 35 < fov < 110:  # no phone camera: degenerate
                continue
            ret['focal'] = f
            results[estimate_focal] = ret
        fixed, free = results.get(False), results.get(True)
        if fixed is None:
            chosen = free
        elif free is not None and free['num_inliers'] > 1.3 * fixed['num_inliers']:
            chosen = free
        else:
            chosen = fixed
        if dbg is not None:
            dbg['solver'] = None if chosen is None else 'p4pf' if chosen is free else 'p3p'
        return chosen

    def plausible(self, q: Query, out: dict) -> bool:
        """The beacon fix is metres off at worst: a pose far from it is a wrong match."""
        if not q.prior:
            return True
        x, y = self.db.to_local(out['lng'], out['lat'])
        px, py = self.db.to_local(q.prior['lng'], q.prior['lat'])
        return float(np.hypot(x - px, y - py)) <= max(self.conf.max_prior_dist, 4 * float(q.prior.get('accuracy') or 0))
