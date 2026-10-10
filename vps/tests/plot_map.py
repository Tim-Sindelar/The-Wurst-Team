"""Top view of a triangulated map: points (by floor) and camera positions, for checking georeferencing."""
import sys
import cv2
import numpy as np
import pycolmap

rec = pycolmap.Reconstruction(sys.argv[1])
out = sys.argv[2]
zlo, zhi = float(sys.argv[3]), float(sys.argv[4])
xyz = np.array([p.xyz for p in rec.points3D.values() if p.track.length() >= 3])
cams = np.array([im.projection_center() for im in rec.images.values()])
sel = (xyz[:, 2] > zlo) & (xyz[:, 2] < zhi)
csel = (cams[:, 2] > zlo) & (cams[:, 2] < zhi)
res = 0.1
lo = cams[:, :2].min(0) - 15
hi = cams[:, :2].max(0) + 15
W, H = ((hi - lo) / res).astype(int) + 1
img = np.zeros((H, W), np.float32)
q = ((xyz[sel, :2] - lo) / res).astype(int)
ok = (q[:, 0] >= 0) & (q[:, 0] < W) & (q[:, 1] >= 0) & (q[:, 1] < H)
np.add.at(img, (q[ok, 1], q[ok, 0]), 1)
img = np.clip(img / 3, 0, 1)
rgb = cv2.cvtColor((255 - img * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
for c in ((cams[csel, :2] - lo) / res).astype(int):
    cv2.circle(rgb, tuple(int(v) for v in c), 2, (255, 120, 0), -1)
cv2.imwrite(out, cv2.resize(rgb[::-1], None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA))
print('extent', lo, hi)
