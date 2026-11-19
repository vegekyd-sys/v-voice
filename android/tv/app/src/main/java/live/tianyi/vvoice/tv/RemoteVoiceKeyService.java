package live.tianyi.vvoice.tv;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/** Enabled by a firmware integrator after the matching Bluetooth service policy is active. */
public final class RemoteVoiceKeyService extends AccessibilityService {
    private long handledDownTime = -1;

    static boolean matches(int vendor, int product, int key, int scan) {
        return vendor == 0x2717 && product == 0x32b8 && key == KeyEvent.KEYCODE_UNKNOWN && scan == 63;
    }

    @Override protected boolean onKeyEvent(KeyEvent event) {
        InputDevice device = event.getDevice();
        if (device == null || !matches(device.getVendorId(), device.getProductId(),
                event.getKeyCode(), event.getScanCode())) return false;
        long downTime = event.getDownTime();
        if (event.getAction() == KeyEvent.ACTION_UP) {
            boolean handled = handledDownTime == downTime;
            handledDownTime = -1;
            return handled;
        }
        if (event.getAction() != KeyEvent.ACTION_DOWN || event.isCanceled()) return false;
        if (downTime == handledDownTime || event.getRepeatCount() > 0) return downTime == handledDownTime;

        if (!CallService.expandRemoteCall()) {
            startActivity(new Intent(this, MainActivity.class).setAction(CallService.START_CALL)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        handledDownTime = downTime;
        return true;
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {}
    @Override public void onInterrupt() { handledDownTime = -1; }
}
