package il.co.sarcafe.kiosk;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.os.PersistableBundle;

/**
 * Device-owner hook. The policies are applied from MainActivity once the app is the device owner. After a QR install (Android
 * 7–9, and as a fallback later) the setup ends here: the install code is kept and the kiosk starts. docs/SARCAFE_KIOSK_INSTALL.md.
 */
public class KioskAdminReceiver extends DeviceAdminReceiver {
    @Override
    public void onProfileProvisioningComplete(Context context, Intent intent) {
        PersistableBundle extras = intent.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE);
        Enrollment.saveExtras(context, extras);
        context.startActivity(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
}
