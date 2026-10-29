package il.co.sarcafe.kiosk;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Over-the-air updates for the kiosk (see docs/SARCAFE_KIOSK_OTA.md).
 *
 * Web bundle: the portal publishes /kiosk-ota/web/manifest.json and the files under /kiosk-ota/web/<version>/ on every
 * deploy. This class checks it at start, every 10 minutes while the screen is on, and when the network comes back
 * (ETag, so an unchanged manifest costs one small request). A new bundle, only when its manifest carries the owner's
 * offline ECDSA signature (OtaRules.PUBLIC_KEY_B64) and a higher seq than any taken before, is downloaded into
 * files/ota/web/<version>.part, every file checked against the manifest's size and SHA-256, renamed into place, and
 * "staged". The page is switched to it only while no customer is using the kiosk (KioskSession ATTRACT / CLEAN). The
 * new page must call KioskNative.ready() within 20 s, otherwise (or if its renderer crashes, or the app dies twice
 * while trying it) the kiosk goes back to the previous bundle and never takes that version again. The bundle inside
 * the APK stays as the factory fallback.
 *
 * Native app: /kiosk-ota/apk/latest.json names a newer APK (built and committed by the owner). It is downloaded,
 * checked (size, SHA-256, package name, version code) and installed silently through PackageInstaller, which the
 * device owner may do; Android itself refuses an APK signed by anyone else. OtaReceiver brings the kiosk back after
 * the update.
 *
 * Everything is fetched over HTTPS from one host: the `ota` adb extra, or else the host of the `api` extra. Redirects
 * are refused. Network and disk work run on one background thread.
 */
final class OtaUpdater {
    static final String TAG = "SarcafeOta";
    static final String VIRTUAL_HOST = "kiosk.sarcafe.invalid";
    static final String START_URL = "https://" + VIRTUAL_HOST + "/index.html";
    static final String ACTION_INSTALL_STATUS = "il.co.sarcafe.kiosk.OTA_INSTALL_STATUS";

    static final long READY_TIMEOUT_MS = 20 * 1000L;
    static final long FIRST_CHECK_MS = 20 * 1000L;
    static final long IDLE_POLL_MS = 15 * 1000L;
    static final long MIN_GAP_MS = 60 * 1000L;       // a reconnect never causes more than one check a minute
    static final int CONNECT_TIMEOUT_MS = 15 * 1000;
    static final int READ_TIMEOUT_MS = 30 * 1000;
    static final int BUFFER = 16 * 1024;
    static final long SPARE_BYTES = 20L * 1024 * 1024;
    static final int MAX_APK_FAILURES = 3;

    /** What the updater needs from the screen. Called on the main thread. */
    interface Host {
        /** Answers on the main thread whether nobody is using the kiosk right now. */
        void queryIdle(IdleCallback cb);
        /** Load the kiosk page again (a new bundle was switched in, or a rollback happened). */
        void reloadPage();
    }

    interface IdleCallback {
        void onResult(boolean idle);
    }

    private static OtaUpdater instance;

    static synchronized OtaUpdater get(Context context) {
        if (instance == null) instance = new OtaUpdater(context.getApplicationContext());
        return instance;
    }

    private final Context app;
    private final SharedPreferences state;   // "ota": pointers, ETags, results
    private final SharedPreferences config;  // "kiosk": what MainActivity stores from the adb extras
    private final Handler worker;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final File webRoot;
    private final int nativeCode;
    private final String nativeName;

    private volatile File activeDir; // null = the bundle inside the APK
    private Host host;
    private int errors;
    private long lastCheckAt;        // elapsedRealtime of the last started check
    private boolean applyLoopRunning;
    private File pendingApk;         // downloaded and checked, waiting for an idle moment
    private int pendingApkCode;
    private boolean started;

    private final Runnable periodic = new Runnable() {
        @Override public void run() { check(false); }
    };
    private final Runnable applyLoop = new Runnable() {
        @Override public void run() { applyWhenIdle(); }
    };
    private final Runnable readyTimeout = new Runnable() {
        @Override public void run() { rollback("the new page did not report ready within 20 s"); }
    };

    private OtaUpdater(Context app) {
        this.app = app;
        this.state = app.getSharedPreferences("ota", Context.MODE_PRIVATE);
        this.config = app.getSharedPreferences("kiosk", Context.MODE_PRIVATE);
        HandlerThread t = new HandlerThread("kiosk-ota", android.os.Process.THREAD_PRIORITY_BACKGROUND);
        t.start();
        this.worker = new Handler(t.getLooper());
        this.webRoot = new File(app.getFilesDir(), "ota/web");
        int code = 0;
        String name = "?";
        try {
            PackageInfo pi = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
            code = pi.versionCode;
            name = pi.versionName;
        } catch (Exception ignored) { }
        this.nativeCode = code;
        this.nativeName = name;
        refreshActiveDir();
    }

    // ---- lifecycle (main thread) ------------------------------------------------------------

    /**
     * Called from MainActivity.onCreate before the first page load: notes an app update, handles a trial that was
     * interrupted by a crash or a restart, and switches in a staged bundle (a cold start is always an idle moment).
     */
    void onAppStart(Host h) {
        host = h;
        if (!started) {
            // once per process: what happened since the last run
            started = true;
            if (state.getInt("native_code", 0) != nativeCode) {
                int installing = state.getInt("apk_installing", 0);
                state.edit().putInt("native_code", nativeCode).remove("etag_manifest").remove("etag_apk")
                    .remove("apk_installing").remove("apk_fail_code").remove("apk_fail_count")
                    .putString("last_result", installing != 0 && nativeCode >= installing
                        ? "app updated to " + nativeName + " (" + nativeCode + ")" : state.getString("last_result", ""))
                    .commit();
            } else if (state.getInt("apk_installing", 0) != 0) {
                // the process ended during an install and the version did not change: it did not happen
                recordApkFailure(state.getInt("apk_installing", 0), "install did not complete");
            }
            if (state.getString("web_trial", null) != null) {
                int boots = state.getInt("web_trial_boots", 0) + 1;
                state.edit().putInt("web_trial_boots", boots).commit();
                if (boots >= 2) rollbackQuiet("the app restarted twice while trying it");
            }
            registerNetworkCallback();
            worker.postDelayed(periodic, FIRST_CHECK_MS);
        }
        if (state.getString("web_staged", null) != null && config.getString("url", null) == null) activateStaged();
    }

    void onHostGone(Host h) {
        if (host == h) host = null;
        ui.removeCallbacks(readyTimeout);
    }

    /** The kiosk page finished loading. A bundle on trial now has READY_TIMEOUT_MS to call KioskNative.ready(). */
    void onPageFinished(String url) {
        if (url == null || !url.startsWith("https://" + VIRTUAL_HOST + "/")) return;
        if (state.getString("web_trial", null) == null) return;
        ui.removeCallbacks(readyTimeout);
        ui.postDelayed(readyTimeout, READY_TIMEOUT_MS);
    }

    /** KioskNative.ready(version) from the page (posted to the main thread). */
    void onReady(String reported) {
        String clean = reported == null ? "" : reported.replaceAll("[^A-Za-z0-9._:-]", "");
        if (clean.length() > 40) clean = clean.substring(0, 40);
        SharedPreferences.Editor e = state.edit().putString("web_reported", clean);
        String trial = state.getString("web_trial", null);
        if (trial != null) {
            ui.removeCallbacks(readyTimeout);
            e.remove("web_trial").remove("web_trial_boots").putString("last_result", "web " + trial + " is running");
            Log.i(TAG, "web bundle " + trial + " confirmed");
        }
        e.commit();
        if (trial != null) {
            worker.post(new Runnable() { @Override public void run() { prune(); } });
            logStatus();
        }
    }

    /** The WebView renderer died. A bundle on trial is rolled back; returns true when that happened. */
    boolean onRendererGone() {
        if (state.getString("web_trial", null) == null) return false;
        rollbackQuiet("the page crashed");
        return true;
    }

    /** Staff menu: "Check for updates now". */
    void checkNow() {
        worker.post(new Runnable() { @Override public void run() { check(true); } });
    }

    /** Staff menu: undo the current web update (it is not taken again). */
    boolean undoWebUpdate() {
        String active = state.getString("web_active", null);
        if (active == null) return false;
        state.edit().putString("web_trial", active).commit();
        rollback("undone from the staff menu");
        return true;
    }

    // ---- serving the active bundle (any thread) ---------------------------------------------

    /**
     * Answers a request for https://kiosk.sarcafe.invalid/<name>: from the active downloaded bundle, or from the APK's
     * own assets when none is active. A downloaded bundle never falls back to assets file by file, so the page is
     * always one consistent version.
     */
    WebResourceResponse serve(Uri u, String method) {
        if (!"GET".equalsIgnoreCase(method)) return notFound();
        String path = u.getPath();
        String name = path == null || path.equals("/") || path.isEmpty() ? "index.html" : path.substring(1);
        if (!OtaRules.isSafeName(name)) return notFound();
        InputStream in = null;
        File dir = activeDir;
        if (dir != null && !dir.isDirectory()) {
            // the active folder vanished (storage trouble): serve the factory files and drop that bundle once
            final String missing = dir.getName();
            dir = null;
            ui.post(new Runnable() {
                @Override public void run() {
                    if (!missing.equals(state.getString("web_active", null))) return; // already handled
                    state.edit().putString("web_trial", missing).commit();
                    rollback("the bundle folder is missing");
                }
            });
        }
        try {
            if (dir != null) {
                File f = new File(dir, name);
                if (f.isFile()) in = new FileInputStream(f);
            } else {
                in = app.getAssets().open(name);
            }
        } catch (IOException e) {
            in = null;
        }
        if (in == null) return notFound();
        String mime = OtaRules.mimeFor(name);
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", "no-cache");
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse(mime, OtaRules.isText(mime) ? "utf-8" : null, 200, "OK", headers, in);
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null,
            new ByteArrayInputStream(new byte[0]));
    }

    // ---- status ------------------------------------------------------------------------------

    /** One line for the staff menu. */
    String summaryLine() {
        String web = state.getString("web_active", null);
        long at = state.getLong("last_check", 0);
        return "Updates: page " + (web == null ? "built-in" : web.substring(0, 8)) + ", app " + nativeName
            + " (" + nativeCode + "), checked " + (at == 0 ? "never" : new SimpleDateFormat("dd/MM HH:mm", Locale.US).format(new Date(at)));
    }

    /** The details dialog in the staff menu. */
    String details() {
        StringBuilder sb = new StringBuilder();
        String web = state.getString("web_active", null);
        sb.append("Page bundle: ").append(web == null ? "built into the app" : web).append('\n');
        String prev = state.getString("web_prev", null);
        if (prev != null) sb.append("Previous (kept for rollback): ").append(prev).append('\n');
        String staged = state.getString("web_staged", null);
        if (staged != null) sb.append("Waiting for an idle moment: ").append(staged).append('\n');
        if (state.getString("web_trial", null) != null) sb.append("On trial (waiting for the page to start)\n");
        sb.append("App: ").append(nativeName).append(" (").append(nativeCode).append(")\n");
        if (pendingApk != null) sb.append("App update ready: ").append(pendingApkCode).append('\n');
        long at = state.getLong("last_check", 0);
        sb.append("Last check: ").append(at == 0 ? "never"
            : new SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.US).format(new Date(at))).append('\n');
        sb.append("Result: ").append(state.getString("last_result", "-")).append('\n');
        String base = updateBase();
        sb.append("Update server: ").append(base == null ? "not set (needs the api or ota setting)" : Uri.parse(base).getHost());
        return sb.toString();
    }

    /** Logcat only, never anything about customers. */
    private void logStatus() {
        try {
            JSONObject o = new JSONObject();
            o.put("web", state.getString("web_active", "factory"));
            o.put("prev", state.getString("web_prev", ""));
            o.put("staged", state.getString("web_staged", ""));
            o.put("trial", state.getString("web_trial", ""));
            o.put("reported", state.getString("web_reported", ""));
            o.put("native", nativeCode);
            o.put("lastCheck", state.getLong("last_check", 0));
            o.put("result", state.getString("last_result", ""));
            o.put("errors", errors);
            Log.i(TAG, "status " + o.toString());
        } catch (Exception ignored) { }
    }

    // ---- the check (worker thread) -----------------------------------------------------------

    private void check(boolean manual) {
        worker.removeCallbacks(periodic);
        try {
            if (!manual && !screenOn()) return; // finally reschedules; nothing is fetched with the screen off
            lastCheckAt = SystemClock.elapsedRealtime();
            String base = updateBase();
            if (base == null) {
                finish("no update server set", true);
                return;
            }
            StringBuilder result = new StringBuilder();
            boolean ok = true;
            if (config.getString("url", null) == null) {
                try {
                    result.append(checkWeb(base));
                } catch (Exception e) {
                    ok = false;
                    result.append("page: ").append(shortError(e));
                }
            } else {
                result.append("page: hosted address in use");
            }
            try {
                result.append("; ").append(checkApk(base));
            } catch (Exception e) {
                ok = false;
                result.append("; app: ").append(shortError(e));
            }
            finish(result.toString(), ok);
        } finally {
            worker.removeCallbacks(periodic);
            worker.postDelayed(periodic, OtaRules.nextDelayMs(errors));
        }
    }

    private void finish(String result, boolean ok) {
        errors = ok ? 0 : errors + 1;
        state.edit().putLong("last_check", System.currentTimeMillis()).putString("last_result", result).commit();
        logStatus();
    }

    private boolean screenOn() {
        PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isInteractive();
    }

    /** https://<host>[:port]/<path>/ from the `ota` extra, or https://<host of api>/kiosk-ota/. Null when neither is set. */
    String updateBase() {
        String ota = config.getString("ota", null);
        if (ota != null && ota.startsWith("https://")) return ota.endsWith("/") ? ota : ota + "/";
        String api = config.getString("api", null);
        if (api == null || !api.startsWith("https://")) return null;
        Uri u = Uri.parse(api);
        if (u.getHost() == null || u.getHost().isEmpty()) return null;
        return "https://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "") + "/kiosk-ota/";
    }

    private String checkWeb(String base) throws Exception {
        Fetched m = fetchSmall(base + "web/manifest.json", state.getString("etag_manifest", null), OtaRules.MAX_MANIFEST_BYTES);
        if (m.code == 304) return "page: no change";
        if (m.code == 404) return "page: nothing published";
        if (m.code != 200) throw new IOException("manifest HTTP " + m.code);

        JSONObject o = new JSONObject(new String(m.body, "UTF-8"));
        String version = o.optString("version", "");
        long seq = o.optLong("seq", 0);
        int minNative = o.optInt("minNativeVersion", 0);
        JSONArray arr = o.optJSONArray("files");
        if (!OtaRules.isVersion(version) || arr == null) throw new IOException("manifest malformed");
        List<OtaRules.Entry> files = new ArrayList<OtaRules.Entry>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject f = arr.getJSONObject(i);
            files.add(new OtaRules.Entry(f.optString("path", ""), f.optString("sha256", ""), f.optLong("size", -1)));
        }
        String problem = OtaRules.checkEntries(files);
        if (problem != null) throw new IOException("manifest refused: " + problem);
        if (!version.equals(OtaRules.computeVersion(files))) throw new IOException("manifest version does not match its files");

        String active = state.getString("web_active", null);
        // Every manifest must carry the owner's offline signature over version + seq + minNativeVersion (the version
        // already covers every file's hash and size). Unsigned or wrongly signed: never applied.
        if (!OtaRules.hasPublicKey()) return "page: this app has no update key, page updates are off";
        String sig = o.optString("signature", "");
        if (sig.isEmpty() || !OtaRules.verifySignature(OtaRules.PUBLIC_KEY_B64, OtaRules.signaturePayload(version, seq, minNative), sig)) {
            // no ETag kept: whatever is served next is looked at again in full
            return "page: " + version + " is " + (sig.isEmpty() ? "not signed yet" : "wrongly signed") + ", ignored";
        }
        if (version.equals(active) || version.equals(state.getString("web_staged", null))) {
            rememberEtag("etag_manifest", m.etag);
            return "page: up to date";
        }
        if (isBad(version)) {
            rememberEtag("etag_manifest", m.etag);
            return "page: " + version + " failed before, not taken again";
        }
        if (seq <= state.getLong("web_max_seq", 0)) {
            // a replayed older signed manifest (or a re-signed older bundle with an old seq): never go backwards
            rememberEtag("etag_manifest", m.etag);
            return "page: " + version + " is older (seq " + seq + ") than one already taken, ignored";
        }
        if (minNative > nativeCode) {
            // no ETag kept: once the app itself is updated the same manifest must be looked at again
            return "page: " + version + " needs app version " + minNative;
        }

        File dir = download(base, version, files);
        state.edit().putString("web_staged", version).putLong("web_staged_seq", seq).putLong("web_max_seq", seq).commit();
        rememberEtag("etag_manifest", m.etag);
        Log.i(TAG, "web bundle " + version + " staged (" + dir.getName() + ")");
        ui.post(applyLoop);
        return "page: " + version + " downloaded, waiting for an idle moment";
    }

    /** Downloads a bundle into webRoot/<version>, reusing identical files the kiosk already has. */
    private File download(String base, String version, List<OtaRules.Entry> files) throws Exception {
        webRoot.mkdirs();
        File done = new File(webRoot, version);
        if (done.isDirectory() && verifyDir(done, files)) return done; // e.g. the previous bundle came back
        long total = 0;
        for (OtaRules.Entry e : files) total += e.size;
        if (webRoot.getUsableSpace() < total + SPARE_BYTES) throw new IOException("not enough storage");

        File part = new File(webRoot, version + ".part");
        deleteTree(part);
        if (!part.mkdirs()) throw new IOException("cannot create folder");
        List<File> local = new ArrayList<File>();
        String active = state.getString("web_active", null);
        String prev = state.getString("web_prev", null);
        if (active != null) local.add(new File(webRoot, active));
        if (prev != null) local.add(new File(webRoot, prev));
        int fetched = 0;
        for (OtaRules.Entry e : files) {
            File target = new File(part, e.path);
            if (copyIfSame(local, e, target)) continue;
            downloadTo(base + "web/" + version + "/" + e.path, e.size, e.sha256, target);
            fetched++;
        }
        deleteTree(done);
        if (!part.renameTo(done)) throw new IOException("cannot move bundle into place");
        Log.i(TAG, "web bundle " + version + ": " + fetched + " of " + files.size() + " files fetched");
        return done;
    }

    private boolean verifyDir(File dir, List<OtaRules.Entry> files) {
        for (OtaRules.Entry e : files) {
            File f = new File(dir, e.path);
            if (!f.isFile() || f.length() != e.size) return false;
            try {
                if (!e.sha256.equals(sha256Of(new FileInputStream(f)))) return false;
            } catch (IOException ex) {
                return false;
            }
        }
        return true;
    }

    /** Copies an identical file from a bundle on disk or from the APK's assets instead of downloading it. */
    private boolean copyIfSame(List<File> dirs, OtaRules.Entry e, File target) {
        for (File d : dirs) {
            File f = new File(d, e.path);
            try {
                if (f.isFile() && f.length() == e.size && e.sha256.equals(sha256Of(new FileInputStream(f)))) {
                    copy(new FileInputStream(f), target);
                    return true;
                }
            } catch (IOException ignored) { }
        }
        try {
            if (e.sha256.equals(sha256Of(app.getAssets().open(e.path)))) {
                copy(app.getAssets().open(e.path), target);
                return true;
            }
        } catch (IOException ignored) { }
        return false;
    }

    private String checkApk(String base) throws Exception {
        Fetched m = fetchSmall(base + "apk/latest.json", state.getString("etag_apk", null), 4096);
        if (m.code == 304) return "app: no change";
        if (m.code == 404) return "app: nothing published";
        if (m.code != 200) throw new IOException("latest.json HTTP " + m.code);
        JSONObject o = new JSONObject(new String(m.body, "UTF-8"));
        int code = o.optInt("versionCode", 0);
        String file = o.optString("url", "");
        String sha = o.optString("sha256", "");
        long size = o.optLong("size", -1);
        if (code <= 0 || !OtaRules.isSafeName(file) || !file.endsWith(".apk") || !OtaRules.isSha256(sha)
            || size <= 0 || size > OtaRules.MAX_APK_BYTES) {
            throw new IOException("latest.json malformed");
        }
        if (code <= nativeCode) {
            rememberEtag("etag_apk", m.etag);
            return "app: up to date";
        }
        if (state.getInt("apk_fail_code", 0) == code && state.getInt("apk_fail_count", 0) >= MAX_APK_FAILURES) {
            return "app: " + code + " failed " + MAX_APK_FAILURES + " times, skipped";
        }
        File dir = new File(app.getCacheDir(), "ota");
        dir.mkdirs();
        File apk = new File(dir, "kiosk-" + code + ".apk");
        boolean have = false;
        if (apk.isFile() && apk.length() == size) {
            have = sha.equals(sha256Of(new FileInputStream(apk)));
        }
        if (!have) {
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            if (dir.getUsableSpace() < size + SPARE_BYTES) throw new IOException("not enough storage");
            downloadTo(base + "apk/" + file, size, sha, apk);
        }
        PackageInfo info = app.getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
        if (info == null || !app.getPackageName().equals(info.packageName) || info.versionCode != code) {
            apk.delete();
            throw new IOException("downloaded APK is not the expected package/version");
        }
        synchronized (this) {
            pendingApk = apk;
            pendingApkCode = code;
        }
        ui.post(applyLoop);
        return "app: " + code + " downloaded, waiting for an idle moment";
    }

    // ---- switching in (main thread) -----------------------------------------------------------

    /** Polls the page every 15 s until nobody is using the kiosk, then installs the app update or switches the bundle. */
    private void applyWhenIdle() {
        ui.removeCallbacks(applyLoop);
        boolean apk;
        synchronized (this) { apk = pendingApk != null; }
        final boolean web = state.getString("web_staged", null) != null && config.getString("url", null) == null;
        if (!apk && !web) return;
        if (host == null) return; // the next onAppStart switches a staged bundle in; the APK waits for the next check
        host.queryIdle(new IdleCallback() {
            @Override public void onResult(boolean idle) {
                if (!idle) {
                    ui.postDelayed(applyLoop, IDLE_POLL_MS);
                    return;
                }
                File f;
                int code;
                synchronized (OtaUpdater.this) {
                    f = pendingApk;
                    code = pendingApkCode;
                    pendingApk = null;
                }
                if (f != null) {
                    final File apkFile = f;
                    final int apkCode = code;
                    worker.post(new Runnable() { @Override public void run() { install(apkFile, apkCode); } });
                } else if (state.getString("web_staged", null) != null) {
                    activateStaged();
                    if (host != null) host.reloadPage();
                }
            }
        });
    }

    private void activateStaged() {
        String staged = state.getString("web_staged", null);
        if (staged == null || !new File(webRoot, staged).isDirectory()) {
            state.edit().remove("web_staged").commit();
            return;
        }
        String active = state.getString("web_active", null);
        SharedPreferences.Editor e = state.edit()
            .putString("web_active", staged)
            .putLong("web_active_seq", state.getLong("web_staged_seq", 0))
            .remove("web_staged").remove("web_staged_seq")
            .putString("web_trial", staged).putInt("web_trial_boots", 0)
            .putString("last_result", "switched to page " + staged);
        if (active != null && !active.equals(staged)) {
            e.putString("web_prev", active).putLong("web_prev_seq", state.getLong("web_active_seq", 0));
        }
        e.commit();
        refreshActiveDir();
        Log.i(TAG, "web bundle " + staged + " switched in (on trial)");
        logStatus();
    }

    /** Rolls back and reloads the page. */
    private void rollback(String reason) {
        if (rollbackQuiet(reason) && host != null) host.reloadPage();
    }

    /** Goes back to the previous bundle (or the factory one), never to take the failed version again. */
    private boolean rollbackQuiet(String reason) {
        ui.removeCallbacks(readyTimeout);
        String bad = state.getString("web_trial", null); // callers mark what is being undone as the trial
        if (bad == null) return false;
        String prev = state.getString("web_prev", null);
        SharedPreferences.Editor e = state.edit().remove("web_trial").remove("web_trial_boots")
            .putString("web_bad", addBad(bad))
            .putString("last_result", "page " + bad + " rolled back: " + reason);
        if (prev != null && !prev.equals(bad)) {
            e.putString("web_active", prev).putLong("web_active_seq", state.getLong("web_prev_seq", 0));
        } else {
            e.remove("web_active").remove("web_active_seq");
        }
        e.remove("web_prev").remove("web_prev_seq").commit();
        refreshActiveDir();
        Log.w(TAG, "web bundle " + bad + " rolled back: " + reason);
        logStatus();
        worker.post(new Runnable() { @Override public void run() { prune(); } });
        return true;
    }

    private void refreshActiveDir() {
        String v = state.getString("web_active", null);
        activeDir = v == null ? null : new File(webRoot, v);
    }

    private boolean isBad(String version) {
        return Arrays.asList(state.getString("web_bad", "").split(",")).contains(version);
    }

    private String addBad(String version) {
        List<String> list = new ArrayList<String>();
        for (String s : state.getString("web_bad", "").split(",")) if (!s.isEmpty() && !s.equals(version)) list.add(s);
        list.add(version);
        while (list.size() > 10) list.remove(0);
        StringBuilder sb = new StringBuilder();
        for (String s : list) sb.append(sb.length() == 0 ? "" : ",").append(s);
        return sb.toString();
    }

    /** Deletes every bundle folder except the active, the previous and the staged one (worker thread). */
    private void prune() {
        Set<String> keep = new HashSet<String>();
        for (String k : new String[] { "web_active", "web_prev", "web_staged" }) {
            String v = state.getString(k, null);
            if (v != null) keep.add(v);
        }
        File[] dirs = webRoot.listFiles();
        if (dirs == null) return;
        for (File d : dirs) if (!keep.contains(d.getName())) deleteTree(d);
    }

    // ---- native install (worker thread) -------------------------------------------------------

    private void install(File apk, int code) {
        state.edit().putInt("apk_installing", code).putString("last_result", "installing app " + code).commit();
        logStatus();
        PackageInstaller.Session session = null;
        try {
            PackageInstaller pi = app.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            p.setAppPackageName(app.getPackageName());
            p.setSize(apk.length());
            session = pi.openSession(pi.createSession(p));
            OutputStream out = session.openWrite("kiosk.apk", 0, apk.length());
            InputStream in = new FileInputStream(apk);
            try {
                byte[] buf = new byte[BUFFER];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            } finally {
                in.close();
                out.close();
            }
            Intent status = new Intent(ACTION_INSTALL_STATUS).setClass(app, OtaReceiver.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE; // the installer fills in the result
            PendingIntent pending = PendingIntent.getBroadcast(app, 7, status, flags);
            session.commit(pending.getIntentSender());
            Log.i(TAG, "app " + code + " handed to the installer");
        } catch (Exception e) {
            if (session != null) {
                try { session.abandon(); } catch (Exception ignored) { }
            }
            recordApkFailure(code, shortError(e));
        } finally {
            if (session != null) {
                try { session.close(); } catch (Exception ignored) { }
            }
        }
    }

    /** From OtaReceiver: the installer's answer. Success is rarely seen: the update replaces this process. */
    void onInstallStatus(int status, String message) {
        int code = state.getInt("apk_installing", 0);
        if (status == PackageInstaller.STATUS_SUCCESS) {
            state.edit().putString("last_result", "app " + code + " installed").commit();
        } else if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // a device owner installs silently; a prompt means the role is missing. Kiosk mode would block the prompt.
            recordApkFailure(code, "the installer asked for confirmation (is the app still the device owner?)");
        } else {
            recordApkFailure(code, "installer status " + status + (message == null ? "" : ": " + message));
        }
        logStatus();
    }

    private void recordApkFailure(int code, String why) {
        int count = state.getInt("apk_fail_code", 0) == code ? state.getInt("apk_fail_count", 0) + 1 : 1;
        state.edit().putInt("apk_fail_code", code).putInt("apk_fail_count", count).remove("apk_installing")
            .putString("last_result", "app " + code + " not installed: " + why).commit();
        Log.w(TAG, "app " + code + " install failed (" + count + "): " + why);
    }

    // ---- network -------------------------------------------------------------------------------

    private void registerNetworkCallback() {
        try {
            ConnectivityManager cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
            cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network network) {
                    worker.post(new Runnable() {
                        @Override public void run() {
                            // the first check after start is the scheduled one; this is for reconnects
                            if (lastCheckAt != 0 && SystemClock.elapsedRealtime() - lastCheckAt > MIN_GAP_MS) check(false);
                        }
                    });
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "no network callback: " + e);
        }
    }

    private static final class Fetched {
        int code;
        byte[] body;
        String etag;
    }

    private void rememberEtag(String key, String etag) {
        if (etag != null && etag.length() <= 200) state.edit().putString(key, etag).commit();
    }

    /** Only https URLs on the pinned update host; redirects are refused, never followed. */
    private HttpURLConnection open(String url) throws IOException {
        URL u = new URL(url);
        String base = updateBase();
        if (!"https".equals(u.getProtocol()) || base == null || !u.getHost().equals(Uri.parse(base).getHost())) {
            throw new IOException("refused address");
        }
        HttpURLConnection c = (HttpURLConnection) u.openConnection();
        c.setInstanceFollowRedirects(false);
        c.setUseCaches(false);
        c.setConnectTimeout(CONNECT_TIMEOUT_MS);
        c.setReadTimeout(READ_TIMEOUT_MS);
        c.setRequestProperty("User-Agent", "SarcafeKiosk-OTA/" + nativeCode);
        return c;
    }

    private Fetched fetchSmall(String url, String etag, int max) throws IOException {
        HttpURLConnection c = open(url);
        try {
            if (etag != null) c.setRequestProperty("If-None-Match", etag);
            Fetched f = new Fetched();
            f.code = c.getResponseCode();
            if (f.code >= 300 && f.code < 400 && f.code != 304) throw new IOException("redirect refused");
            f.etag = c.getHeaderField("ETag");
            if (f.code == 200) {
                InputStream in = c.getInputStream();
                try {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        if (out.size() > max) throw new IOException("response too large");
                    }
                    f.body = out.toByteArray();
                } finally {
                    in.close();
                }
            }
            return f;
        } finally {
            c.disconnect();
        }
    }

    /** Streams one file to disk, never past its declared size, and keeps it only if size and SHA-256 match. */
    private void downloadTo(String url, long size, String sha, File target) throws Exception {
        HttpURLConnection c = open(url);
        File tmp = new File(target.getPath() + ".tmp");
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new IOException((code >= 300 && code < 400 ? "redirect refused" : "HTTP " + code) + " for a file");
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long got = 0;
            InputStream in = c.getInputStream();
            OutputStream out = new FileOutputStream(tmp);
            try {
                byte[] buf = new byte[BUFFER];
                int n;
                while ((n = in.read(buf)) > 0) {
                    got += n;
                    if (got > size) throw new IOException("file larger than the manifest says");
                    md.update(buf, 0, n);
                    out.write(buf, 0, n);
                }
            } finally {
                in.close();
                out.close();
            }
            if (got != size) throw new IOException("file size does not match");
            if (!sha.equals(OtaRules.hex(md.digest()))) throw new IOException("file hash does not match");
            if (!tmp.renameTo(target)) throw new IOException("cannot save file");
        } finally {
            c.disconnect();
            tmp.delete();
        }
    }

    // ---- files ---------------------------------------------------------------------------------

    private static String sha256Of(InputStream in) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[BUFFER];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            return OtaRules.hex(md.digest());
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException(e);
        } finally {
            in.close();
        }
    }

    private static void copy(InputStream in, File target) throws IOException {
        OutputStream out = new FileOutputStream(target);
        try {
            byte[] buf = new byte[BUFFER];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } finally {
            in.close();
            out.close();
        }
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    private static String shortError(Exception e) {
        String m = e.getMessage();
        if (e instanceof java.net.UnknownHostException) return "offline";
        if (e instanceof java.net.SocketTimeoutException) return "timed out";
        if (e instanceof javax.net.ssl.SSLException) return "TLS error";
        if (e instanceof org.json.JSONException) return "bad JSON";
        return m == null ? e.getClass().getSimpleName() : (m.length() > 120 ? m.substring(0, 120) : m);
    }
}
