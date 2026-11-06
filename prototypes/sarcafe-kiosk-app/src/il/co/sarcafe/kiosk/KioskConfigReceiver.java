package il.co.sarcafe.kiosk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import java.security.SecureRandom;

/**
 * The ONLY way to configure the kiosk. The manifest protects this receiver with android.permission.DUMP, which the adb
 * shell holds and no installed app can get, so another app on the tablet cannot change the PIN, the page address, the
 * keys or debugging. Launching MainActivity ignores every extra.
 *
 *   adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es pin 123456
 *   adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es api https://... --es rt https://... --es rt_key ...
 *   adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es ota_check now
 *
 * Extras: url (https://... | asset), orient (auto|portrait|landscape), debug (on|off), pin (6-8 digits), api, rt,
 * rt_key, rt_channel, key (sign-up key), perf (auto|lite|full), ota (update server base), ota_check (now), device (this tablet's
 * name in the portal, e.g. givat-haviva-1: where a PIN reset set on the dashboard is fetched for).
 * An empty value removes api / rt / rt_key / key / ota.
 */
public class KioskConfigReceiver extends BroadcastReceiver {
    /** Set by the running MainActivity: called on the main thread after a change that needs the page reloaded. */
    static volatile Runnable onChanged;

    @Override
    public void onReceive(Context context, Intent intent) {
        SharedPreferences prefs = context.getSharedPreferences("kiosk", Context.MODE_PRIVATE);
        boolean changed = apply(prefs, intent);
        if ("now".equals(intent.getStringExtra("ota_check"))) OtaUpdater.get(context).checkNow();
        Runnable r = onChanged;
        if (changed && r != null) r.run();
        // "changed" only means the page reloads; a new PIN never reloads it, so the PIN gets its own word (owner, 2026-11-06: a PIN
        // that WAS saved answered "nothing changed" and looked like a failure)
        String pin = intent.getStringExtra("pin");
        String pinResult = pin == null ? "" : (StaffPin.isAcceptableNewPin(pin) ? "; PIN set" : "; PIN NOT set: it must be 6-8 digits");
        setResultData((changed ? "changed" : "nothing changed") + pinResult);
    }

    /** Stores what the broadcast carries. True when the page should be reloaded. */
    static boolean apply(SharedPreferences prefs, Intent intent) {
        boolean changed = false;
        String url = intent.getStringExtra("url");
        if (url != null) {
            if (url.equals("asset")) {
                prefs.edit().remove("url").apply();
                changed = true;
            } else if (url.startsWith("https://") && url.length() <= 400) {
                prefs.edit().putString("url", url).apply();
                changed = true;
            }
        }
        String orient = intent.getStringExtra("orient"); // auto|portrait|landscape
        if (orient != null && orient.matches("auto|portrait|landscape")) {
            prefs.edit().putString("orient", orient).apply();
            changed = true;
        }
        String debug = intent.getStringExtra("debug"); // on|off: Chrome remote debugging over the cable
        if (debug != null) {
            prefs.edit().putBoolean("debug", debug.equals("on")).apply();
            changed = true;
        }
        String device = intent.getStringExtra("device"); // the tablet's portal name: where a dashboard PIN reset is fetched for
        if (device != null) {
            if (device.isEmpty()) prefs.edit().remove("device").apply();
            else if (PinReset.deviceOrDefault(device).equals(device)) prefs.edit().putString("device", device).apply();
            else Log.w(OtaUpdater.TAG, "device not changed: not a tablet name");
        }

        String pin = intent.getStringExtra("pin");
        if (pin != null) {
            if (StaffPin.isAcceptableNewPin(pin)) {
                prefs.edit().putString("pin_v2", StaffPin.create(pin, new SecureRandom())).remove("pin_hash")
                    .remove("pin_failures").remove("pin_locked_until").apply();
            } else {
                Log.w(OtaUpdater.TAG, "PIN not changed: it must be 6-8 digits");
            }
        }
        // menu-update channel (empty value removes it); the page reads these through SarcafeKiosk.config()
        changed |= setPref(prefs, intent, "api", "https://");     // snapshot endpoint the page fetches when told to
        changed |= setPref(prefs, intent, "rt", "https://");      // realtime server base address
        changed |= setPref(prefs, intent, "rt_key", "");          // its public (anon) key
        setPref(prefs, intent, "ota", "https://");                // update server (OtaUpdater); no reload needed
        String signupKey = intent.getStringExtra("key");          // the kiosk's key for the sign-up endpoint
        if (signupKey != null) {
            if (signupKey.isEmpty()) prefs.edit().remove("signup_key").apply();
            else if (signupKey.length() <= 200) prefs.edit().putString("signup_key", signupKey).apply();
            changed = true;
        }
        String perf = intent.getStringExtra("perf"); // auto | lite | full
        if (perf != null && perf.matches("auto|lite|full")) {
            setPerfMode(prefs, perf);
            changed = true;
        }
        String channel = intent.getStringExtra("rt_channel");
        if (channel != null && channel.matches("[A-Za-z0-9:_-]{1,64}")) {
            prefs.edit().putString("rt_channel", channel).apply();
            changed = true;
        }
        return changed;
    }

    /** The page's speed setting; a change starts a fresh speed test (the epoch invalidates the remembered result). */
    static void setPerfMode(SharedPreferences prefs, String mode) {
        prefs.edit().putString("perf", mode).putInt("perf_epoch", prefs.getInt("perf_epoch", 0) + 1).apply();
    }

    private static boolean setPref(SharedPreferences prefs, Intent intent, String key, String requiredPrefix) {
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
}
