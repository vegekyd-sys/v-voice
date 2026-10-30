package live.tianyi.vvoice.tv;
import org.junit.Test;
import static org.junit.Assert.*;
public class ArrayLayoutTest {
    @Test public void onlyVerifiedHardwareAndFormatAdvertiseTheWiring() {
        assertNotNull(ArrayLayout.forCapture("MiTV-MFTR0",4,16000));
        assertNull(ArrayLayout.forCapture("sdk_gphone64_arm64",4,16000));
        assertNull(ArrayLayout.forCapture("MiTV-MFTR0",6,16000));
        assertNull(ArrayLayout.forCapture("MiTV-MFTR0",4,48000));
    }
}
