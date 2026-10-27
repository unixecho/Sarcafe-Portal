package il.co.sarcafe.kiosk;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.security.MessageDigest;

/**
 * Full-screen WebView kiosk. Loads the bundled page (or an https URL set over adb), hides the system
 * bars, and, once provisioned as device owner, locks the tablet to this app.
 *
 * Configure over adb (needs the cable, so staff cannot do it by accident):
 *   adb shell am start -n il.co.sarcafe.kiosk/.MainActivity --es url https://example.com/kiosk
 *   adb shell am start -n il.co.sarcafe.kiosk/.MainActivity --es url asset     (back to the bundled page)
 *   adb shell am start -n il.co.sarcafe.kiosk/.MainActivity --es pin 123456    (staff PIN, 4-8 digits)
 *   adb shell am start -n il.co.sarcafe.kiosk/.MainActivity --es orient portrait   (auto | portrait | landscape)
 * Staff menu: tap the top-left corner 5 times quickly, then enter the PIN.
 */
public class MainActivity extends Activity {
    static final String ASSET_URL = "file:///android_asset/index.html";
    static final String HOME_ALIAS = "il.co.sarcafe.kiosk.HomeAlias";
    static final long STAFF_WINDOW_MS = 5 * 60 * 1000L;
    static final long RETRY_MS = 10 * 1000L;

    static final String OFFLINE_HTML =
        "<html dir='rtl' lang='he'><body style='margin:0;background:#171813;color:#f4efe4;"
        + "font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"
        + "text-align:center'><div><h1>אין חיבור לאינטרנט</h1><p>מנסים שוב אוטומטית…</p></div></body></html>";

    private WebView web;
    private SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private String currentUrl = ASSET_URL;
    private int cornerTaps;
    private long firstTapAt;
    private long staffUntil;

    private final Runnable retry = new Runnable() {
        @Override public void run() {
            if (web != null) web.loadUrl(currentUrl);
        }
    };
    private final Runnable relock = new Runnable() {
        @Override public void run() {
            staffUntil = 0;
            lockIfPermitted();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("kiosk", MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        applyIntentConfig(getIntent());
        applyOrientation();

        web = new WebView(this);
        configureWebView();
        // A WebView's own touch listener never fires (its child view consumes the touch), so the staff-corner
        // taps are watched one level up, before the touch reaches the page; the page still gets every touch.
        FrameLayout root = new FrameLayout(this) {
            @Override public boolean dispatchTouchEvent(MotionEvent e) {
                if (e.getActionMasked() == MotionEvent.ACTION_UP) {
                    float lim = 96 * getResources().getDisplayMetrics().density;
                    if (e.getX() < lim && e.getY() < lim) cornerTap();
                }
                return super.dispatchTouchEvent(e);
            }
        };
        root.addView(web, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        applyDeviceOwnerPolicies();
        load();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (applyIntentConfig(intent)) load();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (System.currentTimeMillis() >= staffUntil) lockIfPermitted();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    public void onBackPressed() {
        // swallowed: customers must not leave the page
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // ---- configuration over adb ------------------------------------------------------------

    private boolean applyIntentConfig(Intent intent) {
        if (intent == null) return false;
        boolean changed = false;
        String url = intent.getStringExtra("url");
        if (url != null) {
            if (url.equals("asset")) {
                prefs.edit().remove("url").apply();
                changed = true;
            } else if (url.startsWith("https://")) {
                prefs.edit().putString("url", url).apply();
                changed = true;
            }
        }
        String orient = intent.getStringExtra("orient"); // auto|portrait|landscape
        if (orient != null && orient.matches("auto|portrait|landscape")) {
            prefs.edit().putString("orient", orient).apply();
            applyOrientation();
        }
        String debug = intent.getStringExtra("debug"); // on|off: Chrome remote debugging over the cable
        if (debug != null) prefs.edit().putBoolean("debug", debug.equals("on")).apply();
        String pin = intent.getStringExtra("pin");
        if (pin != null && pin.matches("\\d{4,8}")) {
            prefs.edit().putString("pin_hash", hash(pin)).apply();
        }
        // menu-update channel (empty value removes it); the page reads these through SarcafeKiosk.config()
        changed |= setSyncPref(intent, "api", "https://");     // snapshot endpoint the page fetches when told to
        changed |= setSyncPref(intent, "rt", "https://");      // realtime server base address
        changed |= setSyncPref(intent, "rt_key", "");           // its public (anon) key
        String channel = intent.getStringExtra("rt_channel");
        if (channel != null && channel.matches("[A-Za-z0-9:_-]{1,64}")) {
            prefs.edit().putString("rt_channel", channel).apply();
            changed = true;
        }
        return changed;
    }

    private boolean setSyncPref(Intent intent, String key, String requiredPrefix) {
        String value = intent.getStringExtra(key);
        if (value == null) return false;
        if (value.isEmpty()) {
            prefs.edit().remove(key).apply();
            return true;
        }
        if (!value.startsWith(requiredPrefix) || value.length() > 400) return false;
        prefs.edit().putString(key, value).apply();
        return true;
    }

    /** What the bundled page may know about the menu-update channel. None of it is secret (public key only). */
    private String syncConfigJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("api", prefs.getString("api", ""));
            o.put("rt", prefs.getString("rt", ""));
            o.put("rtKey", prefs.getString("rt_key", ""));
            o.put("rtChannel", prefs.getString("rt_channel", "menu:givat-haviva") /* the dashboard's own menu channel */);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** auto follows the sensor (both orientations); portrait/landscape pin the tablet to one of them. */
    private void applyOrientation() {
        String o = prefs.getString("orient", "auto");
        setRequestedOrientation(o.equals("portrait") ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            : o.equals("landscape") ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            : ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
    }

    private static String hash(String pin) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(("sarcafe-kiosk:" + pin).getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    // ---- web view --------------------------------------------------------------------------

    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(prefs.getBoolean("debug", false));
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public String config() { return syncConfigJson(); }
        }, "SarcafeKiosk");
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true); // needed for the bundled page; file URLs may not reach other files
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        web.setBackgroundColor(Color.parseColor("#171813"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHapticFeedbackEnabled(false);
        web.setLongClickable(false);
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { return true; }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("file".equals(u.getScheme()) && u.toString().startsWith("file:///android_asset/")) return false;
                Uri home = Uri.parse(currentUrl);
                if ("https".equals(u.getScheme()) && home.getHost() != null && home.getHost().equals(u.getHost())) {
                    return false;
                }
                return true; // anything else is blocked
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                recreate();
                return true;
            }
        });
    }

    private void load() {
        String saved = prefs.getString("url", null);
        currentUrl = saved != null ? saved : ASSET_URL;
        ui.removeCallbacks(retry);
        web.loadUrl(currentUrl);
    }

    private void showOffline() {
        web.loadDataWithBaseURL(null, OFFLINE_HTML, "text/html", "utf-8", null);
        ui.removeCallbacks(retry);
        ui.postDelayed(retry, RETRY_MS);
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    // ---- device owner / lock task ----------------------------------------------------------

    private DevicePolicyManager dpm() {
        return (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
    }

    private void applyDeviceOwnerPolicies() {
        DevicePolicyManager dpm = dpm();
        if (!dpm.isDeviceOwnerApp(getPackageName())) return;
        ComponentName admin = new ComponentName(this, KioskAdminReceiver.class);
        try {
            dpm.setLockTaskPackages(admin, new String[] { getPackageName() });
            dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
        } catch (Exception ignored) { }
        try { dpm.setKeyguardDisabled(admin, true); } catch (Exception ignored) { }
        try { dpm.setStatusBarDisabled(admin, true); } catch (Exception ignored) { }
        try { dpm.setGlobalSetting(admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "7"); } catch (Exception ignored) { }
        try {
            // become the home screen so the kiosk is what appears after boot or after "home"
            setHomeAliasEnabled(true);
            dpm.clearPackagePersistentPreferredActivities(admin, getPackageName());
            IntentFilter home = new IntentFilter(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            home.addCategory(Intent.CATEGORY_DEFAULT);
            dpm.addPersistentPreferredActivity(admin, home, new ComponentName(this, HOME_ALIAS));
        } catch (Exception ignored) { }
    }

    private void setHomeAliasEnabled(boolean on) {
        getPackageManager().setComponentEnabledSetting(new ComponentName(this, HOME_ALIAS),
            on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP);
    }

    private void goToNormalHome() {
        startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finishAndRemoveTask();
    }

    private void lockIfPermitted() {
        try {
            if (!dpm().isLockTaskPermitted(getPackageName())) return;
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (am.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_NONE) startLockTask();
        } catch (Exception ignored) { }
    }

    // ---- staff menu ------------------------------------------------------------------------

    private void cornerTap() {
        long now = System.currentTimeMillis();
        if (now - firstTapAt > 1500) { // firstTapAt holds the previous tap: a pause of 1.5 s starts the count over
            cornerTaps = 0;
        }
        firstTapAt = now;
        if (++cornerTaps >= 5) {
            cornerTaps = 0;
            askPin();
        }
    }

    private void askPin() {
        final String stored = prefs.getString("pin_hash", null);
        if (stored == null) {
            new AlertDialog.Builder(this)
                .setMessage("No staff PIN is set. Set one over adb.")
                .setPositiveButton("OK", null).show();
            return;
        }
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Staff PIN")
            .setView(input)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("OK", new android.content.DialogInterface.OnClickListener() {
                @Override public void onClick(android.content.DialogInterface d, int w) {
                    if (stored.equals(hash(input.getText().toString()))) staffMenu();
                }
            }).create();
        // the number keypad opens by itself, with the cursor already in the field
        dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        dialog.show();
        input.requestFocus();
    }

    private void staffMenu() {
        final String[] items = {
            "Reload page", "Wi-Fi settings (unlocks for 5 min)", "Unlock for 5 min",
            "Exit kiosk mode (tap the Sarcafe Kiosk app to return)",
            "Remove kiosk completely (needs adb to set up again)", "Cancel" };
        new AlertDialog.Builder(this)
            .setTitle("Sarcafe Kiosk")
            .setItems(items, new android.content.DialogInterface.OnClickListener() {
                @Override public void onClick(android.content.DialogInterface d, int which) {
                    if (which == 0) load();
                    else if (which == 1) {
                        unlockForStaff();
                        startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } else if (which == 2) unlockForStaff();
                    else if (which == 3) confirmLeave(false);
                    else if (which == 4) confirmLeave(true);
                }
            }).show();
    }

    private void confirmLeave(final boolean permanent) {
        new AlertDialog.Builder(this)
            .setTitle(permanent ? "Remove kiosk completely?" : "Exit kiosk mode?")
            .setMessage(permanent
                ? "The lock and the device-owner role are removed for good. Setting it up again needs the USB cable "
                    + "and a computer. This app stays installed as a normal app. Continue?"
                : "The tablet goes back to its normal home screen. Tap the Sarcafe Kiosk app to put it back in kiosk mode.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton(permanent ? "Remove" : "Exit", new android.content.DialogInterface.OnClickListener() {
                @Override public void onClick(android.content.DialogInterface d, int w) { leaveKiosk(permanent); }
            }).show();
    }

    /**
     * Undoes what applyDeviceOwnerPolicies did. Exit keeps the device-owner role, so opening the app again puts the
     * tablet back in kiosk mode; permanent also gives the role up.
     */
    private void leaveKiosk(boolean permanent) {
        DevicePolicyManager dpm = dpm();
        ComponentName admin = new ComponentName(this, KioskAdminReceiver.class);
        if (!dpm.isDeviceOwnerApp(getPackageName())) {
            new AlertDialog.Builder(this).setMessage("This app is not the device owner, nothing to release.")
                .setPositiveButton("OK", null).show();
            return;
        }
        staffUntil = Long.MAX_VALUE; // never relock while we are winding down
        try { stopLockTask(); } catch (Exception ignored) { }
        try { dpm.setLockTaskPackages(admin, new String[0]); } catch (Exception ignored) { }
        try { dpm.setKeyguardDisabled(admin, false); } catch (Exception ignored) { }
        try { dpm.setStatusBarDisabled(admin, false); } catch (Exception ignored) { }
        try { dpm.setGlobalSetting(admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "0"); } catch (Exception ignored) { }
        try { dpm.clearPackagePersistentPreferredActivities(admin, getPackageName()); } catch (Exception ignored) { }
        try { setHomeAliasEnabled(false); } catch (Exception ignored) { }
        if (permanent) {
            try { dpm.clearDeviceOwnerApp(getPackageName()); } catch (Exception e) {
                new AlertDialog.Builder(this).setMessage("Could not remove: " + e.getMessage())
                    .setPositiveButton("OK", null).show();
                return;
            }
        }
        goToNormalHome();
    }

    private void unlockForStaff() {
        staffUntil = System.currentTimeMillis() + STAFF_WINDOW_MS;
        try { stopLockTask(); } catch (Exception ignored) { }
        ui.removeCallbacks(relock);
        ui.postDelayed(relock, STAFF_WINDOW_MS);
    }
}
