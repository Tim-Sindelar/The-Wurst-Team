# polymaps-ar

Indoor positioning on the ETH campus with the PolyMaps Bluetooth beacons, an accuracy test against
GPS, indoor routing to rooms, and an AR view that draws the floor plan and the route over the camera
image.

```bash
python scraper/scrape_polymaps.py scraper/polymaps_data   # PolyMaps layers (floor plans, walkways)
python scraper/extract_floors.py                          # -> occupancy-map-preview/public/floors
python scraper/extract_ips.py                             # -> polymaps-ar/public/ips (downloads the radio map)
python scraper/pathfinding/build_navigation.py            # -> polymaps-ar/public/nav (~1.5 min; numpy pillow scipy shapely)
cd polymaps-ar && npm install && npm run dev              # https://<your-ip>:5443 (self-signed)
```

| command | what |
|---|---|
| `npm test` | unit tests |
| `npm run evaluate -- --simulate [--walk]` | simulated positioning accuracy |
| `npm run evaluate -- session.json` | score an exported field test (BLE vs GPS) |
| `npm run route -- "HG E 41" "CAB G 61"` | route between two rooms on the command line |
| `npm run validate-routes [-- --rooms]` | compare routes with PolyMaps' walkway network / room-to-room success rate |

## Where PolyMaps' position comes from

[PolyMaps](https://ethz.ch/de/die-eth-zuerich/organisation/abteilungen/engineering-und-systeme/polymaps.html)
is ArcGIS Indoors. Its web viewer (`arcgis-prd-web.ethz.ch/portal/apps/indoors`) has no positioning
of its own: its "Bluedot" module only calls `navigator.geolocation.watchPosition` with
`{enableHighAccuracy: true, maximumAge: 0, timeout: 15000}`, finds the building whose footprint
contains the point, takes the floor from the non-standard `coords.floorLevel` (iOS) via the level's
vertical order, and draws an accuracy circle. It is even switched off for ETH
(`indoorPositioning.iOS: false`). That module is ported as-is in
`src/positioning/sources/geolocation.ts` and is the **GPS** side of the comparison.

The blue dot in the ETH App comes from ArcGIS IPS: ~12 000 iBeacons
(UUID `58793564-459C-548D-BFCC-367FFD4FCD70`) matched against a radio map, inside the native app.
The SDK is closed, but its input is public: the `IPS_Positioning` table of the `EGDB_IPS` feature
service has the radio map as an attachment, a SQLite database (named `.zip`) with ~136 000 points
on a 0.75 m grid along all corridors and stairs, each with the mean and variance of the RSSI of
every beacon heard there. `scraper/extract_ips.py`

- downloads it (~140 MB),
- converts its local millimetre frame to WGS84. The frame is "y mm due south of an origin in Basel,
  then x mm due east" on great circles, plus a small linear correction fitted against the
  `IPS_Recordings` survey lines: afterwards every recording vertex lies within 1 m of a fingerprint
  (median 0.56 m = the grid spacing),
- assigns each point to a PolyMaps `LEVEL_ID`. The radio map's floor numbers are PolyMaps' vertical
  orders: 99.4 % of the points fall inside a level outline with the same vertical order,
- writes 28 binary tiles (~18 MB) plus an index with every beacon's major/minor and rough position.

## BLE positioning (`src/positioning`)

The algorithm is not Esri's (that's in the closed SDK); it is a standard probabilistic fingerprinting
on Esri's radio map:

0. **Decoding the radio map** (`radioMap.ts`): the stored (mean, variance) per beacon and point mix
   scans that heard the beacon with scans that didn't, recorded at a floor value. Weak beacons have
   huge variances, capped at exactly 550 dB², which is m²/4 for a 50/50 mix of two values m apart.
   Each entry is decoded as such a mixture (floor −120 dBm, 4 dB spread when heard) into a
   **detection probability** and a **mean when heard**. Taking the raw mean ± std at face value
   biased the device calibration by 10–30 dB.
1. **Scan** (`engine.ts`): mean RSSI per PolyMaps beacon over the last 2 s.
2. **Candidates**: radio map points within 45 m of the strongest beacons that agree on a location.
   32 beacon ids are heard in two buildings, so one beacon alone can't place the search.
3. **Likelihood** (`fingerprint.ts`): per point,
   `Σ heard [log P(heard) + log N(rssi + offset; μ_heard, 5 dB)] + Σ not heard log P(missed)`,
   plus a penalty for heard beacons the point doesn't know.
4. **Estimate**: the likelihood-weighted mean of the best 10 points on the most likely floor.
5. **Device calibration**: phones' RSSI differs by up to ±15 dB, so the offset with the highest
   likelihood is estimated each scan and smoothed (simulation: −6 dB is found within ~5 s).
6. **Track** (`tracker.ts`): Kalman filter (random walk at 4 m/s, tuned in simulation), 3σ outlier
   gate, floor change only after 2 consistent scans.

Beacon sources (`src/positioning/sources`):

| Source | Works on | Notes |
|---|---|---|
| Web Bluetooth | Chrome Android, flag `chrome://flags/#enable-experimental-web-platform-features`, HTTPS | `navigator.bluetooth.requestLEScan`, iBeacon frames parsed from the Apple manufacturer data |
| Native bridge | any phone, with a small native shell | the shell ranges the UUID and calls `window.polymapsBeacons([{uuid, major, minor, rssi}])` |
| Simulation | anywhere | draws readings from the radio map with device offset, slow per-beacon bias, noise and dropouts |

iOS browsers can't scan Bluetooth at all. On iOS the native shell is a few lines of CoreLocation:

```swift
let constraint = CLBeaconIdentityConstraint(uuid: UUID(uuidString: "58793564-459C-548D-BFCC-367FFD4FCD70")!)
locationManager.startRangingBeacons(satisfying: constraint)
// locationManager(_:didRange:satisfying:) ->
webView.evaluateJavaScript("window.polymapsBeacons(\(json))")   // [{uuid, major, minor, rssi}]
```

and set `window.polymapsNativeBridge = true` from a user script so the page detects it.

## Accuracy test: BLE vs GPS (`src/evaluation`)

In the app's **Accuracy test** tab: start BLE and GPS, stand at a recognizable spot, tap it on the
plan (that's the ground truth, including the floor), press *Measure* (30 s). Repeat at many spots.
Every fix of both methods is logged. `sessionSamples()` samples each method once per second inside
each window (after a 3 s warm-up; a fix older than 3 s counts as *no fix*), and the same
`evaluate()` computes for both:

- availability, median / mean / 68 / 90 / 95 % / max horizontal error, RMSE,
- floor hit rate (GPS reports no floor, so it shows *no floor*),
- calibration: the share of fixes within their own reported accuracy (68 % if honest).

Sessions export as JSON; `npm run evaluate -- session.json` gives the same table offline.

**Simulated results** (`npm run evaluate -- --simulate`). Scans are drawn from the decoded radio map
with a −6 dB device offset, a ±6 dB slowly varying per-beacon bias, 4 dB reading noise, and a phone
that hears beacons 30 % less often than the survey device. The simulation uses the locator's own
model of the world, so these are an **upper bound, not a field result**:

| scenario (tracked fix) | median | p90 | max | floor right | within reported ± |
|---|---|---|---|---|---|
| standing, 150 random points | 0.8 m | 2.8 m | 8.1 m | 99 % | 95 % |
| walking 1.2 m/s, 50 walks | 2.3 m | 4.0 m | 11.9 m | 100 % | 80 % |

ETH quotes about 5 m for PolyMaps in practice; expect field errors in that range (the radio map is
interpolated, bodies and crowds attenuate, and phones differ in more than a constant offset). Indoor GPS typically gives 10–50 m or no fix, but
only a field session can tell; the app's *GPS simulation* is synthetic and only there to exercise
the comparison.

## AR view (`src/ar`)

- Camera feed (`getUserMedia`, back camera) with a transparent three.js canvas on top.
- Camera pose: position from the current fix (BLE, else GPS), 1.5 m above the floor, gliding
  between the 1 Hz fixes. Rotation: the gyro-based `deviceorientation` stream, with its heading
  slowly pulled to the compass (`deviceorientationabsolute` on Android, `webkitCompassHeading` on
  iOS) and its roll and pitch pulled to gravity from the accelerometer whenever the phone is held
  still (`TiltCorrection`: Android's own fusion leaves the tilt degrees off for a long time after
  a turn).
- Scene: rooms of the current level on the floor, coloured by use; translucent walls 2.6 m high;
  doors green, stairs yellow; room names as labels.
- The compass is often 10–30° off indoors: drag sideways (or use the slider) until walls line up.
  The FOV slider matches the overlay to the camera's field of view.
- Without motion sensors (desktop) dragging looks around, so the overlay can be checked anywhere.

### Visual fix (`src/vps`, server in `../vps`)

**Localize visually** (or **auto**, every 3 s) runs SuperPoint on the current camera frame in the
browser (`public/vps/superpoint.onnx`, onnxruntime-web, WebGPU or WASM). It posts only the features
(~260 KiB, never the image outside debug mode), together with the beacon fix, to `vps/localize`. The server matches
them against LaMAR's 3D maps of HG E and CAB and returns the camera pose. The app then:

- turns the heading so the rendered camera faces the visual one, and locks out the compass
  (validation: median heading error 0.2° in HG, see `../vps/README.md`);
- shifts beacon positions by the visual offset (full strength for 15 s, then fading over 30 s);
- trusts the visual floor for 20 s;
- sets the FOV slider from the refined focal length.

In WebXR the camera belongs to ARCore. A visual fix taken before starting WebXR carries over,
because the heading stays locked. `?camera=<image url>` uses a photo instead of the camera, to test
on a desktop. The dev server proxies `/vps/localize` to `VPS_URL` (default `http://127.0.0.1:8090`).

**debug** (or `?vpsDebug=1`) shows each attempt's frame with its keypoints, matches and inliers and
the numbers behind a failure, and uploads frame + context to the server for `../vps/debug_replay.py`
(see "Debug mode" in `../vps/README.md`).

## Pathfinding (`scraper/pathfinding`, `src/pathfinding`)

Routes go to a room (search by name, e.g. `HG E 41`) or a tapped point, from the live BLE position
or a picked start, across floors and buildings. The Map tab draws the route of the floor shown and
where it changes floor; the AR view lays it on the floor as a ribbon with chevrons.

**Walkable space from the drawing** (`build_navigation.py`, 0.25 m grid per floor). PolyMaps draws
rooms as polygons usually separated by a wall-thick gap, so most walls are implicit; corridors are
several touching polygons; explicit wall lines exist mostly on façades; doors are leaf + swing-arc
symbols spanning the gaps. A cell is walkable if it is inside a room, minus the outlines of closed
rooms and explicit walls, plus door openings: around each door symbol, the gap cells and the outlines
of the rooms that door serves (only those, so a door next to a corner doesn't open the room around it).

**Which rooms are drawn properly** is decided per room, and written to `public/nav/report.json`:

| status | meaning | handling |
|---|---|---|
| ok | reachable through its doors | — |
| open-area | no door, touches a corridor over > 2 m (study spots, exhibition areas in halls) | treated as open space (never for technical rooms, cupboards, labs) |
| door-widened | has a door symbol that doesn't reach across the gap | opening widened from 0.6 to 1.2 m |
| no-door / cut-off | no door symbol / still unreachable (mostly shafts, plant and storage rooms) | routes lead to the nearest reachable cell within 3 m (its doorstep) |
| tiny | < 1.5 m² | ignored |

Of 32 104 rooms: 25 486 ok, 205 open areas, 683 widened doors, 2 022 without a door, 575 cut off, 3 133 tiny.

Two kinds of gaps the drawing can't fill are repaired from PolyMaps' walkway network (the lines
ArcGIS Indoors routes on; `NAV_NETWORK=0` disables it): halls and atria that have walls but no room
polygon (the walkways through them are widened, only inside wide room-free space, never across thin
wall gaps), and floor connections and bridges / tunnels between buildings where a stair, lift or
cross-building walkway ends on two floors.

**Floor changes**: stair rooms of consecutive floors whose footprints overlap ≥ 1 m², linked at the
overlap (not at one representative cell, which let routes "teleport" across a floor through a big
stair hall); stairs arriving in undrawn space; lifts between any two floors of a shaft. **Between
buildings**: entrance rooms and façade doors near the ground, linked through outdoors (straight
line × 1.2), plus indoor passages from the walkway network.

**Search** (`astar.ts`): A* over the grids of the start and goal buildings at once, 8-neighbour moves,
stair / lift / passage / outdoor links (stairs 15 m-equivalent per flight, lifts 30 m). Walking
through a closed room costs 5× (except the start and goal rooms): PolyMaps' walkways only enter rooms
on spurs from their doors, and a meeting room with two doors is not a corridor. The cell path is
straightened by string pulling with line of sight that, between corridor cells, may not cross rooms.

**Validation** against PolyMaps' walkway network (`npm run validate-routes`), 400 random pairs of
walkway nodes in corridors on the same floor, 165 floors: all routed; for routes that stay on the
floor, our length is within ±20 % of the network's shortest path for 82 %, median ratio 0.91 (ours
cuts corners, the network follows centre lines). Of the 6 % where ours is much shorter, the cases
inspected were gaps in the reference network (walkway lines that don't meet) rather than leaks.
Room-to-room (`-- --rooms`): 91 % routed within a building (~20 ms each), 83 % between nearby
buildings (~100 ms). Failures are floors the drawing doesn't connect at all: mezzanines and plant
floors in 20 of 46 buildings, and the rented OAT tower floors (no stairs or lifts drawn).

## Status

Tested in this repo: unit tests, the simulation benchmark, the routing validation, type checking,
and the UI in headless Chromium with a fake camera. **Not yet tested on a phone**: Web Bluetooth scanning of the real
beacons, the device offset range of real phones, compass alignment, and the camera FOV. Next steps,
in order:

1. Field session on an Android phone (Web Bluetooth) in HG: check the beacons are heard and the
   fix is sane, collect a BLE vs GPS session at 20+ checkpoints.
2. A minimal Capacitor/WebView shell for iOS (bridge above).
3. WebXR `immersive-ar` on Android: ARCore tracking between fixes would make the overlay rock
   steady; the beacon fix would then only correct drift and anchor the plan.
