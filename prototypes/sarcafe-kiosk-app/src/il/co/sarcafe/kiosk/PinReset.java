package il.co.sarcafe.kiosk;

/**
 * A new staff PIN chosen on the dashboard (docs/SARCAFE_KIOSK_REMOTE.md). The portal never has the PIN: it sends the record the
 * app keeps anyway ("pbkdf2$<iterations>$<salt hex 16 bytes>$<hash hex 32 bytes>", the StaffPin format), fetched with the kiosk
 * key from the update host (OtaUpdater.checkPinReset). These are the rules for taking one; free of android.* so it is unit-tested
 * with plain javac (scripts/check-kiosk-remote.mjs), together with a record made by the portal's own code.
 */
final class PinReset {
    private PinReset() { }

    private static final java.util.regex.Pattern RECORD = java.util.regex.Pattern.compile("^pbkdf2\\$([0-9]{4,7})\\$[0-9a-f]{32}\\$[0-9a-f]{64}$");
    private static final java.util.regex.Pattern ID = java.util.regex.Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    private static final java.util.regex.Pattern SLUG = java.util.regex.Pattern.compile("^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$");

    /** A record the PIN dialog can verify: the exact format, and iterations inside StaffPin.verify's bounds. */
    static boolean acceptableRecord(String record) {
        if (record == null) return false;
        java.util.regex.Matcher m = RECORD.matcher(record);
        if (!m.matches()) return false;
        int iterations = Integer.parseInt(m.group(1));
        return iterations >= 1000 && iterations <= 1000000;
    }

    static boolean acceptableId(String id) {
        return id != null && ID.matcher(id).matches();
    }

    /** The tablet's name in the portal (kiosk_devices.slug), set with the `device` adb extra; the first tablet otherwise. */
    static String deviceOrDefault(String slug) {
        return slug != null && SLUG.matcher(slug).matches() ? slug : "givat-haviva-1";
    }
}
