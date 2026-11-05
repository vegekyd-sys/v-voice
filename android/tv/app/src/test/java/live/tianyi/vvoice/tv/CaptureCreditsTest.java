package live.tianyi.vvoice.tv;
import org.junit.Test;
import static org.junit.Assert.*;

public class CaptureCreditsTest {
    @Test public void slowConsumerCannotCreateUnboundedMessages(){
        CaptureCredits c=new CaptureCredits();for(int n=0;n<8;n++)c.sent();
        assertFalse(c.available());assertEquals(8,c.peak());
        assertThrows(IllegalStateException.class,c::sent);
        c.acknowledge(1);assertTrue(c.available());c.sent();assertFalse(c.available());
        for(int n=2;n<=9;n++)c.acknowledge(n);assertTrue(c.available());
    }
    @Test public void duplicateFutureAndCrossGenerationAcknowledgementsCannotGrantCredit(){
        CaptureCredits c=new CaptureCredits();c.sent();
        assertThrows(IllegalArgumentException.class,()->c.acknowledge(2));
        c.acknowledge(1);assertThrows(IllegalArgumentException.class,()->c.acknowledge(1));
        c.reset();assertThrows(IllegalArgumentException.class,()->c.acknowledge(1));
        assertEquals(0,c.peak());assertTrue(c.available());
    }
}
