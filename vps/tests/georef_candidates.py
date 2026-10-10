"""Top rotation candidates of the georeferencing search for one level, as overlay images."""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pycolmap
from scipy.optimize import minimize
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from georeference import COARSE, FINE, LevelRaster, fft_search, floor_height, floors_of, load_level, score_fn  # noqa

sfm, level_id, origin_json, out_dir = sys.argv[1], sys.argv[2], sys.argv[3], Path(sys.argv[4])
origin = tuple(json.loads(origin_json))
rec = pycolmap.Reconstruction(sfm)
xyz = np.array([p.xyz for p in rec.points3D.values() if p.track.length() >= 3])
floors = floors_of(rec)
zc, ids = max(floors, key=lambda f: len(f[1]))
cams = np.array([rec.images[i].projection_center() for i in ids])[:, :2]
zf = floor_height(xyz[:, 2], zc)
near = cKDTree(cams).query(xyz[:, :2], distance_upper_bound=12)[0] < 12
pts = xyz[(xyz[:, 2] > zf + 0.3) & (xyz[:, 2] < zf + 2.3) & near, :2]
rng = np.random.default_rng(0)
pts = pts[rng.choice(len(pts), min(30000, len(pts)), replace=False)]
cams = cams[rng.choice(len(cams), min(3000, len(cams)), replace=False)]
level = load_level(level_id, origin)
coarse = fft_search(LevelRaster(level, *COARSE), pts, cams, 0.5, np.radians(np.arange(0, 360, 1.0)))
# local maxima over rotation
sc = np.array([c[0] for c in coarse])
peaks = [i for i in range(360) if sc[i] >= sc[(i - 1) % 360] and sc[i] >= sc[(i + 1) % 360]]
peaks.sort(key=lambda i: -sc[i])
fine = LevelRaster(level, *FINE)
f = score_fn(fine, pts, cams, 0.5)
out_dir.mkdir(exist_ok=True, parents=True)
for k, i in enumerate(peaks[:5]):
    s, th, t = coarse[i]
    r = minimize(f, [th, *t], method='Nelder-Mead', options={'xatol': 1e-4, 'fatol': 1e-6})
    print(k, f'coarse {s:.3f} at {np.degrees(th):.0f}  refined {-r.fun:.4f} theta {np.degrees(r.x[0]) % 360:.2f} t {r.x[1]:.2f} {r.x[2]:.2f}', flush=True)
    geo = {'origin': origin, 'theta': float(r.x[0]), 'tx': float(r.x[1]), 'ty': float(r.x[2])}
    (out_dir / f'cand{k}.json').write_text(json.dumps(geo))
    subprocess.run([sys.executable, str(Path(__file__).parent / 'plot_overlay.py'), sfm, str(out_dir / f'cand{k}.json'), level_id,
                    str(zf + 0.3), str(zf + 2.3), str(out_dir / f'cand{k}.png')])
