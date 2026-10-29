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
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;

import org.json.JSONObject;


/**
 * Full-screen WebView kiosk. Loads the bundled page (or an https URL set over adb), hides the system
 * bars, and, once provisioned as device owner, locks the tablet to this app.
 *
 * Configure over adb ONLY (the receiver needs android.permission.DUMP, which the adb shell has and apps cannot get;
 * launching this activity ignores every extra). See KioskConfigReceiver for the full list:
 *   adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es pin 123456    (staff PIN, 6-8 digits)
 *   adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es orient portrait   (auto | portrait | landscape)
 *   adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es ota_check now   (look for updates at once)
 * The bundled page is served from https://kiosk.sarcafe.invalid/ (OtaUpdater): the newest verified web bundle the
 * portal published, or the copy inside the APK. See docs/SARCAFE_KIOSK_OTA.md.
 * Staff menu: tap the top-left corner 5 times quickly, then enter the PIN.
 */
public class MainActivity extends Activity {
    static final String ASSET_URL = OtaUpdater.START_URL; // the bundled page, through the update layer's virtual origin
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
    private OtaUpdater ota;

    /** What the update layer may ask of this screen. */
    private final OtaUpdater.Host otaHost = new OtaUpdater.Host() {
        @Override public void queryIdle(final OtaUpdater.IdleCallback cb) {
            if (web == null || isFinishing() || System.currentTimeMillis() < staffUntil) {
                cb.onResult(false); // never while staff have the tablet unlocked
                return;
            }
            // KioskSession (the session controller) says ATTRACT/CLEAN when no customer is mid-visit; a page without
            // it (older bundle) counts as idle only on its welcome screen; the offline page has no screen at all
            web.evaluateJavascript("(function(){try{var k=window.KioskSession;"
                + "if(k&&k.state)return k.state==='ATTRACT'||k.state==='CLEAN';"
                + "var b=document.body;return !!b&&(!b.dataset.screen||b.dataset.screen==='welcome');"
                + "}catch(e){return false}})()", new android.webkit.ValueCallback<String>() {
                    @Override public void onReceiveValue(String v) { cb.onResult("true".equals(v)); }
                });
        }
        @Override public void reloadPage() {
            if (web != null) load();
        }
    };

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
        applyOrientation(); // launch extras are ignored: configuration arrives only through KioskConfigReceiver

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
        ota = OtaUpdater.get(this);
        ota.onAppStart(otaHost); // may switch in a downloaded bundle or roll a failed one back, before the first load
        KioskConfigReceiver.onChanged = configChanged;
        load();
    }

    /** After an adb configuration broadcast (main thread): apply what can change while running and reload. */
    private final Runnable configChanged = new Runnable() {
        @Override public void run() {
            if (web == null || isFinishing()) return;
            applyOrientation();
            WebView.setWebContentsDebuggingEnabled(prefs.getBoolean("debug", false));
            load();
        }
    };

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); // extras ignored on purpose (any app may start this activity)
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
        if (ota != null) ota.onHostGone(otaHost);
        if (KioskConfigReceiver.onChanged == configChanged) KioskConfigReceiver.onChanged = null;
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // ---- configuration (stored by KioskConfigReceiver) ------------------------------------------

    /** True while the top-level page is the kiosk's own (the virtual origin); set on every main-frame load. */
    private volatile boolean kioskPageOnTop;

    /** What the bundled page may know about the menu-update channel. None of it is secret (public key only). */
    private String syncConfigJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("api", prefs.getString("api", ""));
            o.put("rt", prefs.getString("rt", ""));
            o.put("rtKey", prefs.getString("rt_key", ""));
            o.put("rtChannel", prefs.getString("rt_channel", "menu:givat-haviva") /* the dashboard's own menu channel */);
            o.put("signupKey", prefs.getString("signup_key", ""));
            o.put("perf", prefs.getString("perf", "auto"));
            o.put("perfEpoch", prefs.getInt("perf_epoch", 0));
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

    // ---- web view --------------------------------------------------------------------------

    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(prefs.getBoolean("debug", false));
        web.addJavascriptInterface(new Object() {
            // the sign-up key is in here: only the kiosk's own page gets an answer, any other top-level page gets "{}"
            @JavascriptInterface public String config() { return kioskPageOnTop ? syncConfigJson() : "{}"; }
        }, "SarcafeKiosk");
        // the page reports that it booted; a freshly switched-in web bundle is rolled back without this
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public void ready(final String version) {
                if (!kioskPageOnTop) return;
                ui.post(new Runnable() { @Override public void run() { if (ota != null) ota.onReady(version); } });
            }
        }, "KioskNative");
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); // the bundled page is served from the virtual https origin, not file://
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
                if ("https".equals(u.getScheme()) && OtaUpdater.VIRTUAL_HOST.equals(u.getHost())) return false;
                Uri home = Uri.parse(currentUrl);
                if ("https".equals(u.getScheme()) && home.getHost() != null && home.getHost().equals(u.getHost())) {
                    return false;
                }
                return true; // anything else is blocked
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (ota != null && "https".equals(u.getScheme()) && OtaUpdater.VIRTUAL_HOST.equals(u.getHost())) {
                    return ota.serve(u, req.getMethod());
                }
                return null; // everything else goes to the network as before
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                kioskPageOnTop = isKioskPage(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (ota != null) ota.onPageFinished(url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                if (ota != null) ota.onRendererGone(); // a bundle on trial is rolled back before the page comes back
                recreate();
                return true;
            }
        });
    }

    static boolean isKioskPage(String url) {
        return url != null && url.startsWith("https://" + OtaUpdater.VIRTUAL_HOST + "/");
    }

    private void load() {
        String saved = prefs.getString("url", null);
        currentUrl = saved != null ? saved : ASSET_URL;
        kioskPageOnTop = isKioskPage(currentUrl); // before any script of the new page can run
        ui.removeCallbacks(retry);
        web.loadUrl(currentUrl);
    }

    private void showOffline() {
        kioskPageOnTop = false;
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
        final String stored = prefs.getString("pin_v2", null);
        final String legacy = prefs.getString("pin_hash", null); // the pre-2026-10-28 format, accepted once
        if (stored == null && legacy == null) {
            new AlertDialog.Builder(this)
                .setMessage("No staff PIN is set. Set one over adb.")
                .setPositiveButton("OK", null).show();
            return;
        }
        long lockedFor = prefs.getLong("pin_locked_until", 0) - System.currentTimeMillis();
        if (lockedFor > 0) {
            new AlertDialog.Builder(this)
                .setMessage("Too many wrong PINs. Try again in " + ((lockedFor + 59999) / 60000) + " min.")
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
                    checkPin(input.getText().toString(), stored, legacy);
                }
            }).create();
        // the number keypad opens by itself, with the cursor already in the field
        dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        dialog.show();
        input.requestFocus();
    }

    /** PBKDF2 check; a correct legacy PIN is moved to the new format; wrong tries lock the dialog for longer each time. */
    private void checkPin(String pin, String stored, String legacy) {
        boolean ok = stored != null ? StaffPin.verify(stored, pin) : StaffPin.verifyLegacy(legacy, pin);
        if (ok) {
            SharedPreferences.Editor e = prefs.edit().remove("pin_failures").remove("pin_locked_until");
            if (stored == null) e.putString("pin_v2", StaffPin.create(pin, new java.security.SecureRandom())).remove("pin_hash");
            e.apply();
            staffMenu();
            return;
        }
        int failures = prefs.getInt("pin_failures", 0) + 1;
        long lock = StaffPin.lockoutMs(failures);
        prefs.edit().putInt("pin_failures", failures)
            .putLong("pin_locked_until", lock > 0 ? System.currentTimeMillis() + lock : 0).apply();
    }

    private void staffMenu() {
        final String perfNow = prefs.getString("perf", "auto");
        final String perfNext = perfNow.equals("auto") ? "lite" : perfNow.equals("lite") ? "full" : "auto";
        final String[] items = {
            "Reload page", "Wi-Fi settings (unlocks for 5 min)", "Unlock for 5 min",
            "Exit kiosk mode (tap the Sarcafe Kiosk app to return)",
            "Remove kiosk completely (needs adb to set up again)",
            "Speed: " + perfNow + "  (tap for " + perfNext + ")",
            ota.summaryLine(), "Check for updates now", "Cancel" };
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
                    else if (which == 5) { KioskConfigReceiver.setPerfMode(prefs, perfNext); load(); }
                    else if (which == 6) updatesDialog();
                    else if (which == 7) checkUpdatesNow();
                }
            }).show();
    }

    private void checkUpdatesNow() {
        ota.checkNow();
        android.widget.Toast.makeText(this, "Checking for updates; open this menu again in a minute for the result.",
            android.widget.Toast.LENGTH_LONG).show();
    }

    /** Details of the update state, with "check now" and "undo the last page update". */
    private void updatesDialog() {
        new AlertDialog.Builder(this)
            .setTitle("Updates")
            .setMessage(ota.details())
            .setNegativeButton("Close", null)
            .setNeutralButton("Undo page update", new android.content.DialogInterface.OnClickListener() {
                @Override public void onClick(android.content.DialogInterface d, int w) {
                    if (!ota.undoWebUpdate()) {
                        new AlertDialog.Builder(MainActivity.this)
                            .setMessage("The page built into the app is in use; there is nothing to undo.")
                            .setPositiveButton("OK", null).show();
                    }
                }
            })
            .setPositiveButton("Check now", new android.content.DialogInterface.OnClickListener() {
                @Override public void onClick(android.content.DialogInterface d, int w) { checkUpdatesNow(); }
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
