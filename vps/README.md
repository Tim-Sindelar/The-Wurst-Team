# vps — visual positioning for the ETH AR app

The AR app (`polymaps-ar`) knows roughly where it is from the PolyMaps beacons (~1.5 m) but not
which way the phone faces: the indoor compass is often 10–30° off. This service fixes that. The
phone computes SuperPoint features of a camera frame **on the device** and sends only those
(~260 KiB, never the image). The server matches them against a 3D map of ETH and returns the
camera's position and full orientation. The app then corrects its heading and position.

```
phone (browser / Android WebView)                        VM (~/vps, docker)
  camera frame -> SuperPoint (ONNX, onnxruntime-web)       map images near the beacon fix
  keypoints + int8 descriptors + beacon fix  --POST-->     MNN shortlist -> LightGlue -> 2D-3D
                                             <--JSON--     P3P / P4Pf LO-RANSAC + refinement (pycolmap)
  heading offset, position offset, FOV                     -> lng, lat, level, quaternion, heading
```

## Dataset: LaMAR (ETH Zürich + Microsoft, CC BY-SA 4.0)

[LaMAR](https://lamar.ethz.ch) was recorded at ETH with HoloLens 2 headsets and iPhones/iPads over
two years. Its ground-truth poses come from NavVis laser scans. Two of its scenes are on campus:
**HGE** (HG, level E and its surroundings) and **CAB**. Other ETH datasets (ETH3D, LaMAria) are
outdoor-only or don't cover a building, so LaMAR is the only one with posed images inside campus
buildings. The benchmark release (`cvg-data.inf.ethz.ch/lamar/benchmark/{HGE,CAB}.zip`, 7.3 + 6.3 GB)
has a `map` session with posed images and validation queries with ground truth on other days.

## Pipeline (hloc-style, `build_map.py`)

1. map images (HoloLens grey + phone RGB), thinned to one per 0.8 m / 20° per camera stream
   (HGE 12 904, CAB 16 578);
2. SuperPoint (lightglue weights), ≤ 2048 keypoints at ≤ 800 px;
3. pairs from the known poses (≤ 6 m, ≤ 60° apart, 6 per image);
4. mutual-nearest-neighbour matching, then epipolar verification with the known poses (hloc);
   LightGlue is ~100× slower on this machine and not needed when the poses are known;
5. triangulation with fixed poses (pycolmap): HGE 582 k points, CAB 646 k, 1.3 px reprojection error.

## Georeferencing (`georeference.py`)

LaMAR's frame is metric and gravity-aligned but local. The map is placed on the PolyMaps floor plan
(`occupancy-map-preview/public/floors`) by a 2D rigid fit. Points 0.3–2.3 m above the floor
should lie on room outlines and walls, and cameras inside rooms. The fit is an FFT
cross-correlation over all rotations at 0.5 m, refined at 0.1 m. Height clusters of the cameras
are assigned to levels:

| scene | level fit | clusters → levels |
|---|---|---|
| HGE | ETH.HG.E, 197.8° | all ETH.HG.E: HG is on a slope (raised north wing, street outside) |
| CAB | ETH.CAB.E, 126.9° | D (outdoors, street), E, F, G, H |

Check a fit with `tests/plot_overlay.py` (points in red, cameras in blue on the plan).

## Localization (`vps/localizer.py`)

Map images within 12 m (or 3× the beacon accuracy) of the beacon fix on its level → 5 with the most
mutual NN descriptor matches → LightGlue against each → 2D-3D correspondences → P3P with the
app's focal guess, P4Pf only if it explains 30 % more matches (far, flat views trade focal length
against distance) → reject < 50 inliers or > 8 m from the beacon fix.

## Accuracy (`evaluate.py`, LaMAR validation phone queries, 100 each)

Queries go through the app's path: 640 px, 1024 keypoints, int8 wire format, beacon-like prior
(1.6 m mean error), focal guess ±15 %.

| scene | localized | position median / p90 | heading median / p90 | heading > 5° | within 1 m, 5° | server |
|---|---|---|---|---|---|---|
| HGE | 84 % | 0.15 m / 1.8 m | 0.2° / 2.7° | 4 % | 72 % | 1.2 s (4 threads), ~2 s on the VM |
| CAB | 45 % | 0.14 m / 1.2 m | 0.5° / 10° | 7 % | 34 % | 0.5 s |

The CAB queries include hard cases the map can't explain (close-ups of boxes in a storeroom,
dark stairwells). Unlocalized queries return `ok: false` and the app keeps its current heading.

## Files

| file | what |
|---|---|
| `build_map.py` | features, pairs, matching (`--stage match --shard i/n` to split), triangulation |
| `georeference.py` | LaMAR → PolyMaps level + rotation + translation (`--floor-levels` to override) |
| `build_db.py` | server database: triangulated keypoints only, float16 descriptors, world frame (1.4 GB per scene) |
| `evaluate.py` | accuracy on LaMAR validation queries |
| `export_superpoint_onnx.py` | the browser's SuperPoint (`polymaps-ar/public/vps/superpoint.onnx`) |
| `vps/server.py` | FastAPI: `POST /localize` (`vps/protocol.py` wire format), `GET /health` |
| `tests/` | `python -m pytest tests` (wire format, frame conventions), plotting helpers, ONNX fixture |

## Rebuild from scratch

```bash
python -m venv --system-site-packages .venv   # torch with a GPU backend if you have one
.venv/Scripts/pip install -r requirements.txt "hloc @ git+https://github.com/cvg/Hierarchical-Localization" opencv-python-headless onnx onnxruntime tqdm pytest
curl -O https://cvg-data.inf.ethz.ch/lamar/benchmark/HGE.zip   # into data/lamar, unzip
python build_map.py data/lamar/HGE data/maps/HGE --min-dist 0.8 --min-angle 20 --pairs 6
python georeference.py data/maps/HGE/sfm --building ETH.HG --levels ETH.HG.E --floor-levels ETH.HG.E ETH.HG.E ETH.HG.E --out data/maps/HGE/georef.json
python build_db.py data/maps/HGE data/db/HGE.h5 --scene HGE
python evaluate.py data/lamar/HGE data/maps/HGE data/db/HGE.h5
python -m vps.server --db data/db/*.h5        # local; the app's dev server proxies /vps/localize here
```

## Deployment (VM)

`~/vps` holds this directory's `Dockerfile`, `compose.yaml`, `requirements.txt`, `vps/` and
`data/db/*.h5`. Run `docker compose up -d --build` there: CPU torch, port 8090 on localhost, 3 GB
memory limit. `~/router/Caddyfile` forwards `/ar/vps/localize` and `/ar/vps/health` to it.
