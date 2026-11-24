package live.tianyi.vvoice.tv;

import java.util.ArrayDeque;

/** Keeps the newest half second of unsent audio while the WebView is busy. */
final class CaptureQueue {
    private static final int LIMIT = 25;
    private final ArrayDeque<String> pcm = new ArrayDeque<>();
    private long delivered, dropped;

    void add(String frame) {
        if (pcm.size() == LIMIT) {
            pcm.removeFirst();
            dropped++;
        }
        pcm.addLast(frame);
    }

    String remove(int channels) {
        // The receiver acknowledges delivery sequence, including after a stall.
        return "{\"sequence\":" + (++delivered) + ",\"channels\":" + channels
                + ",\"pcm\":\"" + pcm.removeFirst() + "\"}";
    }

    int size() { return pcm.size(); }
    boolean isEmpty() { return pcm.isEmpty(); }
    long dropped() { return dropped; }

    void clear() {
        pcm.clear();
        delivered = dropped = 0;
    }
}
