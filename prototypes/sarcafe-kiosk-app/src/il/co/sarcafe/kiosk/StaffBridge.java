package il.co.sarcafe.kiosk;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * The door the page's staff control panel (overrides/kiosk-admin.js) uses to ask the app for things only the app can do:
 * rotation, brightness, the speed setting, Wi-Fi, restarting, leaving the kiosk, a new PIN, update status. It is
 * window.KioskStaff in the page: info(token), act(token, action, arg), close(token).
 *
 * Who may call it: the panel opens ONLY after the staff PIN was entered (MainActivity.openPanel), and MainActivity gives
 * the page a random one-time token with it. Every call must carry that token and arrive while the panel session is alive
 * (15 minutes after the last call; the page itself closes after 3 minutes without a touch). Without it every call answers
 * {"ok":false,"error":"denied"} and nothing happens. Only the kiosk's own page (never another site) can reach it at all.
 *
 * Everything that touches the screen or the system is handed to the main thread (JavaScript calls arrive on a WebView
 * thread). Nothing here can throw into the page: every action is wrapped and answers {"ok":false}.
 * Read-only facts the page may know without the PIN (the charge, the app version) are on KioskNative in MainActivity.
 */
final class StaffBridge {
    /** A panel session lives this long after its last call. */
    static final long SESSION_MS = 15 * 60 * 1000L;

    private final MainActivity host;
    private final SharedPreferences prefs;
    private final SecureRandom random = new SecureRandom();
    private volatile String token;
    private volatile long until;
    /** Set when an action reloads the page: the panel is opened again on the new page. */
    volatile boolean reopen;

    StaffBridge(MainActivity host, SharedPreferences prefs) {
        this.host = host;
        this.prefs = prefs;
    }

    // ---- the staff session ---------------------------------------------------------------------------------------

    /** After a correct PIN: starts a panel session and returns its token. */
    String begin() {
        byte[] bytes = new byte[16];
        random.nextBytes(bytes);
        token = OtaRules.hex(bytes);
        until = System.currentTimeMillis() + SESSION_MS;
        reopen = false;
        return token;
    }

    /** The token of the session that is alive, or null. */
    String current() {
        return panelOpen() ? token : null;
    }

    boolean panelOpen() {
        return token != null && System.currentTimeMillis() < until;
    }

    void end() {
        token = null;
        until = 0;
        reopen = false;
    }

    private boolean valid(String given) {
        String t = token;
        if (t == null || given == null || System.currentTimeMillis() >= until) return false;
        if (!MessageDigest.isEqual(t.getBytes(), given.getBytes())) return false;
        until = System.currentTimeMillis() + SESSION_MS;
        return true;
    }

    // ---- what the page sees --------------------------------------------------------------------------------------

    /** window.KioskStaff */
    Object js() {
        return new Object() {
            @JavascriptInterface public String info(String t) {
                if (!host.isKioskPageOnTop() || !valid(t)) return "null";
                try { return describe().toString(); } catch (Exception e) { return "null"; }
            }

            @JavascriptInterface public String act(String t, String action, String arg) {
                if (!host.isKioskPageOnTop() || !valid(t)) return answer(false, "denied");
                try {
                    return run(action == null ? "" : action, arg == null ? "" : arg);
                } catch (Exception e) {
                    return answer(false, "failed");
                }
            }

            @JavascriptInterface public void close(String t) {
                if (valid(t)) {
                    end();
                    host.runOnUiThread(new Runnable() { @Override public void run() { host.panelClosed(); } });
                }
            }
        };
    }

    private static String answer(boolean ok, String error) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", ok);
            if (error != null) o.put("error", error);
            return o.toString();
        } catch (Exception e) {
            return ok ? "{\"ok\":true}" : "{\"ok\":false}";
        }
    }

    private void onUi(Runnable r) {
        host.runOnUiThread(r);
    }

    private String run(String action, String arg) {
        if (action.equals("reload")) {
            onUi(new Runnable() { @Override public void run() { host.reloadPage(); } });
            return answer(true, null);
        }
        if (action.equals("orient")) {
            if (!arg.matches("auto|portrait|landscape")) return answer(false, "bad_value");
            prefs.edit().putString("orient", arg).apply();
            onUi(new Runnable() { @Override public void run() { host.applyOrientation(); } });
            return answer(true, null);
        }
        if (action.equals("perf")) {
            if (!arg.matches("auto|lite|full")) return answer(false, "bad_value");
            KioskConfigReceiver.setPerfMode(prefs, arg);
            reopen = true;                       // the speed is chosen when the page loads: reload, and come back to the panel
            onUi(new Runnable() { @Override public void run() { host.reloadPage(); } });
            return answer(true, null);
        }
        if (action.equals("brightness")) {
            int pct;
            try { pct = Integer.parseInt(arg); } catch (NumberFormatException e) { return answer(false, "bad_value"); }
            if (pct != -1 && (pct < 10 || pct > 100)) return answer(false, "bad_value");
            prefs.edit().putInt("brightness", pct).apply();
            onUi(new Runnable() { @Override public void run() { host.applyBrightness(); } });
            return answer(true, null);
        }
        if (action.equals("wifi")) {
            onUi(new Runnable() { @Override public void run() { host.openWifiSettings(); } });
            return answer(true, null);
        }
        if (action.equals("unlock")) {
            onUi(new Runnable() { @Override public void run() { host.unlockForStaff(); } });
            return answer(true, null);
        }
        if (action.equals("restart_app")) {
            reopen = false;
            onUi(new Runnable() { @Override public void run() { host.recreate(); } });
            return answer(true, null);
        }
        if (action.equals("reboot")) {
            onUi(new Runnable() { @Override public void run() { host.confirmReboot(); } });
            return answer(true, null);
        }
        if (action.equals("exit")) {
            onUi(new Runnable() { @Override public void run() { host.confirmLeave(false); } });
            return answer(true, null);
        }
        if (action.equals("native_menu")) {
            onUi(new Runnable() { @Override public void run() { host.staffMenu(); } });
            return answer(true, null);
        }
        if (action.equals("check_updates")) {
            host.updater().checkNow();
            return answer(true, null);
        }
        if (action.equals("undo_web")) {
            boolean undone = host.updater().undoWebUpdate();
            return answer(undone, undone ? null : "nothing_to_undo");
        }
        if (action.equals("set_pin")) return setPin(arg);
        return answer(false, "unknown_action");
    }

    /** arg = "<current PIN>\n<new PIN>". The current PIN is checked like the PIN dialog does, with the same lockout. */
    private String setPin(String arg) {
        int at = arg.indexOf('\n');
        if (at < 0) return answer(false, "bad_value");
        String oldPin = arg.substring(0, at);
        String newPin = arg.substring(at + 1);
        long lockedFor = prefs.getLong("pin_locked_until", 0) - System.currentTimeMillis();
        if (lockedFor > 0) return answer(false, "locked");
        String stored = prefs.getString("pin_v2", null);
        String legacy = prefs.getString("pin_hash", null);
        boolean ok = stored != null ? StaffPin.verify(stored, oldPin) : StaffPin.verifyLegacy(legacy, oldPin);
        if (!ok) {
            int failures = prefs.getInt("pin_failures", 0) + 1;
            long lock = StaffPin.lockoutMs(failures);
            prefs.edit().putInt("pin_failures", failures)
                .putLong("pin_locked_until", lock > 0 ? System.currentTimeMillis() + lock : 0).apply();
            return answer(false, lock > 0 ? "locked" : "wrong");
        }
        if (!StaffPin.isAcceptableNewPin(newPin)) return answer(false, "weak");
        prefs.edit().putString("pin_v2", StaffPin.create(newPin, new SecureRandom())).remove("pin_hash")
            .remove("pin_failures").remove("pin_locked_until").apply();
        return answer(true, null);
    }

    // ---- facts -------------------------------------------------------------------------------------------------------

    /** The charge and whether the tablet is charging, from the system's battery service. Null when it cannot say. */
    static JSONObject battery(Context context) {
        try {
            Intent b = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (b == null) return null;
            int level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            if (level < 0 || scale <= 0) return null;
            int status = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            JSONObject o = new JSONObject();
            o.put("level", Math.round(level * 100f / scale));
            o.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
            o.put("plugged", b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0);
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    private JSONObject describe() throws Exception {
        JSONObject o = new JSONObject();
        OtaUpdater ota = host.updater();
        o.put("appCode", ota.nativeVersionCode());
        o.put("appName", ota.nativeVersionName());
        o.put("webVersion", ota.activeWebVersion());
        o.put("updates", ota.details());
        o.put("orient", prefs.getString("orient", "auto"));
        o.put("perf", prefs.getString("perf", "auto"));
        o.put("brightness", prefs.getInt("brightness", -1));
        o.put("model", (Build.MANUFACTURER + " " + Build.MODEL).trim());
        o.put("android", Build.VERSION.RELEASE);
        o.put("sdk", Build.VERSION.SDK_INT);
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) host.getSystemService(Context.DEVICE_POLICY_SERVICE);
            o.put("deviceOwner", dpm.isDeviceOwnerApp(host.getPackageName()));
            ActivityManager am = (ActivityManager) host.getSystemService(Context.ACTIVITY_SERVICE);
            o.put("lockTask", am.getLockTaskModeState());
        } catch (Exception ignored) { }
        try {
            StatFs fs = new StatFs(Environment.getDataDirectory().getPath());
            o.put("freeMb", fs.getAvailableBytes() / (1024 * 1024));
        } catch (Exception ignored) { }
        try {
            ConnectivityManager cm = (ConnectivityManager) host.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo ni = cm.getActiveNetworkInfo();
            o.put("online", ni != null && ni.isConnected());
        } catch (Exception ignored) { }
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                android.content.pm.PackageInfo wv = WebView.getCurrentWebViewPackage();
                if (wv != null) o.put("webview", wv.versionName);
            }
        } catch (Exception ignored) { }
        JSONObject battery = battery(host);
        if (battery != null) o.put("battery", battery);
        return o;
    }

    /** Used by MainActivity for the device owner's reboot (API 24+). */
    static boolean reboot(Context context) {
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
            if (!dpm.isDeviceOwnerApp(context.getPackageName())) return false;
            dpm.reboot(new ComponentName(context, KioskAdminReceiver.class));
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
