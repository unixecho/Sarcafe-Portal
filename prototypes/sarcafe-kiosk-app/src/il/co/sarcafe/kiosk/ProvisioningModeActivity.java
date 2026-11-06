package il.co.sarcafe.kiosk;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Parcelable;

/**
 * Android 10+ QR setup asks the kiosk app which mode it wants: a fully managed device (the app becomes the device owner, so kiosk
 * mode locks and updates install silently). Keeps the install code from the QR's extras. docs/SARCAFE_KIOSK_INSTALL.md.
 */
public class ProvisioningModeActivity extends Activity {
    static final String EXTRA_ADMIN_EXTRAS = "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE";
    static final String EXTRA_MODE = "android.app.extra.PROVISIONING_MODE";
    static final int MODE_FULLY_MANAGED = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Parcelable extras = getIntent().getParcelableExtra(EXTRA_ADMIN_EXTRAS);
        if (extras instanceof android.os.BaseBundle) Enrollment.saveExtras(this, (android.os.BaseBundle) extras);
        setResult(RESULT_OK, new Intent().putExtra(EXTRA_MODE, MODE_FULLY_MANAGED));
        finish();
    }
}
