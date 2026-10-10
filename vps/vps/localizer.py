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
        return [s for s in scored[: self.conf.shortlist] if s[0] >= self.conf.min_mnn]

    def match(self, q: Query, i: int) -> tuple[np.ndarray, np.ndarray]:
        """Indices into the query keypoints and the 3D points they match (only triangulated ones)."""
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
        return m[keep, 0], p3d[m[keep, 1]]

    def localize(self, q: Query) -> dict:
        t0 = time.time()
        cands = self.candidates(q.prior)
        if len(cands) == 0:
            return {'ok': False, 'reason': 'no map images near this position', 'scene': self.db.scene}
        short = self.shortlist(q, cands)
        if not short:
            return {'ok': False, 'reason': 'no similar map images', 'candidates': len(cands), 'scene': self.db.scene}
        qi, pi = [], []
        for _, i in short:
            a, b = self.match(q, i)
            qi.append(a)
            pi.append(b)
        qi = np.concatenate(qi)
        pi = np.concatenate(pi)
        # One correspondence per (query keypoint, 3D point).
        pairs = np.unique(np.stack([qi, pi], 1), axis=0)
        if len(pairs) < self.conf.min_inliers:
            return {'ok': False, 'reason': f'only {len(pairs)} 2D-3D matches', 'candidates': len(cands),
                    'matches': len(pairs), 'scene': self.db.scene}
        pts2d = q.keypoints[pairs[:, 0]].astype(np.float64) + 0.5  # COLMAP pixel centres
        pts3d = self.db.points[pairs[:, 1]]
        ret = self.solve(q, pts2d, pts3d)
        if ret is None or ret['num_inliers'] < self.conf.min_inliers:
            n = 0 if ret is None else ret['num_inliers']
            return {'ok': False, 'reason': f'pose not found ({n} inliers)', 'candidates': len(cands),
                    'matches': len(pairs), 'inliers': n, 'scene': self.db.scene}
        out = self.db.describe_pose(ret['cam_from_world'])
        if not self.plausible(q, out):
            return {'ok': False, 'reason': 'pose too far from the beacon position', 'candidates': len(cands),
                    'matches': len(pairs), 'inliers': int(ret['num_inliers']), 'scene': self.db.scene}
        out.update(ok=True, focal=float(ret['focal']), inliers=int(ret['num_inliers']), matches=len(pairs),
                   candidates=len(cands), shortlist=len(short), ms=round(1000 * (time.time() - t0)), scene=self.db.scene)
        return out

    def solve(self, q: Query, pts2d: np.ndarray, pts3d: np.ndarray):
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
            if ret is None:
                continue
            f = cam.params[0]
            fov = 2 * np.degrees(np.arctan(max(q.width, q.height) / 2 / f))
            if not 35 < fov < 110:  # no phone camera: degenerate
                continue
            ret['focal'] = f
            results[estimate_focal] = ret
        fixed, free = results.get(False), results.get(True)
        if fixed is None:
            return free
        if free is not None and free['num_inliers'] > 1.3 * fixed['num_inliers']:
            return free
        return fixed

    def plausible(self, q: Query, out: dict) -> bool:
        """The beacon fix is metres off at worst: a pose far from it is a wrong match."""
        if not q.prior:
            return True
        x, y = self.db.to_local(out['lng'], out['lat'])
        px, py = self.db.to_local(q.prior['lng'], q.prior['lat'])
        return float(np.hypot(x - px, y - py)) <= max(self.conf.max_prior_dist, 4 * float(q.prior.get('accuracy') or 0))
