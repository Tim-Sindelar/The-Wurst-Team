package ch.ethz.polymapsar;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.Log;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import java.util.ArrayList;
import java.util.List;

/**
 * The web app in a WebView, plus the native beacon scan it can't do itself. The page sees
 * window.PolymapsAndroid (so its "Native bridge" source is available and preselected) and receives
 * window.polymapsBeacons([...]) once per second while the app is in the foreground.
 */
public class MainActivity extends Activity implements BeaconScanner.Listener {
    /** PolyMaps' iBeacon UUID (all ~12 000 beacons share it). */
    private static final String POLYMAPS_UUID = "58793564-459C-548D-BFCC-367FFD4FCD70";
    private static final int REQUEST_PERMISSIONS = 1;

    private WebView webView;
    private BeaconScanner scanner;
    private PermissionRequest pendingCameraRequest;
    private String lastError;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        WebView.setWebContentsDebuggingEnabled(true);
        webView = new WebView(this);
        // Edge-to-edge is enforced from Android 15: keep the page clear of the status and nav bars.
        // The padding goes on a container: a WebView ignores its own padding.
        FrameLayout root = new FrameLayout(this);
        root.addView(webView, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 30) root.setOnApplyWindowInsetsListener((v, insets) -> {
            int types = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout();
            android.graphics.Insets bars = insets.getInsets(types);
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " PolymapsAR/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new Bridge(), "PolymapsAndroid");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> grantCamera(request));
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, has(Manifest.permission.ACCESS_FINE_LOCATION), false);
            }
        });

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, () -> {
                if (webView.canGoBack()) webView.goBack();
                else finish();
            });
        }

        scanner = new BeaconScanner(this, POLYMAPS_UUID, this);
        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl(BuildConfig.APP_URL);
        requestMissingPermissions();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        startScan();
    }

    @Override
    protected void onPause() {
        scanner.stop();
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        scanner.stop();
        webView.destroy();
        super.onDestroy();
    }

    // --- permissions -------------------------------------------------------------------------

    private boolean has(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private String[] scanPermissions() {
        return Build.VERSION.SDK_INT >= 31
                ? new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.ACCESS_FINE_LOCATION}
                : new String[]{Manifest.permission.ACCESS_FINE_LOCATION};
    }

    private void requestMissingPermissions() {
        List<String> missing = new ArrayList<>();
        for (String p : scanPermissions()) if (!has(p)) missing.add(p);
        if (!has(Manifest.permission.CAMERA)) missing.add(Manifest.permission.CAMERA);
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), REQUEST_PERMISSIONS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        startScan();
        if (pendingCameraRequest != null) {
            PermissionRequest r = pendingCameraRequest;
            pendingCameraRequest = null;
            if (has(Manifest.permission.CAMERA)) r.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else r.deny();
        }
    }

    private void grantCamera(PermissionRequest request) {
        boolean wantsVideo = false;
        for (String r : request.getResources()) wantsVideo |= PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r);
        if (!wantsVideo) {
            request.deny();
        } else if (has(Manifest.permission.CAMERA)) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            pendingCameraRequest = request;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQUEST_PERMISSIONS);
        }
    }

    // --- beacon scan -------------------------------------------------------------------------

    private void startScan() {
        for (String p : scanPermissions()) {
            if (!has(p)) {
                onError("Allow \"Nearby devices\" and \"Location\" for PolyMaps AR to see your position.");
                return;
            }
        }
        LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (lm != null && !lm.isLocationEnabled()) {
            // Android delivers no BLE scan results to apps that use them for location while it's off.
            onError("Turn on Location: Android hides Bluetooth beacons from apps while it is off.");
        }
        if (scanner.start()) lastError = null;
    }

    @Override
    public void onBatch(String json, int beacons) {
        if (BuildConfig.DEBUG && beacons > 0) Log.d("PolymapsAR", beacons + " beacons: " + json);
        webView.evaluateJavascript("window.polymapsBeacons && window.polymapsBeacons(" + json + ")", null);
    }

    @Override
    public void onError(String message) {
        if (message.equals(lastError)) return;
        lastError = message;
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    /** window.PolymapsAndroid in the page. Called on a WebView background thread. */
    private final class Bridge {
        @JavascriptInterface
        public String status() {
            return lastError == null ? "scanning, " + scanner.totalFrames() + " beacon frames so far" : lastError;
        }
    }
}
