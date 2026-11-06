package il.co.sarcafe.kiosk;

import android.app.Activity;
import android.os.Bundle;
import android.os.Parcelable;

/**
 * The last step of Android 10+ QR setup: the app is now the device owner. Keeps the install code (if the previous step did not)
 * and says it is ready; MainActivity starts kiosk mode and trades the code for its settings. docs/SARCAFE_KIOSK_INSTALL.md.
 */
public class PolicyComplianceActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Parcelable extras = getIntent().getParcelableExtra(ProvisioningModeActivity.EXTRA_ADMIN_EXTRAS);
        if (extras instanceof android.os.BaseBundle) Enrollment.saveExtras(this, (android.os.BaseBundle) extras);
        setResult(RESULT_OK);
        finish();
    }
}
