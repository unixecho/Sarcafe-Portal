package il.co.sarcafe.kiosk;

/**
 * What a QR-installed kiosk accepts (docs/SARCAFE_KIOSK_INSTALL.md). Plain Java (no Android), so the QA suite compiles and runs it.
 * The QR carries a one-time install code and the portal's address; the app talks only to a portal on this list, and takes only
 * settings of the right shape from its answer.
 */
final class EnrollRules {
    private EnrollRules() {}

    /** The portals a kiosk may enroll with. A QR naming any other address is ignored. */
    static final String[] PORTAL_HOSTS = { "sarcafe-portal.vercel.app" };

    static boolean acceptablePortal(String url) {
        if (url == null || url.length() > 200 || !url.startsWith("https://")) return false;
        String rest = url.substring("https://".length());
        if (rest.endsWith("/")) rest = rest.substring(0, rest.length() - 1);
        for (String h : PORTAL_HOSTS) if (rest.equals(h)) return true;
        return false;
    }

    /** 32 random bytes, base64url: 43 characters. */
    static boolean acceptableCode(String code) {
        return code != null && code.matches("[A-Za-z0-9_-]{43}");
    }

    static boolean acceptableHttps(String url) {
        return url != null && url.startsWith("https://") && url.length() <= 400 && url.indexOf(' ') < 0;
    }

    static boolean acceptableChannel(String channel) {
        return channel != null && channel.matches("[A-Za-z0-9:_-]{1,64}");
    }

    static boolean acceptableKey(String key) {
        return key != null && key.length() >= 8 && key.length() <= 200 && key.matches("[\\x21-\\x7e]+");
    }

    /** The portal's own address with no trailing slash, e.g. https://sarcafe-portal.vercel.app */
    static String base(String portal) {
        return portal.endsWith("/") ? portal.substring(0, portal.length() - 1) : portal;
    }
}
