package il.co.sarcafe.kiosk;

import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * The staff PIN, stored as "pbkdf2$<iterations>$<salt hex>$<hash hex>" (PBKDF2WithHmacSHA1, a random 16-byte salt;
 * available from API 24). A new PIN must be 6-8 digits. The old unsalted SHA-256 format ("pin_hash") is still accepted
 * once and replaced by the new format on that first correct entry. After 5 wrong tries the dialog locks for a growing
 * time. Free of android.* so it is unit-tested with plain javac.
 */
final class StaffPin {
    private StaffPin() { }

    static final int ITERATIONS = 15000;
    static final int FREE_TRIES = 5;

    static boolean isAcceptableNewPin(String pin) {
        return pin != null && pin.matches("\\d{6,8}");
    }

    static String create(String pin, SecureRandom random) {
        byte[] salt = new byte[16];
        random.nextBytes(salt);
        return "pbkdf2$" + ITERATIONS + "$" + OtaRules.hex(salt) + "$" + OtaRules.hex(derive(pin, salt, ITERATIONS));
    }

    /** True when `pin` matches a stored "pbkdf2$..." record. Constant-time comparison of the derived keys. */
    static boolean verify(String stored, String pin) {
        if (stored == null || pin == null) return false;
        String[] p = stored.split("\\$");
        if (p.length != 4 || !p[0].equals("pbkdf2")) return false;
        try {
            int iterations = Integer.parseInt(p[1]);
            if (iterations < 1000 || iterations > 1000000) return false;
            byte[] salt = unhex(p[2]);
            byte[] want = unhex(p[3]);
            if (salt == null || want == null) return false;
            return MessageDigest.isEqual(want, derive(pin, salt, iterations));
        } catch (NumberFormatException e) {
            return false;
        }
    }

    /** The format used before 2026-10-28 (unsalted SHA-256), only to recognise an existing PIN once. */
    static boolean verifyLegacy(String storedHex, String pin) {
        if (storedHex == null || pin == null) return false;
        byte[] want = unhex(storedHex);
        byte[] got = unhex(OtaRules.sha256Hex(OtaRules.utf8("sarcafe-kiosk:" + pin)));
        return want != null && MessageDigest.isEqual(want, got);
    }

    /** How long the PIN dialog stays locked after `failures` wrong tries in a row: 0 for the first 5, then 30 s doubling to 1 h. */
    static long lockoutMs(int failures) {
        if (failures < FREE_TRIES) return 0;
        long ms = 30000L << Math.min(failures - FREE_TRIES, 7);
        return Math.min(ms, 60L * 60 * 1000);
    }

    private static byte[] derive(String pin, byte[] salt, int iterations) {
        try {
            PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), salt, iterations, 256);
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).getEncoded();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static byte[] unhex(String s) {
        if (s == null || s.length() % 2 != 0) return null;
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(s.charAt(i * 2), 16);
            int lo = Character.digit(s.charAt(i * 2 + 1), 16);
            if (hi < 0 || lo < 0) return null;
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }
}
