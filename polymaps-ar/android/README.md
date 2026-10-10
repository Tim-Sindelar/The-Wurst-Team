# polymaps-ar Android app

The web app in a WebView, plus the beacon scan the browser can't do. Chrome's Web Bluetooth blocklist
strips iBeacon frames (`Add(0x4c, {{0x02, 0xff}})` in Chromium's `bluetooth_blocklist.cc`), so a page
never sees the PolyMaps beacons. This app scans them with Android's BLE scanner and calls
`window.polymapsBeacons([...])` once per second. The page detects `window.PolymapsAndroid` and
preselects the "Native bridge" source.

| File | What |
|---|---|
| `BeaconScanner.java` | BLE scan filtered to the PolyMaps UUID, mean RSSI per beacon per second |
| `MainActivity.java` | WebView, permissions (Nearby devices, Location, Camera), camera and geolocation for the page |
| `NativeSuperPoint.java` | SuperPoint for the page's visual fix (`PolymapsAndroid.superPoint`): ONNX Runtime on NNAPI (GPU / AI unit, fp16) or XNNPACK (4 CPU threads), whichever is faster on the first frame and agrees with the CPU. The WebView itself only has single-threaded WebAssembly (~10 s per frame on a Moto g86) |
| `build.ps1` | Downloads the SDK and Gradle on first run, builds, installs on a USB-debugging phone |

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1                               # opens https://02.hackathon.ethz.ch/ar/
powershell -ExecutionPolicy Bypass -File build.ps1 -AppUrl http://localhost:5444/  # a dev server, via adb reverse tcp:5444 tcp:5444
```

The APK is arm64 only (onnxruntime's native libraries are ~35 MB per ABI); the model is copied from
`../public/vps/superpoint.onnx` at build time. `adb logcat -s SuperPoint` shows the backend timings.

Without USB debugging: the VM serves the latest build at https://02.hackathon.ethz.ch/ar-android.apk
(open it on the phone, allow installing from the browser).

On the phone: Bluetooth and Location must be on. Android hides BLE scan results from apps that use them
for location while Location is off.

Debug builds allow plain HTTP to `localhost` (for the dev server) and enable WebView debugging
(`chrome://inspect`, or `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`).
`gradle.properties` makes Gradle use the Windows certificate store, so downloads work behind antivirus
HTTPS inspection.
