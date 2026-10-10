"""Overlay of a georeferenced map's point density (floor at z0..z1) on a PolyMaps level plan.
    python tests/plot_overlay.py <sfm> <georef.json> <level> <z0> <z1> <out.png> [theta_deg tx ty]"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import pycolmap

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from georeference import LevelRaster, load_level, rot  # noqa: E402

sfm, geo_path, level_id, z0, z1, out = sys.argv[1:7]
geo = json.loads(Path(geo_path).read_text())
if len(sys.argv) > 7:
    geo['theta'], geo['tx'], geo['ty'] = np.radians(float(sys.argv[7])), float(sys.argv[8]), float(sys.argv[9])
rec = pycolmap.Reconstruction(sfm)
xyz = np.array([p.xyz for p in rec.points3D.values() if p.track.length() >= 3])
cams = np.array([im.projection_center() for im in rec.images.values()])
xyz = xyz[(xyz[:, 2] > float(z0)) & (xyz[:, 2] < float(z1))]
cams = cams[(cams[:, 2] > float(z0)) & (cams[:, 2] < float(z1))]
R = rot(geo['theta'])
t = np.array([geo['tx'], geo['ty']])
raster = LevelRaster(load_level(level_id, tuple(geo['origin'])), 0.1, 0.3)
img = np.full((raster.h, raster.w, 3), 255, np.uint8)
img[raster.wall > 0.5] = (90, 90, 90)
dens = np.zeros((raster.h, raster.w), np.float32)
q = raster.to_px(xyz[:, :2] @ R.T + t).astype(int)
ok = (q[:, 0] >= 0) & (q[:, 0] < raster.w) & (q[:, 1] >= 0) & (q[:, 1] < raster.h)
np.add.at(dens, (q[ok, 1], q[ok, 0]), 1)
dens = np.clip(dens / 2, 0, 1)
img[dens > 0] = (np.array([0, 0, 255]) * dens[dens > 0, None] + img[dens > 0] * (1 - dens[dens > 0, None])).astype(np.uint8)
for c in raster.to_px(cams[:, :2] @ R.T + t).astype(int):
    cv2.circle(img, tuple(int(v) for v in c), 2, (255, 140, 0), -1)
img = img[::-1]
cv2.imwrite(out, cv2.resize(img, None, fx=0.6, fy=0.6, interpolation=cv2.INTER_AREA))
