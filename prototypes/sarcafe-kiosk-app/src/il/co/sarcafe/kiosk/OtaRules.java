package il.co.sarcafe.kiosk;

import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * The update rules that need no Android: which file names a bundle may contain, how a bundle's version is derived
 * from its file list, the size caps, and the required manifest signature. Kept free of android.* so it can be
 * unit-tested with plain javac (see docs/SARCAFE_KIOSK_OTA.md). scripts/publish-kiosk-ota.mjs computes the same
 * version and signs the same payload; the two must stay in step.
 */
final class OtaRules {
    private OtaRules() { }

    /** Hard limits for one web bundle. The publisher enforces the same numbers. */
    static final long MAX_BUNDLE_BYTES = 15L * 1024 * 1024;
    static final long MAX_FILE_BYTES = 8L * 1024 * 1024;
    static final int MAX_FILES = 200;
    static final long MAX_APK_BYTES = 30L * 1024 * 1024;
    static final int MAX_MANIFEST_BYTES = 64 * 1024;

    /**
     * Manifest signing is REQUIRED (security review S-27). This is the base64 DER (SubjectPublicKeyInfo) ECDSA P-256
     * public key printed by `node scripts/sign-kiosk-ota.mjs keygen`; the private key stays on the owner's PC
     * (C:\Users\Johnathan\android-tools\), never on GitHub or Vercel. While this is empty the kiosk takes no web
     * update at all (fail closed). Changing it needs a new APK.
     */
    static final String PUBLIC_KEY_B64 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEfSAb30GqPVrVK50s+9xUSqZrIDt5TGRq79pKUFu601T8V6/56/YhIHa57H1e2ttsUJuDSARPN8Tzum22oCMKoQ==";

    static boolean hasPublicKey() {
        return PUBLIC_KEY_B64.length() > 0;
    }

    /** One file of a bundle as the manifest lists it. */
    static final class Entry {
        final String path;
        final String sha256;
        final long size;
        Entry(String path, String sha256, long size) {
            this.path = path;
            this.sha256 = sha256;
            this.size = size;
        }
    }

    /**
     * A bundle file name: flat (no folders), ASCII letters, digits, dot, dash, underscore; no leading dot, no "..",
     * at most 100 characters. Anything else is refused before it can become a path on disk or a served URL.
     */
    static boolean isSafeName(String name) {
        if (name == null || name.length() == 0 || name.length() > 100) return false;
        if (name.charAt(0) == '.' || name.contains("..")) return false;
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                || c == '.' || c == '-' || c == '_';
            if (!ok) return false;
        }
        return true;
    }

    /** A bundle version: 16 lowercase hex characters (the publisher's content hash). */
    static boolean isVersion(String v) {
        return v != null && v.matches("[0-9a-f]{16}");
    }

    static boolean isSha256(String v) {
        return v != null && v.matches("[0-9a-f]{64}");
    }

    /**
     * Checks a manifest's file list. Returns null when it is acceptable, otherwise the reason.
     * index.html must be present; names must be safe and unique; sizes and counts within the caps.
     */
    static String checkEntries(List<Entry> files) {
        if (files == null || files.isEmpty()) return "no files";
        if (files.size() > MAX_FILES) return "too many files";
        long total = 0;
        boolean index = false;
        List<String> seen = new ArrayList<String>();
        for (Entry e : files) {
            if (!isSafeName(e.path)) return "unsafe name";
            String lower = e.path.toLowerCase(Locale.ROOT);
            if (seen.contains(lower)) return "duplicate name";
            seen.add(lower);
            if (!isSha256(e.sha256)) return "bad hash";
            if (e.size < 0 || e.size > MAX_FILE_BYTES) return "file too large";
            total += e.size;
            if (total > MAX_BUNDLE_BYTES) return "bundle too large";
            if (e.path.equals("index.html")) index = true;
        }
        return index ? null : "no index.html";
    }

    /**
     * The version of a file list: the first 16 hex characters of SHA-256 over "path\nsha256\nsize\n" for every file,
     * sorted by path. The kiosk recomputes it, so a manifest cannot claim one version and list another bundle.
     */
    static String computeVersion(List<Entry> files) {
        List<Entry> sorted = new ArrayList<Entry>(files);
        Collections.sort(sorted, new java.util.Comparator<Entry>() {
            @Override public int compare(Entry a, Entry b) { return a.path.compareTo(b.path); }
        });
        StringBuilder sb = new StringBuilder();
        for (Entry e : sorted) sb.append(e.path).append('\n').append(e.sha256).append('\n').append(e.size).append('\n');
        return sha256Hex(utf8(sb.toString())).substring(0, 16);
    }

    /** The exact bytes the signature covers. The version already covers every file's hash and size. */
    static byte[] signaturePayload(String version, long seq, int minNativeVersion) {
        return utf8("sarcafe-kiosk-ota-v1\n" + version + "\n" + seq + "\n" + minNativeVersion + "\n");
    }

    /** SHA256withECDSA (P-256) check of a DER signature, both base64. False on any error. */
    static boolean verifySignature(String publicKeyB64, byte[] payload, String signatureB64) {
        try {
            byte[] key = base64Decode(publicKeyB64);
            byte[] sig = base64Decode(signatureB64);
            if (key == null || sig == null) return false;
            PublicKey pk = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(key));
            Signature s = Signature.getInstance("SHA256withECDSA");
            s.initVerify(pk);
            s.update(payload);
            return s.verify(sig);
        } catch (Exception e) {
            return false;
        }
    }

    /** Next wait after `errors` failed checks in a row: 10 min normally, doubling on errors up to 2 h. */
    static long nextDelayMs(int errors) {
        long base = 10L * 60 * 1000;
        if (errors <= 0) return base;
        long d = base << Math.min(errors, 4); // 20, 40, 80, 160 min ...
        return Math.min(d, 2L * 60 * 60 * 1000);
    }

    /** Content type for a served bundle file, by extension. */
    static String mimeFor(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        int dot = n.lastIndexOf('.');
        String ext = dot < 0 ? "" : n.substring(dot + 1);
        if (ext.equals("html") || ext.equals("htm")) return "text/html";
        if (ext.equals("js") || ext.equals("mjs")) return "text/javascript";
        if (ext.equals("css")) return "text/css";
        if (ext.equals("json")) return "application/json";
        if (ext.equals("txt")) return "text/plain";
        if (ext.equals("svg")) return "image/svg+xml";
        if (ext.equals("png")) return "image/png";
        if (ext.equals("jpg") || ext.equals("jpeg")) return "image/jpeg";
        if (ext.equals("webp")) return "image/webp";
        if (ext.equals("gif")) return "image/gif";
        if (ext.equals("ico")) return "image/x-icon";
        if (ext.equals("woff2")) return "font/woff2";
        if (ext.equals("woff")) return "font/woff";
        if (ext.equals("ttf")) return "font/ttf";
        if (ext.equals("mp4")) return "video/mp4";
        if (ext.equals("webm")) return "video/webm";
        return "application/octet-stream";
    }

    static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.equals("application/json") || mime.equals("image/svg+xml");
    }

    // ---- small helpers ----------------------------------------------------------------------

    static byte[] utf8(String s) {
        try {
            return s.getBytes("UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    static String sha256Hex(byte[] data) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static String hex(byte[] d) {
        char[] digits = "0123456789abcdef".toCharArray();
        char[] out = new char[d.length * 2];
        for (int i = 0; i < d.length; i++) {
            out[i * 2] = digits[(d[i] >> 4) & 15];
            out[i * 2 + 1] = digits[d[i] & 15];
        }
        return new String(out);
    }

    /** Standard base64 (RFC 4648, padding optional). Own decoder: java.util.Base64 is API 26, android.util is not plain Java. */
    static byte[] base64Decode(String s) {
        if (s == null) return null;
        String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        int buf = 0;
        int bits = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '=') break;
            if (c == '\n' || c == '\r' || c == ' ') continue;
            int v = alphabet.indexOf(c);
            if (v < 0) return null;
            buf = (buf << 6) | v;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out.write((buf >> bits) & 0xff);
            }
        }
        return out.toByteArray();
    }
}
