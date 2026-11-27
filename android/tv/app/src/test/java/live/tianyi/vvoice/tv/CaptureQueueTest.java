package live.tianyi.vvoice.tv;

import org.junit.Test;
import static org.junit.Assert.*;

public class CaptureQueueTest {
    @Test public void stalledConsumerResumesWithFreshAudioAndContiguousCredits() {
        CaptureQueue queue = new CaptureQueue();
        queue.add("first");
        assertTrue(queue.remove(4).contains("\"sequence\":1"));
        for (int i = 0; i < 30; i++) queue.add(Integer.toString(i));
        assertEquals(25, queue.size());
        assertEquals(5, queue.dropped());
        assertEquals("{\"sequence\":2,\"channels\":4,\"pcm\":\"5\"}", queue.remove(4));
        queue.clear();
        assertTrue(queue.isEmpty());
        assertEquals(0, queue.dropped());
        queue.add("next");
        assertTrue(queue.remove(6).contains("\"sequence\":1"));
    }
}
