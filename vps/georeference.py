"""Georeferences a LaMAR map: finds the rigid 2D transform (rotation about the vertical + translation)
that puts its 3D points onto the PolyMaps floor plan, and the PolyMaps level of each floor.

LaMAR's world frame is metric and gravity-aligned (from the NavVis laser scans) but local. The
floor plan's room outlines are walls, and a sparse SfM model has most of its points on walls, so:
  - per floor (clusters of camera heights), points 0.3-2.3 m above the floor are projected to 2D;
  - for each rotation (1 degree steps), the translation maximising the points' closeness to room
    outlines and wall lines is found by FFT cross-correlation, plus a term for camera positions
    inside rooms (cameras are never inside walls or outside the building);
  - the best (level, rotation, translation) is refined with a continuous local optimisation.

    python georeference.py data/maps/HGE/sfm --building ETH.HG --out data/maps/HGE/georef.json [--plot geo.png]
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import pycolmap
from scipy.ndimage import map_coordinates
from scipy.optimize import minimize

from vps.mapdb import to_local

ROOT = Path(__file__).resolve().parent.parent
FLOORS = ROOT / 'occupancy-map-preview' / 'public' / 'floors'
# Coarse search over all rotations on a 0.5 m raster, then refinement on a 0.1 m one.
COARSE = (0.5, 0.6)  # metres per raster cell, closeness-to-wall sigma
FINE = (0.1, 0.3)


def load_level(level_id: str, origin) -> dict:
    raw = json.loads((FLOORS / 'levels' / f'{level_id}.json').read_text())
    ox, oy = raw['origin']
    s = raw['scale']

    def conv(flat):
        a = np.asarray(flat, float).reshape(-1, 2)
        x, y = to_local(ox + a[:, 0] / s, oy + a[:, 1] / s, *origin)
        return np.stack([x, y], 1)

    rings = [conv(ring) for room in raw['rooms'] for poly in room['rings'] for ring in poly]
    walls = [conv(line) for line in raw['lines'].get('wall', [])]
    return {'id': level_id, 'rings': rings, 'walls': walls}


class LevelRaster:
    """Closeness-to-wall score and inside-a-room mask of a level, on a RES grid."""

    def __init__(self, level: dict, res: float, sigma: float, margin: float = 30):
        self.res = RES = res
        pts = np.concatenate(level['rings'] + level['walls'])
        self.x0, self.y0 = pts.min(0) - margin
        x1, y1 = pts.max(0) + margin
        self.w, self.h = int((x1 - self.x0) / RES) + 1, int((y1 - self.y0) / RES) + 1
        edges = np.zeros((self.h, self.w), np.uint8)
        inside = np.zeros((self.h, self.w), np.uint8)
        for ring in level['rings']:
            px = self.to_px(ring).round().astype(np.int32)
            cv2.polylines(edges, [px], True, 1)
            cv2.fillPoly(inside, [px], 1)
        for line in level['walls']:
            cv2.polylines(edges, [self.to_px(line).round().astype(np.int32)], False, 1)
        dist = cv2.distanceTransform((1 - edges).astype(np.uint8), cv2.DIST_L2, 5) * RES
        self.wall = np.exp(-0.5 * (dist / sigma) ** 2).astype(np.float32)
        # Cameras: inside a room (some slack for the gaps that are walls in the drawing).
        self.inside = cv2.dilate(inside, np.ones((3, 3), np.uint8)).astype(np.float32)

    def to_px(self, xy):
        return np.stack([(xy[:, 0] - self.x0) / self.res, (xy[:, 1] - self.y0) / self.res], 1)

    def sample(self, img, xy):
        px = self.to_px(xy)
        return map_coordinates(img, [px[:, 1], px[:, 0]], order=1, mode='constant', cval=0.0)


def rot(theta):
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, -s], [s, c]])


def fft_search(raster: LevelRaster, pts: np.ndarray, cams: np.ndarray, cam_weight: float, thetas):
    """Best translation per rotation by cross-correlating rasterised points with the score maps."""
    H, W = raster.h, raster.w
    RES = raster.res
    F_wall = np.fft.rfft2(raster.wall, (2 * H, 2 * W))
    F_in = np.fft.rfft2(raster.inside, (2 * H, 2 * W))
    best = []
    for th in thetas:
        R = rot(th)
        out = []
        for xy, F, wgt in ((pts, F_wall, 1.0 / len(pts)), (cams, F_in, cam_weight / len(cams))):
            p = xy @ R.T
            c = p.mean(0)
            q = ((p - c) / RES + [W / 2, H / 2]).round().astype(int)
            ok = (q[:, 0] >= 0) & (q[:, 0] < W) & (q[:, 1] >= 0) & (q[:, 1] < H)
            img = np.zeros((H, W), np.float32)
            np.add.at(img, (q[ok, 1], q[ok, 0]), 1)
            # corr[dy, dx] = sum img[y, x] * map[y + dy, x + dx]
            corr = np.fft.irfft2(F * np.conj(np.fft.rfft2(img, (2 * H, 2 * W))), (2 * H, 2 * W))
            out.append(wgt * corr)
            if xy is pts:
                center = c
        score = out[0] + out[1]
        dy, dx = np.unravel_index(np.argmax(score), score.shape)
        dy = dy - 2 * H if dy >= H else dy
        dx = dx - 2 * W if dx >= W else dx
        # A point at raster pixel (q) lands at map pixel q + d: world = map origin + (q + d) * RES.
        t = np.array([raster.x0 + (dx + W / 2) * RES, raster.y0 + (dy + H / 2) * RES]) - center
        best.append((float(score.max()), th, t))
    return best


def score_fn(raster, pts, cams, cam_weight):
    def f(v):
        th, tx, ty = v
        R = rot(th)
        s = raster.sample(raster.wall, pts @ R.T + [tx, ty]).mean()
        s += cam_weight * raster.sample(raster.inside, cams @ R.T + [tx, ty]).mean()
        return -s
    return f


def floors_of(rec: pycolmap.Reconstruction, min_images=50):
    """Floors as peaks of the camera height histogram (stairs connect them, so no gaps), lowest
    first: (z_cam_peak, ids of the images within 0.8 m of it)."""
    ids = np.array(list(rec.images.keys()))
    z = np.array([rec.images[i].projection_center()[2] for i in ids])
    bins = np.arange(z.min() - 0.5, z.max() + 0.75, 0.25)
    hist, edges = np.histogram(z, bins)
    hist = np.convolve(hist, [1, 2, 1], 'same')
    peaks = []
    for k in np.argsort(-hist):
        zc = edges[k] + 0.125
        if hist[k] < min_images:
            break
        if all(abs(zc - p) > 2.5 for p in peaks):
            peaks.append(zc)
    out = []
    for zc in sorted(peaks):
        sel = np.abs(z - zc) < 0.8
        if sel.sum() >= min_images:
            out.append((float(np.median(z[sel])), ids[sel]))
    return out


def floor_height(zs_points: np.ndarray, z_cam: float) -> float:
    """The floor: the densest point height 0.8-2.2 m below the cameras, else cameras - 1.45 m."""
    sel = zs_points[(zs_points > z_cam - 2.2) & (zs_points < z_cam - 0.8)]
    if len(sel) < 200:
        return z_cam - 1.45
    hist, edges = np.histogram(sel, bins=np.arange(z_cam - 2.2, z_cam - 0.8, 0.05))
    return float(edges[np.argmax(hist)] + 0.025)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('sfm', type=Path)
    p.add_argument('--building', required=True, help='PolyMaps facility, e.g. ETH.HG')
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--plot', type=Path)
    p.add_argument('--cam-weight', type=float, default=0.5)
    p.add_argument('--levels', nargs='*', help='only try these levels for the main floor')
    p.add_argument('--floor-levels', nargs='*', help='level id of each camera-height cluster, lowest first '
                   '(default: consecutive levels around the main one). Clusters are not always floors: HG is '
                   'built on a slope, so its north wing and the street outside are other heights of level E.')
    args = p.parse_args()

    rec = pycolmap.Reconstruction(args.sfm)
    index = json.loads((FLOORS / 'index.json').read_text())
    levels = sorted([lv for lv in index['levels'] if lv['facilityId'] == args.building], key=lambda lv: lv['floor'])
    # Mezzanine variants (HG.EO ...) aren't separate floors.
    levels = [lv for lv in levels if not lv['id'].endswith('O')]
    origin = tuple(json.loads((FLOORS / 'levels' / f"{levels[0]['id']}.json").read_text())['origin'])

    xyz = np.array([p3.xyz for p3 in rec.points3D.values()])
    nobs = np.array([p3.track.length() for p3 in rec.points3D.values()])
    xyz = xyz[nobs >= 3]
    floors = floors_of(rec)
    print('floors (camera height, images):', [(round(z, 2), len(i)) for z, i in floors])
    main_z, main_ids = max(floors, key=lambda f: len(f[1]))
    cams = np.array([rec.images[i].projection_center() for i in main_ids])
    cam_xy = cams[:, :2]
    zf = floor_height(xyz[:, 2], main_z)
    sel = (xyz[:, 2] > zf + 0.3) & (xyz[:, 2] < zf + 2.3)
    # Only points near this floor's cameras (other floors' points can be at the same height range).
    from scipy.spatial import cKDTree
    near = cKDTree(cam_xy).query(xyz[:, :2], distance_upper_bound=12)[0] < 12
    pts = xyz[sel & near, :2]
    rng = np.random.default_rng(0)
    if len(pts) > 30000:
        pts = pts[rng.choice(len(pts), 30000, replace=False)]
    if len(cam_xy) > 3000:
        cam_xy = cam_xy[rng.choice(len(cam_xy), 3000, replace=False)]
    print(f'main floor: cameras at z={main_z:.2f}, floor z={zf:.2f}, {len(pts)} wall points, {len(cam_xy)} cameras')

    candidates = [lv['id'] for lv in levels if not args.levels or lv['id'] in args.levels]
    results = []
    for lid in candidates:
        level = load_level(lid, origin)
        coarse = fft_search(LevelRaster(level, *COARSE), pts, cam_xy, args.cam_weight, np.radians(np.arange(0, 360, 1.0)))
        coarse.sort(key=lambda r: -r[0])
        raster = LevelRaster(level, *FINE)
        f = score_fn(raster, pts, cam_xy, args.cam_weight)
        refined = []
        for s, th, t in coarse[:5]:
            r = minimize(f, [th, *t], method='Nelder-Mead', options={'xatol': 1e-4, 'fatol': 1e-6, 'initial_simplex': None})
            refined.append((-r.fun, r.x))
        refined.sort(key=lambda r: -r[0])
        s, x = refined[0]
        second = next((r for r in coarse if abs(np.angle(np.exp(1j * (r[1] - x[0])))) > np.radians(10)), None)
        print(f'{lid}: score {s:.4f} theta {np.degrees(x[0]) % 360:.2f} t ({x[1]:.2f}, {x[2]:.2f})'
              f'  next-best other rotation {second[0]:.4f} at {np.degrees(second[1]):.0f} deg' if second else '')
        results.append((s, lid, x, raster))
    results.sort(key=lambda r: -r[0])
    s, lid, x, raster = results[0]
    main_index = next(i for i, lv in enumerate(levels) if lv['id'] == lid)
    main_floor_i = next(i for i, f in enumerate(floors) if f[0] == main_z)

    # Other floors by order relative to the main one.
    out_levels = []
    if args.floor_levels:
        assert len(args.floor_levels) == len(floors), f'{len(floors)} clusters'
    for i, (zc, ids) in enumerate(floors):
        if args.floor_levels:
            level_id = args.floor_levels[i]
        else:
            li = main_index + (i - main_floor_i)
            if not 0 <= li < len(levels):
                continue
            level_id = levels[li]['id']
        out_levels.append({'id': level_id, 'z': floor_height(xyz[:, 2], zc), 'cameraZ': zc, 'images': len(ids)})
    geo = {'building': args.building, 'origin': origin, 'theta': float(x[0]), 'tx': float(x[1]), 'ty': float(x[2]),
           'score': float(s), 'levels': out_levels,
           'note': 'world_xy = R(theta) @ lamar_xy + t; z unchanged (LaMAR z is up). Local metres around origin (lng, lat).'}
    args.out.write_text(json.dumps(geo, indent=1))
    print(json.dumps(geo, indent=1))

    if args.plot:
        img = cv2.cvtColor((raster.inside * 60 + 120).astype(np.uint8), cv2.COLOR_GRAY2BGR)
        img[raster.wall > 0.6] = (40, 40, 40)
        R = rot(x[0])
        for xy, col in ((pts @ R.T + x[1:], (0, 0, 255)), (cam_xy @ R.T + x[1:], (255, 120, 0))):
            for q in raster.to_px(xy).round().astype(int):
                if 0 <= q[0] < raster.w and 0 <= q[1] < raster.h:
                    img[q[1], q[0]] = col
        cv2.imwrite(str(args.plot), img[::-1])  # north up


if __name__ == '__main__':
    main()
