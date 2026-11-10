package live.tianyi.vvoice.tv;

import org.junit.Test;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class RemoteVoiceKeyServiceTest {
    @Test public void matchesOnlyTheMeasuredSwitch() {
        assertTrue(RemoteVoiceKeyService.matches(0x2717, 0x32b8, 0, 63));
        assertFalse(RemoteVoiceKeyService.matches(0x2717, 0x32ba, 0, 63));
        assertFalse(RemoteVoiceKeyService.matches(0, 0x32b8, 0, 63));
        assertFalse(RemoteVoiceKeyService.matches(0x2717, 0x32b8, 0, 64));
        assertFalse(RemoteVoiceKeyService.matches(0x2717, 0x32b8, 135, 63));
    }
}
