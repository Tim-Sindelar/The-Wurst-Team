# polymaps-ar

Indoor positioning on the ETH campus with the PolyMaps Bluetooth beacons, an accuracy test against
GPS, and an AR view that draws the floor plan over the camera image.

```bash
python scraper/scrape_polymaps.py scraper/polymaps_data   # PolyMaps layers (floor plans)
python scraper/extract_floors.py                          # -> occupancy-map-preview/public/floors
python scraper/extract_ips.py                             # -> polymaps-ar/public/ips (downloads the radio map)
cd polymaps-ar && npm install && npm run dev              # https://<your-ip>:5173 (self-signed)
```

`npm test` runs the unit tests, `npm run evaluate -- --simulate [--walk]` the simulated accuracy
benchmark, `npm run evaluate -- session.json` scores an exported field test.

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
  between the 1 Hz fixes. Rotation from `deviceorientationabsolute` (Android) or `deviceorientation`
  plus `webkitCompassHeading` (iOS, after the permission prompt).
- Scene: rooms of the current level on the floor, coloured by use; translucent walls 2.6 m high;
  doors green, stairs yellow; room names as labels.
- The compass is often 10–30° off indoors: drag sideways (or use the slider) until walls line up.
  The FOV slider matches the overlay to the camera's field of view.
- Without motion sensors (desktop) dragging looks around, so the overlay can be checked anywhere.

## Status

Tested in this repo: unit tests, the simulation benchmark, type checking, and the UI in headless
Chromium with a fake camera. **Not yet tested on a phone**: Web Bluetooth scanning of the real
beacons, the device offset range of real phones, compass alignment, and the camera FOV. Next steps,
in order:

1. Field session on an Android phone (Web Bluetooth) in HG: check the beacons are heard and the
   fix is sane, collect a BLE vs GPS session at 20+ checkpoints.
2. A minimal Capacitor/WebView shell for iOS (bridge above).
3. WebXR `immersive-ar` on Android: ARCore tracking between fixes would make the overlay rock
   steady; the beacon fix would then only correct drift and anchor the plan.
