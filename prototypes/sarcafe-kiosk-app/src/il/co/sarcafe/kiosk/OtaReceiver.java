package il.co.sarcafe.kiosk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;

/**
 * Two jobs after a native self-update:
 *  - MY_PACKAGE_REPLACED: the new version of this app was just installed (the old process was killed). Start the
 *    kiosk again at once; MainActivity.onCreate/onResume put lock-task, the home role and the policies back. A device
 *    owner may start an activity from the background, and as the persistent home app it would come back on the next
 *    Home event anyway.
 *  - OTA_INSTALL_STATUS: PackageInstaller's answer for a session OtaUpdater committed (not exported; only the
 *    installer, through our own PendingIntent, sends it).
 */
public class OtaReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Log.i(OtaUpdater.TAG, "app replaced, starting the kiosk again");
            try {
                context.startActivity(new Intent(context, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
            } catch (Exception e) {
                Log.w(OtaUpdater.TAG, "could not start the kiosk after the update: " + e);
            }
        } else if (OtaUpdater.ACTION_INSTALL_STATUS.equals(action)) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            OtaUpdater.get(context).onInstallStatus(status, message);
        }
    }
}
