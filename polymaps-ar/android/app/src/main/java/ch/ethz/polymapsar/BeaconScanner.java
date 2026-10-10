package ch.ethz.polymapsar;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Scans for the PolyMaps iBeacons with Android's BLE scanner and hands the page one batch per second:
 * the mean RSSI of every beacon heard since the last batch, as the JSON array that
 * window.polymapsBeacons() expects. Chrome can't do this: its Web Bluetooth blocklist strips
 * iBeacon frames (Apple manufacturer data starting with 0x02).
 */
final class BeaconScanner {
    interface Listener {
        void onBatch(String json, int beacons);

        void onError(String message);
    }

    private static final int APPLE_COMPANY_ID = 0x004C;
    private static final long BATCH_MS = 1000;

    private final Context context;
    private final String uuid;
    private final Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    /** "major:minor" -> {rssi sum, count}. Touched only on the main thread. */
    private final Map<String, int[]> pending = new HashMap<>();
    private BluetoothLeScanner scanner;
    private boolean running;
    private long totalFrames;

    BeaconScanner(Context context, String uuid, Listener listener) {
        this.context = context.getApplicationContext();
        this.uuid = uuid.toUpperCase(Locale.ROOT);
        this.listener = listener;
    }

    long totalFrames() {
        return totalFrames;
    }

    /** Needs BLUETOOTH_SCAN (Android 12+) or location (older); the caller checks. */
    @SuppressLint("MissingPermission")
    boolean start() {
        if (running) return true;
        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null) {
            listener.onError("This phone has no Bluetooth.");
            return false;
        }
        if (!adapter.isEnabled()) {
            listener.onError("Bluetooth is off. Turn it on to see your position.");
            return false;
        }
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            listener.onError("Bluetooth scanner not available.");
            return false;
        }
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .setReportDelay(0)
                .build();
        List<ScanFilter> filters = Collections.singletonList(new ScanFilter.Builder()
                .setManufacturerData(APPLE_COMPANY_ID, iBeaconPrefix(uuid), iBeaconMask())
                .build());
        try {
            scanner.startScan(filters, settings, callback);
        } catch (SecurityException e) {
            listener.onError("Missing Bluetooth permission.");
            return false;
        }
        running = true;
        handler.postDelayed(flush, BATCH_MS);
        return true;
    }

    @SuppressLint("MissingPermission")
    void stop() {
        if (!running) return;
        running = false;
        handler.removeCallbacks(flush);
        try {
            if (scanner != null) scanner.stopScan(callback);
        } catch (SecurityException | IllegalStateException ignored) {
            // Bluetooth turned off or permission revoked meanwhile: the scan is gone anyway.
        }
        pending.clear();
    }

    private final ScanCallback callback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            handle(result);
        }

        @Override
        public void onBatchScanResults(List<ScanResult> results) {
            for (ScanResult r : results) handle(r);
        }

        @Override
        public void onScanFailed(int errorCode) {
            running = false;
            handler.removeCallbacks(flush);
            listener.onError("Bluetooth scan failed (code " + errorCode + "). Restart the app.");
        }
    };

    private void handle(ScanResult result) {
        if (result.getScanRecord() == null) return;
        byte[] d = result.getScanRecord().getManufacturerSpecificData(APPLE_COMPANY_ID);
        // 0x02 0x15 | 16 byte UUID | major | minor | tx power
        if (d == null || d.length < 23 || d[0] != 0x02 || d[1] != 0x15) return;
        int major = ((d[18] & 0xff) << 8) | (d[19] & 0xff);
        int minor = ((d[20] & 0xff) << 8) | (d[21] & 0xff);
        int rssi = result.getRssi();
        handler.post(() -> {
            totalFrames++;
            int[] acc = pending.get(major + ":" + minor);
            if (acc == null) pending.put(major + ":" + minor, new int[]{rssi, 1});
            else {
                acc[0] += rssi;
                acc[1]++;
            }
        });
    }

    private final Runnable flush = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            long now = System.currentTimeMillis();
            List<String> items = new ArrayList<>(pending.size());
            for (Map.Entry<String, int[]> e : pending.entrySet()) {
                String[] mm = e.getKey().split(":");
                double rssi = (double) e.getValue()[0] / e.getValue()[1];
                items.add(String.format(Locale.ROOT,
                        "{\"uuid\":\"%s\",\"major\":%s,\"minor\":%s,\"rssi\":%.1f,\"timestamp\":%d}",
                        uuid, mm[0], mm[1], rssi, now));
            }
            pending.clear();
            listener.onBatch("[" + String.join(",", items) + "]", items.size());
            handler.postAtTime(this, SystemClock.uptimeMillis() + BATCH_MS);
        }
    };

    private static byte[] iBeaconPrefix(String uuid) {
        byte[] data = new byte[23];
        data[0] = 0x02;
        data[1] = 0x15;
        String hex = uuid.replace("-", "");
        for (int i = 0; i < 16; i++) data[2 + i] = (byte) Integer.parseInt(hex.substring(2 * i, 2 * i + 2), 16);
        return data;
    }

    /** Match type, length and UUID; any major, minor and tx power. */
    private static byte[] iBeaconMask() {
        byte[] mask = new byte[23];
        for (int i = 0; i < 18; i++) mask[i] = (byte) 0xff;
        return mask;
    }
}
