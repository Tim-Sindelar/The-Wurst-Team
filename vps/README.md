# vps — visual positioning for the ETH AR app

The AR app (`polymaps-ar`) knows roughly where it is from the PolyMaps beacons (~1.5 m) but not
which way the phone faces: the indoor compass is often 10–30° off. This service fixes that. The
phone computes SuperPoint features of a camera frame **on the device** and sends only those
(~260 KiB, never the image outside debug mode). The server matches them against a 3D map of ETH and returns the
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
against distance) → reject < 50 inliers or > 8 m from the beacon fix. 30–49 inliers are accepted only
if the pose agrees with the phone's own orientation (heading within 20°, pitch and roll from gravity
within 6°, camera 0.5–2.3 m above the floor, focal length within 20 % of the phone's guess): wrong
poses from few matches are far off, right ones in places that changed since the map agree. On the
validation queries with a σ 12° compass this added 4 CAB fixes (all within 1.5 m and 6.1°) and none
in HG. A beacon floor that isn't mapped (HG J) is answered at once.

## Accuracy (`evaluate.py`, LaMAR validation phone queries, 100 each)

Queries go through the app's path: 640 px, 1024 keypoints, int8 wire format, beacon-like prior
(1.6 m mean error), focal guess ±15 %.

| scene | localized | position median / p90 | heading median / p90 | heading > 5° | within 1 m, 5° | server |
|---|---|---|---|---|---|---|
| HGE | 84 % | 0.15 m / 1.8 m | 0.2° / 2.7° | 4 % | 72 % | 1.2 s (4 threads), ~2 s on the VM |
| CAB | 45 % | 0.14 m / 1.2 m | 0.5° / 10° | 7 % | 34 % | 0.5 s |

The CAB queries include hard cases the map can't explain (close-ups of boxes in a storeroom,
dark stairwells). Unlocalized queries return `ok: false` and the app keeps its current heading.

## Debug mode

Tick **debug** in the AR view (or open it with `?vpsDebug=1`; the choice is remembered). Each visual
fix then:

- **on the phone** shows the grey 640 px frame SuperPoint actually ran on, with all keypoints
  (yellow), the ones matched to 3D map points (orange rings), the pose's inliers (green) and blue
  lines to where the pose reprojects their 3D points. Below that: the shortlist (mutual-NN / LightGlue /
  2D-3D matches per map image), both solvers' inliers and FOV, reprojection error, distance of the
  pose to the beacon fix (also for rejected poses), visual vs. AR heading, image brightness /
  sharpness, keypoint coverage, how fast the phone was turning, timings, and hints on the likely
  cause. ‹ › browse the last 12 attempts.
- **on the server** stores a bundle under `~/vps/debug/<id>/` (newest 300 kept):
  `request.bin` (the features as received), `server.json` (answer + every intermediate step:
  candidate images and distances, shortlist, matched / inlier keypoints, solver results, pose),
  `frame.png` (the exact network input, lossless) and `client.json` (beacon fix and its age,
  orientation at capture: rendered quaternion, heading, pitch, sensor reading, heading offset,
  compass lock, angular speed; video / view size, FOV setting, focal guess, camera track settings;
  ONNX backend and timings; image and keypoint statistics; what the app applied).

Unlike normal use, debug mode uploads the frame (~300 KiB PNG + the usual ~260 KiB features).

```bash
scp -r viscon-vm:~/vps/debug data/                   # fetch
python debug_replay.py data/debug --summary          # one line per attempt: result, inliers, heading error, image quality...
python debug_replay.py data/debug/<id> --db data/db/*.h5 --images data/lamar/HGE/sessions/map/raw_data data/lamar/CAB/sessions/map/raw_data
```

A replay re-runs the localizer on the phone's features (try config changes), runs the reference
PyTorch SuperPoint on `frame.png` and compares it with the phone's features (share of the same
keypoints, descriptor cosine: catches NNAPI / WebGPU precision problems and image layout bugs),
localizes with the reference features too, and writes `replay.png`: the annotated frame, a top
view (floor plan, map cameras near the beacon fix, shortlist, beacon fix with the phone's heading,
visual pose) and the shortlisted map images.

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
