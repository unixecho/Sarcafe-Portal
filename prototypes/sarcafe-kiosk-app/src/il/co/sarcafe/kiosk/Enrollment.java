package il.co.sarcafe.kiosk;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.BaseBundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * A kiosk installed from the owner's QR (the install wizard, docs/SARCAFE_KIOSK_INSTALL.md). Android's device-owner setup hands the
 * QR's extras to the app (KioskAdminReceiver / the two provisioning activities): a one-time install code and the portal's address.
 * On its first start the app trades the code ONCE at POST {portal}/api/kiosk/enroll for the settings the adb setup used to give it
 * (menu address, realtime channel, kiosk key, its name, the staff PIN's record), stores them exactly as KioskConfigReceiver would,
 * and forgets the code. No computer, no cable.
 */
final class Enrollment {
    private Enrollment() {}

    static final String CODE = "enroll_code";
    static final String PORTAL = "enroll_portal";
    private static volatile boolean running;

    /** From the provisioning extras (PersistableBundle or Bundle): keeps the code and the portal when both are acceptable. */
    static void saveExtras(Context context, BaseBundle extras) {
        if (extras == null) return;
        String code = extras.getString("enroll");
        String portal = extras.getString("portal");
        if (!EnrollRules.acceptableCode(code) || !EnrollRules.acceptablePortal(portal)) {
            Log.w(OtaUpdater.TAG, "enrollment extras ignored");
            return;
        }
        context.getSharedPreferences("kiosk", Context.MODE_PRIVATE).edit()
            .putString(CODE, code).putString(PORTAL, EnrollRules.base(portal)).apply();
    }

    static boolean pending(SharedPreferences prefs) {
        return prefs.getString(CODE, null) != null;
    }

    /** Trades the code in the background; `done` runs on the main thread after settings were stored. Retries on the next start. */
    static void start(final Context context, final Runnable done) {
        final SharedPreferences prefs = context.getSharedPreferences("kiosk", Context.MODE_PRIVATE);
        if (!pending(prefs) || running) return;
        running = true;
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    int result = exchange(prefs);
                    if (result == 200 && done != null) new Handler(Looper.getMainLooper()).post(done);
                } catch (Exception e) {
                    Log.w(OtaUpdater.TAG, "enrollment failed: " + e.getClass().getSimpleName());
                } finally {
                    running = false;
                }
            }
        }, "kiosk-enroll").start();
    }

    private static int exchange(SharedPreferences prefs) throws Exception {
        String code = prefs.getString(CODE, null);
        String portal = prefs.getString(PORTAL, null);
        if (!EnrollRules.acceptableCode(code) || !EnrollRules.acceptablePortal(portal)) {
            prefs.edit().remove(CODE).remove(PORTAL).apply();
            return 0;
        }
        HttpURLConnection c = (HttpURLConnection) new URL(EnrollRules.base(portal) + "/api/kiosk/enroll").openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        byte[] body = new JSONObject().put("code", code).toString().getBytes(StandardCharsets.UTF_8);
        OutputStream out = c.getOutputStream();
        out.write(body);
        out.close();
        int status = c.getResponseCode();
        if (status == 404 || status == 400) {           // used, expired or wrong: stop trying, staff installs again from a new QR
            prefs.edit().remove(CODE).remove(PORTAL).apply();
            Log.w(OtaUpdater.TAG, "enrollment code refused (" + status + ")");
            return status;
        }
        if (status != 200) return status;                // portal busy or offline: kept, tried again on the next start
        InputStream in = c.getInputStream();
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int n;
        while ((n = in.read(chunk)) > 0 && buf.size() < 16384) buf.write(chunk, 0, n);
        in.close();
        JSONObject cfg = new JSONObject(new String(buf.toByteArray(), StandardCharsets.UTF_8)).getJSONObject("config");
        if (!applyConfig(prefs, cfg)) return 0;
        prefs.edit().remove(CODE).remove(PORTAL).commit();
        return 200;
    }

    /** Stores a portal's settings answer exactly as KioskConfigReceiver would. False (nothing stored) when any field is off. */
    static boolean applyConfig(SharedPreferences prefs, JSONObject cfg) {
        String api = cfg.optString("api"), ota = cfg.optString("ota"), rt = cfg.optString("rt"), rtKey = cfg.optString("rtKey");
        String channel = cfg.optString("rtChannel"), key = cfg.optString("key"), device = cfg.optString("device");
        String pin = cfg.isNull("pinRecord") ? null : cfg.optString("pinRecord", null);
        if (!EnrollRules.acceptableHttps(api) || !EnrollRules.acceptableHttps(ota) || !EnrollRules.acceptableHttps(rt)
            || rtKey.isEmpty() || rtKey.length() > 400 || !EnrollRules.acceptableChannel(channel) || !EnrollRules.acceptableKey(key)
            || !PinReset.deviceOrDefault(device).equals(device)) {
            Log.w(OtaUpdater.TAG, "enrollment answer refused");
            return false;
        }
        SharedPreferences.Editor e = prefs.edit()
            .putString("api", api).putString("ota", ota).putString("rt", rt).putString("rt_key", rtKey)
            .putString("rt_channel", channel).putString("signup_key", key).putString("device", device);
        if (pin != null && PinReset.acceptableRecord(pin)) {
            e.putString("pin_v2", pin).remove("pin_hash").remove("pin_failures").remove("pin_locked_until");
        }
        e.commit();
        Log.i(OtaUpdater.TAG, "enrolled as " + device);
        return true;
    }

    // ---- pairing by the short code on the setup screen (an app installed from a link, with no settings) ----------------------------
    // POST {portal}/api/kiosk/pair → a 6-character code to show + the app's own secret token; then GET ?token= every few seconds until
    // the owner typed the code in the dashboard's install wizard → the settings, once. docs/SARCAFE_KIOSK_INSTALL.md.

    static volatile String pairStatus = "idle";   // idle | asking | waiting | done | offline | error
    static volatile String pairCode = null;
    static volatile String pairExpires = null;
    private static volatile boolean pairing;

    static boolean configured(SharedPreferences prefs) {
        String key = prefs.getString("signup_key", null), api = prefs.getString("api", null);
        return key != null && !key.isEmpty() && api != null && api.startsWith("https://");
    }

    /** Starts (once) the pairing loop when the app has no settings and no install code; `done` runs on the main thread. */
    static void startPairing(final Context context, final Runnable done) {
        final SharedPreferences prefs = context.getSharedPreferences("kiosk", Context.MODE_PRIVATE);
        if (configured(prefs) || pending(prefs) || pairing) return;
        pairing = true;
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    String portal = "https://" + EnrollRules.PORTAL_HOSTS[0];
                    while (!configured(prefs) && !pending(prefs)) {
                        String token = prefs.getString("pair_token", null);
                        if (token == null) {
                            pairStatus = "asking";
                            JSONObject made = call(portal + "/api/kiosk/pair", "POST");
                            if (made == null) { pairStatus = "offline"; Thread.sleep(10000); continue; }
                            token = made.optString("token");
                            if (!EnrollRules.acceptableCode(token)) { pairStatus = "error"; Thread.sleep(30000); continue; }
                            pairCode = made.optString("code");
                            pairExpires = made.optString("expiresAt");
                            prefs.edit().putString("pair_token", token).apply();
                        }
                        JSONObject state = call(portal + "/api/kiosk/pair?token=" + token, "GET");
                        if (state == null) { pairStatus = "offline"; Thread.sleep(8000); continue; }
                        if (state.optBoolean("gone")) { prefs.edit().remove("pair_token").apply(); pairCode = null; continue; } // expired: a new code
                        if ("ready".equals(state.optString("status")) && state.optJSONObject("config") != null) {
                            if (applyConfig(prefs, state.getJSONObject("config"))) {
                                prefs.edit().remove("pair_token").commit();
                                pairStatus = "done";
                                pairCode = null;
                                if (done != null) new Handler(Looper.getMainLooper()).post(done);
                                return;
                            }
                            pairStatus = "error";
                            prefs.edit().remove("pair_token").apply();
                            continue;
                        }
                        pairCode = state.optString("code", pairCode);
                        pairExpires = state.optString("expiresAt", pairExpires);
                        pairStatus = "waiting";
                        Thread.sleep(4000);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } catch (Exception e) {
                    pairStatus = "error";
                    Log.w(OtaUpdater.TAG, "pairing failed: " + e.getClass().getSimpleName());
                } finally {
                    pairing = false;
                }
            }
        }, "kiosk-pair").start();
    }

    /** One JSON call to the portal; null when offline or the portal is busy; {"gone":true} for 404 (expired or unknown). */
    private static JSONObject call(String url, String method) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(12000);
            c.setReadTimeout(12000);
            c.setRequestMethod(method);
            if ("POST".equals(method)) { c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json"); OutputStream o = c.getOutputStream(); o.write("{}".getBytes(StandardCharsets.UTF_8)); o.close(); }
            int status = c.getResponseCode();
            if (status == 404) return new JSONObject().put("gone", true);
            if (status != 200 && status != 201) return null;
            InputStream in = c.getInputStream();
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int n;
            while ((n = in.read(chunk)) > 0 && buf.size() < 16384) buf.write(chunk, 0, n);
            in.close();
            return new JSONObject(new String(buf.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }
}
